// Ponte segura entre a página e o aplicativo. Só é exposta para o site configurado ou a tela de configuração.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tavernaApp', {
  isApp: true,
  windowControls: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    onState: (cb) => { ipcRenderer.removeAllListeners('win:state'); ipcRenderer.on('win:state', (_e, s) => cb(s)); },
  },
  version: ipcRenderer.sendSync('app:version'),
  installUpdate: (url) => ipcRenderer.invoke('app:install-update', url),
  onUpdateProgress: (cb) => { ipcRenderer.removeAllListeners('app:update-progress'); ipcRenderer.on('app:update-progress', (_e, p) => cb(p)); },
  getSources: () => ipcRenderer.invoke('app:get-sources'),
  selectSource: (id, audio) => ipcRenderer.invoke('app:select-source', id, audio),
  // Som só da janela compartilhada (Windows 10 2004+)
  windowAudio: {
    start: () => ipcRenderer.invoke('app:win-audio-start'),
    stop: () => ipcRenderer.invoke('app:win-audio-stop'),
    onData: (cb) => { ipcRenderer.removeAllListeners('app:win-audio'); ipcRenderer.on('app:win-audio', (_e, chunk) => cb(chunk)); },
  },
  // Modo gamer: Taverna com prioridade abaixo do normal (o jogo vem primeiro)
  setGamer: (on) => ipcRenderer.invoke('app:gamer', !!on),
  googleLogin: () => ipcRenderer.invoke('app:google-login'),
  openSetup: () => ipcRenderer.invoke('app:open-setup'),
  getServer: () => ipcRenderer.invoke('app:get-server'),
  setServer: (url) => ipcRenderer.invoke('app:set-server', url),
});
