// Ponte segura entre a página e o aplicativo. Só é exposta para o site configurado ou a tela de configuração.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tavernaApp', {
  isApp: true,
  getSources: () => ipcRenderer.invoke('app:get-sources'),
  selectSource: (id, audio) => ipcRenderer.invoke('app:select-source', id, audio),
  googleLogin: () => ipcRenderer.invoke('app:google-login'),
  openSetup: () => ipcRenderer.invoke('app:open-setup'),
  getServer: () => ipcRenderer.invoke('app:get-server'),
  setServer: (url) => ipcRenderer.invoke('app:set-server', url),
});
