const { app, BrowserWindow, ipcMain, dialog, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { AUTH, EVENTS } = require(path.join(__dirname, 'renderer', 'js', 'api-paths.js'));
const http = require('http');
const https = require('https');
const fs = require('fs');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

app.commandLine.appendSwitch('ignore-certificate-errors');

function configureChromiumCache() {
  try {
    const cacheRoot = path.join(app.getPath('temp'), 'kvantorium-desktop-cache');
    const gpuCacheDir = path.join(cacheRoot, 'gpu-cache');
    const sessionDir = path.join(cacheRoot, 'session-data');
    fs.mkdirSync(gpuCacheDir, { recursive: true });
    fs.mkdirSync(sessionDir, { recursive: true });
    app.commandLine.appendSwitch('disk-cache-dir', cacheRoot);
    app.commandLine.appendSwitch('gpu-shader-disk-cache-dir', gpuCacheDir);
    app.setPath('sessionData', sessionDir);
  } catch (err) {
    console.warn('[cache] failed to configure cache paths:', err && err.message ? err.message : err);
  }
}

configureChromiumCache();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const AUTH_REQUEST_TIMEOUT_MS = 8000;
const AUTO_UPDATE_FEED_PATH = '/desktop-updates';
const AUTO_UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6;
const TRAY_ICON_CANDIDATES = [
  path.join(__dirname, 'build', 'icon.png'),
  path.join(__dirname, 'build', 'icon.ico')
];
const APP_USER_MODEL_ID = 'ru.kvantorium.desktop';

function apiRequest(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const bodyStr = JSON.stringify(body);
    const hostname = (u.hostname === 'localhost' || u.hostname === '::1') ? '127.0.0.1' : u.hostname;
    const port = u.port || (isHttps ? 443 : 80);
    const opts = {
      hostname,
      port,
      path: u.pathname + (u.search || ''),
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
    req.setTimeout(AUTH_REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Превышено время ожидания ответа сервера (' + Math.round(AUTH_REQUEST_TIMEOUT_MS / 1000) + ' сек)'));
    });
    req.write(bodyStr);
    req.end();
  });
}

function apiJsonRequest(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const payload = body != null ? JSON.stringify(body) : null;
    const hostname = (u.hostname === 'localhost' || u.hostname === '::1') ? '127.0.0.1' : u.hostname;
    const port = u.port || (isHttps ? 443 : 80);
    const headers = { Host: u.host, Accept: 'application/json' };
    if (payload != null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) headers.Authorization = 'Bearer ' + token;
    const opts = {
      hostname,
      port,
      path: u.pathname + (u.search || ''),
      method: method || 'GET',
      headers
    };
    if (isHttps) opts.agent = httpsAgent;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try {
          parsed = JSON.parse(data || '{}');
        } catch {
          parsed = {};
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
          return;
        }
        const msg = extractApiErrorMessage(parsed, 'Ошибка ' + res.statusCode);
        const err = new Error(msg);
        err.status = res.statusCode;
        err.data = parsed;
        reject(err);
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Превышено время ожидания ответа сервера (30 сек)'));
    });
    if (payload != null) req.write(payload);
    req.end();
  });
}

let store = null;
let appTray = null;
let mainWindowRef = null;
let pendingEventNotificationOpen = null;
let isQuitting = false;
let autoUpdaterReady = false;
let autoUpdateTimer = null;
let currentAutoUpdateFeedUrl = '';

function getStore() {
  if (!store) {
    store = new Store({ name: 'kvant-auth' });
  }
  return store;
}

function buildAutoUpdateFeedUrl(serverUrlRaw) {
  const value = String(serverUrlRaw || '').trim();
  if (!value) return '';
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    return '';
  }
  const base = parsed.toString().replace(/\/$/, '');
  return base + AUTO_UPDATE_FEED_PATH;
}

