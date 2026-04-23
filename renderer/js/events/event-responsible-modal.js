'use strict';

const { apiRequest, unwrapResponse } = require('../api-client.js');
const API = require('../api-paths.js');
const { escapeHtml, escapeHtmlAttr } = require('../html-escape.js');
const { RESP_PART_RESULT_MAX_LEN } = require('./event-constants.js');

function cloneRespDraft(list) {
  if (!list || !Array.isArray(list)) return [];
  return list.map(function (r) {
    var o = {};
    Object.keys(r).forEach(function (k) { o[k] = r[k]; });
    var id = r.id_employees != null ? r.id_employees : r.id;
    o.id_employees = id;
    o.id = id;
    return o;
  });
}

function normalizeRespListForCompare(list, type) {
  return list.map(function (r) {
    var id = r.id_employees != null ? r.id_employees : r.id;
    if (type === 'part') {
      return {
        id: String(id),
        mark: (r.mark_of_sending_an_application === 1 || r.mark_of_sending_an_application === true) ? 1 : 0,
        comment: String(r.result_of_responsible != null ? r.result_of_responsible : ''),
        participants: r.responsible_participants == null || r.responsible_participants === '' ? null : Number(r.responsible_participants),
        winners: r.responsible_winners == null || r.responsible_winners === '' ? null : Number(r.responsible_winners),
        runnerUp: r.responsible_runner_up == null || r.responsible_runner_up === '' ? null : Number(r.responsible_runner_up)
      };
    }
    return { id: String(id) };
  }).sort(function (a, b) {
    return a.id.localeCompare(b.id);
  });
}

function respDraftsEqual(a, b, type) {
  return JSON.stringify(normalizeRespListForCompare(a, type)) === JSON.stringify(normalizeRespListForCompare(b, type));
}

async function syncResponsibleDraftToServer(base, type, eventId, initial, staged) {
  var idEv = parseInt(String(eventId), 10);
  var initialIds = {};
  initial.forEach(function (r) {
    var id = r.id_employees != null ? r.id_employees : r.id;
    if (id != null) initialIds[String(id)] = r;
  });
  var stagedIds = {};
  staged.forEach(function (r) {
    var id = r.id_employees != null ? r.id_employees : r.id;
    if (id != null) stagedIds[String(id)] = r;
  });
  var sid;
  for (sid in initialIds) {
    if (!Object.prototype.hasOwnProperty.call(initialIds, sid)) continue;
    if (!stagedIds[sid]) {
      await apiRequest('DELETE', base + '/responsible', { id_event: idEv, id_employee: parseInt(sid, 10) });
    }
  }
  for (sid in stagedIds) {
    if (!Object.prototype.hasOwnProperty.call(stagedIds, sid)) continue;
    if (!initialIds[sid]) {
      await apiRequest('POST', base + '/responsible', { id_event: idEv, id_employee: parseInt(sid, 10) });
    }
  }
  if (type !== 'part') return;
  var i;
  for (i = 0; i < staged.length; i++) {
    var r = staged[i];
    var rid = r.id_employees != null ? r.id_employees : r.id;
    if (rid == null) continue;
    sid = String(rid);
    var init = initialIds[sid];
    var mark = r.mark_of_sending_an_application === 1 || r.mark_of_sending_an_application === true;
    var initMark = init ? (init.mark_of_sending_an_application === 1 || init.mark_of_sending_an_application === true) : false;
    var comment = r.result_of_responsible != null ? String(r.result_of_responsible) : '';
    var initComment = init && init.result_of_responsible != null ? String(init.result_of_responsible) : '';
    var participants = r.responsible_participants == null || r.responsible_participants === '' ? null : Number(r.responsible_participants);
    var initParticipants = init && init.responsible_participants != null && init.responsible_participants !== '' ? Number(init.responsible_participants) : null;
    var winners = r.responsible_winners == null || r.responsible_winners === '' ? null : Number(r.responsible_winners);
    var initWinners = init && init.responsible_winners != null && init.responsible_winners !== '' ? Number(init.responsible_winners) : null;
    var runnerUp = r.responsible_runner_up == null || r.responsible_runner_up === '' ? null : Number(r.responsible_runner_up);
    var initRunnerUp = init && init.responsible_runner_up != null && init.responsible_runner_up !== '' ? Number(init.responsible_runner_up) : null;
    if (!init || mark !== initMark) {
      await apiRequest('PUT', base + '/mark', {
        id_event: idEv,
        id_employee: parseInt(sid, 10),
        mark_of_sending_an_application: mark ? 1 : 0
      });
    }
    if (comment !== initComment || participants !== initParticipants || winners !== initWinners || runnerUp !== initRunnerUp) {
      await apiRequest('PUT', base + '/result', {
        id_event: idEv,
        id_employee: parseInt(sid, 10),
        result_of_responsible: comment,
        responsible_participants: participants,
        responsible_winners: winners,
        responsible_runner_up: runnerUp
      });
    }
  }
}

