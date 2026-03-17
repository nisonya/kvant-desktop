const { ipcRenderer } = require('electron');

const form = document.getElementById('authForm');
const serverUrlInput = document.getElementById('serverUrl');
const errorEl = document.getElementById('authError');
const submitBtn = document.getElementById('submitBtn');

function setError(msg) {
  errorEl.textContent = msg || '';
}

function getBaseUrl() {
  let url = serverUrlInput.value.trim();
  if (!url) return null;
  if (!url.startsWith('http')) url = 'https://' + url;
  return url.replace(/\/$/, '');
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  setError('');
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    setError('Укажите адрес сервера');
    return;
  }
  ipcRenderer.send('server-url-set', baseUrl);
});

ipcRenderer.invoke('get-saved-credentials').then((creds) => {
  if (creds?.serverUrl) serverUrlInput.value = creds.serverUrl;
});
