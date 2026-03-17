const { ipcRenderer } = require('electron');

const form = document.getElementById('authForm');
const loginInput = document.getElementById('login');
const passwordInput = document.getElementById('password');
const rememberCheckbox = document.getElementById('remember');
const errorEl = document.getElementById('authError');
const submitBtn = document.getElementById('submitBtn');
const btnBack = document.getElementById('btnBack');

function setError(msg) {
  errorEl.textContent = msg || '';
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.textContent = loading ? 'Вход...' : 'Войти';
}

async function apiLogin(baseUrl, login, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  if (!data.success) throw new Error(data.error || 'Ошибка входа');
  return data;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('');
  setLoading(true);

  const baseUrl = await ipcRenderer.invoke('get-server-url');
  const login = loginInput.value.trim();
  const password = passwordInput.value;
  const remember = rememberCheckbox.checked;

  if (!baseUrl) {
    setError('Адрес сервера не задан');
    setLoading(false);
    return;
  }

  try {
    const data = await apiLogin(baseUrl, login, password);
    ipcRenderer.send('auth-success', {
      serverUrl: baseUrl,
      login: remember ? login : '',
      password: remember ? password : '',
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user,
      remember
    });
  } catch (err) {
    setError(err.message || 'Ошибка входа');
    setLoading(false);
  }
});

btnBack.addEventListener('click', () => {
  ipcRenderer.send('navigate-to-url');
});

async function init() {
  const creds = await ipcRenderer.invoke('get-saved-credentials');
  if (creds?.login) loginInput.value = creds.login;

  const auto = await ipcRenderer.invoke('try-auto-login');
  if (auto?.success) return;
  if (auto?.sessionExpired) setError('Сессия истекла. Войдите снова.');
}

init();
