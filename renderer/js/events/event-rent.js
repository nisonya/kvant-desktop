'use strict';

const API = require('../api-paths.js');
const { unwrapResponse } = require('../api-client.js');

/**
 * @param {object} deps
 * @param {'org'|'part'} deps.type
 * @param {function} deps.escapeHtml
 * @param {function} deps.escapeHtmlAttr
 * @param {function} deps.apiRequest
 * @param {function(string): string} deps.parseDateValueToInputIso
 */
module.exports = function createEventRent(deps) {
  var type = deps.type;
  var escapeHtml = deps.escapeHtml;
  var escapeHtmlAttr = deps.escapeHtmlAttr;
  var apiRequest = deps.apiRequest;
  var parseDateValueToInputIso = deps.parseDateValueToInputIso;

  function rentFormatTimeHHMM(t) {
    if (t == null || t === '') return '';
    var s = String(t).trim();
    var m = s.match(/^(\d{1,2}):(\d{2})/);
    if (m) return String(parseInt(m[1], 10)).padStart(2, '0') + ':' + m[2];
    return s.slice(0, 5);
  }

  function rentNormalizeTimeApi(t) {
    if (!t || !String(t).trim()) return '';
    var s = String(t).trim();
    if (/^\d{2}:\d{2}$/.test(s)) return s + ':00';
    return s;
  }

  function buildRentRoomOptionsHtml(roomsOpts, selectedId) {
    var sel = selectedId == null ? '' : String(selectedId);
    var parts = ['<option value="">— Кабинет —</option>'];
    (roomsOpts || []).forEach(function (o) {
      var v = String(o.value);
      var picked = v === sel ? ' selected' : '';
      parts.push('<option value="' + escapeHtmlAttr(v) + '"' + picked + '>' + escapeHtml(o.label) + '</option>');
    });
    return parts.join('');
  }

  function roomLabelById(roomsOpts, roomId) {
    var rid = String(roomId == null ? '' : roomId);
    var found = (roomsOpts || []).find(function (o) { return String(o.value) === rid; });
    return found ? String(found.label || '—') : '—';
  }

  function cloneRentDraft(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function (r) {
      return {
        id: r && r.id != null ? r.id : null,
        id_rent: r && r.id_rent != null ? r.id_rent : null,
        __draft_id: r && r.__draft_id != null ? String(r.__draft_id) : '',
        id_room: r && r.id_room != null ? String(r.id_room) : '',
        name: r && r.name != null ? String(r.name) : '',
        start_time: r && r.start_time != null ? rentFormatTimeHHMM(r.start_time) : '',
        end_time: r && r.end_time != null ? rentFormatTimeHHMM(r.end_time) : '',
        date: r && r.date != null ? String(r.date) : ''
      };
    });
  }

  function rentDraftsEqual(a, b) {
    var left = cloneRentDraft(a);
    var right = cloneRentDraft(b);
    if (left.length !== right.length) return false;
    for (var i = 0; i < left.length; i++) {
      var l = left[i];
      var r = right[i];
      if (String(l.id_room || '') !== String(r.id_room || '')) return false;
      if (String(l.start_time || '') !== String(r.start_time || '')) return false;
      if (String(l.end_time || '') !== String(r.end_time || '')) return false;
      if (String(l.date || '') !== String(r.date || '')) return false;
    }
    return true;
  }

  async function syncRentDraftToServer(eventId, draftRows, getDefaultDateForRent) {
    var list = cloneRentDraft(draftRows);
    if (!list.length) return;
    var evNum = parseInt(String(eventId), 10);
    if (isNaN(evNum)) throw new Error('Некорректный id мероприятия для сохранения брони.');
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      var roomNum = parseInt(String(row.id_room || ''), 10);
      if (isNaN(roomNum)) throw new Error('В бронировании не выбран кабинет.');
      var st = rentNormalizeTimeApi(row.start_time);
      var en = rentNormalizeTimeApi(row.end_time);
      if (!st || !en) throw new Error('В бронировании не заполнено время начала и конца.');
      var dateStr = String((typeof getDefaultDateForRent === 'function' ? getDefaultDateForRent() : '') || row.date || '').trim();
      if (!dateStr) throw new Error('Укажите дату проведения мероприятия для сохранения брони.');
      await apiRequest('POST', API.RENT.ROOT, {
        event_id: evNum,
        room_id: roomNum,
        date: dateStr,
        start_time: st,
        end_time: en
      });
    }
  }

  function buildEventRentRowViewHtml(row) {
    var rid = row.id_rent != null ? row.id_rent : row.id;
    if ((rid == null || rid === '') && row.__draft_id) rid = row.__draft_id;
    var roomId = row.id_room != null ? String(row.id_room) : '';
    var roomLabel = row.name != null ? String(row.name) : '—';
    var t0 = rentFormatTimeHHMM(row.start_time);
    var t1 = rentFormatTimeHHMM(row.end_time);
    var dateStr = row.date != null ? String(row.date) : '';
    var timeLine = t0 && t1 ? t0 + '–' + t1 : (t0 || t1 || '—');
    var ridStr = rid == null ? '' : String(rid);
    return '<div class="event-rent-row event-rent-row--view" data-rent-id="' + escapeHtmlAttr(ridStr) + '"' +
      (roomId !== '' ? ' data-room-id="' + escapeHtmlAttr(roomId) + '"' : '') +
      ' data-start="' + escapeHtmlAttr(t0) + '"' +
      ' data-end="' + escapeHtmlAttr(t1) + '"' +
      ' data-date="' + escapeHtmlAttr(dateStr) + '">' +
      '<div class="event-rent-row__body">' +
      '<div class="event-rent-row__room">' + escapeHtml(roomLabel) + '</div>' +
      '<div class="event-rent-row__time">' + escapeHtml(timeLine) + '</div>' +
      '</div>' +
      '<div class="event-rent-row__actions">' +
      '<button type="button" class="event-rent-btn event-rent-btn--edit">Изменить</button>' +
      '<button type="button" class="event-rent-btn event-rent-btn--del">Удалить</button>' +
      '</div></div>';
  }

  function buildEventRentRowEditHtml(row, roomsOpts) {
    var rid = row.id_rent != null ? row.id_rent : row.id;
    var ridStr = rid != null && rid !== '' ? String(rid) : '';
    var roomId = row.id_room != null ? String(row.id_room) : '';
    var t0 = rentFormatTimeHHMM(row.start_time);
    var t1 = rentFormatTimeHHMM(row.end_time);
    return '<div class="event-rent-row event-rent-row--edit" data-rent-id="' + escapeHtmlAttr(ridStr) + '">' +
      '<div class="event-rent-row__edit-grid">' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Кабинет</span>' +
      '<select class="event-edit-input event-rent-edit-room">' + buildRentRoomOptionsHtml(roomsOpts, roomId) + '</select></label>' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Начало</span>' +
      '<input type="time" class="event-edit-input event-rent-edit-start" value="' + escapeHtmlAttr(t0) + '"></label>' +
      '<label class="event-rent-lbl"><span class="event-rent-lbl__t">Конец</span>' +
      '<input type="time" class="event-edit-input event-rent-edit-end" value="' + escapeHtmlAttr(t1) + '"></label>' +
      '</div>' +
      '<div class="event-rent-row__edit-actions">' +
      '<button type="button" class="event-rent-btn event-rent-btn--save">Сохранить</button>' +
      (ridStr ? '<button type="button" class="event-rent-btn event-rent-btn--cancel">Отмена</button>' : '') +
      '<button type="button" class="event-rent-btn event-rent-btn--del">Удалить</button>' +
      '</div></div>';
  }

  function buildEventRentListHtml(rows, roomsOpts) {
    if (!rows || !rows.length) {
      return '<p class="event-rent-empty">Нет бронирований. Нажмите «Добавить бронь».</p>';
    }
    return rows.map(function (r) { return buildEventRentRowViewHtml(r); }).join('');
  }

  function wireEventRentSection(eventId, createMode, roomsRentOpts, defaultDateForRent, stagedRentListRef) {
    if (type !== 'org') return;
    var listEl = document.getElementById('eventRentList');
    var addBtn = document.getElementById('eventRentAddBtn');
    var msgEl = document.getElementById('eventRentMsg');
    var draftSeq = 0;
    var isDraftMode = !!createMode && stagedRentListRef && Array.isArray(stagedRentListRef.list);

    function showMsg(text, isErr) {
      if (!msgEl) return;
      if (!text) {
        msgEl.textContent = '';
        msgEl.style.display = 'none';
        msgEl.className = 'event-rent-msg';
        return;
      }
      msgEl.textContent = text;
      msgEl.style.display = 'block';
      msgEl.className = 'event-rent-msg' + (isErr ? ' event-rent-msg--err' : '');
    }

    function getDefaultDateForRentNow() {
      var form = document.getElementById('eventEditForm');
      if (!form) return defaultDateForRent;
      var el = form.elements.namedItem('dates_of_event');
      if (!el) return defaultDateForRent;
      if (el.type === 'date') {
        var v = String(el.value || '').trim();
        return v || defaultDateForRent;
      }
      return parseDateValueToInputIso(el.value) || defaultDateForRent;
    }

    function ensureDraftId(row) {
      if (!row) return '';
      if (row.__draft_id) return String(row.__draft_id);
      draftSeq += 1;
      row.__draft_id = 'draft_' + String(draftSeq);
      return row.__draft_id;
    }

    function renderDraftList() {
      if (!listEl || !isDraftMode) return;
      (stagedRentListRef.list || []).forEach(function (r) { ensureDraftId(r); });
      listEl.innerHTML = buildEventRentListHtml(stagedRentListRef.list || [], roomsRentOpts);
      showMsg('');
    }

    async function reloadRentList() {
      if (!listEl) return;
      if (isDraftMode) {
        renderDraftList();
        return;
      }
      try {
        var rentRes = await apiRequest('GET', require('../api-paths.js').RENT.BY_EVENT(eventId));
        var rows = unwrapResponse(rentRes);
        if (!Array.isArray(rows)) rows = [];
        listEl.innerHTML = buildEventRentListHtml(rows, roomsRentOpts);
        showMsg('');
      } catch (e) {
        console.warn('[events-view] reload rent', e);
        showMsg(e.message || 'Ошибка загрузки броней', true);
      }
    }

    function rowFromViewEl(viewEl) {
      var rid = viewEl.getAttribute('data-rent-id');
      var roomId = viewEl.getAttribute('data-room-id') || '';
      var st = viewEl.getAttribute('data-start') || '';
      var en = viewEl.getAttribute('data-end') || '';
      var dt = viewEl.getAttribute('data-date') || '';
      return {
        id: rid,
        id_rent: rid,
        __draft_id: rid,
        id_room: roomId,
        start_time: st,
        end_time: en,
        date: dt
      };
    }

    if (addBtn) {
      addBtn.addEventListener('click', function () {
        if (!listEl) return;
        showMsg('');
        var empty = listEl.querySelector('.event-rent-empty');
        if (empty) empty.remove();
        var html = buildEventRentRowEditHtml({}, roomsRentOpts);
        listEl.insertAdjacentHTML('beforeend', html);
      });
    }

    if (!listEl) return;

    listEl.addEventListener('click', async function (e) {
      var btn = e.target.closest('.event-rent-btn');
      if (!btn || !listEl.contains(btn)) return;
      var row = btn.closest('.event-rent-row');
      if (!row) return;

      if (btn.classList.contains('event-rent-btn--edit')) {
        if (row.classList.contains('event-rent-row--view')) {
          var data = rowFromViewEl(row);
          row.outerHTML = buildEventRentRowEditHtml(data, roomsRentOpts);
        }
        return;
      }

      if (btn.classList.contains('event-rent-btn--cancel')) {
        showMsg('');
        await reloadRentList();
        return;
      }

      if (btn.classList.contains('event-rent-btn--del')) {
        var ridDel = row.getAttribute('data-rent-id');
        if (isDraftMode) {
          if (ridDel) {
            stagedRentListRef.list = (stagedRentListRef.list || []).filter(function (r) {
              return String(r.__draft_id || '') !== String(ridDel);
            });
          } else {
            row.remove();
          }
          renderDraftList();
          showMsg('Бронь удалена из черновика.', false);
          return;
        }
        if (!ridDel || ridDel === '') {
          row.remove();
          if (listEl && !listEl.querySelector('.event-rent-row')) {
            listEl.innerHTML = buildEventRentListHtml([], roomsRentOpts);
          }
          return;
        }
        showMsg('');
        try {
          await apiRequest('DELETE', API.RENT.BY_ID(ridDel));
          await reloadRentList();
        } catch (err) {
          showMsg(err.message || 'Не удалось удалить', true);
        }
        return;
      }

      if (btn.classList.contains('event-rent-btn--save')) {
        var roomSel = row.querySelector('.event-rent-edit-room');
        var startInp = row.querySelector('.event-rent-edit-start');
        var endInp = row.querySelector('.event-rent-edit-end');
        var roomId = roomSel ? String(roomSel.value || '').trim() : '';
        var dateStr = String(getDefaultDateForRentNow() || '').trim();
        var st = rentNormalizeTimeApi(startInp ? startInp.value : '');
        var en = rentNormalizeTimeApi(endInp ? endInp.value : '');
        if (!roomId || !st || !en) {
          showMsg('Укажите кабинет и время начала и конца.', true);
          return;
        }
        if (!dateStr) {
          showMsg('Сначала укажите дату проведения мероприятия в блоке «Данные мероприятия».', true);
          return;
        }
        var roomNum = parseInt(roomId, 10);
        if (isNaN(roomNum)) {
          showMsg('Выберите кабинет из списка.', true);
          return;
        }
        showMsg('');
        try {
          var ridSave = row.getAttribute('data-rent-id');
          if (isDraftMode) {
            var draftItem = {
              __draft_id: ridSave || '',
              id_room: String(roomNum),
              name: roomLabelById(roomsRentOpts, roomNum),
              start_time: rentFormatTimeHHMM(st),
              end_time: rentFormatTimeHHMM(en),
              date: dateStr
            };
            if (!draftItem.__draft_id) {
              ensureDraftId(draftItem);
              stagedRentListRef.list.push(draftItem);
            } else {
              var updated = false;
              stagedRentListRef.list = (stagedRentListRef.list || []).map(function (r) {
                if (String(r.__draft_id || '') !== String(draftItem.__draft_id)) return r;
                updated = true;
                return Object.assign({}, r, draftItem);
              });
              if (!updated) stagedRentListRef.list.push(draftItem);
            }
            renderDraftList();
            showMsg('Бронь добавлена в черновик. Сохранится вместе с мероприятием.', false);
            return;
          }
          var evNum = parseInt(String(eventId), 10);
          if (isNaN(evNum)) {
            showMsg('Некорректный id мероприятия.', true);
            return;
          }
          if (!ridSave || ridSave === '') {
            await apiRequest('POST', API.RENT.ROOT, {
              event_id: evNum,
              room_id: roomNum,
              date: dateStr,
              start_time: st,
              end_time: en
            });
          } else {
            await apiRequest('PUT', API.RENT.ROOT, {
              id: parseInt(ridSave, 10),
              event_id: evNum,
              room_id: roomNum,
              date: dateStr,
              start_time: st,
              end_time: en
            });
          }
          await reloadRentList();
        } catch (err) {
          showMsg(err.message || 'Ошибка сохранения', true);
        }
      }
    });

    if (isDraftMode) {
      renderDraftList();
    }
  }

  function buildEventRentSectionHtml(createMode, rentListRows, roomsRentOpts) {
    if (type !== 'org') return '';
    var inner = buildEventRentListHtml(rentListRows, roomsRentOpts);
    return '<section class="event-detail-card event-detail-card--rent" aria-labelledby="eventRentHeading">' +
      '<div class="event-detail-card-head">' +
      '<h3 class="event-detail-card__title" id="eventRentHeading">Бронирование</h3>' +
      '<button type="button" class="event-rent-btn event-rent-btn--primary" id="eventRentAddBtn">Добавить бронь</button>' +
      '</div>' +
      (createMode ? '<p class="event-rent-placeholder">Бронь можно добавить сразу. Она сохранится вместе с мероприятием.</p>' : '') +
      '<p class="event-rent-msg" id="eventRentMsg" style="display:none"></p>' +
      '<div id="eventRentList" class="event-rent-panel">' + inner + '</div></section>';
  }

  return {
    cloneRentDraft,
    rentDraftsEqual,
    syncRentDraftToServer,
    buildEventRentListHtml,
    wireEventRentSection,
    buildEventRentSectionHtml
  };
};
