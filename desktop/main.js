// Taverna na Combie — aplicativo para Windows (Electron).
// Abre o site da Taverna numa janela própria, com seletor de tela nativo e login com Google pelo navegador.
const { app, BrowserWindow, desktopCapturer, ipcMain, session, dialog, shell, Menu } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'Taverna na Combie';
if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.tavernanacombie.app');

let win = null;
let selectedSourceId = null;
let selectedAudio = false;

// ---------- Configuração (endereço do site) ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() {
  let defaults = {};
  try { defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-config.json'), 'utf8')); } catch {}
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { return defaults; }
}
function writeSettings(next) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
}
const serverUrl = () => String(readSettings().serverUrl || '').replace(/\/+$/, '');
const serverOrigin = () => { try { return new URL(serverUrl()).origin; } catch { return null; } };

function loadSetup(error) {
  return win.loadFile(path.join(__dirname, 'app', 'setup.html'), { query: error ? { erro: '1' } : {} });
}
function loadSite() {
  const url = serverUrl();
  return url ? win.loadURL(url + '/') : loadSetup();
}

// ---------- Janela ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 900, minWidth: 900, minHeight: 640,
    backgroundColor: '#12062a', title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, // continua transmitindo com a janela minimizada
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());

  // Entrega a tela escolhida no seletor da página ao getDisplayMedia.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      const wantWindow = String(selectedSourceId || '').startsWith('window:');
      let sources = await desktopCapturer.getSources({ types: [wantWindow ? 'window' : 'screen'] });
      let source = sources.find((s) => s.id === selectedSourceId);
      if (!source) { // janela fechada ou tela trocada: usa a tela principal
        sources = wantWindow ? await desktopCapturer.getSources({ types: ['screen'] }) : sources;
        source = sources[0];
      }
      if (!source) return callback({});
      callback(selectedAudio && process.platform === 'win32' ? { video: source, audio: 'loopback' } : { video: source });
    } catch (e) { console.error(e); callback({}); }
  });

  // Só navega dentro do site da Taverna; o resto abre no navegador padrão.
  const allowed = (url) => url.startsWith('file:') || (serverOrigin() && url.startsWith(serverOrigin()));
  win.webContents.on('will-navigate', (e, url) => {
    if (!allowed(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // Site fora do ar / sem internet: volta para a tela de configuração.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && !url.startsWith('file:')) loadSetup(true);
  });

  // Confirma antes de fechar durante uma transmissão.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Encerrar e sair', 'Continuar transmitindo'], defaultId: 1, cancelId: 1,
      title: APP_NAME, message: 'Você está transmitindo a tela.',
      detail: 'Sair encerra a transmissão para todos que estão assistindo.',
    });
    if (choice === 0) event.preventDefault();
  });

  loadSite();
}

// ---------- Login com Google pelo navegador padrão ----------
// O Google não permite login dentro de apps; abrimos o navegador e recebemos a volta em 127.0.0.1.
let oauthServer = null;
function googleLogin() {
  const base = serverUrl();
  if (!base) return;
  if (oauthServer) oauthServer.close();
  oauthServer = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
    const code = u.searchParams.get('code') || '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><meta charset="utf-8"><title>${APP_NAME}</title>
      <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#12062a;color:#f3e8ff;font:20px monospace;text-align:center">
      <div><h2 style="color:#d68cff">LOGIN CONCLUÍDO!</h2><p>Pode fechar esta aba e voltar para o ${APP_NAME}.</p></div></body>`);
    oauthServer.close(); oauthServer = null;
    if (win) {
      win.loadURL(`${base}/auth/app-exchange?code=${encodeURIComponent(code)}`);
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
    }
  });
  oauthServer.listen(0, '127.0.0.1', () => {
    const port = oauthServer.address().port;
    shell.openExternal(`${base}/auth/google?app_port=${port}`);
    setTimeout(() => { if (oauthServer) { oauthServer.close(); oauthServer = null; } }, 10 * 60_000);
  });
}

// ---------- IPC ----------
ipcMain.handle('app:get-sources', async () => {
  // Busca telas e janelas separadamente: se uma falhar, a outra ainda aparece.
  const opts = { thumbnailSize: { width: 384, height: 216 } };
  const [screens, windows] = await Promise.all([
    desktopCapturer.getSources({ ...opts, types: ['screen'] }).catch(() => []),
    desktopCapturer.getSources({ ...opts, types: ['window'] }).catch(() => []),
  ]);
  return [...screens, ...windows]
    .filter((s) => !(s.id.startsWith('window:') && s.name.startsWith(APP_NAME)))
    .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL() }));
});
ipcMain.handle('app:select-source', (_e, id, audio) => { selectedSourceId = id; selectedAudio = !!audio; return true; });
ipcMain.handle('app:google-login', () => googleLogin());
ipcMain.handle('app:open-setup', () => loadSetup());
ipcMain.handle('app:get-server', () => serverUrl());
ipcMain.handle('app:set-server', (_e, url) => {
  writeSettings({ ...readSettings(), serverUrl: String(url || '').replace(/\/+$/, '') });
  return loadSite();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
