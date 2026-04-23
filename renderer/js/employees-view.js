'use strict';

const { ipcRenderer } = require('electron');
const { apiRequest, unwrapResponse } = require('./api-client.js');
const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');
const API = require('./api-paths.js');
const { employeeDisplayName } = require('./shared-utils.js');
const { wireEmployeesExport } = require('./employees-export.js');
const { wireEmployeesAddModal } = require('./employees-add-modal.js');
const { wireEmployeesPositionsModal } = require('./employees-positions-modal.js');
const { wireEmployeesEditModal } = require('./employees-edit-modal.js');

const ADMIN_ACCESS_LEVELS = [1, 4, 6];

function hasAdminAccess(accessLevel) {
  const n = Number(accessLevel);
  return !isNaN(n) && ADMIN_ACCESS_LEVELS.indexOf(n) >= 0;
}

function employeePosition(e) {
  return e.position_name || e.position || e.job_title || '';
}

function employeePhone(e) {
  return e.contact || e.phone || e.contact_phone || '';
}

module.exports = function renderEmployeesView(container) {
  let currentUser = null;
  let isAdmin = false;
  let activeEmployees = [];
  let allWithInactive = [];
  let filteredEmployees = [];
  let currentTab = 'active';

  const shared = { positionsCache: null, accessLevelsCache: null };

  const downloadSvg = '<svg class="excel-btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>';

  container.innerHTML = [
    '<div class="emp-view">',
    '  <div class="emp-tabs">',
    '    <button type="button" class="emp-tab emp-tab--active" id="empTabActive">Активные</button>',
    '    <button type="button" class="emp-tab" id="empTabAll">Все</button>',
    '  </div>',
    '  <div class="emp-toolbar">',
    '    <input type="text" class="search-input" id="empSearch" placeholder="Поиск сотрудника...">',
    '    <div class="emp-toolbar__actions">',
    '      <button type="button" class="excel-btn" id="empExportSizes" title="Скачать размеры (Excel)">' + downloadSvg + '<span>Размеры</span></button>',
    '      <button type="button" class="excel-btn" id="empExportAll" title="Скачать всю информацию (Excel)">' + downloadSvg + '<span>Вся информация</span></button>',
    '      <button type="button" class="emp-positions-btn" id="empPositionsBtn" style="display:none">Должности</button>',
    '      <button type="button" class="emp-add-btn" id="empAddBtn" style="display:none">+ Добавить сотрудника</button>',
    '    </div>',
    '  </div>',
    '  <div class="emp-list-scroll" id="empListScroll">',
    '    <div class="emp-grid" id="empGrid"><div class="events-loading">Загрузка...</div></div>',
    '  </div>',
    '  <div class="emp-empty" id="empEmpty" style="display:none">Нет сотрудников</div>',
    '  <div class="emp-error" id="empError" style="display:none"><span id="empErrorText"></span><button type="button" id="empRetry">Повторить</button></div>',
    '</div>',

    '<div class="modal-overlay emp-add-modal" id="empAddModal" hidden aria-hidden="true">',
    '  <div class="modal-dialog emp-add-dialog" role="dialog" aria-modal="true" onclick="event.stopPropagation()">',
    '    <div class="modal-header">',
    '      <h2 class="modal-title">Новый сотрудник</h2>',
    '      <button type="button" class="modal-close" id="empAddClose" aria-label="Закрыть">&times;</button>',
    '    </div>',
    '    <div class="modal-body">',
    '      <form id="empAddForm" class="emp-add-form">',
    '        <div class="emp-add-field"><span class="emp-add-label">Фамилия <abbr title="Обязательное поле">*</abbr></span><input type="text" name="second_name" required autocomplete="off" class="emp-add-input"></div>',
    '        <div class="emp-add-field"><span class="emp-add-label">Имя <abbr title="Обязательное поле">*</abbr></span><input type="text" name="first_name" required autocomplete="off" class="emp-add-input"></div>',
    '        <div class="emp-add-field"><span class="emp-add-label">Отчество</span><input type="text" name="patronymic" autocomplete="off" class="emp-add-input" placeholder="необязательно"></div>',
    '        <div class="emp-add-field"><span class="emp-add-label">Дата рождения <abbr title="Обязательное поле">*</abbr></span><input type="date" name="date_of_birth" required class="emp-add-input"></div>',
    '        <div class="emp-add-field"><span class="emp-add-label">Должность <abbr title="Обязательное поле">*</abbr></span><select name="position" required class="emp-add-input" id="empAddPosition"><option value="">Загрузка...</option></select></div>',
    '        <div class="emp-add-field"><span class="emp-add-label">Уровень доступа <abbr title="Обязательное поле">*</abbr></span><select name="access_level_id" required class="emp-add-input" id="empAddAccess"><option value="">Загрузка...</option></select></div>',
    '        <div class="emp-add-field"><span class="emp-add-label">Логин <abbr title="Обязательное поле">*</abbr> <small>(мин. 6 символов)</small></span><input type="text" name="login" required minlength="6" autocomplete="off" class="emp-add-input"></div>',
    '        <div class="emp-add-field"><span class="emp-add-label">Пароль <abbr title="Обязательное поле">*</abbr></span><input type="password" name="password" required autocomplete="new-password" class="emp-add-input"></div>',
    '        <div class="emp-add-actions">',
    '          <button type="submit" class="emp-add-submit" id="empAddSubmit">Создать</button>',
    '          <span class="emp-add-msg" id="empAddMsg"></span>',
    '        </div>',
    '      </form>',
    '    </div>',
    '  </div>',
    '</div>',

    '<div class="modal-overlay pos-modal" id="posModal" hidden aria-hidden="true">',
    '  <div class="modal-dialog pos-dialog" role="dialog" aria-modal="true" onclick="event.stopPropagation()">',
    '    <div class="modal-header">',
    '      <h2 class="modal-title">Управление должностями</h2>',
    '      <button type="button" class="modal-close" id="posClose" aria-label="Закрыть">&times;</button>',
    '    </div>',
    '    <div class="modal-body pos-body">',
    '      <div class="pos-create-row">',
    '        <input type="text" class="pos-create-input" id="posNewName" placeholder="Новая должность..." maxlength="150">',
    '        <button type="button" class="pos-create-btn" id="posCreateBtn">Добавить</button>',
    '      </div>',
    '      <div class="pos-list" id="posList"><div class="events-loading">Загрузка...</div></div>',
    '      <div class="pos-msg" id="posMsg"></div>',
    '    </div>',
    '  </div>',
    '</div>',

    '<div class="modal-overlay emp-edit-modal" id="empEditModal" hidden aria-hidden="true">',
    '  <div class="modal-dialog emp-edit-dialog" role="dialog" aria-modal="true" onclick="event.stopPropagation()">',
    '    <div class="modal-header">',
    '      <h2 class="modal-title" id="empEditTitle">Редактирование сотрудника</h2>',
    '      <button type="button" class="modal-close" id="empEditClose" aria-label="Закрыть">&times;</button>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div class="emp-edit-loading" id="empEditLoading"><div class="events-loading">Загрузка...</div></div>',
    '      <form id="empEditForm" class="emp-add-form" style="display:none"></form>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('');

  const tabActive = document.getElementById('empTabActive');
  const tabAll = document.getElementById('empTabAll');
  const searchInput = document.getElementById('empSearch');
  const grid = document.getElementById('empGrid');
  const emptyEl = document.getElementById('empEmpty');
  const errorEl = document.getElementById('empError');
  const errorText = document.getElementById('empErrorText');
  const retryBtn = document.getElementById('empRetry');
  const addBtn = document.getElementById('empAddBtn');
  const positionsBtn = document.getElementById('empPositionsBtn');
  const scrollEl = document.getElementById('empListScroll');
  const exportSizesBtn = document.getElementById('empExportSizes');
  const exportAllBtn = document.getElementById('empExportAll');

  function setTab(tab) {
    currentTab = tab;
    if (tabActive) tabActive.classList.toggle('emp-tab--active', tab === 'active');
    if (tabAll) tabAll.classList.toggle('emp-tab--active', tab === 'all');
    applyFilter();
  }

  if (tabActive) tabActive.addEventListener('click', function () { setTab('active'); });
  if (tabAll) tabAll.addEventListener('click', function () { setTab('all'); });

  function showState(s, msg) {
    if (scrollEl) scrollEl.style.display = (s === 'loading' || s === 'list') ? 'block' : 'none';
    if (emptyEl) emptyEl.style.display = s === 'empty' ? 'block' : 'none';
    if (errorEl) errorEl.style.display = s === 'error' ? 'block' : 'none';
    if (s === 'loading' && grid) grid.innerHTML = '<div class="events-loading">Загрузка...</div>';
    if (s === 'error' && errorText) errorText.textContent = msg || '';
  }

  const editModalApi = wireEmployeesEditModal({
    shared: shared,
    apiRequest: apiRequest,
    escapeHtml: escapeHtml,
    escapeHtmlAttr: escapeHtmlAttr,
    employeeDisplayName: employeeDisplayName,
    getCurrentUser: function () { return currentUser; },
    onListReload: function () { loadEmployees(); }
  });

  function buildCardHtml(emp) {
    const empId = emp.id_employees || emp.id;
    const name = escapeHtml(employeeDisplayName(emp));
    const pos = employeePosition(emp);
    const phone = employeePhone(emp);
    const edu = emp.education || '';
    const employed = !(emp.is_active === 0 || emp.is_active === false);
    const posHtml = pos ? '<p class="emp-card__position">' + escapeHtml(String(pos)) + '</p>' : '';
    const eduHtml = edu ? '<p class="emp-card__education">' + escapeHtml(edu) + '</p>' : '';
    const phoneHtml = phone ? '<p class="emp-card__phone">' + escapeHtml(phone) + '</p>' : '';
    const cls = 'emp-card' + (!employed ? ' emp-card--inactive' : '') + (isAdmin ? ' emp-card--clickable' : '');
    return '<div class="' + cls + '" data-emp-id="' + (empId || '') + '">' +
      '<div class="emp-card__avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>' +
      '<h3 class="emp-card__name">' + name + '</h3>' +
      posHtml +
      eduHtml +
      phoneHtml +
      '</div>';
  }

  function renderCards() {
    if (!grid) return;
    if (!filteredEmployees.length) {
      grid.innerHTML = '';
      const sourceList = currentTab === 'active' ? activeEmployees : allWithInactive;
      showState(sourceList.length ? 'list' : 'empty');
      if (sourceList.length && !filteredEmployees.length) {
        grid.innerHTML = '<p class="emp-no-match">Ничего не найдено</p>';
        if (scrollEl) scrollEl.style.display = 'block';
      }
      return;
    }
    grid.innerHTML = filteredEmployees.map(buildCardHtml).join('');
    showState('list');

    if (isAdmin) {
      grid.querySelectorAll('.emp-card--clickable').forEach(function (card) {
        card.addEventListener('click', function () {
          const eid = parseInt(card.dataset.empId, 10);
          if (eid) editModalApi.openEditEmployee(eid);
        });
      });
    }
  }

  function getSourceList() {
    return currentTab === 'active' ? activeEmployees : allWithInactive;
  }

  function applyFilter() {
    const source = getSourceList();
    const q = (searchInput ? searchInput.value : '').trim().toLowerCase();
    if (!q) {
      filteredEmployees = source.slice();
    } else {
      filteredEmployees = source.filter(function (e) {
        const haystack = (employeeDisplayName(e) + ' ' + employeePosition(e) + ' ' + employeePhone(e)).toLowerCase();
        return haystack.indexOf(q) >= 0;
      });
    }
    renderCards();
  }

  async function loadEmployees() {
    showState('loading');
    try {
      const resActive = await apiRequest('GET', API.EMPLOYEES.ALL);
      let arrActive = resActive.data || resActive || [];
      if (!Array.isArray(arrActive)) arrActive = [];
      activeEmployees = arrActive;

      try {
        const resAll = await apiRequest('GET', API.EMPLOYEES.WITH_INACTIVE);
        let arrAll = resAll.data || resAll || [];
        if (!Array.isArray(arrAll)) arrAll = [];
        allWithInactive = arrAll;
      } catch (e) {
        console.warn('[employees] with-inactive fallback', e);
        allWithInactive = arrActive.slice();
      }

      applyFilter();
    } catch (err) {
      console.error('[employees] load', err);
      showState('error', err.message || 'Ошибка загрузки');
    }
  }

  if (searchInput) {
    let searchTimer = null;
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilter, 200);
    });
  }
  if (retryBtn) retryBtn.addEventListener('click', loadEmployees);

  (async function checkAccess() {
    try {
      currentUser = await ipcRenderer.invoke('get-user') || {};
    } catch (e) { currentUser = {}; }
    const empId = currentUser.employee_id || currentUser.id_employees || currentUser.id;
    let level = null;
    if (empId != null) {
      try {
        const res = await apiRequest('GET', API.REFERENCE.ACCESS_BY_ID(empId));
        const d = unwrapResponse(res);
        level = d.access_level_id;
      } catch (e) {
        console.warn('[employees] GET reference access failed', empId, e);
      }
    }
    if (level == null) level = currentUser.accessLevel;
    isAdmin = hasAdminAccess(level);
    if (isAdmin) {
      if (addBtn) addBtn.style.display = '';
      if (positionsBtn) positionsBtn.style.display = '';
    }
  })();

  wireEmployeesExport({
    apiRequest: apiRequest,
    exportSizesBtn: exportSizesBtn,
    exportAllBtn: exportAllBtn,
    getActiveEmployees: function () { return activeEmployees; }
  });

  wireEmployeesAddModal({
    shared: shared,
    apiRequest: apiRequest,
    escapeHtml: escapeHtml,
    escapeHtmlAttr: escapeHtmlAttr,
    onEmployeeCreated: loadEmployees
  });

  wireEmployeesPositionsModal({
    shared: shared,
    apiRequest: apiRequest,
    escapeHtml: escapeHtml,
    escapeHtmlAttr: escapeHtmlAttr,
    getActiveEmployees: function () { return activeEmployees; },
    getAllWithInactive: function () { return allWithInactive; },
    onAfterPositionMutation: loadEmployees
  });

  loadEmployees();
};