function configureAutoUpdaterFromServerUrl(serverUrlRaw) {
  if (!app.isPackaged) return false;
  const feedUrl = buildAutoUpdateFeedUrl(serverUrlRaw);
  if (!feedUrl) return false;
  if (currentAutoUpdateFeedUrl === feedUrl) return true;
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    currentAutoUpdateFeedUrl = feedUrl;
    return true;
  } catch (err) {
    console.warn('[updater] failed to set feed url:', err.message || err);
    return false;
  }
}

function checkForUpdatesSafe() {
  if (!app.isPackaged) return;
  const configured = currentAutoUpdateFeedUrl
    ? true
    : configureAutoUpdaterFromServerUrl(getStore().get('serverUrl'));
  if (!configured) return;
  autoUpdater.checkForUpdates().catch(function (err) {
    console.warn('[updater] check failed:', err.message || err);
  });
}

async function checkForUpdatesManual() {
  if (!app.isPackaged) {
    return { ok: false, message: 'Проверка обновлений доступна только в установленной версии приложения.' };
  }
  const configured = currentAutoUpdateFeedUrl
    ? true
    : configureAutoUpdaterFromServerUrl(getStore().get('serverUrl'));
  if (!configured) {
    return { ok: false, message: 'Не удалось определить адрес сервера обновлений.' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true, message: 'Проверка обновлений запущена.' };
  } catch (err) {
    return {
      ok: false,
      message: err && err.message ? String(err.message) : 'Не удалось проверить обновления.'
    };
  }
}

function setupAutoUpdater() {
  if (autoUpdaterReady || !app.isPackaged) return;
  autoUpdaterReady = true;

  autoUpdater.on('error', function (err) {
    console.warn('[updater] error:', err.message || err);
  });
  autoUpdater.on('update-available', function (info) {
    const version = info && info.version ? String(info.version) : 'unknown';
    console.log('[updater] update available:', version);
  });
  autoUpdater.on('update-not-available', function () {
    console.log('[updater] update not available');
  });
  autoUpdater.on('update-downloaded', async function () {
    const win = getWindow();
    const result = await dialog.showMessageBox(win || undefined, {
      type: 'info',
      title: 'Доступно обновление',
      message: 'Обновление загружено. Перезапустить приложение сейчас?',
      buttons: ['Перезапустить сейчас', 'Позже'],
      defaultId: 0,
      cancelId: 1
    });
    if (result.response === 0) autoUpdater.quitAndInstall();
  });

  configureAutoUpdaterFromServerUrl(getStore().get('serverUrl'));
  checkForUpdatesSafe();

  autoUpdateTimer = setInterval(function () {
    checkForUpdatesSafe();
  }, AUTO_UPDATE_CHECK_INTERVAL_MS);
}

/** Ответы /api/auth/* по документации: { success, data: { accessToken, ... } } */
function unwrapAuthBody(res) {
  if (!res || typeof res !== 'object') return {};
  if (res.data != null && typeof res.data === 'object' && !Array.isArray(res.data)) {
    return res.data;
  }
  return res;
}

/** Текст ошибки из тела ответа API (`success: false`, поле `error`). */
function extractApiErrorMessage(data, fallback) {
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  }
  return fallback;
}

function unwrapApiBody(res) {
  if (!res || typeof res !== 'object') return res;
  if (res.data != null) return res.data;
  return res;
}

function getEmployeeIdFromUser(user) {
  if (!user || typeof user !== 'object') return null;
  const id = user.employee_id != null ? user.employee_id
    : (user.id_employees != null ? user.id_employees : user.id);
  const n = parseInt(String(id), 10);
  return isNaN(n) || n <= 0 ? null : n;
}