var respModalCtx = { eventId: null, base: null, type: null, onRefresh: null };

function closeResponsibleModal() {
  var modal = document.getElementById('eventRespModal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  respModalCtx = { eventId: null, base: null, type: null, onRefresh: null };
}

function asIntOrEmpty(v) {
  if (v == null || v === '') return '';
  var n = Number(v);
  if (!isNaN(n) && isFinite(n)) return String(Math.max(0, Math.trunc(n)));
  return '';
}

function buildResponsibleDetailHtml(type, respList) {
  if (type === 'part') {
    if (!respList || !respList.length) {
      return '<p class="event-detail-empty">Нет ответственных — нажмите «Добавить/Удалить»</p>';
    }
    var cards = respList.map(function (r) {
      var empId = r.id_employees != null ? r.id_employees : r.id;
      var name = [r.first_name, r.second_name, r.patronymic].filter(Boolean).join(' ') || r.name || '—';
      var eid = escapeHtmlAttr(String(empId));
      var mark = r.mark_of_sending_an_application === 1 || r.mark_of_sending_an_application === true;
      var comment = r.result_of_responsible != null ? String(r.result_of_responsible) : '';
      var participants = asIntOrEmpty(r.responsible_participants);
      var winners = asIntOrEmpty(r.responsible_winners);
      var runnerUp = asIntOrEmpty(r.responsible_runner_up);
      return '<article class="event-resp-card event-resp-card--part">' +
        '<div class="event-resp-card__head">' +
          '<span class="event-resp-card__name">' + escapeHtml(name) + '</span>' +
          '<label class="event-resp-participation event-resp-switch">' +
            '<input type="checkbox" class="resp-detail-mark event-resp-switch__input" data-emp-id="' + eid + '"' + (mark ? ' checked' : '') + ' aria-label="Участвовал">' +
            '<span class="event-resp-switch__track" aria-hidden="true"></span>' +
            '<span class="event-resp-switch__label">Участвовал</span>' +
          '</label>' +
        '</div>' +
        '<div class="event-resp-card__stats">' +
          '<label class="event-resp-stat"><small>Участвовавшие</small><input type="number" min="0" step="1" class="event-edit-input resp-detail-count" data-kind="participants" data-emp-id="' + eid + '" value="' + escapeHtmlAttr(participants) + '" placeholder="0"></label>' +
          '<label class="event-resp-stat"><small>Призёры</small><input type="number" min="0" step="1" class="event-edit-input resp-detail-count" data-kind="runner_up" data-emp-id="' + eid + '" value="' + escapeHtmlAttr(runnerUp) + '" placeholder="0"></label>' +
          '<label class="event-resp-stat"><small>Победители</small><input type="number" min="0" step="1" class="event-edit-input resp-detail-count" data-kind="winners" data-emp-id="' + eid + '" value="' + escapeHtmlAttr(winners) + '" placeholder="0"></label>' +
        '</div>' +
        '<div class="event-resp-card__result">' +
          '<textarea class="event-edit-input resp-detail-comment" rows="2" maxlength="' + RESP_PART_RESULT_MAX_LEN + '" data-emp-id="' + eid + '" placeholder="Комментарий (до ' + RESP_PART_RESULT_MAX_LEN + ' симв.)">' + escapeHtml(comment) + '</textarea>' +
        '</div>' +
      '</article>';
    }).join('');
    return '<div class="event-resp-cards event-resp-cards--part">' + cards + '</div>';
  }
  if (!respList || !respList.length) {
    return '<p class="event-detail-empty">Нет ответственных — нажмите «Добавить/Удалить»</p>';
  }
  var rowsOrg = respList.map(function (r) {
    var name = [r.first_name, r.second_name, r.patronymic].filter(Boolean).join(' ') || r.name || '—';
    return '<article class="event-resp-card event-resp-card--org"><span class="event-resp-card__name">' + escapeHtml(name) + '</span></article>';
  }).join('');
  return '<div class="event-resp-cards">' + rowsOrg + '</div>';
}

function parseNonNegativeIntOrNull(raw) {
  if (raw == null) return null;
  var txt = String(raw).trim();
  if (txt === '') return null;
  var n = Number(txt);
  if (!isFinite(n) || isNaN(n)) return null;
  n = Math.trunc(n);
  if (n < 0) n = 0;
  return n;
}

function wireDetailResponsibleHandlers(base, type, eventId, stagedRespListRef) {
  if (type !== 'part') return;
  var summary = document.getElementById('eventRespSummary');
  if (!summary || !stagedRespListRef || !stagedRespListRef.list) return;
  summary.querySelectorAll('.resp-detail-mark').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var empId = cb.getAttribute('data-emp-id');
      var row = stagedRespListRef.list.find(function (r) {
        var id = r.id_employees != null ? r.id_employees : r.id;
        return String(id) === String(empId);
      });
      if (row) row.mark_of_sending_an_application = cb.checked ? 1 : 0;
    });
  });
  summary.querySelectorAll('.resp-detail-comment').forEach(function (ta) {
    ta.addEventListener('input', function () {
      var empId = ta.getAttribute('data-emp-id');
      var row = stagedRespListRef.list.find(function (r) {
        var id = r.id_employees != null ? r.id_employees : r.id;
        return String(id) === String(empId);
      });
      if (row) row.result_of_responsible = ta.value;
    });
  });
  summary.querySelectorAll('.resp-detail-count').forEach(function (input) {
    input.addEventListener('input', function () {
      var empId = input.getAttribute('data-emp-id');
      var kind = input.getAttribute('data-kind');
      var row = stagedRespListRef.list.find(function (r) {
        var id = r.id_employees != null ? r.id_employees : r.id;
        return String(id) === String(empId);
      });
      if (!row) return;
      var val = parseNonNegativeIntOrNull(input.value);
      if (kind === 'participants') row.responsible_participants = val;
      if (kind === 'winners') row.responsible_winners = val;
      if (kind === 'runner_up') row.responsible_runner_up = val;
    });
  });
}

