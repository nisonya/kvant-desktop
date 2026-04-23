'use strict';

const { apiRequest, unwrapResponse } = require('./api-client.js');
const API = require('./api-paths.js');
const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');

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

function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

function shiftMonth(y, m, delta) {
  var dt = new Date(y, m - 1 + delta, 1);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1 };
}

function calendarGridStart(y, m) {
  var first = new Date(y, m - 1, 1);
  var day = first.getDay();
  var mondayIndex = day === 0 ? 6 : day - 1;
  return new Date(y, m - 1, 1 - mondayIndex);
}

module.exports = function renderRentView(container) {
  if (!container) return;

  var rooms = [];
  var selectedRoomId = '';
  var selectedDate = todayIso();
  var rentRows = [];
  var lessonRows = [];
  var loading = false;
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
        var eventId = eventIdFromRent(row);
        var st = timeShort(pick(row, ['start_time', 'startTime']));
        var en = timeShort(pick(row, ['end_time', 'endTime']));
        var timeLine = st && en ? (st + ' - ' + en) : (st || en || 'Время не указано');
        parts.push(
          '<article class="rent-card rent-card--event"' + (eventId ? (' data-event-id="' + escapeHtmlAttr(String(eventId)) + '"') : '') + '>' +
            '<h3 class="rent-card__title">' + escapeHtml(eventTitleFromRent(row)) + '</h3>' +
            '<p class="rent-card__meta">Начало: ' + escapeHtml(st || '—') + '</p>' +
            '<p class="rent-card__meta">Конец: ' + escapeHtml(en || '—') + '</p>' +
            '<p class="rent-card__hint">' + escapeHtml(timeLine) + '</p>' +
          '</article>'
        );
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
      wrap.innerHTML = '<div class="students-empty">Брони нет.</div>';
      return;
    }

    wrap.innerHTML = parts.join('');

    wrap.querySelectorAll('.rent-card--event[data-event-id]').forEach(function (card) {
      card.addEventListener('click', function () {
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

  function renderCalendar() {
    var root = document.getElementById('rentCalendar');
    if (!root) return;
    var cur = parseIsoDate(selectedDate);
    if (cur && (cur.y !== calendarYear || cur.m !== calendarMonth)) {
      calendarYear = cur.y;
      calendarMonth = cur.m;
    }
    var prev = shiftMonth(calendarYear, calendarMonth, -1);
    var next = shiftMonth(calendarYear, calendarMonth, 1);
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

    root.querySelectorAll('.rent-cal__nav').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nav = btn.getAttribute('data-nav');
        var shifted = shiftMonth(calendarYear, calendarMonth, nav === 'prev' ? -1 : 1);
        calendarYear = shifted.y;
        calendarMonth = shifted.m;
        renderCalendar();
      });
    });
    root.querySelectorAll('.rent-cal__day').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var iso = btn.getAttribute('data-date') || '';
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
    });
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
      '    <div class="rent-selected-date">Дата: ' + escapeHtml(selectedDate) + '</div>',
      '    <div class="students-msg" id="rentMsg"></div>',
      '    <div class="rent-cards" id="rentCards"></div>',
      '  </section>',
      '  </div>',
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
  }

  (async function init() {
    container.innerHTML = '<div class="rent-view"><div class="events-loading">Загрузка брони...</div></div>';
    try {
      await loadRooms();
      render();
      await loadData();
    } catch (err) {
      container.innerHTML = '<p class="content-error">Не удалось загрузить бронь: ' + escapeHtml((err && err.message) || 'ошибка') + '</p>';
    }
  })();
};
