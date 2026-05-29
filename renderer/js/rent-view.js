'use strict';

const { ipcRenderer } = require('electron');
const { apiRequest, unwrapResponse } = require('./api-client.js');
const API = require('./api-paths.js');
const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');
const { wireRentRoomsModal } = require('./rent-rooms-modal.js');

const ADMIN_ACCESS_LEVELS = [1, 4, 6];
const WEEKDAY_NAMES = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const CALENDAR_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const CALENDAR_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function todayIso() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function weekdayRuLower(isoDate) {
  var dt = new Date(isoDate + 'T00:00:00');
  if (isNaN(dt.getTime())) return '';
  return WEEKDAY_NAMES[dt.getDay()] || '';
}

function normDay(v) {
  return String(v || '').trim().toLowerCase();
}

function asInt(value) {
  var n = Number(value);
  if (!isFinite(n)) return null;
  return Math.trunc(n);
}

function pick(row, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = row ? row[keys[i]] : null;
    if (v != null && String(v).trim() !== '') return v;
  }
  return '';
}

function timeShort(t) {
  var s = String(t || '').trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s;
  return String(parseInt(m[1], 10)).padStart(2, '0') + ':' + m[2];
}

function rentNormalizeTimeApi(t) {
  if (!t || !String(t).trim()) return '';
  var s = String(t).trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s + ':00';
  return s;
}

function hasRentEditAccess(user) {
  var level = user && (user.accessLevel != null ? user.accessLevel : user.access_level_id);
  var n = Number(level);
  return !isNaN(n) && ADMIN_ACCESS_LEVELS.indexOf(n) >= 0;
}

async function resolveRentEditAccess(user) {
  var level = null;
  var empId = user && (user.employee_id != null ? user.employee_id
    : (user.id_employees != null ? user.id_employees : user.id));
  if (empId != null) {
    try {
      var res = await apiRequest('GET', API.REFERENCE.ACCESS_BY_ID(empId));
      var d = unwrapResponse(res);
      level = d && d.access_level_id;
    } catch (_) {
      // fallback to stored user fields
    }
  }
  if (level == null && user) {
    level = user.accessLevel != null ? user.accessLevel : user.access_level_id;
  }
  return hasRentEditAccess({ accessLevel: level });
}

