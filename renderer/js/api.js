const { ipcRenderer } = require('electron');

let _baseUrl = null;
let _token = null;

async function ensureCredentials() {
  if (!_baseUrl) _baseUrl = await ipcRenderer.invoke('get-server-url');
  if (!_token) _token = await ipcRenderer.invoke('get-access-token');
  return { baseUrl: _baseUrl, token: _token };
}

function toUserMessage(err) {
  const msg = (err && err.message) ? String(err.message) : '';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) {
    return 'Сервер недоступен. Проверьте подключение и адрес сервера.';
  }
  if (msg.includes('timeout') || msg.includes('Timeout')) {
    return 'Превышено время ожидания. Попробуйте позже.';
  }
  if (msg.includes('CORS') || msg.includes('cors')) {
    return 'Ошибка доступа к серверу.';
  }
  return msg || 'Неизвестная ошибка';
}

async function request(method, path, body) {
  let res;
  try {
    const { baseUrl, token } = await ensureCredentials();
    if (!baseUrl) throw new Error('Сервер не настроен');

    const url = `${baseUrl.replace(/\/$/, '')}${path}`;
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` })
      }
    };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    res = await fetch(url, opts);
  } catch (err) {
    throw new Error(toUserMessage(err));
  }

  if (res.status === 401) {
    try {
      const newToken = await ipcRenderer.invoke('refresh-access-token');
      if (newToken) {
        _token = newToken;
        return request(method, path, body);
      }
    } catch (_) {}
    throw new Error('Сессия истекла. Войдите снова.');
  }

  let data = {};
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    if (!res.ok) {
      throw new Error(`Ошибка сервера ${res.status}`);
    }
  }

  if (!res.ok) {
    throw new Error(data.error || data.message || `Ошибка ${res.status}`);
  }
  return data;
}

window.api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  delete: (path, body) => request('DELETE', path, body)
};