async function renderResponsibleModalBody() {
  var ctx = respModalCtx;
  var body = document.getElementById('eventRespModalBody');
  if (!ctx || !body || !ctx.base) return;
  if (ctx.draftMode && ctx.stagedRespListRef) {
    /* черновик до создания мероприятия — id_event ещё нет */
  } else if (ctx.eventId == null || ctx.eventId === '') {
    return;
  }

  var respList = [];
  if (ctx.draftMode && ctx.stagedRespListRef && ctx.stagedRespListRef.list) {
    respList = ctx.stagedRespListRef.list;
  } else if (ctx.type === 'part') {
    try {
      var rNew = await apiRequest('GET', ctx.base + '/responsible-new/' + ctx.eventId);
      respList = rNew.data != null ? rNew.data : rNew;
    } catch (e) {
      if ((e.message || '').indexOf('404') >= 0) {
        var rFallback = await apiRequest('GET', ctx.base + '/responsible/' + ctx.eventId);
        respList = unwrapResponse(rFallback);
      } else {
        throw e;
      }
    }
  } else {
    var rOrg = await apiRequest('GET', ctx.base + '/responsible/' + ctx.eventId);
    respList = unwrapResponse(rOrg);
  }
  respList = Array.isArray(respList) ? respList : [];

  var empRes = await apiRequest('GET', API.EMPLOYEES.LIST);
  var employees = empRes.data || empRes || [];
  if (!Array.isArray(employees)) employees = [];
  ctx.employeesCache = employees;
  var assigned = {};
  respList.forEach(function (r) {
    var id = r.id_employees != null ? r.id_employees : r.id;
    if (id != null) assigned[String(id)] = true;
  });
  var available = employees.filter(function (e) {
    var active = e.is_active !== undefined ? e.is_active : (e.active !== undefined ? e.active : true);
    if (!active) return false;
    var id = e.id_employees || e.id;
    return id != null && !assigned[String(id)];
  });
  var opts = available.map(function (e) {
    var id = e.id_employees || e.id;
    var name = e.name || [e.first_name, e.second_name, e.patronymic].filter(Boolean).join(' ') || '—';
    return '<option value="' + escapeHtmlAttr(String(id)) + '">' + escapeHtml(name) + '</option>';
  }).join('');

  var isOrgModal = ctx.type === 'org';
  var rowsHtml = respList.map(function (r) {
    var empId = r.id_employees != null ? r.id_employees : r.id;
    var name = [r.first_name, r.second_name, r.patronymic].filter(Boolean).join(' ') || r.name || '—';
    var eid = escapeHtmlAttr(String(empId));
    var nameCell = isOrgModal
      ? '<td>' + escapeHtml(name) + '</td>'
      : '<td data-label="Сотрудник">' + escapeHtml(name) + '</td>';
    return '<tr data-emp-id="' + eid + '">' +
      nameCell +
      '<td data-label=""><button type="button" class="resp-modal-remove" data-emp-id="' + eid + '">Удалить</button></td>' +
      '</tr>';
  }).join('');

  var tableHtml = isOrgModal
    ? '<div class="resp-modal-table-wrap"><table class="resp-modal-table resp-modal-table--org-list"><tbody>' + rowsHtml + '</tbody></table></div>'
    : '<div class="resp-modal-table-wrap"><table class="resp-modal-table"><thead><tr><th>Сотрудник</th><th></th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';

  body.innerHTML =
    '<div class="resp-modal-add">' +
    '  <select class="event-edit-input event-edit-select resp-modal-emp-select" id="respModalEmpSelect">' +
    '    <option value="">— Выберите сотрудника —</option>' + opts +
    '  </select>' +
    '  <button type="button" class="resp-modal-add-btn" id="respModalAddBtn">Добавить</button>' +
    '</div>' +
    tableHtml +
    '<p class="resp-modal-msg" id="respModalMsg"></p>';

  document.getElementById('respModalAddBtn').addEventListener('click', respModalAddHandler);
  body.querySelectorAll('.resp-modal-remove').forEach(function (btn) {
    btn.addEventListener('click', respModalRemoveHandler);
  });
}