function isMarkedParticipation(v) {
  return v === 1 || v === true || String(v) === '1';
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function emptyEventNotificationsData() {
  return {
    orgToday: [],
    orgTomorrow: [],
    partToday: [],
    partTomorrow: []
  };
}

function countEventNotifications(data) {
  if (!data) return 0;
  return asArray(data.orgToday).length
    + asArray(data.orgTomorrow).length
    + asArray(data.partToday).length
    + asArray(data.partTomorrow).length;
}

function formatEventLine(ev) {
  const name = ev && ev.name ? String(ev.name) : 'Без названия';
  const form = ev && ev.form_of_holding ? String(ev.form_of_holding) : '';
  const date = ev && ev.registration_deadline ? String(ev.registration_deadline) : '';
  const parts = [name];
  if (form) parts.push('(' + form + ')');
  if (date) parts.push('до ' + date);
  return '• ' + parts.join(' ');
}

function eventIdFromNotificationItem(ev) {
  if (!ev || typeof ev !== 'object') return '';
  const raw = ev.id != null ? ev.id : (ev.id_event != null ? ev.id_event : ev.id_events);
  return raw == null ? '' : String(raw);
}

function notificationEventName(ev) {
  if (!ev || typeof ev !== 'object') return 'Без названия';
  return String(ev.name || ev.title || ev.event_name || 'Без названия');
}

function notificationEventDate(ev) {
  if (!ev || typeof ev !== 'object') return '';
  return String(ev.dates_of_event || ev.registration_deadline || ev.date || '').trim();
}

function buildNotificationEntries(data) {
  const sections = [
    { type: 'org', when: 'Сегодня', label: 'Организация', rows: asArray(data && data.orgToday) },
    { type: 'org', when: 'Завтра', label: 'Организация', rows: asArray(data && data.orgTomorrow) },
    { type: 'part', when: 'Сегодня', label: 'Участие', rows: asArray(data && data.partToday) },
    { type: 'part', when: 'Завтра', label: 'Участие', rows: asArray(data && data.partTomorrow) }
  ];
  const entries = [];
  sections.forEach(function (section) {
    section.rows.forEach(function (ev, idx) {
      const id = eventIdFromNotificationItem(ev);
      const name = notificationEventName(ev);
      const date = notificationEventDate(ev);
      entries.push({
        id,
        view: section.type,
        key: section.type + ':' + (id || (name + ':' + idx)),
        title: section.label + ': ' + name,
        body: section.when + (date ? ' · ' + date : '')
      });
    });
  });
  return entries;
}

function dateSlotKey(now, slotHour) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d + ':' + String(slotHour);
}

function resolveCurrentNotificationSlotHour(now) {
  const hour = now.getHours();
  if (hour < 10) return null;
  if (hour < 17) return 10;
  return 17;
}

async function fetchResponsiblePartUnmarked(base, token, empId, events) {
  const checks = await Promise.all(events.map(async function (ev) {
    const eventId = ev && ev.id != null ? parseInt(String(ev.id), 10) : NaN;
    if (isNaN(eventId) || eventId <= 0) return null;
    try {
      const r = await apiJsonRequest('GET', base + EVENTS.PART + '/responsible-new/' + eventId, token);
      const list = asArray(unwrapApiBody(r));
      const myRow = list.find(function (row) {
        const rid = row && row.id_employees != null ? parseInt(String(row.id_employees), 10) : NaN;
        return !isNaN(rid) && rid === empId;
      });
      return (!myRow || !isMarkedParticipation(myRow.mark_of_sending_an_application)) ? ev : null;
    } catch (_) {
      // Если не удалось проверить отметку, не показываем событие, чтобы не тревожить ложными уведомлениями.
      return null;
    }
  }));
  return checks.filter(Boolean);
}

async function collectEventNotificationsData() {
  const s = getStore();
  const serverUrl = s.get('serverUrl');
  const accessToken = s.get('accessToken');
  const user = s.get('user');
  if (!serverUrl || !accessToken) return null;
  const empId = getEmployeeIdFromUser(user);
  if (!empId) return null;
  const base = String(serverUrl).replace(/\/$/, '');

  const [orgTodayRes, orgTomorrowRes, partTodayRes, partTomorrowRes] = await Promise.all([
    apiJsonRequest('GET', base + EVENTS.ORG + '/notifications-today/' + empId, accessToken),
    apiJsonRequest('GET', base + EVENTS.ORG + '/notifications-tomorrow/' + empId, accessToken),
    apiJsonRequest('GET', base + EVENTS.PART + '/notifications-today/' + empId, accessToken),
    apiJsonRequest('GET', base + EVENTS.PART + '/notifications-tomorrow/' + empId, accessToken)
  ]);

  const orgToday = asArray(unwrapApiBody(orgTodayRes));
  const orgTomorrow = asArray(unwrapApiBody(orgTomorrowRes));
  const partTodayRaw = asArray(unwrapApiBody(partTodayRes));
  const partTomorrowRaw = asArray(unwrapApiBody(partTomorrowRes));
  const [partToday, partTomorrow] = await Promise.all([
    fetchResponsiblePartUnmarked(base, accessToken, empId, partTodayRaw),
    fetchResponsiblePartUnmarked(base, accessToken, empId, partTomorrowRaw)
  ]);

  return { orgToday, orgTomorrow, partToday, partTomorrow };
}

