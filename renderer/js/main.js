/* eslint-disable no-console */
console.log('[main] script start');

const { ipcRenderer } = require('electron');
console.log('[main] ipcRenderer loaded');

const VIEWS = {
  org: 'Мероприятия — Организация',
  part: 'Мероприятия — Участие',
  rent: 'Бронь',
  notifications: 'Уведомления',
  docs: 'Документы',
  schedule: 'Расписание',
  export: 'Выгрузка',
  students: 'Ученики',
  employees: 'Сотрудники',
  profile: 'Профиль'
};

function showView(viewId) {
  console.log('[main] showView', viewId);
  const contentTitle = document.getElementById('contentTitle');
  const contentBody = document.getElementById('contentBody');
  if (!contentTitle) {
    console.error('[main] contentTitle not found');
    return;
  }
  if (!contentBody) {
    console.error('[main] contentBody not found');
    return;
  }

  contentTitle.textContent = VIEWS[viewId] || viewId;
  contentBody.innerHTML = '';

  document.querySelectorAll('.nav-item').forEach(function (el) {
    el.classList.toggle('active', el.dataset.view === viewId);
  });

  if (viewId === 'org' || viewId === 'part') {
    renderEventsView(contentBody, viewId);
  } else {
    contentBody.innerHTML = '<p class="content-placeholder">Раздел в разработке</p>';
  }
}

async function apiRequest(method, path, body) {
  const baseUrl = await ipcRenderer.invoke('get-server-url');
  const token = await ipcRenderer.invoke('get-access-token');
  if (!baseUrl) throw new Error('Сервер не настроен');
  const url = baseUrl.replace(/\/$/, '') + path;
  const opts = {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  const res = await fetch(url, opts);
  if (res.status === 401) {
    const newToken = await ipcRenderer.invoke('refresh-access-token');
    if (newToken) return apiRequest(method, path, body);
    throw new Error('Сессия истекла');
  }
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || 'Ошибка ' + res.status);
  return data;
}