async function respModalAddHandler() {
  var sel = document.getElementById('respModalEmpSelect');
  var msg = document.getElementById('respModalMsg');
  if (!sel) return;
  if (!respModalCtx.draftMode && (respModalCtx.eventId == null || respModalCtx.eventId === '')) return;
  var id = sel.value.trim();
  if (!id) return;
  if (msg) { msg.textContent = ''; msg.className = 'resp-modal-msg'; }
  try {
    if (respModalCtx.draftMode && respModalCtx.stagedRespListRef) {
      var idNum = parseInt(id, 10);
      var employees = respModalCtx.employeesCache || [];
      var emp = employees.find(function (e) {
        var eid = e.id_employees != null ? e.id_employees : e.id;
        return String(eid) === String(idNum);
      });
      var newRow = {
        id_employees: idNum,
        id: idNum,
        mark_of_sending_an_application: 0,
        result_of_responsible: '',
        responsible_participants: null,
        responsible_winners: null,
        responsible_runner_up: null
      };
      if (emp) {
        newRow.first_name = emp.first_name;
        newRow.second_name = emp.second_name;
        newRow.patronymic = emp.patronymic;
        newRow.name = emp.name;
      } else {
        var opt = sel.options[sel.selectedIndex];
        newRow.name = opt ? opt.text : '—';
      }
      respModalCtx.stagedRespListRef.list.push(newRow);
      sel.value = '';
      if (respModalCtx.onRefresh) await respModalCtx.onRefresh();
      await renderResponsibleModalBody();
      return;
    }
    await apiRequest('POST', respModalCtx.base + '/responsible', {
      id_event: parseInt(String(respModalCtx.eventId), 10),
      id_employee: parseInt(id, 10)
    });
    if (respModalCtx.onRefresh) await respModalCtx.onRefresh();
    await renderResponsibleModalBody();
  } catch (e) {
    if (msg) { msg.textContent = e.message || 'Ошибка'; msg.className = 'resp-modal-msg resp-modal-msg--err'; }
  }
}

