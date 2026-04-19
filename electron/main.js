const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
    process.exit(0);
}

const PORT = Number(process.env.PORT) || 3000;
const START_URL = `http://127.0.0.1:${PORT}/`;
let embeddedServer = null;

/** Запуск Express-сервера из корня проекта (рядом с этим файлом в asar). */
function startServer() {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const serverModule = require(serverPath);
    embeddedServer = serverModule && serverModule.httpServer ? serverModule.httpServer : null;
}

function waitForHealth(callback, maxAttempts = 80) {
    let n = 0;
    const tryOnce = () => {
        const req = http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
            res.resume();
            if (res.statusCode === 200) {
                callback();
            } else {
                retry();
            }
        });
        req.on('error', retry);
        function retry() {
            n += 1;
            if (n >= maxAttempts) {
                console.error('ПомРеж: сервер не ответил на /health, открываю окно всё равно.');
                callback();
                return;
            }
            setTimeout(tryOnce, 150);
        }
    };
    tryOnce();
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 900,
        minHeight: 600,
        title: 'ПомРеж',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false
    });

    win.once('ready-to-show', () => win.show());
    win.loadURL(START_URL);
}

app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) {
        const w = wins[0];
        if (w.isMinimized()) w.restore();
        w.focus();
    }
});

ipcMain.handle('dialog:saveFile', async (_event, content, defaultName) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: defaultName || 'show.show.json',
        filters: [
            { name: 'Show Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (canceled || !filePath) return null;
    try {
        fs.writeFileSync(filePath, content, 'utf-8');
        return filePath;
    } catch (err) {
        console.error('Ошибка сохранения:', err);
        return null;
    }
});

ipcMain.handle('dialog:saveToPath', async (_event, filePath, content) => {
    try {
        fs.writeFileSync(filePath, content, 'utf-8');
        return true;
    } catch (err) {
        console.error('Ошибка сохранения в путь:', err);
        return false;
    }
});

ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        filters: [
            { name: 'Show Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
    });

    if (canceled || !filePaths.length) return null;
    const filePath = filePaths[0];
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return {
            content,
            filePath,
            fileName: path.basename(filePath)
        };
    } catch (err) {
        console.error('Ошибка открытия:', err);
        return null;
    }
});

ipcMain.handle('dialog:showMessage', async (_event, title, message, type = 'info') => {
    await dialog.showMessageBox({
        type: type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info',
        title: title || 'Run of Show',
        message: message || '',
        buttons: ['OK']
    });
    return true;
});

ipcMain.handle('app:quit', async () => {
    app.quit();
    return true;
});

ipcMain.handle('system:openExternal', async (_event, url) => {
    if (!url || typeof url !== 'string') return false;
    await shell.openExternal(url);
    return true;
});

ipcMain.handle('system:openDevTools', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
        win.webContents.openDevTools();
        return true;
    }
    return false;
});

app.whenReady().then(() => {
    process.env.PORT = String(PORT);
    startServer();
    waitForHealth(createWindow);
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', () => {
    if (embeddedServer && typeof embeddedServer.close === 'function') {
        try {
            embeddedServer.close();
        } catch (err) {
            console.error('ПомРеж: ошибка при остановке встроенного сервера:', err);
        }
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        waitForHealth(createWindow);
    }
});
