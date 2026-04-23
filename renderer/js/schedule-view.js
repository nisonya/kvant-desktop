'use strict';

const { apiRequest, unwrapResponse } = require('./api-client.js');
const API = require('./api-paths.js');
const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');

const TAB_CONFIG = {
  teachers: {
    label: 'Наставники',
    loadOptions: async function () {
      var rows = [];
      try {
        var withInactiveRes = await apiRequest('GET', API.EMPLOYEES.WITH_INACTIVE);
        rows = unwrapResponse(withInactiveRes);
      } catch (_) {
        var activeRes = await apiRequest('GET', API.EMPLOYEES.ALL);
        rows = unwrapResponse(activeRes);
      }
      if (!Array.isArray(rows)) rows = [];
      return rows.filter(function (row) {
        return isActiveEmployee(row) && isTeacherEmployee(row);
      });
    },
    loadSchedule: async function (id) {
      var res = await apiRequest('GET', API.SCHEDULE.BY_TEACHER(id));
      var rows = unwrapResponse(res);
      return Array.isArray(rows) ? rows : [];
    },
    placeholder: 'Выберите наставника'
  },
  rooms: {
    label: 'Кабинеты',
    loadOptions: async function () {
      var res = await apiRequest('GET', API.REFERENCE.ROOMS);
      var rows = unwrapResponse(res);
      return Array.isArray(rows) ? rows : [];
    },
    loadSchedule: async function (id) {
      var res = await apiRequest('GET', API.SCHEDULE.BY_ROOM(id));
      var rows = unwrapResponse(res);
      return Array.isArray(rows) ? rows : [];
    },
    placeholder: 'Выберите кабинет'
  },
  groups: {
    label: 'Группы',
    loadOptions: async function () {
      var res = await apiRequest('GET', API.SCHEDULE.GROUPS);
      var rows = unwrapResponse(res);
      return Array.isArray(rows) ? rows : [];
    },
    loadSchedule: async function (id) {
      var res = await apiRequest('GET', API.SCHEDULE.BY_GROUP(id));
      var rows = unwrapResponse(res);
      return Array.isArray(rows) ? rows : [];
    },
    placeholder: 'Выберите группу'
  }
};

const DAY_ORDER = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

function normalizeDayName(dayName) {
  return String(dayName || '').trim().toLowerCase();
}

function scheduleSort(a, b) {
  var dayA = DAY_ORDER.indexOf(normalizeDayName(a && a.day));
  var dayB = DAY_ORDER.indexOf(normalizeDayName(b && b.day));
  var rankA = dayA >= 0 ? dayA : 999;
  var rankB = dayB >= 0 ? dayB : 999;
  if (rankA !== rankB) return rankA - rankB;
  return String((a && a.startTime) || '').localeCompare(String((b && b.startTime) || ''));
}

function readNumericPositionId(row) {
  var raw = row && (
    row.position_id != null ? row.position_id
      : (row.id_position != null ? row.id_position
        : (row.position != null ? row.position
          : (row.id_posts != null ? row.id_posts : row.post)))
  );
  var n = parseInt(String(raw), 10);
  return isNaN(n) ? null : n;
}

function isActiveEmployee(row) {
  return !(row && (row.is_active === 0 || row.is_active === false || String(row.is_active) === '0'));
}

function isTeacherEmployee(row) {
  var posId = readNumericPositionId(row);
  if (posId === 2) return true;
  var text = String(
    (row && (row.position_name || row.position || row.post || row.job_title || row.role_name)) || ''
  ).trim().toLowerCase();
  if (!text) return false;
  return text.indexOf('настав') >= 0;
}

function optionId(row) {
  if (!row || typeof row !== 'object') return '';
  var raw = row.id != null ? row.id
    : (row.employee_id != null ? row.employee_id
      : (row.id_employee != null ? row.id_employee : row.id_employees));
  return raw == null ? '' : String(raw);
}