async function getEventNotificationsResult() {
  const checkedAt = new Date().toISOString();
  try {
    const data = await collectEventNotificationsData();
    if (!data) {
      return {
        ok: false,
        checkedAt,
        error: 'Не удалось проверить напоминания: нет активной сессии или id сотрудника.',
        data: emptyEventNotificationsData(),
        total: 0
      };
    }
    return {
      ok: true,
      checkedAt,
      error: '',
      data,
      total: countEventNotifications(data)
    };
  } catch (err) {
    return {
      ok: false,
      checkedAt,
      error: err && err.message ? String(err.message) : 'Не удалось загрузить напоминания.',
      data: emptyEventNotificationsData(),
      total: 0
    };
  }
}

function buildNotificationsBody(data) {
  if (!data) return '';
  const chunks = [];
  if (data.orgToday.length || data.orgTomorrow.length) {
    chunks.push('Организация:');
    if (data.orgToday.length) {
      chunks.push('Сегодня:');
      data.orgToday.slice(0, 3).forEach(function (ev) { chunks.push(formatEventLine(ev)); });
      if (data.orgToday.length > 3) chunks.push('• ... и ещё ' + (data.orgToday.length - 3));
    }
    if (data.orgTomorrow.length) {
      chunks.push('Завтра:');
      data.orgTomorrow.slice(0, 3).forEach(function (ev) { chunks.push(formatEventLine(ev)); });
      if (data.orgTomorrow.length > 3) chunks.push('• ... и ещё ' + (data.orgTomorrow.length - 3));
    }
  }
  if (data.partToday.length || data.partTomorrow.length) {
    if (chunks.length) chunks.push('');
    chunks.push('Участие (без отметки "Участвовал"):');
    if (data.partToday.length) {
      chunks.push('Сегодня:');
      data.partToday.slice(0, 3).forEach(function (ev) { chunks.push(formatEventLine(ev)); });
      if (data.partToday.length > 3) chunks.push('• ... и ещё ' + (data.partToday.length - 3));
    }
    if (data.partTomorrow.length) {
      chunks.push('Завтра:');
      data.partTomorrow.slice(0, 3).forEach(function (ev) { chunks.push(formatEventLine(ev)); });
      if (data.partTomorrow.length > 3) chunks.push('• ... и ещё ' + (data.partTomorrow.length - 3));
    }
  }
  return chunks.join('\n').trim();
}

function flushPendingEventNotificationOpen() {
  const payload = pendingEventNotificationOpen;
  const win = getWindow();
  if (!payload || !win || win.isDestroyed()) return;
  win.webContents.send('open-event-from-notification', payload);
  pendingEventNotificationOpen = null;
}

function openEventFromNotification(entry) {
  if (!entry || !entry.id) {
    showMainWindow();
    return;
  }
  pendingEventNotificationOpen = {
    id: String(entry.id),
    view: entry.view === 'part' ? 'part' : 'org'
  };
  const win = getWindow();
  if (!win || win.isDestroyed()) {
    createWindow(false).catch(function (err) {
      console.error('[notifications] open window failed:', err);
    });
    return;
  }
  showMainWindow();
  loadPage('main', win);
}

