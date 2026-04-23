'use strict';

const { ipcRenderer } = require('electron');

function apiError(message, status, data) {
  const err = new Error(message);
  err.status = status;
  if (data != null) err.data = data;
  return err;
}

function unwrapResponse(res) {
  return res.data != null ? res.data : res;
}

async function apiRequest(method, path, body) {
  const pair = await Promise.all([
    ipcRenderer.invoke('get-server-url'),
    ipcRenderer.invoke('get-access-token')
  ]);
  const baseUrl = pair[0];
  const token = pair[1];
  if (!baseUrl) throw new Error('Сервер не настроен');
  const url = baseUrl.replace(/\/$/, '') + path;
  const opts = {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch(url, opts);
  } catch (fetchErr) {
    const message = fetchErr && fetchErr.message ? String(fetchErr.message) : '';
    if (message.indexOf('Failed to fetch') >= 0) {
      try {
        const fallback = await ipcRenderer.invoke('api-request', { method, path, body });
        return fallback;
      } catch (ipcErr) {
        var raw = ipcErr && ipcErr.message ? String(ipcErr.message) : 'Ошибка сети';
        raw = raw.replace(/^Error invoking remote method 'api-request':\s*/i, '');
        raw = raw.replace(/^Error:\s*/i, '');
        throw new Error(raw || 'Ошибка сети');
      }
    }
    throw fetchErr;
  }
  if (res.status === 401) {
    const newToken = await ipcRenderer.invoke('refresh-access-token');
    if (newToken) return apiRequest(method, path, body);
    try {
      ipcRenderer.send('session-invalidated');
    } catch (_) { /* ignore */ }
    throw new Error('Сессия истекла');
  }
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw apiError(data.error || 'Ошибка ' + res.status, res.status, data);
  return data;
}

/** GET бинарного ответа (скачивание / превью документов мероприятий). */
async function apiFetchBlob(path) {
  const pair = await Promise.all([
    ipcRenderer.invoke('get-server-url'),
    ipcRenderer.invoke('get-access-token')
  ]);
  const baseUrl = pair[0];
  const token = pair[1];
  if (!baseUrl) throw new Error('Сервер не настроен');
  const url = baseUrl.replace(/\/$/, '') + path;
  var res = await fetch(url, {
    method: 'GET',
    headers: token ? { Authorization: 'Bearer ' + token } : {}
  });
  if (res.status === 401) {
    const newToken = await ipcRenderer.invoke('refresh-access-token');
    if (newToken) return apiFetchBlob(path);
    try {
      ipcRenderer.send('session-invalidated');
    } catch (_) { /* ignore */ }
    throw new Error('Сессия истекла');
  }
  if (!res.ok) {
    var ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.indexOf('application/json') >= 0) {
      var errJson = await res.json().catch(function () { return {}; });
      throw apiError(errJson.error || 'Ошибка ' + res.status, res.status, errJson);
    }
    throw apiError(httpStatusToDocumentError(res.status), res.status);
  }
  return res.blob();
}

function httpStatusToDocumentError(status) {
  if (status === 503) return 'Сервис документов недоступен (проверьте настройки сервера).';
  if (status === 404) return 'Файл или документ не найдены.';
  if (status === 400) return 'Некорректный запрос к серверу.';
  return 'Ошибка ' + status;
}

/** POST multipart/form-data (поле file — документы мероприятий). */
async function apiRequestMultipart(path, formData) {
  const pair = await Promise.all([
    ipcRenderer.invoke('get-server-url'),
    ipcRenderer.invoke('get-access-token')
  ]);
  const baseUrl = pair[0];
  const token = pair[1];
  if (!baseUrl) throw new Error('Сервер не настроен');
  const url = baseUrl.replace(/\/$/, '') + path;
  var opts = {
    method: 'POST',
    body: formData,
    headers: {}
  };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  var res = await fetch(url, opts);
  if (res.status === 401) {
    const newToken = await ipcRenderer.invoke('refresh-access-token');
    if (newToken) return apiRequestMultipart(path, formData);
    try {
      ipcRenderer.send('session-invalidated');
    } catch (_) { /* ignore */ }
    throw new Error('Сессия истекла');
  }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    var msg = data.error || httpStatusToDocumentError(res.status);
    throw apiError(msg, res.status, data);
  }
  return data;
}

module.exports = {
  apiRequest,
  apiFetchBlob,
  apiRequestMultipart,
  unwrapResponse
};
