const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('leonel', {
  hide: () => ipcRenderer.send('hide-window'),
  onScreenshot: (cb) => ipcRenderer.on('screenshot-captured', (_e, b64) => cb(b64)),
  removeScreenshotListener: () => ipcRenderer.removeAllListeners('screenshot-captured'),
  checkScreenPermission: () => ipcRenderer.invoke('check-screen-permission'),
});
