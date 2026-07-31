const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wahongshu", {
  getState: () => ipcRenderer.invoke("wahongshu:get-state"),
  browserAction: (action) =>
    ipcRenderer.invoke("wahongshu:browser-action", action),
  navigate: (value) => ipcRenderer.invoke("wahongshu:navigate", value),
  startCurrent: (limit) =>
    ipcRenderer.invoke("wahongshu:start-current", { limit }),
  cancel: () => ipcRenderer.invoke("wahongshu:cancel"),
  openDownloads: () => ipcRenderer.invoke("wahongshu:open-downloads"),
  openDevTools: () => ipcRenderer.invoke("wahongshu:open-devtools"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("wahongshu:state", listener);
    return () => ipcRenderer.removeListener("wahongshu:state", listener);
  },
});