function showEventNotification(entry) {
  if (!entry) return false;
  const title = entry.title || 'Мероприятие';
  const body = entry.body || '';
  let desktopShown = false;

  if (typeof Notification.isSupported !== 'function' || Notification.isSupported()) {
    try {
      const notification = new Notification({
        title,
        body,
        silent: false
      });
      notification.on('click', function () {
        openEventFromNotification(entry);
      });
      notification.on('failed', function (_event, error) {
        console.warn('[notifications] desktop notification failed:', error || 'unknown error');
      });
      notification.show();
      desktopShown = true;
    } catch (err) {
      console.warn('[notifications] desktop notification failed:', err && err.message ? err.message : err);
    }
  } else {
    console.warn('[notifications] desktop notifications are not supported on this system');
  }
  return desktopShown;
}

function notifiedEventKeysForSlot(slot) {
  const s = getStore();
  const raw = s.get('notifiedEventReminderKeys');
  if (!raw || typeof raw !== 'object' || raw.slot !== slot || !raw.keys || typeof raw.keys !== 'object') {
    return { slot, keys: {} };
  }
  return raw;
}

async function runScheduledEventNotificationsIfNeeded() {
  const now = new Date();
  const slotHour = resolveCurrentNotificationSlotHour(now);
  if (slotHour == null) return;

  const s = getStore();
  const slot = dateSlotKey(now, slotHour);

  try {
    const result = await getEventNotificationsResult();
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('event-reminders-updated', result);
    }
    if (!result.ok) {
      console.warn('[notifications] scheduled check failed:', result.error);
      return;
    }
    const entries = buildNotificationEntries(result.data);
    if (!entries.length) {
      // Отмечаем пустой слот, чтобы не крутить повторно каждую минуту.
      s.set('lastEventsNotificationSlot', slot);
      return;
    }
    const alreadyShownSlot = s.get('lastEventsNotificationSlot') === slot;
    const notified = notifiedEventKeysForSlot(slot);
    let shownAny = false;
    entries.forEach(function (entry) {
      if (alreadyShownSlot && notified.keys[entry.key]) return;
      if (showEventNotification(entry)) shownAny = true;
      notified.keys[entry.key] = true;
    });
    s.set('notifiedEventReminderKeys', notified);
    if (shownAny || !alreadyShownSlot) s.set('lastEventsNotificationSlot', slot);
  } catch (err) {
    console.warn('[notifications] scheduled check failed:', err.message || err);
  }
}

let eventNotifyTimer = null;
function startEventNotificationsScheduler() {
  if (eventNotifyTimer) return;
  runScheduledEventNotificationsIfNeeded().catch(function () { /* ignore */ });
  eventNotifyTimer = setInterval(function () {
    runScheduledEventNotificationsIfNeeded().catch(function () { /* ignore */ });
  }, 60000);
}

const RENDERER = path.join(__dirname, 'renderer', 'html');

function getWindow() {
  return mainWindowRef || BrowserWindow.getAllWindows()[0];
}

/** Окно, с которого пришёл IPC (надёжнее, чем getAllWindows()[0]). */
function windowFromIpc(sender) {
  if (sender && typeof sender === 'object') {
    const w = BrowserWindow.fromWebContents(sender);
    if (w) return w;
  }
  return BrowserWindow.getFocusedWindow() || getWindow();
}

