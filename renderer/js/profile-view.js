'use strict';

const { ipcRenderer, shell } = require('electron');
const { apiRequest, unwrapResponse } = require('./api-client.js');
const API = require('./api-paths.js');
const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');
const { employeeDisplayName } = require('./shared-utils.js');

var EDUCATION_OPTIONS = ['СПО', 'Высшее', 'Высшее педагогическое'];
var GENDER_OPTIONS = ['Мужской', 'Женский'];

var PROFILE_FIELDS = [
  { key: 'second_name', label: 'Фамилия' },
  { key: 'first_name', label: 'Имя' },
  { key: 'patronymic', label: 'Отчество' },
  { key: 'date_of_birth', label: 'Дата рождения', type: 'date' },
  { key: 'position_name', label: 'Должность', readonly: true },
  { key: 'contact', label: 'Контактный номер', type: 'tel' },
  { key: 'gender', label: 'Пол', select: GENDER_OPTIONS },
  { key: 'education', label: 'Образование', select: EDUCATION_OPTIONS },
  { key: 'size', label: 'Размер одежды' }
];

function displayName(data) {
  return employeeDisplayName(data, { surnameFirst: true });
}

function kpiLinkFromProfile(d) {
  if (!d || typeof d !== 'object') return '';
  var v = d.KPI != null && d.KPI !== '' ? d.KPI : d.kpi;
  if (v == null) return '';
  return String(v).trim();
}