async function respModalRemoveHandler(e) {
  var empId = e.target.getAttribute('data-emp-id');
  var msg = document.getElementById('respModalMsg');
  if (!empId) return;
  if (!respModalCtx.draftMode && (respModalCtx.eventId == null || respModalCtx.eventId === '')) return;
  if (msg) { msg.textContent = ''; msg.className = 'resp-modal-msg'; }
  try {
    if (respModalCtx.draftMode && respModalCtx.stagedRespListRef) {
      respModalCtx.stagedRespListRef.list = respModalCtx.stagedRespListRef.list.filter(function (r) {
        var rid = r.id_employees != null ? r.id_employees : r.id;
        return String(rid) !== String(empId);
      });
      if (respModalCtx.onRefresh) await respModalCtx.onRefresh();
      await renderResponsibleModalBody();
      return;
    }
    await apiRequest('DELETE', respModalCtx.base + '/responsible', {
      id_event: parseInt(String(respModalCtx.eventId), 10),
      id_employee: parseInt(empId, 10)
    });
    if (respModalCtx.onRefresh) await respModalCtx.onRefresh();
    await renderResponsibleModalBody();
  } catch (err) {
    if (msg) { msg.textContent = err.message || 'Ошибка'; msg.className = 'resp-modal-msg resp-modal-msg--err'; }
  }
}

async function openResponsibleModal(ctx) {
  respModalCtx = ctx;
  var modal = document.getElementById('eventRespModal');
  var body = document.getElementById('eventRespModalBody');
  if (!modal || !body) return;
  body.innerHTML = '<div class="resp-modal-loading">Загрузка...</div>';
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  try {
    await renderResponsibleModalBody();
  } catch (err) {
    console.error('[events-view] resp modal', err);
    body.innerHTML = '<p class="event-detail-error">' + escapeHtml(err.message || 'Ошибка загрузки') + '</p>';
  }
}

function setupResponsibleModal() {
  var modal = document.getElementById('eventRespModal');
  if (!modal) return;
  var closeBtn = document.getElementById('eventRespModalClose');
  if (closeBtn) closeBtn.addEventListener('click', closeResponsibleModal);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeResponsibleModal();
  });
}

module.exports = {
  cloneRespDraft,
  respDraftsEqual,
  syncResponsibleDraftToServer,
  closeResponsibleModal,
  buildResponsibleDetailHtml,
  wireDetailResponsibleHandlers,
  openResponsibleModal,
  setupResponsibleModal
};
