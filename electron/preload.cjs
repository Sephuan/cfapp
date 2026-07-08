// Tiny preload exposing a logout bridge to the renderer. The renderer can't
// touch sessions directly (contextIsolation: true, nodeIntegration: false),
// so we round-trip through ipcMain.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cfapp", {
  logoutCf: () => ipcRenderer.invoke("cfapp:logout-cf"),
});