function optionName(row) {
  if (!row || typeof row !== 'object') return '—';
  if (row.name != null && String(row.name).trim()) return String(row.name);
  if (row.full_name != null && String(row.full_name).trim()) return String(row.full_name);
  if (row.fio != null && String(row.fio).trim()) return String(row.fio);
  var parts = [row.surname, row.first_name, row.patronymic]
    .map(function (v) { return v == null ? '' : String(v).trim(); })
    .filter(Boolean);
  if (parts.length) return parts.join(' ');
  return '—';
}

module.exports = function renderScheduleView(container) {
  if (!container) return;

  var activeTab = 'teachers';
  var options = { teachers: [], rooms: [], groups: [] };
  var selected = { teachers: '', rooms: '', groups: '' };
  var lessons = [];
  var loading = false;
  var message = '';

  function setMessage(text) {
    message = text || '';
    var el = document.getElementById('scheduleMsg');
    if (!el) return;
    el.textContent = message;
  }

  function groupByDays(list) {
    var map = {};
    list.forEach(function (item) {
      var key = String(item && item.day ? item.day : 'Без дня');
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    return map;
  }

  function renderLessons() {
    var wrap = document.getElementById('scheduleCards');
    if (!wrap) return;
    if (loading) {
      wrap.innerHTML = '<div class="events-loading">Загрузка расписания...</div>';
      return;
    }
    if (!lessons.length) {
      wrap.innerHTML = '<div class="students-empty">Расписание не найдено.</div>';
      return;
    }
    lessons.sort(scheduleSort);
    var byDays = groupByDays(lessons);
    var dayNames = Object.keys(byDays).sort(function (a, b) {
      var ia = DAY_ORDER.indexOf(normalizeDayName(a));
      var ib = DAY_ORDER.indexOf(normalizeDayName(b));
      var ra = ia >= 0 ? ia : 999;
      var rb = ib >= 0 ? ib : 999;
      return ra - rb;
    });
    wrap.innerHTML = dayNames.map(function (day) {
      var rows = byDays[day];
      var cards = rows.map(function (row, idx) {
        return '<article class="schedule-lesson">' +
          '<div class="schedule-lesson__index">' + (idx + 1) + '</div>' +
          '<div class="schedule-lesson__body">' +
          '<div class="schedule-lesson__title">' + escapeHtml(String((row && row.room) || '—')) + '</div>' +
          '<div class="schedule-lesson__time">' + escapeHtml(String((row && row.startTime) || '—') + ' - ' + String((row && row.endTime) || '—')) + '</div>' +
          '<div class="schedule-lesson__teacher">' + escapeHtml(String((row && row.name) || '—')) + '</div>' +
          '<div class="schedule-lesson__group">' + escapeHtml(String((row && row.group) || '—')) + '</div>' +
          '</div>' +
          '</article>';
      }).join('');
      return '<section class="schedule-day">' +
        '<h3 class="schedule-day__title">' + escapeHtml(String(day || 'Без дня').toUpperCase()) + '</h3>' +
        '<div class="schedule-day__list">' + cards + '</div>' +
        '</section>';
    }).join('');
  }

  function renderTabs() {
    var tabWrap = document.getElementById('scheduleTabs');
    var select = document.getElementById('scheduleSelect');
    if (!tabWrap || !select) return;
    tabWrap.innerHTML = Object.keys(TAB_CONFIG).map(function (key) {
      var isActive = key === activeTab;
      var icon = key === 'teachers'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        : (key === 'rooms'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="18" height="20" rx="2"/><path d="M9 22V8h6v14"/><path d="M9 6h6"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H4a4 4 0 0 0-4 4v2"/><circle cx="8" cy="7" r="4"/><path d="M24 21v-2a4 4 0 0 0-3-3.87"/><path d="M17 3.13a4 4 0 0 1 0 7.75"/></svg>');
      return '<button type="button" class="schedule-tab' + (isActive ? ' schedule-tab--active' : '') + '" data-tab="' + key + '">' +
        '<span class="schedule-tab__icon">' + icon + '</span>' +
        '<span>' + escapeHtml(TAB_CONFIG[key].label) + '</span>' +
        '</button>';
    }).join('');

    var activeCfg = TAB_CONFIG[activeTab];
    var opts = options[activeTab] || [];
    select.innerHTML = ['<option value="">' + escapeHtml(activeCfg.placeholder) + '</option>'].concat(opts.map(function (o) {
      var oid = optionId(o);
      var selectedAttr = String(selected[activeTab]) === oid ? ' selected' : '';
      return '<option value="' + escapeHtmlAttr(oid) + '"' + selectedAttr + '>' + escapeHtml(optionName(o)) + '</option>';
    })).join('');
    tabWrap.querySelectorAll('.schedule-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nextTab = btn.getAttribute('data-tab') || 'teachers';
        if (nextTab === activeTab) return;
        activeTab = nextTab;
        ensureOptions(activeTab).then(function () {
          if ((!selected[activeTab] || String(selected[activeTab]).trim() === '') && (options[activeTab] || []).length) {
            selected[activeTab] = optionId(options[activeTab][0]);
          }
          renderTabs();
          loadScheduleForSelected(activeTab).catch(function (err) {
            setMessage((err && err.message) || 'Не удалось загрузить расписание.');
          });
        }).catch(function (err) {
          setMessage((err && err.message) || 'Не удалось загрузить список.');
          renderTabs();
        });
      });
    });
  }

  async function ensureOptions(tab) {
    if (Array.isArray(options[tab]) && options[tab].length) return;
    var loaded = await TAB_CONFIG[tab].loadOptions();
    if (!Array.isArray(loaded)) loaded = [];
    options[tab] = loaded;
    if ((!selected[tab] || String(selected[tab]).trim() === '') && loaded.length) {
      selected[tab] = optionId(loaded[0]);
    }
  }

  async function loadScheduleForSelected(tab) {
    var selectedId = selected[tab];
    if (!selectedId) {
      lessons = [];
      renderLessons();
      return;
    }
    loading = true;
    renderLessons();
    try {
      lessons = await TAB_CONFIG[tab].loadSchedule(selectedId);
      setMessage('');
    } catch (err) {
      lessons = [];
      setMessage((err && err.message) || 'Не удалось загрузить расписание.');
    } finally {
      loading = false;
      renderLessons();
    }
  }

  function render() {
    container.innerHTML = [
      '<div class="schedule-view">',
      '  <div class="schedule-tabs" id="scheduleTabs"></div>',
      '  <div class="schedule-toolbar">',
      '    <select id="scheduleSelect" class="search-input schedule-select"></select>',
      '  </div>',
      '  <div class="students-msg" id="scheduleMsg"></div>',
      '  <div class="schedule-cards" id="scheduleCards"></div>',
      '</div>'
    ].join('');
    renderTabs();
    renderLessons();
    var select = document.getElementById('scheduleSelect');
    if (select) {
      select.addEventListener('change', function () {
        selected[activeTab] = select.value;
        loadScheduleForSelected(activeTab).catch(function (err) {
          setMessage((err && err.message) || 'Не удалось загрузить расписание.');
        });
      });
    }
  }

  (async function init() {
    container.innerHTML = '<div class="schedule-view"><div class="events-loading">Загрузка расписания...</div></div>';
    try {
      await ensureOptions(activeTab);
      render();
      loadScheduleForSelected(activeTab).catch(function (err) {
        setMessage((err && err.message) || 'Не удалось загрузить расписание.');
      });
    } catch (err) {
      container.innerHTML = '<p class="content-error">Не удалось загрузить расписание: ' + escapeHtml((err && err.message) || 'ошибка') + '</p>';
    }
  })();
};
