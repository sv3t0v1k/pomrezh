/**
 * Простой OSC UDP-приёмник для отладки (запуск: node test_osc_receiver.js).
 * Слушает порт 7000 на 0.0.0.0 — должен совпадать с «Порт» в пульте.
 */
const dgram = require('dgram');

const PORT = Number(process.env.OSC_TEST_PORT) || 7000;

(async () => {
    let fromBuffer;
    try {
        const oscMin = await import('osc-min');
        fromBuffer = oscMin.fromBuffer;
    } catch (e) {
        console.error('Не удалось загрузить osc-min:', e.message);
        process.exit(1);
    }

    const udpSocket = dgram.createSocket('udp4');

    udpSocket.on('error', (err) => {
        console.log(`Ошибка сокета: ${err.message}`);
    });

    udpSocket.on('message', (msg, rinfo) => {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📨 UDP от ${rinfo.address}:${rinfo.port}, ${msg.length} байт`);
        try {
            const oscMsg = fromBuffer(msg);
            console.log(`   Адрес: ${oscMsg.address}`);
            console.log('   Аргументы:', oscMsg.args);
        } catch (e) {
            console.log('   Не удалось декодировать OSC:', e.message);
            console.log('   Сырые байты (hex):', msg.toString('hex'));
        }
    });

    udpSocket.bind(PORT, () => {
        console.log(`🎧 OSC тестовый приёмник: UDP 0.0.0.0:${PORT}`);
        console.log('   Ожидание пакетов... (Ctrl+C — выход)');
    });
})();