function escapeHtml(str) {
  if (str == null) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function createCustomSelect(id, options, selectedValue, placeholder) {
  var html = '<div class="custom-select" id="' + id + '">';
  html += '<button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false">';
  html += '<span class="custom-select-value">' + escapeHtml(placeholder || 'Выберите') + '</span>';
  html += '<span class="custom-select-arrow"></span></button>';
  html += '<div class="custom-select-dropdown" role="listbox">';
  options.forEach(function (opt) {
    var val = opt.value !== undefined && opt.value !== null ? String(opt.value) : '';
    var label = opt.label || opt.name || val || '—';
    var sel = (selectedValue === val || (selectedValue === '' && val === '')) ? ' custom-select-option--selected' : '';
    html += '<div class="custom-select-option' + sel + '" role="option" data-value="' + escapeHtml(String(opt.value === '' ? '' : opt.value)) + '">' + escapeHtml(label) + '</div>';
  });
  html += '</div></div>';
  return html;
}

function initCustomSelect(containerId, onChange) {
  var wrap = document.getElementById(containerId);
  if (!wrap) return null;
  var trigger = wrap.querySelector('.custom-select-trigger');
  var valueEl = wrap.querySelector('.custom-select-value');
  var dropdown = wrap.querySelector('.custom-select-dropdown');
  var options = wrap.querySelectorAll('.custom-select-option');
  var currentValue = '';

  options.forEach(function (opt) {
    if (opt.classList.contains('custom-select-option--selected')) {
      currentValue = opt.getAttribute('data-value') || opt.dataset.value || '';
    }
    opt.addEventListener('click', function () {
      var v = this.dataset.value || '';
      currentValue = v;
      valueEl.textContent = this.textContent;
      options.forEach(function (o) { o.classList.remove('custom-select-option--selected'); });
      this.classList.add('custom-select-option--selected');
      wrap.classList.remove('custom-select--open');
      trigger.setAttribute('aria-expanded', 'false');
      if (onChange) onChange(v);
    });
  });

  trigger.addEventListener('click', function (e) {
    e.stopPropagation();
    var isOpen = wrap.classList.toggle('custom-select--open');
    trigger.setAttribute('aria-expanded', isOpen);
  });

  document.addEventListener('click', function () {
    wrap.classList.remove('custom-select--open');
    trigger.setAttribute('aria-expanded', 'false');
  });

  return {
    getValue: function () { return currentValue; },
    setOptions: function (opts, selectedVal) {
      var sel = selectedVal !== undefined ? selectedVal : currentValue;
      currentValue = sel;
      dropdown.innerHTML = opts.map(function (o) {
        var v = o.value !== undefined && o.value !== null ? String(o.value) : '';
        var lbl = o.label || o.name || v || '—';
        var s = (sel === v || (sel === '' && v === '')) ? ' custom-select-option--selected' : '';
        return '<div class="custom-select-option' + s + '" role="option" data-value="' + escapeHtml(v) + '">' + escapeHtml(lbl) + '</div>';
      }).join('');
      var selOpt = opts.find(function (o) {
        var v = o.value !== undefined && o.value !== null ? String(o.value) : '';
        return sel === v || (sel === '' && v === '');
      });
      valueEl.textContent = selOpt ? (selOpt.label || selOpt.name || '—') : (opts[0] ? (opts[0].label || opts[0].name || '—') : '');
      var newOpts = dropdown.querySelectorAll('.custom-select-option');
      newOpts.forEach(function (opt) {
        opt.addEventListener('click', function () {
          currentValue = this.dataset.value || '';
          valueEl.textContent = this.textContent;
          newOpts.forEach(function (o) { o.classList.remove('custom-select-option--selected'); });
          this.classList.add('custom-select-option--selected');
          wrap.classList.remove('custom-select--open');
          trigger.setAttribute('aria-expanded', 'false');
          if (onChange) onChange(currentValue);
        });
      });
    }
  };
}

function renderEventsView(container, type) {
  console.log('[main] renderEventsView', type);
  container.innerHTML = [
    '<div class="events-view">',
    '  <div class="events-toolbar">',
    '    <input type="text" class="events-search" placeholder="Поиск..." id="eventsSearch">',
    createCustomSelect('eventsSortTime', [
      { value: 'asc', label: 'По времени: раньше' },
      { value: 'desc', label: 'По времени: позже' }
    ], 'asc', 'По времени: раньше'),
    createCustomSelect('eventsSortEmployee', [{ value: '', label: 'Все сотрудники' }], '', 'Все сотрудники'),
    '  </div>',
    '  <div class="events-list" id="eventsList"><div class="events-loading">Загрузка...</div></div>',
    '  <div class="events-empty" id="eventsEmpty" style="display:none">Нет мероприятий</div>',
    '  <div class="events-error" id="eventsError" style="display:none"><span id="eventsErrorText"></span><button type="button" id="eventsErrorRetry">Повторить</button></div>',
    '</div>'
  ].join('');

  const listEl = document.getElementById('eventsList');
  const emptyEl = document.getElementById('eventsEmpty');
  const errorEl = document.getElementById('eventsError');
  const errorText = document.getElementById('eventsErrorText');
  const searchInput = document.getElementById('eventsSearch');
  const retryBtn = document.getElementById('eventsErrorRetry');

  var sortTimeSelect = initCustomSelect('eventsSortTime', function () { load(); });
  var sortEmployeeSelect = initCustomSelect('eventsSortEmployee', function () { load(); });

  const sortField = type === 'part' ? 'registration_deadline' : 'dates_of_event';

  function showState(s, msg) {
    listEl.style.display = (s === 'loading' || s === 'list') ? 'flex' : 'none';
    emptyEl.style.display = s === 'empty' ? 'block' : 'none';
    errorEl.style.display = s === 'error' ? 'block' : 'none';
    if (s === 'loading') listEl.innerHTML = '<div class="events-loading">Загрузка...</div>';
    if (s === 'error' && errorText) errorText.textContent = msg || '';
  }

  function escapeHtml(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(str) {
    if (!str) return '—';
    var d = String(str);
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
      var p = d.split(/[-T]/);
      return (p[2] || '') + '.' + (p[1] || '') + '.' + (p[0] || '');
    }
    return d;
  }

  function cardHtml(item, resp) {
    var dateLabel = type === 'part' ? 'регистрация до:' : 'дата проведения:';
    var dateVal = type === 'part' ? (item.registration_deadline || item.dates_of_event) : item.dates_of_event;
    var respHtml = (resp || []).map(function (r) {
      var n = [r.first_name, r.second_name].filter(Boolean).join(' ') || '—';
      return '<span class="event-card-responsible">' + escapeHtml(n) + '</span>';
    }).join('');
    return '<div class="event-card">' +
      '<h3 class="event-card-title">' + escapeHtml(item.name || '—') + '</h3>' +
      (type === 'part' && item.form_of_holding ? '<p class="event-card-type">' + escapeHtml(item.form_of_holding) + '</p>' : '') +
      (type === 'org' && item.day_of_the_week ? '<p class="event-card-day">' + escapeHtml(item.day_of_the_week) + '</p>' : '') +
      '<p class="event-card-date"><span class="event-card-date-label">' + dateLabel + '</span> ' + formatDate(dateVal) + '</p>' +
      '<div class="event-card-responsibles">' + respHtml + '</div></div>';
  }

  async function load() {
    console.log('[main] events load start');
    showState('loading');
    try {
      var filters = { period: new Date().getFullYear().toString() };
      if (searchInput && searchInput.value.trim()) filters.search = searchInput.value.trim();
      var empVal = sortEmployeeSelect ? sortEmployeeSelect.getValue() : '';
      if (empVal) filters.employee_id = parseInt(empVal, 10);
      var sortOrder = sortTimeSelect ? sortTimeSelect.getValue() : 'asc';
      var sort = [{ field: sortField, order: sortOrder }];

      var base = type === 'org' ? '/api/events/org' : '/api/events/part';
      var listRes = await apiRequest('POST', base + '/list', { filters: filters, sort: sort, page: 1, limit: 20 });
      console.log('[main] list response', JSON.stringify(listRes).slice(0, 200));

      if (listRes && listRes.success === false) throw new Error(listRes.error || 'Ошибка API');
      var items = listRes.data || listRes || [];
      if (!Array.isArray(items)) items = [];

      var cards = [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var resp = [];
        try {
          var rRes = await apiRequest('GET', base + '/responsible/' + item.id);
          resp = rRes.data || rRes;
          resp = Array.isArray(resp) ? resp : [];
        } catch (e) {
          console.warn('[main] responsible fail', item.id, e);
        }
        cards.push(cardHtml(item, resp));
      }

      if (cards.length === 0) {
        showState('empty');
        return;
      }
      listEl.innerHTML = cards.join('');
      listEl.className = 'events-list events-cards';
      showState('list');
      console.log('[main] events loaded', cards.length);
    } catch (err) {
      console.error('[main] events load error', err);
      showState('error', err.message || 'Ошибка загрузки');
    }
  }

  async function loadEmployees() {
    try {
      var res = await apiRequest('GET', '/api/employees');
      var arr = res.data || res || [];
      if (!Array.isArray(arr)) arr = [];
      var opts = [{ value: '', label: 'Все сотрудники' }];
      arr.forEach(function (e) {
        var active = e.is_active !== undefined ? e.is_active : (e.active !== undefined ? e.active : true);
        if (!active) return;
        var id = e.id_employees || e.id;
        var name = e.name || [e.first_name, e.second_name, e.patronymic].filter(Boolean).join(' ') || '—';
        opts.push({ value: String(id || ''), label: name });
      });
      if (sortEmployeeSelect && sortEmployeeSelect.setOptions) {
        sortEmployeeSelect.setOptions(opts, '');
      }
    } catch (e) {
      console.warn('[main] employees load fail', e);
    }
  }

  if (searchInput) searchInput.addEventListener('input', function () { setTimeout(load, 300); });
  if (retryBtn) retryBtn.addEventListener('click', load);

  loadEmployees().then(load).catch(function (e) {
    console.error('[main] init fail', e);
    showState('error', e.message || 'Ошибка');
  });
}

function init() {
  console.log('[main] init start');
  var profileName = document.getElementById('profileName');
  var profileBtn = document.getElementById('profileBtn');
  var sidebar = document.getElementById('sidebar');
  var sidebarToggle = document.getElementById('sidebarToggle');

  if (profileName) {
    ipcRenderer.invoke('get-user').then(function (user) {
      profileName.textContent = (user && user.id) ? 'Пользователь' : '—';
    });
  }

  if (profileBtn) profileBtn.addEventListener('click', function () { showView('profile'); });

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', function () {
      sidebar.classList.toggle('collapsed');
      var c = sidebar.classList.contains('collapsed');
      sidebarToggle.classList.toggle('collapsed', c);
      sidebarToggle.setAttribute('aria-label', c ? 'Развернуть меню' : 'Свернуть меню');
    });
    sidebarToggle.classList.toggle('collapsed', sidebar.classList.contains('collapsed'));
  }

  document.querySelectorAll('.nav-item').forEach(function (item) {
    item.addEventListener('click', function (e) {
      e.preventDefault();
      var v = item.dataset.view;
      if (v) showView(v);
    });
  });

  showView('part');
  console.log('[main] init done');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    console.log('[main] DOMContentLoaded');
    init();
  });
} else {
  console.log('[main] DOM already ready');
  init();
}
