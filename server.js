const express = require('express');
const path = require('path');
const dgram = require('dgram');

const app = express();
const port = Number(process.env.PORT) || 3000;

/** Подробные логи OSC: `OSC_DEBUG=1 node server.js` (по умолчанию выкл.) */
const OSC_DEBUG = process.env.OSC_DEBUG === '1' || process.env.OSC_DEBUG === 'true';

function oscLog(...args) {
    if (OSC_DEBUG) console.log(...args);
}

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname)));

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'scenario-control-panel'
    });
});

/**
 * Приводит аргументы к виду, который osc-min стабильно кодирует в OSC 1.0.
 */
function normalizeArgsForOscMin(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((arg) => {
        if (arg === null || arg === undefined) return '';
        if (typeof arg === 'number' && Number.isFinite(arg)) {
            return Number.isInteger(arg) ? arg : arg;
        }
        if (typeof arg === 'boolean') return arg;
        if (typeof arg === 'object' && arg !== null && 'type' in arg && 'value' in arg) {
            return arg;
        }
        return String(arg);
    });
}

/**
 * Отправка OSC по UDP (клиент шлёт JSON).
 * Body: { host?, port?, remoteIP?, remotePort?, address: string, args?: array }
 */
app.post('/api/osc', async (req, res) => {
    const body = req.body || {};
    const host = body.host ?? body.remoteIP;
    const portRaw = body.port ?? body.remotePort;

    if (OSC_DEBUG) {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📨 OSC запрос получен:', new Date().toISOString());
        console.log('   Body:', JSON.stringify(body, null, 2));
    }

    const address = body.address;
    if (!address || typeof address !== 'string' || !address.startsWith('/')) {
        oscLog('❌ Ошибка: нет корректного address в запросе');
        return res.status(400).json({
            error: 'address must be a non-empty OSC path starting with /',
            success: false,
            ok: false
        });
    }

    const targetHost = typeof host === 'string' && host.trim() ? host.trim() : '127.0.0.1';
    const targetPort = Number(portRaw) > 0 && Number(portRaw) < 65536 ? Number(portRaw) : 7000;
    const argList = normalizeArgsForOscMin(Array.isArray(body.args) ? body.args : []);

    if (OSC_DEBUG) {
        console.log(`   Цель: ${targetHost}:${targetPort}`);
        console.log(`   Адрес: ${address}`);
        console.log('   Аргументы:', argList);
    }

    let oscBuffer;
    try {
        const { toBuffer } = await import('osc-min');
        oscBuffer = toBuffer({ address, args: argList });
        const bufLen = oscBuffer && typeof oscBuffer.length === 'number'
            ? oscBuffer.length
            : (oscBuffer && oscBuffer.byteLength) || 0;
        oscLog('   OSC пакет сформирован, размер:', bufLen, 'байт');
    } catch (err) {
        console.error('❌ Ошибка формирования OSC пакета:', err.message);
        return res.status(500).json({
            error: 'OSC encoding failed',
            details: err.message,
            success: false,
            ok: false
        });
    }

    const udpSocket = dgram.createSocket('udp4');
    const sendLen = oscBuffer && typeof oscBuffer.length === 'number'
        ? oscBuffer.length
        : (oscBuffer && oscBuffer.byteLength) || 0;
    udpSocket.send(oscBuffer, 0, sendLen, targetPort, targetHost, (err) => {
        udpSocket.close();
        if (err) {
            console.error('❌ Ошибка отправки UDP:', err.message);
            return res.status(500).json({
                error: 'UDP send failed',
                details: err.message,
                success: false,
                ok: false
            });
        }
        oscLog('✅ OSC отправлен успешно (UDP)');
        res.json({ ok: true, success: true });
    });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        details: err.message,
        timestamp: new Date().toISOString()
    });
});

function testUdpStack() {
    if (!OSC_DEBUG) return;
    try {
        const s = dgram.createSocket('udp4');
        s.on('error', (err) => {
            console.log('[OSC] ⚠️ UDP сокет (тест):', err.message);
            s.close();
        });
        s.bind(0, '127.0.0.1', () => {
            const a = s.address();
            console.log(`[OSC] ✅ UDP стек Node.js: сокет открыт, эфемерный порт ${a.port} (приёмник на целевом порту может занять его отдельно)`);
            s.close();
        });
    } catch (e) {
        console.log('[OSC] ⚠️ UDP тест:', e.message);
    }
}

const httpServer = app.listen(port, async () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('🎛️ OSC: POST /api/osc → UDP (логи OSC: OSC_DEBUG=1)');
    try {
        await import('osc-min');
        console.log('   osc-min: модуль доступен (динамический import)');
    } catch (e) {
        console.error('   osc-min: ошибка загрузки', e.message);
    }
    testUdpStack();
}).on('error', (err) => {
    console.error('Server failed to start:', err);
});

module.exports = { app, httpServer };
