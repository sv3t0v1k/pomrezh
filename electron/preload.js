const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    saveFile: (content, defaultName) => ipcRenderer.invoke('dialog:saveFile', content, defaultName),
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    saveToPath: (filePath, content) => ipcRenderer.invoke('dialog:saveToPath', filePath, content),
    showMessage: (title, message, type = 'info') => ipcRenderer.invoke('dialog:showMessage', title, message, type),
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
    openDevTools: () => ipcRenderer.invoke('system:openDevTools'),
    quit: () => ipcRenderer.invoke('app:quit'),
    isElectron: true
});