function parseIsoDate(iso) {
  var s = String(iso || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var y = parseInt(m[1], 10);
  var mo = parseInt(m[2], 10);
  var d = parseInt(m[3], 10);
  if (!y || !mo || !d) return null;
  return { y: y, m: mo, d: d };
}

function toIso(y, month1, day) {
  return String(y) + '-' + String(month1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function shiftMonth(y, m, delta) {
  var dt = new Date(y, m - 1 + delta, 1);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1 };
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

function calendarGridStart(y, m) {
  var first = new Date(y, m - 1, 1);
  var day = first.getDay();
  var mondayIndex = day === 0 ? 6 : day - 1;
  return new Date(y, m - 1, 1 - mondayIndex);
}

function rentIdFromRow(row) {
  return pick(row, ['id_rent', 'id']);
}

module.exports = function renderRentView(container) {
  if (!container) return;

  var rooms = [];
  var selectedRoomId = '';
  var selectedDate = todayIso();
  var rentRows = [];
  var lessonRows = [];
  var loading = false;
  var canEdit = false;
  var calendarYear = parseIsoDate(selectedDate).y;
  var calendarMonth = parseIsoDate(selectedDate).m;

  function setMsg(text, kind) {
    var el = document.getElementById('rentMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'students-msg' + (kind ? ' students-msg--' + kind : '');
  }

  function eventIdFromRent(row) {
    return asInt(pick(row, ['id_event', 'event_id', 'id_events']));
  }

  function eventTitleFromRent(row) {
    var t = pick(row, ['event_name', 'name_event', 'name']);
    return String(t || '').trim() || 'Мероприятие';
  }

  function buildRentRowViewHtml(row) {
    var rid = rentIdFromRow(row);
    var eventId = eventIdFromRent(row);
    var st = timeShort(pick(row, ['start_time', 'startTime']));
    var en = timeShort(pick(row, ['end_time', 'endTime']));
    var timeLine = st && en ? (st + ' - ' + en) : (st || en || 'Время не указано');
    var actions = canEdit
      ? '<div class="rent-card__actions">' +
        '<button type="button" class="event-rent-btn event-rent-btn--edit">Изменить</button>' +
        '<button type="button" class="event-rent-btn event-rent-btn--del">Удалить</button>' +
        '</div>'
      : '';
    return '<article class="rent-card rent-card--event rent-card--view"' +
      (eventId ? (' data-event-id="' + escapeHtmlAttr(String(eventId)) + '"') : '') +
      ' data-rent-id="' + escapeHtmlAttr(String(rid || '')) + '"' +
      ' data-room-id="' + escapeHtmlAttr(String(pick(row, ['id_room', 'room_id']) || selectedRoomId || '')) + '"' +
      ' data-date="' + escapeHtmlAttr(String(pick(row, ['date']) || selectedDate || '')) + '"' +
      ' data-start="' + escapeHtmlAttr(st) + '"' +
      ' data-end="' + escapeHtmlAttr(en) + '">' +
      '<h3 class="rent-card__title">' + escapeHtml(eventTitleFromRent(row)) + '</h3>' +
      '<p class="rent-card__meta">Мероприятие: ' + escapeHtml(eventId ? String(eventId) : '—') + '</p>' +
      '<p class="rent-card__meta">Начало: ' + escapeHtml(st || '—') + '</p>' +
      '<p class="rent-card__meta">Конец: ' + escapeHtml(en || '—') + '</p>' +
      '<p class="rent-card__hint">' + escapeHtml(timeLine) + '</p>' +
      actions +
      '</article>';
  }

  function buildRentRowEditHtml(state) {
    var rid = state && state.id != null ? String(state.id) : '';
    var roomOptions = rooms.map(function (r) {
      var picked = String(r.value) === String(state.room_id || '') ? ' selected' : '';
      return '<option value="' + escapeHtmlAttr(String(r.value)) + '"' + picked + '>' + escapeHtml(String(r.label)) + '</option>';
    }).join('');
    return '<article class="rent-card rent-card--event rent-card--edit" data-rent-id="' + escapeHtmlAttr(rid) + '">' +
      '<div class="event-rent-row__edit-grid rent-edit-grid">' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">ID мероприятия</span>' +
      '<input type="number" min="1" class="event-edit-input rent-edit-event" value="' + escapeHtmlAttr(state.event_id || '') + '"></label>' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Кабинет</span>' +
      '<select class="event-edit-input rent-edit-room"><option value="">— Кабинет —</option>' + roomOptions + '</select></label>' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Дата</span>' +
      '<input type="date" class="event-edit-input rent-edit-date" value="' + escapeHtmlAttr(state.date || '') + '"></label>' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Начало</span>' +
      '<input type="time" class="event-edit-input rent-edit-start" value="' + escapeHtmlAttr(state.start_time || '') + '"></label>' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Конец</span>' +
      '<input type="time" class="event-edit-input rent-edit-end" value="' + escapeHtmlAttr(state.end_time || '') + '"></label>' +
      '</div>' +
      '<div class="event-rent-row__edit-actions">' +
      '<button type="button" class="event-rent-btn event-rent-btn--save">Сохранить</button>' +
      (rid ? '<button type="button" class="event-rent-btn event-rent-btn--cancel">Отмена</button>' : '') +
      (rid ? '<button type="button" class="event-rent-btn event-rent-btn--del">Удалить</button>' : '') +
      '</div></article>';
  }

  function defaultRentEditState() {
    return {
      id: '',
      event_id: '',
      room_id: selectedRoomId || '',
      date: selectedDate || '',
      start_time: '',
      end_time: ''
    };
  }

  function readRentEditStateFromEl(rowEl) {
    var eventInp = rowEl.querySelector('.rent-edit-event');
    var roomSel = rowEl.querySelector('.rent-edit-room');
    var dateInp = rowEl.querySelector('.rent-edit-date');
    var startInp = rowEl.querySelector('.rent-edit-start');
    var endInp = rowEl.querySelector('.rent-edit-end');
    return {
      id: rowEl.getAttribute('data-rent-id') || '',
      event_id: eventInp ? String(eventInp.value || '').trim() : '',
      room_id: roomSel ? String(roomSel.value || '').trim() : '',
      date: dateInp ? String(dateInp.value || '').trim() : '',
      start_time: rentNormalizeTimeApi(startInp ? startInp.value : ''),
      end_time: rentNormalizeTimeApi(endInp ? endInp.value : '')
    };
  }

  async function saveRentRow(state) {
    var eventNum = parseInt(String(state.event_id || ''), 10);
    var roomNum = parseInt(String(state.room_id || ''), 10);
    if (isNaN(eventNum)) throw new Error('Укажите ID мероприятия.');
    if (isNaN(roomNum)) throw new Error('Выберите кабинет.');
    if (!state.date) throw new Error('Укажите дату брони.');
    if (!state.start_time || !state.end_time) throw new Error('Укажите время начала и конца.');
    if (!state.id) {
      await apiRequest('POST', API.RENT.ROOT, {
        event_id: eventNum,
        room_id: roomNum,
        date: state.date,
        start_time: state.start_time,
        end_time: state.end_time
      });
      return;
    }
    var rid = parseInt(String(state.id), 10);
    if (isNaN(rid)) throw new Error('Некорректный id брони.');
    await apiRequest('PUT', API.RENT.ROOT, {
      id: rid,
      event_id: eventNum,
      room_id: roomNum,
      date: state.date,
      start_time: state.start_time,
      end_time: state.end_time
    });
  }

  function renderCards() {
    var wrap = document.getElementById('rentCards');
    var dateLabel = document.querySelector('.rent-selected-date');
    if (dateLabel) dateLabel.textContent = 'Дата: ' + String(selectedDate || '—');
    if (!wrap) return;
    if (loading) {
      wrap.innerHTML = '<div class="events-loading">Загрузка...</div>';
      return;
    }
    if (!selectedRoomId || !selectedDate) {
      wrap.innerHTML = '<div class="students-empty">Выберите кабинет и дату.</div>';
      return;
    }

    var parts = [];

    if (rentRows.length) {
      parts.push('<div class="rent-cards-section-title">Бронирования на дату</div>');
      rentRows.forEach(function (row) {
        parts.push(buildRentRowViewHtml(row));
      });
    }

    if (lessonRows.length) {
      parts.push('<div class="rent-cards-section-title">Уроки по расписанию в этот день</div>');
      lessonRows.forEach(function (row) {
        var roomTitle = String(pick(row, ['room', 'room_name']) || 'Кабинет').trim();
        var teacher = String(pick(row, ['name', 'teacher', 'teacher_name']) || '—').trim();
        var group = String(pick(row, ['group', 'group_name']) || '—').trim();
        var st = timeShort(pick(row, ['startTime', 'start_time']));
        var en = timeShort(pick(row, ['endTime', 'end_time']));
        parts.push(
          '<article class="rent-card rent-card--lesson">' +
            '<h3 class="rent-card__title">' + escapeHtml(roomTitle) + '</h3>' +
            '<p class="rent-card__meta">Время: ' + escapeHtml((st || '—') + ' - ' + (en || '—')) + '</p>' +
            '<p class="rent-card__meta">Педагог: ' + escapeHtml(teacher) + '</p>' +
            '<p class="rent-card__meta">Группа: ' + escapeHtml(group) + '</p>' +
          '</article>'
        );
      });
    }

    if (!parts.length) {
      wrap.innerHTML = '<div class="students-empty">' + (canEdit ? 'Брони нет. Нажмите «Добавить бронь».' : 'Брони нет.') + '</div>';
      return;
    }

    wrap.innerHTML = parts.join('');
    wireRentCardClicks();
  }

  function wireRentCardClicks() {
    var wrap = document.getElementById('rentCards');
    if (!wrap) return;
    wrap.querySelectorAll('.rent-card--view[data-event-id]').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.event-rent-btn')) return;
        var id = card.getAttribute('data-event-id');
        if (!id) return;
        if (typeof window.__openEventById === 'function') {
          window.__openEventById(id, 'org');
          return;
        }
        setMsg('Не удалось открыть мероприятие из вкладки брони.', 'err');
      });
    });
  }

  function wireRentActions() {
    var addBtn = document.getElementById('rentAddBtn');
    var wrap = document.getElementById('rentCards');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        if (!selectedRoomId || !selectedDate) {
          setMsg('Сначала выберите кабинет и дату.', 'err');
          return;
        }
        if (!wrap) return;
        setMsg('');
        var empty = wrap.querySelector('.students-empty');
        if (empty) empty.remove();
        var sectionTitle = wrap.querySelector('.rent-cards-section-title');
        if (!sectionTitle) {
          wrap.insertAdjacentHTML('afterbegin', '<div class="rent-cards-section-title">Бронирования на дату</div>');
        }
        wrap.insertAdjacentHTML('beforeend', buildRentRowEditHtml(defaultRentEditState()));
      });
    }
    if (!wrap) return;
    wrap.addEventListener('click', async function (e) {
      var btn = e.target.closest('.event-rent-btn');
      if (!btn || !wrap.contains(btn)) return;
      var row = btn.closest('.rent-card--event');
      if (!row) return;
      e.stopPropagation();

      if (btn.classList.contains('event-rent-btn--edit')) {
        if (!row.classList.contains('rent-card--view')) return;
        var viewState = {
          id: row.getAttribute('data-rent-id') || '',
          event_id: row.getAttribute('data-event-id') || '',
          room_id: row.getAttribute('data-room-id') || selectedRoomId,
          date: row.getAttribute('data-date') || selectedDate,
          start_time: row.getAttribute('data-start') || '',
          end_time: row.getAttribute('data-end') || ''
        };
        row.outerHTML = buildRentRowEditHtml(viewState);
        return;
      }

      if (btn.classList.contains('event-rent-btn--cancel')) {
        setMsg('');
        await loadData();
        return;
      }

      if (btn.classList.contains('event-rent-btn--del')) {
        var ridDel = row.getAttribute('data-rent-id');
        if (!ridDel) {
          row.remove();
          if (!wrap.querySelector('.rent-card')) renderCards();
          return;
        }
        if (!window.confirm('Удалить эту бронь?')) return;
        setMsg('');
        try {
          await apiRequest('DELETE', API.RENT.BY_ID(ridDel));
          await loadData();
        } catch (err) {
          setMsg((err && err.message) || 'Не удалось удалить бронь.', 'err');
        }
        return;
      }

      if (btn.classList.contains('event-rent-btn--save')) {
        var state = readRentEditStateFromEl(row);
        setMsg('');
        try {
          await saveRentRow(state);
          await loadData();
        } catch (err) {
          setMsg((err && err.message) || 'Не удалось сохранить бронь.', 'err');
        }
      }
    });
  }

  function renderCalendar() {
    var root = document.getElementById('rentCalendar');
    if (!root) return;
    var gridStart = calendarGridStart(calendarYear, calendarMonth);
    var cellHtml = '';
    var nowIso = todayIso();
    for (var i = 0; i < 42; i++) {
      var dt = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      var y = dt.getFullYear();
      var m = dt.getMonth() + 1;
      var d = dt.getDate();
      var iso = toIso(y, m, d);
      var classes = ['rent-cal__day'];
      if (m !== calendarMonth) classes.push('rent-cal__day--muted');
      if (iso === nowIso) classes.push('rent-cal__day--today');
      if (iso === selectedDate) classes.push('rent-cal__day--selected');
      cellHtml += '<button type="button" class="' + classes.join(' ') + '" data-date="' + escapeHtmlAttr(iso) + '">' + escapeHtml(String(d)) + '</button>';
    }
    root.innerHTML = [
      '<div class="rent-cal__header">',
      '<button type="button" class="rent-cal__nav" data-nav="prev" aria-label="Предыдущий месяц">‹</button>',
      '<div class="rent-cal__title">' + escapeHtml(CALENDAR_MONTHS[calendarMonth - 1] + ' ' + String(calendarYear)) + '</div>',
      '<button type="button" class="rent-cal__nav" data-nav="next" aria-label="Следующий месяц">›</button>',
      '</div>',
      '<div class="rent-cal__week">' + CALENDAR_WEEKDAYS.map(function (w) { return '<div class="rent-cal__weekday">' + escapeHtml(w) + '</div>'; }).join('') + '</div>',
      '<div class="rent-cal__grid">' + cellHtml + '</div>'
    ].join('');

    if (!root.dataset.rentCalendarWired) {
      root.dataset.rentCalendarWired = '1';
      root.addEventListener('click', function (e) {
        var navBtn = e.target.closest('.rent-cal__nav');
        if (navBtn && root.contains(navBtn)) {
          e.preventDefault();
          e.stopPropagation();
          var nav = navBtn.getAttribute('data-nav');
          var shifted = shiftMonth(calendarYear, calendarMonth, nav === 'prev' ? -1 : 1);
          var parsedSelected = parseIsoDate(selectedDate);
          var selectedDay = parsedSelected ? parsedSelected.d : 1;
          calendarYear = shifted.y;
          calendarMonth = shifted.m;
          selectedDate = toIso(calendarYear, calendarMonth, Math.min(selectedDay, daysInMonth(calendarYear, calendarMonth)));
          renderCalendar();
          loadData().catch(function (err) {
            setMsg((err && err.message) || 'Не удалось загрузить данные.', 'err');
          });
          return;
        }

        var dayBtn = e.target.closest('.rent-cal__day');
        if (!dayBtn || !root.contains(dayBtn)) return;
        e.preventDefault();
        var iso = dayBtn.getAttribute('data-date') || '';
        if (!iso) return;
        selectedDate = iso;
        var p = parseIsoDate(selectedDate);
        if (p) {
          calendarYear = p.y;
          calendarMonth = p.m;
        }
        renderCalendar();
        loadData().catch(function (err) {
          setMsg((err && err.message) || 'Не удалось загрузить данные.', 'err');
        });
      });
    }
  }

  async function loadData() {
    if (!selectedRoomId || !selectedDate) {
      rentRows = [];
      lessonRows = [];
      renderCards();
      return;
    }
    loading = true;
    renderCards();
    setMsg('');
    var roomNum = asInt(selectedRoomId);
    if (!roomNum) {
      loading = false;
      rentRows = [];
      lessonRows = [];
      renderCards();
      return;
    }
    try {
      var pair = await Promise.all([
        apiRequest('POST', API.RENT.BY_DATE_ROOM, { date: selectedDate, room_id: roomNum }),
        apiRequest('GET', API.SCHEDULE.BY_ROOM(roomNum))
      ]);
      var rentList = unwrapResponse(pair[0]);
      var scheduleList = unwrapResponse(pair[1]);
      rentRows = Array.isArray(rentList) ? rentList : [];
      scheduleList = Array.isArray(scheduleList) ? scheduleList : [];
      var day = weekdayRuLower(selectedDate);
      lessonRows = scheduleList.filter(function (row) {
        return normDay(pick(row, ['day', 'weekday', 'day_of_week'])) === day;
      });
    } catch (err) {
      rentRows = [];
      lessonRows = [];
      setMsg((err && err.message) || 'Не удалось загрузить данные брони.', 'err');
    } finally {
      loading = false;
      renderCards();
    }
  }

  function render() {
    var actionBtnsHtml = '';
    if (canEdit) {
      actionBtnsHtml = [
        '<button type="button" class="event-rent-btn" id="rentRoomsBtn">Изменить кабинеты</button>',
        '<button type="button" class="event-rent-btn event-rent-btn--primary" id="rentAddBtn">Добавить бронь</button>'
      ].join('');
    }
    container.innerHTML = [
      '<div class="rent-view">',
      '  <div class="rent-layout">',
      '  <aside class="rent-sidebar">',
      '    <section class="rent-calendar-card">',
      '      <div id="rentCalendar"></div>',
      '    </section>',
      '    <section class="rent-toolbar">',
      '      <select id="rentRoomSelect" class="search-input rent-room-select">',
      '        <option value="">Выберите кабинет</option>',
      rooms.map(function (r) {
        var selected = String(selectedRoomId) === String(r.value) ? ' selected' : '';
        return '<option value="' + escapeHtmlAttr(String(r.value)) + '"' + selected + '>' + escapeHtml(String(r.label)) + '</option>';
      }).join(''),
      '      </select>',
      '    </section>',
      '  </aside>',
      '  <section class="rent-main">',
      '    <div class="rent-main-head">',
      '      <div class="rent-selected-date">Дата: ' + escapeHtml(selectedDate) + '</div>',
      '      <div class="rent-main-actions">' + actionBtnsHtml + '</div>',
      '    </div>',
      '    <div class="students-msg" id="rentMsg"></div>',
      '    <div class="rent-cards" id="rentCards"></div>',
      '  </section>',
      '  </div>',
      buildRoomsModalHtml(),
      '</div>'
    ].join('');

    var roomSelect = document.getElementById('rentRoomSelect');
    if (roomSelect) {
      roomSelect.addEventListener('change', function () {
        selectedRoomId = roomSelect.value;
        loadData().catch(function (err) {
          setMsg((err && err.message) || 'Не удалось загрузить данные.', 'err');
        });
      });
    }

    renderCalendar();
    renderCards();
    wireRentActions();
    if (canEdit) {
      wireRentRoomsModal({
        apiRequest: apiRequest,
        escapeHtml: escapeHtml,
        escapeHtmlAttr: escapeHtmlAttr,
        onAfterRoomsMutation: refreshAfterRoomsMutation
      });
    }
  }

  async function loadRooms() {
    var res = await apiRequest('GET', API.REFERENCE.ROOMS);
    var list = unwrapResponse(res);
    list = Array.isArray(list) ? list : [];
    rooms = list.map(function (item) {
      var rawId = item.id;
      if (rawId == null) rawId = item.id_room;
      if (rawId == null) rawId = item.value;
      return {
        value: asInt(rawId),
        label: String(item.name != null ? item.name : item.label || '—')
      };
    }).filter(function (x) { return x.value != null; });
    rooms.sort(function (a, b) { return a.label.localeCompare(b.label, 'ru'); });
    if (!selectedRoomId && rooms.length) selectedRoomId = String(rooms[0].value);
    else if (selectedRoomId && !rooms.some(function (r) { return String(r.value) === String(selectedRoomId); })) {
      selectedRoomId = rooms.length ? String(rooms[0].value) : '';
    }
  }

  function buildRoomsModalHtml() {
    if (!canEdit) return '';
    return [
      '<div class="modal-overlay pos-modal" id="rentRoomsModal" hidden aria-hidden="true">',
      '  <div class="modal-dialog pos-dialog" role="dialog" aria-modal="true" aria-labelledby="rentRoomsModalTitle" onclick="event.stopPropagation()">',
      '    <div class="modal-header">',
      '      <h2 class="modal-title" id="rentRoomsModalTitle">Управление кабинетами</h2>',
      '      <button type="button" class="modal-close" id="rentRoomsClose" aria-label="Закрыть">&times;</button>',
      '    </div>',
      '    <div class="modal-body pos-body">',
      '      <div class="pos-create-row">',
      '        <input type="text" class="pos-create-input" id="rentRoomsNewName" placeholder="Новый кабинет..." maxlength="150">',
      '        <button type="button" class="pos-create-btn" id="rentRoomsCreateBtn">Добавить</button>',
      '      </div>',
      '      <div class="pos-list" id="rentRoomsList"><div class="events-loading">Загрузка...</div></div>',
      '      <div class="pos-msg" id="rentRoomsMsg"></div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function updateRoomSelect() {
    var roomSelect = document.getElementById('rentRoomSelect');
    if (!roomSelect) return;
    roomSelect.innerHTML = ['<option value="">Выберите кабинет</option>'].concat(rooms.map(function (r) {
      var selected = String(selectedRoomId) === String(r.value) ? ' selected' : '';
      return '<option value="' + escapeHtmlAttr(String(r.value)) + '"' + selected + '>' + escapeHtml(String(r.label)) + '</option>';
    })).join('');
  }

  async function refreshAfterRoomsMutation() {
    await loadRooms();
    updateRoomSelect();
    await loadData();
  }

  (async function init() {
    container.innerHTML = '<div class="rent-view"><div class="events-loading">Загрузка брони...</div></div>';
    try {
      var user = await ipcRenderer.invoke('get-user');
      canEdit = await resolveRentEditAccess(user);
      await loadRooms();
      render();
      await loadData();
    } catch (err) {
      container.innerHTML = '<p class="content-error">Не удалось загрузить бронь: ' + escapeHtml((err && err.message) || 'ошибка') + '</p>';
    }
  })();
};