function loadPage(name, targetWin) {
  const win = targetWin || BrowserWindow.getFocusedWindow() || getWindow();
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

function showOrHideInitialWindow(win, startHidden) {
  if (!win) return;
  if (startHidden) {
    win.hide();
    return;
  }
  win.show();
}

function showMainWindow() {
  const win = getWindow();
  if (!win) {
    createWindow(false).catch(function (err) {
      console.error('[window] create on show failed:', err);
    });
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function resolveTrayIcon() {
  for (const iconPath of TRAY_ICON_CANDIDATES) {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) return img;
    } catch (_) {
      // ignore broken icon path and try next
    }
  }
  const fallback = nativeImage.createFromPath(process.execPath);
  return fallback;
}

function resolveWindowIconPath() {
  for (const iconPath of TRAY_ICON_CANDIDATES) {
    try {
      if (fs.existsSync(iconPath)) return iconPath;
    } catch (_) {
      // ignore unavailable icon path and try next
    }
  }
  return undefined;
}

function createTray() {
  if (appTray) return;
  const trayIcon = resolveTrayIcon();
  appTray = new Tray(trayIcon);
  appTray.setToolTip('Кванториум');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Открыть',
      click: () => {
        if (!getWindow()) {
          createWindow(false).catch(function (err) {
            console.error('[tray] createWindow failed:', err);
          });
          return;
        }
        showMainWindow();
      }
    },
    {
      label: 'Выход',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  appTray.setContextMenu(menu);
  appTray.on('double-click', function () {
    if (!getWindow()) {
      createWindow(false).catch(function (err) {
        console.error('[tray] createWindow failed:', err);
        return;
      });
      return;
    }
    showMainWindow();
  });
}

async function tryAutoLogin() {
  const s = getStore();
  const serverUrl = s.get('serverUrl');
  const refreshToken = s.get('refreshToken');
  const login = s.get('login');
  const password = s.get('password');

  if (!serverUrl) return { ok: false, attempted: false };
  const base = serverUrl.replace(/\/$/, '');

  // refresh-токен
  if (refreshToken) {
    try {
      const data = await apiRequest(`${base}${AUTH.REFRESH}`, { refreshToken });
      if (data && data.success) {
        const p = unwrapAuthBody(data);
        const at = p.accessToken;
        if (at != null && at !== '') {
          s.set('accessToken', at);
          if (p.user !== undefined && p.user !== null) s.set('user', p.user);
          return { ok: true };
        }
      }
    } catch (err) {
      console.error('[auth] refresh failed:', err.message);
    }
  }

  // если нет refresh-токена, пробуем логин + пароль
  if (login && password) {
    try {
      const data = await apiRequest(`${base}${AUTH.LOGIN}`, { login, password });
      if (data && data.success) {
        const p = unwrapAuthBody(data);
        const at = p.accessToken;
        if (at != null && at !== '') {
          s.set('accessToken', at);
          if (p.refreshToken != null && p.refreshToken !== '') s.set('refreshToken', p.refreshToken);
          if (p.user !== undefined && p.user !== null) s.set('user', p.user);
          return { ok: true };
        }
      }
    } catch (err) {
      console.error('[auth] login failed:', err.message);
    }
  }

  const attempted = !!(refreshToken || (login && password));
  return { ok: false, attempted };
}

async function createWindow(startHidden) {
  const s = getStore();
  const hasUrl = !!s.get('serverUrl');
  const refreshToken = s.get('refreshToken');
  const login = s.get('login');
  const password = s.get('password');
  const accessTokenRaw = s.get('accessToken');
  const hasAccessToken = typeof accessTokenRaw === 'string' && accessTokenRaw.length > 0;
  const hasSavedCreds = !!(refreshToken || (login && password));
  /** Есть что пробовать при старте: refresh/login или только access (без «Запомнить»). */
  const hasStoredSession = hasUrl && (hasSavedCreds || hasAccessToken);

  const mainWindow = new BrowserWindow({
    title: 'Кванториум',
    width: hasStoredSession ? 1200 : 440,
    height: hasStoredSession ? 800 : 520,
    minWidth: hasStoredSession ? 800 : 380,
    minHeight: hasStoredSession ? 600 : 480,
    show: false,
    icon: resolveWindowIconPath(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindowRef = mainWindow;
  mainWindow.webContents.on('did-finish-load', flushPendingEventNotificationOpen);
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.removeAllListeners('close');
    mainWindow.close();
  });
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) mainWindowRef = null;
  });

  if (!hasUrl) {
    mainWindow.loadFile(path.join(RENDERER, 'auth-url.html'));
    showOrHideInitialWindow(mainWindow, startHidden);
    return;
  }

  // Не блокируем старт интерфейса сетью: показываем экран входа сразу,
  // затем пытаемся восстановить сессию в фоне.
  if (hasSavedCreds) {
    mainWindow.loadFile(path.join(RENDERER, 'auth-login.html'));
    mainWindow.setMinimumSize(380, 480);
    mainWindow.setSize(440, 520);
    showOrHideInitialWindow(mainWindow, startHidden);
    tryAutoLogin().then(function (result) {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (result && result.ok) {
        loadPage('main', mainWindow);
        return;
      }
      if (result && result.attempted) {
        getStore().set(
          'loginNotice',
          'Не удалось восстановить сессию. Войдите снова (логин и пароль).'
        );
        // Перезагружаем форму, чтобы она прочитала одноразовое сообщение.
        loadPage('auth-login', mainWindow);
      }
    }).catch(function () {
      // Ошибки уже логируются в tryAutoLogin; на UI остаёмся на логине.
    });
    return;
  }

  // Остался только accessToken (вход без долгого «Запомнить») — открываем главное окно, при 401 клиент уйдёт на логин
  if (hasAccessToken) {
    mainWindow.loadFile(path.join(RENDERER, 'main.html'));
    mainWindow.setMinimumSize(800, 600);
    mainWindow.setSize(1200, 800);
    showOrHideInitialWindow(mainWindow, startHidden);
    return;
  }

  mainWindow.loadFile(path.join(RENDERER, 'auth-login.html'));
  mainWindow.setMinimumSize(380, 480);
  mainWindow.setSize(440, 520);
  showOrHideInitialWindow(mainWindow, startHidden);
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