/** Ссылка для открытия во внешнем браузере */
function normalizeExternalUrl(s) {
  var t = String(s || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\/\//.test(t)) return 'https:' + t;
  return 'https://' + t;
}

async function enrichPositionName(d) {
  if (!d || typeof d !== 'object') return;
  var existing = d.position_name != null ? String(d.position_name).trim() : '';
  if (existing) return;
  var alt = d.job_title || d.positionTitle;
  if (alt != null && String(alt).trim() !== '') {
    d.position_name = String(alt).trim();
    return;
  }
  var pid = d.position;
  if (pid == null || pid === '') return;
  var num = typeof pid === 'number' ? pid : parseInt(String(pid), 10);
  if (isNaN(num)) return;
  try {
    var res = await apiRequest('GET', API.REFERENCE.POSITIONS);
    var arr = unwrapResponse(res);
    if (!Array.isArray(arr)) return;
    var found = arr.find(function (p) { return Number(p.id) === num; });
    if (found && found.name != null) d.position_name = String(found.name);
  } catch (e) {
    console.warn('[profile] resolve position name', e);
  }
}

async function enrichKpiFromApi(d, empId) {
  if (!d || empId == null) return;
  if (kpiLinkFromProfile(d)) return;
  try {
    var res = await apiRequest('GET', API.EMPLOYEES.KPI_BY_ID(empId));
    var o = unwrapResponse(res);
    if (!o || typeof o !== 'object') return;
    var v = o.KPI != null ? o.KPI : o.kpi;
    if (v != null && String(v).trim() !== '') d.KPI = String(v).trim();
  } catch (e) {
    /* KPI необязателен */
  }
}

module.exports = function renderProfileView(container) {
  var profileData = null;
  var isEditing = false;

  container.innerHTML = '<div class="profile-view"><div class="events-loading">Загрузка профиля...</div></div>';

  var viewEl = container.querySelector('.profile-view');

  function buildViewHtml(data) {
    var name = escapeHtml(displayName(data));
    var login = data.login || '';

    var avatarSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

    var fieldsHtml = '';
    PROFILE_FIELDS.forEach(function (f) {
      var val = data[f.key];
      var str = val != null && val !== '' ? escapeHtml(String(val)) : '<span class="profile-field__empty">Не указано</span>';
      fieldsHtml += '<div class="profile-field">' +
        '<span class="profile-field__label">' + escapeHtml(f.label) + '</span>' +
        '<span class="profile-field__value">' + str + '</span>' +
        '</div>';
    });

    var kpiSrc = kpiLinkFromProfile(data);
    var kpiRow = kpiSrc
      ? '<div class="profile-kpi-wrap"><button type="button" class="profile-kpi-btn" id="profileKpiBtn">Просмотреть KPI</button></div>'
      : '';

    return '<div class="profile-header">' +
      '<div class="profile-header__avatar">' + avatarSvg + '</div>' +
      '<div class="profile-header__info">' +
      '<h2 class="profile-header__name">' + name + '</h2>' +
      (login ? '<p class="profile-header__login">' + escapeHtml(login) + '</p>' : '') +
      '</div>' +
      '</div>' +
      '<div class="profile-actions">' +
      '<button type="button" class="profile-edit-btn" id="profileEditBtn">Редактировать</button>' +
      '<button type="button" class="profile-update-btn" id="profileUpdateBtn">Проверить обновления</button>' +
      '<button type="button" class="profile-logout-btn" id="profileLogoutBtn">Выйти из аккаунта</button>' +
      '<span class="profile-save-msg" id="profileUpdateMsg"></span>' +
      '</div>' +
      kpiRow +
      '<section class="profile-section">' +
      '<h3 class="profile-section__title">Личная информация</h3>' +
      '<div class="profile-fields-grid">' + fieldsHtml + '</div>' +
      '</section>';
  }

  function buildEditHtml(data) {
    var fields = '';
    PROFILE_FIELDS.forEach(function (f) {
      var val = data[f.key];
      var str = val != null ? String(val) : '';
      var inputType = f.type || 'text';

      if (f.readonly) {
        fields += '<div class="profile-edit-field">' +
          '<span class="profile-edit-label">' + escapeHtml(f.label) + '</span>' +
          '<input type="text" name="' + escapeHtmlAttr(f.key) + '" value="' + escapeHtmlAttr(str) + '" class="profile-edit-input profile-edit-input--readonly" readonly tabindex="-1">' +
          '</div>';
      } else if (f.select) {
        var opts = '<option value="">— Выберите —</option>';
        f.select.forEach(function (o) {
          var sel = str === o ? ' selected' : '';
          opts += '<option value="' + escapeHtmlAttr(o) + '"' + sel + '>' + escapeHtml(o) + '</option>';
        });
        if (str !== '' && f.select.indexOf(str) < 0) {
          opts = '<option value="' + escapeHtmlAttr(str) + '" selected>' + escapeHtml(str) + '</option>' + opts;
        }
        fields += '<div class="profile-edit-field">' +
          '<span class="profile-edit-label">' + escapeHtml(f.label) + '</span>' +
          '<select name="' + escapeHtmlAttr(f.key) + '" class="profile-edit-input">' + opts + '</select>' +
          '</div>';
      } else {
        fields += '<div class="profile-edit-field">' +
          '<span class="profile-edit-label">' + escapeHtml(f.label) + '</span>' +
          '<input type="' + inputType + '" name="' + escapeHtmlAttr(f.key) + '" value="' + escapeHtmlAttr(str) + '" class="profile-edit-input" autocomplete="off">' +
          '</div>';
      }
    });

    return '<form class="profile-edit-form" id="profileEditForm">' +
      '<div class="profile-edit-grid">' + fields + '</div>' +
      '<div class="profile-edit-actions">' +
      '<button type="submit" class="profile-save-btn" id="profileSaveBtn">Сохранить</button>' +
      '<button type="button" class="profile-cancel-btn" id="profileCancelBtn">Отмена</button>' +
      '<span class="profile-save-msg" id="profileSaveMsg"></span>' +
      '</div>' +
      '</form>' +
      '<section class="profile-section profile-section--password">' +
      '<h3 class="profile-section__title">Смена пароля</h3>' +
      '<div class="profile-password-form" id="profilePasswordForm">' +
      '<div class="profile-edit-field"><span class="profile-edit-label">Текущий пароль</span>' +
      '<input type="password" id="profilePwdOld" class="profile-edit-input" autocomplete="current-password"></div>' +
      '<div class="profile-edit-field"><span class="profile-edit-label">Новый пароль</span>' +
      '<input type="password" id="profilePwdNew" class="profile-edit-input" autocomplete="new-password"></div>' +
      '<div class="profile-edit-field"><span class="profile-edit-label">Повторите новый пароль</span>' +
      '<input type="password" id="profilePwdConfirm" class="profile-edit-input" autocomplete="new-password"></div>' +
      '<div class="profile-edit-actions">' +
      '<button type="button" class="profile-save-btn" id="profilePwdBtn">Сменить пароль</button>' +
      '<span class="profile-save-msg" id="profilePwdMsg"></span>' +
      '</div>' +
      '</div>' +
      '</section>';
  }

  function wireViewHandlers() {
    var editBtn = document.getElementById('profileEditBtn');
    var logoutBtn = document.getElementById('profileLogoutBtn');
    var kpiBtn = document.getElementById('profileKpiBtn');
    var updateBtn = document.getElementById('profileUpdateBtn');
    if (editBtn) editBtn.addEventListener('click', enterEditMode);
    if (logoutBtn) logoutBtn.addEventListener('click', doLogout);
    if (updateBtn) updateBtn.addEventListener('click', checkForUpdates);
    if (kpiBtn) {
      kpiBtn.addEventListener('click', function () {
        var u = normalizeExternalUrl(kpiLinkFromProfile(profileData));
        if (!u) return;
        var p = shell.openExternal(u);
        if (p && typeof p.catch === 'function') {
          p.catch(function (err) {
            console.error('[profile] open KPI', err);
            window.alert('Не удалось открыть ссылку.');
          });
        }
      });
    }
  }

  async function checkForUpdates() {
    var btn = document.getElementById('profileUpdateBtn');
    var msgEl = document.getElementById('profileUpdateMsg');
    if (btn) btn.disabled = true;
    if (msgEl) {
      msgEl.textContent = 'Проверяем обновления...';
      msgEl.className = 'profile-save-msg';
    }
    try {
      var result = await ipcRenderer.invoke('check-for-updates-manual');
      if (msgEl) {
        msgEl.textContent = (result && result.message) || 'Проверка обновлений запущена.';
        msgEl.className = 'profile-save-msg' + (result && result.ok ? ' profile-save-msg--ok' : ' profile-save-msg--err');
      }
    } catch (err) {
      if (msgEl) {
        msgEl.textContent = (err && err.message) || 'Не удалось проверить обновления.';
        msgEl.className = 'profile-save-msg profile-save-msg--err';
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireEditHandlers() {
    var form = document.getElementById('profileEditForm');
    var cancelBtn = document.getElementById('profileCancelBtn');
    var pwdBtn = document.getElementById('profilePwdBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', exitEditMode);
    if (form) form.addEventListener('submit', handleSave);
    if (pwdBtn) pwdBtn.addEventListener('click', handlePasswordChange);
  }

  function renderView() {
    if (!viewEl || !profileData) return;
    isEditing = false;
    viewEl.innerHTML = buildViewHtml(profileData);
    wireViewHandlers();
  }

  function enterEditMode() {
    if (!viewEl || !profileData) return;
    isEditing = true;
    viewEl.innerHTML = buildEditHtml(profileData);
    wireEditHandlers();
  }

  function exitEditMode() {
    renderView();
  }

  async function handleSave(e) {
    e.preventDefault();
    var form = document.getElementById('profileEditForm');
    var msgEl = document.getElementById('profileSaveMsg');
    var saveBtn = document.getElementById('profileSaveBtn');
    if (!form) return;

    var body = {};
    PROFILE_FIELDS.forEach(function (f) {
      if (f.readonly) return;
      var el = form.elements.namedItem(f.key);
      if (!el) return;
      var v = el.value.trim();
      if (v !== '') body[f.key] = v;
    });

    if (!body.first_name || !body.second_name || !body.date_of_birth) {
      if (msgEl) { msgEl.textContent = 'Имя, Фамилия и Дата рождения обязательны'; msgEl.className = 'profile-save-msg profile-save-msg--err'; }
      return;
    }

    if (saveBtn) saveBtn.disabled = true;
    if (msgEl) { msgEl.textContent = 'Сохранение...'; msgEl.className = 'profile-save-msg'; }

    var empId = profileData.employee_id || profileData.id_employees || profileData.id;

    try {
      await apiRequest('PUT', API.EMPLOYEES.BY_ID(empId), body);
      Object.assign(profileData, body);
      if (msgEl) { msgEl.textContent = 'Сохранено'; msgEl.className = 'profile-save-msg profile-save-msg--ok'; }
      setTimeout(exitEditMode, 600);
    } catch (err) {
      console.error('[profile] save', err);
      if (msgEl) { msgEl.textContent = err.message || 'Ошибка сохранения'; msgEl.className = 'profile-save-msg profile-save-msg--err'; }
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function handlePasswordChange() {
    var oldPwd = document.getElementById('profilePwdOld');
    var newPwd = document.getElementById('profilePwdNew');
    var confirmPwd = document.getElementById('profilePwdConfirm');
    var msgEl = document.getElementById('profilePwdMsg');
    var btn = document.getElementById('profilePwdBtn');

    var oldVal = oldPwd ? oldPwd.value : '';
    var newVal = newPwd ? newPwd.value : '';
    var confirmVal = confirmPwd ? confirmPwd.value : '';

    if (!oldVal) {
      if (msgEl) { msgEl.textContent = 'Введите текущий пароль'; msgEl.className = 'profile-save-msg profile-save-msg--err'; }
      return;
    }
    if (!newVal) {
      if (msgEl) { msgEl.textContent = 'Введите новый пароль'; msgEl.className = 'profile-save-msg profile-save-msg--err'; }
      return;
    }
    if (newVal.length < 4) {
      if (msgEl) { msgEl.textContent = 'Новый пароль слишком короткий (мин. 4 символа)'; msgEl.className = 'profile-save-msg profile-save-msg--err'; }
      return;
    }
    if (newVal !== confirmVal) {
      if (msgEl) { msgEl.textContent = 'Пароли не совпадают'; msgEl.className = 'profile-save-msg profile-save-msg--err'; }
      return;
    }

    if (btn) btn.disabled = true;
    if (msgEl) { msgEl.textContent = 'Сохранение...'; msgEl.className = 'profile-save-msg'; }

    var empId = profileData.id_employees || profileData.id;
    var body = { old_password: oldVal, new_password: newVal };

    try {
      var pathCandidates = [
        API.AUTH.CHANGE_PASSWORD,
        '/api/profile/change-password',
        '/api/auth/change_password',
        '/api/auth/password/change'
      ].filter(function (v, idx, arr) { return !!v && arr.indexOf(v) === idx; });
      var changed = false;
      var last404 = null;
      for (var i = 0; i < pathCandidates.length; i++) {
        var endpoint = pathCandidates[i];
        try {
          await apiRequest('POST', endpoint, body);
          changed = true;
          break;
        } catch (err) {
          var status = Number(err && err.status);
          var msg = String((err && err.message) || '');
          if (status === 404 || msg.indexOf('404') >= 0) {
            last404 = err;
            continue;
          }
          throw err;
        }
      }
      if (!changed) {
        if (last404) throw new Error('Эндпоинт смены пароля не найден на сервере (404).');
        throw new Error('Не удалось изменить пароль.');
      }
      if (msgEl) { msgEl.textContent = 'Пароль изменён'; msgEl.className = 'profile-save-msg profile-save-msg--ok'; }
      if (oldPwd) oldPwd.value = '';
      if (newPwd) newPwd.value = '';
      if (confirmPwd) confirmPwd.value = '';
    } catch (err) {
      console.error('[profile] change password', err);
      if (msgEl) { msgEl.textContent = err.message || 'Ошибка смены пароля'; msgEl.className = 'profile-save-msg profile-save-msg--err'; }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function doLogout() {
    if (!window.confirm('Выйти из аккаунта?')) return;
    try {
      ipcRenderer.send('logout');
    } catch (err) {
      console.error('[profile] logout', err);
    }
  }

  async function loadProfile() {
    try {
      var user = await ipcRenderer.invoke('get-user');
      var empId = user ? (user.employee_id || user.id_employees || user.id) : null;
      var fullData = user || {};

      if (empId) {
        try {
          var res = await apiRequest('GET', API.EMPLOYEES.BY_ID(empId));
          var d = unwrapResponse(res);
          if (d && d.success === true && d.data != null && typeof d.data === 'object' && !Array.isArray(d.data)) {
            var inner = d.data;
            if (inner.id_employees != null || inner.first_name != null || inner.id != null) d = inner;
          }
          if (d && typeof d === 'object' && !Array.isArray(d)) {
            fullData = Object.assign({}, user, d);
          }
        } catch (e) {
          console.warn('[profile] GET employee', empId, e);
        }
      }

      await enrichPositionName(fullData);
      if (empId) await enrichKpiFromApi(fullData, empId);

      profileData = fullData;
      renderView();
    } catch (err) {
      console.error('[profile] load', err);
      if (viewEl) viewEl.innerHTML = '<p class="profile-error">Не удалось загрузить профиль: ' + escapeHtml(err.message || 'ошибка') + '</p>';
    }
  }

  loadProfile();
};
