'use strict';

const { ipcRenderer } = require('electron');
const { apiRequest, unwrapResponse } = require('./api-client.js');
const API = require('./api-paths.js');
const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');

const ADMIN_ACCESS_LEVELS = [1, 4, 6];

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
const DAY_TO_NUM = {
  понедельник: 1,
  вторник: 2,
  среда: 3,
  четверг: 4,
  пятница: 5,
  суббота: 6,
  воскресенье: 7
};
const NUM_TO_DAY = {
  1: 'понедельник',
  2: 'вторник',
  3: 'среда',
  4: 'четверг',
  5: 'пятница',
  6: 'суббота',
  7: 'воскресенье'
};

function normalizeDayName(dayName) {
  return String(dayName || '').trim().toLowerCase();
}

function dayNameFromRow(row) {
  var raw = row && (row.day != null ? row.day : row.day_name);
  if (raw == null || raw === '') return '';
  var n = parseInt(String(raw), 10);
  if (!isNaN(n) && NUM_TO_DAY[n]) return NUM_TO_DAY[n];
  return normalizeDayName(raw);
}

function dayNumFromRow(row) {
  var name = dayNameFromRow(row);
  if (name && DAY_TO_NUM[name]) return DAY_TO_NUM[name];
  var raw = row && (row.day != null ? row.day : row.day_name);
  var n = parseInt(String(raw), 10);
  return isNaN(n) ? null : n;
}