/** Одноразовое сообщение для экрана входа (истечение сессии, сбой автологина). */
ipcMain.handle('consume-login-notice', () => {
  const s = getStore();
  const msg = s.get('loginNotice');
  s.delete('loginNotice');
  return typeof msg === 'string' ? msg : '';
});

ipcMain.handle('get-access-token', () => getStore().get('accessToken') || '');

ipcMain.handle('save-excel-dialog', async (event, options) => {
  const win = windowFromIpc(event.sender);
  const opts = options && typeof options === 'object' ? options : {};
  const defaultPath = opts.defaultPath || 'meropriyatiya.xlsx';
  try {
    const result = await dialog.showSaveDialog(win || undefined, {
      title: 'Сохранить Excel',
      defaultPath,
      filters: [{ name: 'Книга Excel', extensions: ['xlsx'] }]
    });
    if (!result || result.canceled || !result.filePath) {
      return { canceled: true, filePath: '' };
    }
    return result;
  } catch (err) {
    console.warn('[save-excel-dialog] failed:', err && err.message ? err.message : err);
    return { canceled: true, filePath: '', error: err && err.message ? err.message : 'Ошибка выбора файла' };
  }
});

ipcMain.handle('get-user', () => getStore().get('user') || null);

ipcMain.handle('get-event-reminders', async () => getEventNotificationsResult());

ipcMain.handle('check-for-updates-manual', async () => checkForUpdatesManual());

ipcMain.handle('refresh-access-token', async () => {
  const result = await tryAutoLogin();
  if (result.ok) return getStore().get('accessToken');
  return null;
});

ipcMain.handle('api-request', async (_event, payload) => {
  const method = String(payload && payload.method ? payload.method : 'GET').toUpperCase();
  const reqPath = String(payload && payload.path ? payload.path : '');
  const body = payload && Object.prototype.hasOwnProperty.call(payload, 'body') ? payload.body : undefined;

  if (!reqPath || reqPath[0] !== '/') {
    throw new Error('Некорректный путь API');
  }

  const s = getStore();
  const serverUrl = s.get('serverUrl');
  if (!serverUrl) throw new Error('Сервер не настроен');
  const base = String(serverUrl).replace(/\/$/, '');

  async function runWithCurrentToken() {
    const token = s.get('accessToken') || '';
    return apiJsonRequest(method, base + reqPath, token, body);
  }

  try {
    return await runWithCurrentToken();
  } catch (err) {
    if (err && err.status === 401) {
      const refreshed = await tryAutoLogin();
      if (refreshed && refreshed.ok) {
        return runWithCurrentToken();
      }
      throw new Error('Сессия истекла');
    }
    throw err;
  }
});

