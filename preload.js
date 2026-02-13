const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('leonel', {
  hide: () => ipcRenderer.send('hide-window'),
});
