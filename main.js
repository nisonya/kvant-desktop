const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const Store = require('electron-store');

app.commandLine.appendSwitch('ignore-certificate-errors');

// HTTP(S)-запросы в main process (fetch не поддерживает самоподписанные сертификаты)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function apiRequest(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const bodyStr = JSON.stringify(body);
    // localhost → 127.0.0.1 чтобы избежать EACCES на IPv6 (::1)
    const hostname = (u.hostname === 'localhost' || u.hostname === '::1') ? '127.0.0.1' : u.hostname;
    const port = u.port || (isHttps ? 443 : 80);
    const opts = {
      hostname,
      port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Host': u.host,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    if (isHttps) opts.agent = httpsAgent;

    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'));
        } catch {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// Store в userData — сохраняется между запусками
let store = null;

function getStore() {
  if (!store) {
    store = new Store({ name: 'kvant-auth' });
  }
  return store;
}

const RENDERER = path.join(__dirname, 'renderer', 'html');

function getWindow() {
  return BrowserWindow.getAllWindows()[0];
}

function loadPage(name) {
  const win = getWindow();
  if (!win) return;
  win.loadFile(path.join(RENDERER, `${name}.html`));
  if (name === 'main') {
    win.setMinimumSize(800, 600);
    win.setSize(1200, 800);
  } else {
    win.setMinimumSize(380, 480);
    win.setSize(440, 520);
  }
}

async function tryAutoLogin() {
  const s = getStore();
  const serverUrl = s.get('serverUrl');
  const refreshToken = s.get('refreshToken');
  const login = s.get('login');
  const password = s.get('password');

  if (!serverUrl) return { ok: false, attempted: false };
  const base = serverUrl.replace(/\/$/, '');

  // 1. Пробуем refresh-токен
  if (refreshToken) {
    try {
      const data = await apiRequest(`${base}/api/auth/refresh`, { refreshToken });
      if (data && data.success) {
        s.set('accessToken', data.accessToken);
        return { ok: true };
      }
    } catch (err) {
      console.error('[auth] refresh failed:', err.message);
    }
  }

  // 2. Пробуем логин + пароль
  if (login && password) {
    try {
      const data = await apiRequest(`${base}/api/auth/login`, { login, password });
      if (data && data.success) {
        s.set('accessToken', data.accessToken);
        s.set('refreshToken', data.refreshToken);
        s.set('user', data.user);
        return { ok: true };
      }
    } catch (err) {
      console.error('[auth] login failed:', err.message);
    }
  }

  const attempted = !!(refreshToken || (login && password));
  return { ok: false, attempted };
}

async function createWindow() {
  const s = getStore();
  const hasUrl = !!s.get('serverUrl');
  const hasCreds = hasUrl && (
    !!s.get('refreshToken') ||
    (!!s.get('login') && !!s.get('password'))
  );

  const mainWindow = new BrowserWindow({
    width: hasCreds ? 1200 : 440,
    height: hasCreds ? 800 : 520,
    minWidth: hasCreds ? 800 : 380,
    minHeight: hasCreds ? 600 : 480,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  if (!hasUrl) {
    mainWindow.loadFile(path.join(RENDERER, 'auth-url.html'));
    mainWindow.show();
    return;
  }

  const result = await tryAutoLogin();
  if (result.ok) {
    mainWindow.loadFile(path.join(RENDERER, 'main.html'));
    mainWindow.setMinimumSize(800, 600);
    mainWindow.setSize(1200, 800);
  } else {
    mainWindow.loadFile(path.join(RENDERER, 'auth-login.html'));
    mainWindow.setMinimumSize(380, 480);
    mainWindow.setSize(440, 520);
  }
  mainWindow.show();
}

// --- IPC handlers ---

ipcMain.handle('get-saved-credentials', () => {
  const s = getStore();
  return {
    serverUrl: s.get('serverUrl') || '',
    login: s.get('login') || ''
  };
});

ipcMain.handle('get-server-url', () => getStore().get('serverUrl') || '');

ipcMain.handle('get-access-token', () => getStore().get('accessToken') || '');

ipcMain.handle('get-user', () => getStore().get('user') || null);

ipcMain.handle('try-auto-login', async () => {
  const result = await tryAutoLogin();
  if (result.ok) loadPage('main');
  return {
    success: result.ok,
    sessionExpired: result.attempted && !result.ok
  };
});

ipcMain.handle('refresh-access-token', async () => {
  const result = await tryAutoLogin();
  if (result.ok) return getStore().get('accessToken');
  return null;
});

ipcMain.on('server-url-set', (_, url) => {
  getStore().set('serverUrl', url.replace(/\/$/, ''));
  loadPage('auth-login');
});

ipcMain.on('navigate-to-url', () => loadPage('auth-url'));

ipcMain.on('auth-success', (_, data) => {
  const s = getStore();
  s.set('serverUrl', data.serverUrl);
  s.set('accessToken', data.accessToken);
  s.set('user', data.user);

  if (data.remember) {
    s.set('login', data.login);
    s.set('password', data.password);
    s.set('refreshToken', data.refreshToken);
    console.log('[auth] Credentials saved for auto-login');
  } else {
    s.delete('login');
    s.delete('password');
    s.delete('refreshToken');
  }

  loadPage('main');
});

// --- App lifecycle ---

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
