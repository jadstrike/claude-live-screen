const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("claudeScreen", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  listDisplays: () => ipcRenderer.invoke("displays:list"),
  setVision: (enabled) => ipcRenderer.invoke("vision:set", enabled),
  startWatch: () => ipcRenderer.invoke("watch:start"),
  stopWatch: () => ipcRenderer.invoke("watch:stop"),
  analyzeNow: () => ipcRenderer.invoke("analyze:now"),
  ask: (question) => ipcRenderer.invoke("ask", question),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  setOverlayClickThrough: (enabled) =>
    ipcRenderer.invoke("overlay:set-click-through", enabled),
  hideOverlay: () => ipcRenderer.invoke("overlay:hide"),
  openScreenPermissionSettings: () =>
    ipcRenderer.invoke("open-screen-permission-settings"),
  onEvent: (callback) => {
    const listener = (_event, name, payload) => callback(name, payload);
    ipcRenderer.on("app-event", listener);
    return () => ipcRenderer.removeListener("app-event", listener);
  },
});
