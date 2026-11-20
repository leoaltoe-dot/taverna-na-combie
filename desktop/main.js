// Taverna na Combie — aplicativo para Windows (Electron).
// Abre o site da Taverna numa janela própria, com seletor de tela nativo e login com Google pelo navegador.
const { app, BrowserWindow, desktopCapturer, ipcMain, session, dialog, shell, Menu } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

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
// Compara a origem inteira (https://site:porta), não só o começo do texto: "site.win.golpe.com" não passa.
const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };
const isSite = (url) => !!serverOrigin() && originOf(url) === serverOrigin();
const isSetupPage = (url) => { try { const u = new URL(url); return u.protocol === 'file:' && decodeURIComponent(u.pathname).replace(/\\/g, '/').endsWith('/app/setup.html'); } catch { return false; } };
// Só abre fora do app endereços da web (nada de file:, ms-…:, search-ms: etc.).
const openOutside = (url) => { try { if (['https:', 'http:'].includes(new URL(url).protocol)) shell.openExternal(url); } catch {} };
// Quem está chamando o app: o site configurado ou a tela de configuração local.
const senderUrl = (e) => (e.senderFrame && e.senderFrame.url) || '';
const fromSite = (e) => isSite(senderUrl(e)) || isSetupPage(senderUrl(e));

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
    frame: false, // barra de título própria, no visual da Taverna (desenhada pela página)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, // continua transmitindo com a janela minimizada
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  const sendState = () => { if (!win.isDestroyed()) win.webContents.send('win:state', { maximized: win.isMaximized() }); };
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);
  win.webContents.on('did-finish-load', sendState);

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

  // Só navega dentro do site da Taverna (ou da tela de configuração); o resto abre no navegador padrão.
  const allowed = (url) => isSite(url) || isSetupPage(url);
  win.webContents.on('will-navigate', (e, url) => {
    if (!allowed(url)) { e.preventDefault(); openOutside(url); }
  });
  win.webContents.on('will-redirect', (e, url) => {
    if (!allowed(url)) { e.preventDefault(); openOutside(url); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  // Permissões do navegador interno: só o site da Taverna, e só o que ele usa (tela, áudio, área de transferência, tela cheia).
  const OK_PERMS = ['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen'];
  const permOk = (wc, perm, origin) => OK_PERMS.includes(perm) && isSite(origin || (wc && wc.getURL()) || '');
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(permOk(wc, perm, details && details.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => permOk(wc, perm, origin));

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

// ---------- Atualização automática ----------
// A página avisa que tem versão nova; com a confirmação, baixamos o instalador, abrimos e fechamos o app.
// O instalador (um clique) troca os arquivos e abre o app de novo já atualizado.
const UPDATE_PREFIX = 'https://github.com/leoaltoe-dot/taverna-na-combie/releases/download/';
let updating = false;
function validUpdateUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(UPDATE_PREFIX) || /\.\.|%2e|%2f|%5c|\\/i.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host === 'github.com' && u.href.startsWith(UPDATE_PREFIX) && u.pathname.endsWith('.exe') && !u.search && !u.hash;
  } catch { return false; }
}
// Confere o arquivo baixado com o "digest" (SHA-256) que o GitHub publica para cada arquivo da versão.
async function expectedDigest(url) {
  try {
    const [tag, name] = new URL(url).pathname.split('/').slice(-2).map(decodeURIComponent);
    const r = await fetch(`https://api.github.com/repos/leoaltoe-dot/taverna-na-combie/releases/tags/${encodeURIComponent(tag)}`, { headers: { 'User-Agent': 'taverna-na-combie', Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    const asset = ((await r.json()).assets || []).find((a) => a.name === name);
    const d = asset && String(asset.digest || '');
    return d.startsWith('sha256:') ? d.slice(7).toLowerCase() : null;
  } catch { return null; }
}
async function installUpdate(url) {
  if (!validUpdateUrl(url)) throw new Error('Endereço de atualização inválido');
  if (updating) return true;
  updating = true;
  try {
    const digest = await expectedDigest(url);
    const hash = require('crypto').createHash('sha256');
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error('Download falhou: ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    const file = path.join(app.getPath('temp'), `Taverna-na-Combie-Update-${Date.now()}.exe`);
    const out = fs.createWriteStream(file);
    let got = 0, lastPct = -1;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      hash.update(value);
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== lastPct && win && !win.isDestroyed()) { lastPct = pct; win.webContents.send('app:update-progress', pct); }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    if (total && got !== total) throw new Error('Download incompleto');
    if (digest && hash.digest('hex') !== digest) { try { fs.unlinkSync(file); } catch {} throw new Error('Arquivo de atualização não confere'); }
    if (win && !win.isDestroyed()) win.webContents.send('app:update-progress', 100);
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => { if (win && !win.isDestroyed()) win.destroy(); app.quit(); }, 800);
    return true;
  } catch (e) {
    updating = false;
    throw e;
  }
}

// ---------- IPC ----------
ipcMain.handle('app:get-sources', async (e) => {
  if (!fromSite(e)) return [];
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
ipcMain.handle('app:select-source', (e, id, audio) => { if (!fromSite(e)) return false; selectedSourceId = String(id || ''); selectedAudio = !!audio; return true; });
ipcMain.handle('app:google-login', (e) => fromSite(e) && googleLogin());
ipcMain.on('win:minimize', (e) => fromSite(e) && win && win.minimize());
ipcMain.on('win:toggle-maximize', (e) => { if (fromSite(e) && win) win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.on('win:close', (e) => fromSite(e) && win && win.close());
ipcMain.handle('app:install-update', (e, url) => { if (!isSite(senderUrl(e))) throw new Error('Não permitido'); return installUpdate(url); });
ipcMain.on('app:version', (e) => { e.returnValue = app.getVersion(); });
ipcMain.handle('app:open-setup', (e) => fromSite(e) && loadSetup());
ipcMain.handle('app:get-server', (e) => (isSetupPage(senderUrl(e)) ? serverUrl() : null));
// Trocar o endereço do site só pela tela de configuração local (nunca por uma página da internet).
ipcMain.handle('app:set-server', (e, url) => {
  if (!isSetupPage(senderUrl(e))) throw new Error('Não permitido');
  url = String(url || '');
  try { if (!['https:', 'http:'].includes(new URL(url).protocol)) throw 0; } catch { throw new Error('Endereço inválido'); }
  writeSettings({ ...readSettings(), serverUrl: String(url || '').replace(/\/+$/, '') });
  return loadSite();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