function scheduleSort(a, b) {
  var dayA = DAY_ORDER.indexOf(dayNameFromRow(a));
  var dayB = DAY_ORDER.indexOf(dayNameFromRow(b));
  var rankA = dayA >= 0 ? dayA : 999;
  var rankB = dayB >= 0 ? dayB : 999;
  if (rankA !== rankB) return rankA - rankB;
  return String((a && a.startTime) || (a && a.start_time) || '').localeCompare(String((b && b.startTime) || (b && b.start_time) || ''));
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

function hasScheduleEditAccess(user) {
  var level = user && (user.accessLevel != null ? user.accessLevel : user.access_level_id);
  var n = Number(level);
  return !isNaN(n) && ADMIN_ACCESS_LEVELS.indexOf(n) >= 0;
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

function pick(row, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = row ? row[keys[i]] : null;
    if (v != null && String(v).trim() !== '') return v;
  }
  return '';
}

function scheduleIdFromRow(row) {
  return pick(row, ['idlesson', 'id_lesson', 'lesson_id', 'id', 'id_schedule', 'schedule_id']);
}

function scheduleFormatTimeHHMM(t) {
  if (t == null || t === '') return '';
  var s = String(t).trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return String(parseInt(m[1], 10)).padStart(2, '0') + ':' + m[2];
  return s.slice(0, 5);
}

function scheduleNormalizeTimeApi(t) {
  if (!t || !String(t).trim()) return '';
  var s = String(t).trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s + ':00';
  return s;
}

function findOptionIdByLabel(list, label) {
  var needle = String(label || '').trim().toLowerCase();
  if (!needle) return '';
  for (var i = 0; i < list.length; i++) {
    if (optionName(list[i]).trim().toLowerCase() === needle) return optionId(list[i]);
  }
  return '';
}

function buildSelectOptionsHtml(list, selectedId, placeholder) {
  var sel = selectedId == null ? '' : String(selectedId);
  var parts = ['<option value="">' + escapeHtml(placeholder || '—') + '</option>'];
  (list || []).forEach(function (o) {
    var v = optionId(o);
    var picked = v === sel ? ' selected' : '';
    parts.push('<option value="' + escapeHtmlAttr(v) + '"' + picked + '>' + escapeHtml(optionName(o)) + '</option>');
  });
  return parts.join('');
}

function buildDayOptionsHtml(selectedNum) {
  var sel = selectedNum == null ? '' : String(selectedNum);
  return DAY_ORDER.map(function (name, idx) {
    var num = String(idx + 1);
    var picked = num === sel ? ' selected' : '';
    return '<option value="' + num + '"' + picked + '>' + escapeHtml(name) + '</option>';
  }).join('');
}

function rowToEditState(row, refRooms, refGroups, refTeachers) {
  var roomId = pick(row, ['room_id', 'id_room']);
  var groupId = pick(row, ['group_id', 'id_group']);
  var employeeId = pick(row, ['employee_id', 'id_employees', 'id_employee']);
  if (!roomId) roomId = findOptionIdByLabel(refRooms, pick(row, ['room', 'room_name']));
  if (!groupId) groupId = findOptionIdByLabel(refGroups, pick(row, ['group', 'group_name']));
  if (!employeeId) employeeId = findOptionIdByLabel(refTeachers, pick(row, ['name', 'teacher', 'teacher_name', 'employee_name']));
  return {
    id: scheduleIdFromRow(row),
    room_id: roomId,
    group_id: groupId,
    employee_id: employeeId,
    day_num: dayNumFromRow(row),
    start_time: scheduleFormatTimeHHMM(pick(row, ['startTime', 'start_time'])),
    end_time: scheduleFormatTimeHHMM(pick(row, ['endTime', 'end_time']))
  };
}

module.exports = function renderScheduleView(container) {
  if (!container) return;

  var activeTab = 'teachers';
  var options = { teachers: [], rooms: [], groups: [] };
  var selected = { teachers: '', rooms: '', groups: '' };
  var refRooms = [];
  var refGroups = [];
  var refTeachers = [];
  var lessons = [];
  var loading = false;
  var message = '';
  var canEdit = false;

  function setMessage(text) {
    message = text || '';
    var el = document.getElementById('scheduleMsg');
    if (!el) return;
    el.textContent = message;
  }

  function groupByDays(list) {
    var map = {};
    list.forEach(function (item) {
      var key = dayNameFromRow(item) || 'Без дня';
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    return map;
  }

  function defaultEditState() {
    var state = {
      id: '',
      room_id: '',
      group_id: '',
      employee_id: '',
      day_num: null,
      start_time: '',
      end_time: ''
    };
    if (activeTab === 'teachers' && selected.teachers) state.employee_id = String(selected.teachers);
    if (activeTab === 'rooms' && selected.rooms) state.room_id = String(selected.rooms);
    if (activeTab === 'groups' && selected.groups) state.group_id = String(selected.groups);
    return state;
  }

  function buildScheduleLessonViewHtml(row, idx) {
    var sid = scheduleIdFromRow(row);
    var editState = rowToEditState(row, refRooms, refGroups, refTeachers);
    var actions = canEdit
      ? '<div class="schedule-lesson__actions">' +
        '<button type="button" class="event-rent-btn event-rent-btn--edit">Изменить</button>' +
        '<button type="button" class="event-rent-btn event-rent-btn--del">Удалить</button>' +
        '</div>'
      : '';
    return '<article class="schedule-lesson schedule-lesson--view"' +
      ' data-schedule-id="' + escapeHtmlAttr(String(sid || '')) + '"' +
      ' data-room-id="' + escapeHtmlAttr(String(editState.room_id || '')) + '"' +
      ' data-group-id="' + escapeHtmlAttr(String(editState.group_id || '')) + '"' +
      ' data-employee-id="' + escapeHtmlAttr(String(editState.employee_id || '')) + '"' +
      ' data-day-num="' + escapeHtmlAttr(String(editState.day_num || '')) + '"' +
      ' data-start="' + escapeHtmlAttr(editState.start_time) + '"' +
      ' data-end="' + escapeHtmlAttr(editState.end_time) + '">' +
      '<div class="schedule-lesson__index">' + (idx + 1) + '</div>' +
      '<div class="schedule-lesson__body">' +
      '<div class="schedule-lesson__title">' + escapeHtml(String(pick(row, ['room', 'room_name']) || '—')) + '</div>' +
      '<div class="schedule-lesson__time">' + escapeHtml(editState.start_time + ' - ' + editState.end_time) + '</div>' +
      '<div class="schedule-lesson__teacher">' + escapeHtml(String(pick(row, ['name', 'teacher', 'teacher_name', 'employee_name']) || '—')) + '</div>' +
      '<div class="schedule-lesson__group">' + escapeHtml(String(pick(row, ['group', 'group_name']) || '—')) + '</div>' +
      actions +
      '</div>' +
      '</article>';
  }

  function buildScheduleLessonEditHtml(state) {
    var sid = state && state.id != null ? String(state.id) : '';
    return '<article class="schedule-lesson schedule-lesson--edit" data-schedule-id="' + escapeHtmlAttr(sid) + '">' +
      '<div class="schedule-lesson__body schedule-lesson__body--edit">' +
      '<div class="event-rent-row__edit-grid schedule-edit-grid">' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">День</span>' +
      '<select class="event-edit-input schedule-edit-day">' + buildDayOptionsHtml(state.day_num) + '</select></label>' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Кабинет</span>' +
      '<select class="event-edit-input schedule-edit-room">' + buildSelectOptionsHtml(refRooms, state.room_id, '— Кабинет —') + '</select></label>' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Группа</span>' +
      '<select class="event-edit-input schedule-edit-group">' + buildSelectOptionsHtml(refGroups, state.group_id, '— Группа —') + '</select></label>' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Наставник</span>' +
      '<select class="event-edit-input schedule-edit-employee">' + buildSelectOptionsHtml(refTeachers, state.employee_id, '— Наставник —') + '</select></label>' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Начало</span>' +
      '<input type="time" class="event-edit-input schedule-edit-start" value="' + escapeHtmlAttr(state.start_time || '') + '"></label>' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Конец</span>' +
      '<input type="time" class="event-edit-input schedule-edit-end" value="' + escapeHtmlAttr(state.end_time || '') + '"></label>' +
      '</div>' +
      '<div class="event-rent-row__edit-actions">' +
      '<button type="button" class="event-rent-btn event-rent-btn--save">Сохранить</button>' +
      (sid ? '<button type="button" class="event-rent-btn event-rent-btn--cancel">Отмена</button>' : '') +
      (sid ? '<button type="button" class="event-rent-btn event-rent-btn--del">Удалить</button>' : '') +
      '</div></div></article>';
  }

  function renderLessons() {
    var wrap = document.getElementById('scheduleCards');
    if (!wrap) return;
    if (loading) {
      wrap.innerHTML = '<div class="events-loading">Загрузка расписания...</div>';
      return;
    }
    if (!lessons.length) {
      wrap.innerHTML = '<div class="students-empty">' + (canEdit ? 'Расписание не найдено. Нажмите «Добавить занятие».' : 'Расписание не найдено.') + '</div>';
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
        return buildScheduleLessonViewHtml(row, idx);
      }).join('');
      return '<section class="schedule-day">' +
        '<h3 class="schedule-day__title">' + escapeHtml(String(day || 'Без дня').toUpperCase()) + '</h3>' +
        '<div class="schedule-day__list">' + cards + '</div>' +
        '</section>';
    }).join('');
  }

  function readEditStateFromEl(rowEl) {
    var daySel = rowEl.querySelector('.schedule-edit-day');
    var roomSel = rowEl.querySelector('.schedule-edit-room');
    var groupSel = rowEl.querySelector('.schedule-edit-group');
    var empSel = rowEl.querySelector('.schedule-edit-employee');
    var startInp = rowEl.querySelector('.schedule-edit-start');
    var endInp = rowEl.querySelector('.schedule-edit-end');
    return {
      id: rowEl.getAttribute('data-schedule-id') || '',
      room_id: roomSel ? String(roomSel.value || '').trim() : '',
      group_id: groupSel ? String(groupSel.value || '').trim() : '',
      employee_id: empSel ? String(empSel.value || '').trim() : '',
      day_num: daySel ? parseInt(String(daySel.value || ''), 10) : null,
      start_time: scheduleNormalizeTimeApi(startInp ? startInp.value : ''),
      end_time: scheduleNormalizeTimeApi(endInp ? endInp.value : '')
    };
  }

  function validateEditState(state, isCreate) {
    if (!state.room_id || !state.group_id || !state.employee_id) {
      return 'Укажите кабинет, группу и наставника.';
    }
    if (!state.start_time || !state.end_time) {
      return 'Укажите время начала и конца.';
    }
    if (isCreate && (!state.day_num || isNaN(state.day_num))) {
      return 'Выберите день недели.';
    }
    return '';
  }

  async function saveScheduleRow(state) {
    var isCreate = !state.id;
    var errText = validateEditState(state, isCreate);
    if (errText) throw new Error(errText);
    var roomNum = parseInt(state.room_id, 10);
    var groupNum = parseInt(state.group_id, 10);
    var employeeNum = parseInt(state.employee_id, 10);
    if (isNaN(roomNum) || isNaN(groupNum) || isNaN(employeeNum)) {
      throw new Error('Некорректные значения кабинета, группы или наставника.');
    }
    if (isCreate) {
      await apiRequest('POST', API.SCHEDULE.ROOT, {
        room_id: roomNum,
        group_id: groupNum,
        employee_id: employeeNum,
        day: state.day_num,
        start_time: state.start_time,
        end_time: state.end_time
      });
      return;
    }
    var sid = parseInt(String(state.id), 10);
    if (isNaN(sid)) throw new Error('Некорректный id занятия.');
    await apiRequest('PUT', API.SCHEDULE.ROOT, {
      id: sid,
      room_id: roomNum,
      group_id: groupNum,
      start_time: state.start_time,
      end_time: state.end_time
    });
  }

  function wireScheduleActions() {
    var addBtn = document.getElementById('scheduleAddBtn');
    var cards = document.getElementById('scheduleCards');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        if (!cards) return;
        setMessage('');
        var empty = cards.querySelector('.students-empty');
        if (empty) empty.remove();
        cards.insertAdjacentHTML('beforeend',
          '<section class="schedule-day schedule-day--draft">' +
          '<h3 class="schedule-day__title">НОВОЕ ЗАНЯТИЕ</h3>' +
          '<div class="schedule-day__list">' + buildScheduleLessonEditHtml(defaultEditState()) + '</div>' +
          '</section>');
      });
    }
    if (!cards) return;
    cards.addEventListener('click', async function (e) {
      var btn = e.target.closest('.event-rent-btn');
      if (!btn || !cards.contains(btn)) return;
      var row = btn.closest('.schedule-lesson');
      if (!row) return;

      if (btn.classList.contains('event-rent-btn--edit')) {
        if (!row.classList.contains('schedule-lesson--view')) return;
        var viewState = {
          id: row.getAttribute('data-schedule-id') || '',
          room_id: row.getAttribute('data-room-id') || '',
          group_id: row.getAttribute('data-group-id') || '',
          employee_id: row.getAttribute('data-employee-id') || '',
          day_num: parseInt(String(row.getAttribute('data-day-num') || ''), 10),
          start_time: row.getAttribute('data-start') || '',
          end_time: row.getAttribute('data-end') || ''
        };
        row.outerHTML = buildScheduleLessonEditHtml(viewState);
        return;
      }

      if (btn.classList.contains('event-rent-btn--cancel')) {
        setMessage('');
        await loadScheduleForSelected(activeTab);
        return;
      }

      if (btn.classList.contains('event-rent-btn--del')) {
        var ridDel = row.getAttribute('data-schedule-id');
        if (!ridDel) {
          var draftSection = row.closest('.schedule-day--draft');
          if (draftSection) draftSection.remove();
          else row.remove();
          if (!cards.querySelector('.schedule-lesson') && !cards.querySelector('.schedule-day')) {
            renderLessons();
          }
          return;
        }
        if (!window.confirm('Удалить это занятие из расписания?')) return;
        setMessage('');
        try {
          await apiRequest('DELETE', API.SCHEDULE.BY_ID(ridDel));
          await loadScheduleForSelected(activeTab);
        } catch (err) {
          setMessage((err && err.message) || 'Не удалось удалить занятие.');
        }
        return;
      }

      if (btn.classList.contains('event-rent-btn--save')) {
        var state = readEditStateFromEl(row);
        setMessage('');
        try {
          await saveScheduleRow(state);
          await loadScheduleForSelected(activeTab);
        } catch (err) {
          setMessage((err && err.message) || 'Не удалось сохранить занятие.');
        }
      }
    });
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

  async function loadReferenceData() {
    var pair = await Promise.all([
      apiRequest('GET', API.REFERENCE.ROOMS),
      apiRequest('GET', API.SCHEDULE.GROUPS),
      apiRequest('GET', API.SCHEDULE.TEACHERS)
    ]);
    refRooms = unwrapResponse(pair[0]);
    refGroups = unwrapResponse(pair[1]);
    refTeachers = unwrapResponse(pair[2]);
    if (!Array.isArray(refRooms)) refRooms = [];
    if (!Array.isArray(refGroups)) refGroups = [];
    if (!Array.isArray(refTeachers)) refTeachers = [];
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
    var addBtnHtml = canEdit
      ? '<button type="button" class="event-rent-btn event-rent-btn--primary" id="scheduleAddBtn">Добавить занятие</button>'
      : '';
    container.innerHTML = [
      '<div class="schedule-view">',
      '  <div class="schedule-tabs" id="scheduleTabs"></div>',
      '  <div class="schedule-toolbar">',
      '    <select id="scheduleSelect" class="search-input schedule-select"></select>',
      addBtnHtml,
      '  </div>',
      '  <div class="students-msg" id="scheduleMsg"></div>',
      '  <div class="schedule-cards" id="scheduleCards"></div>',
      '</div>'
    ].join('');
    renderTabs();
    renderLessons();
    wireScheduleActions();
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
      var user = await ipcRenderer.invoke('get-user');
      canEdit = hasScheduleEditAccess(user);
      await Promise.all([ensureOptions(activeTab), loadReferenceData()]);
      render();
      loadScheduleForSelected(activeTab).catch(function (err) {
        setMessage((err && err.message) || 'Не удалось загрузить расписание.');
      });
    } catch (err) {
      container.innerHTML = '<p class="content-error">Не удалось загрузить расписание: ' + escapeHtml((err && err.message) || 'ошибка') + '</p>';
    }
  })();
};
