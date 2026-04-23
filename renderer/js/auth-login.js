'use strict';

/**
 * Экран входа. Запрос к POST /api/auth/login выполняется в main (main.js → auth-login IPC),
 * как и refresh — см. files/API_DOCUMENTATION.md §3 (тело: login, password; ответ: success, data.accessToken).
 */

const { ipcRenderer } = require('electron');

const form = document.getElementById('authForm');
const loginInput = document.getElementById('login');
const passwordInput = document.getElementById('password');
const rememberCheckbox = document.getElementById('remember');
const errorEl = document.getElementById('authError');
const submitBtn = document.getElementById('submitBtn');
const btnBack = document.getElementById('btnBack');

function setError(msg) {
  if (errorEl) errorEl.textContent = msg || '';
}

function unlockFormControls() {
  if (loginInput) loginInput.disabled = false;
  if (passwordInput) passwordInput.disabled = false;
  if (rememberCheckbox) rememberCheckbox.disabled = false;
  if (btnBack) btnBack.disabled = false;
}

function setLoading(loading) {
  if (!submitBtn) return;
  submitBtn.disabled = loading;
  submitBtn.textContent = loading ? 'Вход…' : 'Войти';
  if (!loading) unlockFormControls();
}

async function showStartupNotice() {
  try {
    const notice = await ipcRenderer.invoke('consume-login-notice');
    if (notice) setError(notice);
  } catch (e) {
    console.error('[auth-login] notice', e);
  }
  try {
    const creds = await ipcRenderer.invoke('get-saved-credentials');
    if (creds && creds.login && loginInput) loginInput.value = creds.login;
  } catch (e) {
    console.error('[auth-login] creds', e);
  }
}

if (form) {
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const login = (loginInput && loginInput.value.trim()) || '';
    const password = (passwordInput && passwordInput.value) || '';
    const remember = !!(rememberCheckbox && rememberCheckbox.checked);
    try {
      const r = await ipcRenderer.invoke('auth-login', { login, password, remember });
      if (!r || !r.ok) {
        setError((r && r.error) || 'Ошибка входа');
      }
    } catch (err) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  });
}

if (btnBack) {
  btnBack.addEventListener('click', function () {
    ipcRenderer.send('navigate-to-url');
  });
}

unlockFormControls();
showStartupNotice().finally(unlockFormControls);