ipcMain.on('server-url-set', (event, url) => {
  const nextUrl = String(url || '').replace(/\/$/, '');
  getStore().set('serverUrl', nextUrl);
  getStore().delete('loginNotice');
  configureAutoUpdaterFromServerUrl(nextUrl);
  checkForUpdatesSafe();
  loadPage('auth-login', windowFromIpc(event.sender));
});

ipcMain.on('navigate-to-url', (event) => {
  loadPage('auth-url', windowFromIpc(event.sender));
});

/** Сброс сессии из рендерера (истёкший JWT, refresh невозможен). См. API_DOCUMENTATION.md §3. */
ipcMain.on('session-invalidated', (event) => {
  const s = getStore();
  s.delete('accessToken');
  s.delete('refreshToken');
  s.delete('user');
  s.set('loginNotice', 'Сессия истекла. Войдите снова.');
  loadPage('auth-login', windowFromIpc(event.sender));
});

ipcMain.on('logout', (event) => {
  const s = getStore();
  s.delete('accessToken');
  s.delete('refreshToken');
  s.delete('user');
  s.delete('login');
  s.delete('password');
  s.delete('loginNotice');
  loadPage('auth-login', windowFromIpc(event.sender));
});

/**
 * Вход через main process (как refresh) — тот же JSON, что в POST /api/auth/login (документация).
 * Избегает CORS и гарантирует показ ошибок в рендерере.
 */
ipcMain.handle('auth-login', async (_event, body) => {
  const login = String(body?.login || '').trim();
  const password = String(body?.password != null ? body.password : '');
  const remember = !!body?.remember;
  const s = getStore();
  const serverUrl = s.get('serverUrl');
  if (!serverUrl) {
    return {
      ok: false,
      error: 'Адрес сервера не задан. Нажмите «Назад» и укажите URL сервера.'
    };
  }
  if (!login) return { ok: false, error: 'Введите логин.' };
  if (!password) return { ok: false, error: 'Введите пароль.' };

  const base = serverUrl.replace(/\/$/, '');
  let data;
  try {
    data = await apiRequest(`${base}${AUTH.LOGIN}`, { login, password });
  } catch (err) {
    return { ok: false, error: err.message || 'Не удалось связаться с сервером.' };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Некорректный ответ сервера.' };
  }
  if (!data.success) {
    return {
      ok: false,
      error: extractApiErrorMessage(data, 'Неверный логин или пароль.')
    };
  }

  const p = unwrapAuthBody(data);
  const at = p.accessToken;
  if (at == null || String(at).trim() === '') {
    return {
      ok: false,
      error: 'Сервер не вернул accessToken. Проверьте версию API (документация: POST /api/auth/login).'
    };
  }

  s.delete('loginNotice');
  s.set('accessToken', at);
  if (p.user !== undefined && p.user !== null) s.set('user', p.user);

  if (remember) {
    s.set('login', login);
    s.set('password', password);
    if (p.refreshToken != null && p.refreshToken !== '') s.set('refreshToken', p.refreshToken);
  } else {
    s.delete('login');
    s.delete('password');
    s.delete('refreshToken');
  }

  const targetWin = windowFromIpc(_event.sender);
  queueMicrotask(() => loadPage('main', targetWin));
  return { ok: true };
});

// --- App lifecycle ---

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    app.setName('Кванториум');
    if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
    Menu.setApplicationMenu(null);
    createTray();
    if (process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: ['--hidden']
      });
    }
    const startHidden = process.argv.includes('--hidden');
    startEventNotificationsScheduler();
    setupAutoUpdater();
    if (!startHidden) {
      await createWindow(false);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (!appTray) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(false);
    return;
  }
  showMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (eventNotifyTimer) {
    clearInterval(eventNotifyTimer);
    eventNotifyTimer = null;
  }
  if (autoUpdateTimer) {
    clearInterval(autoUpdateTimer);
    autoUpdateTimer = null;
  }
});

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(false).catch(function (err) {
        console.error('[app] failed to create window on second instance:', err);
      });
      return;
    }
    showMainWindow();
  });
}
