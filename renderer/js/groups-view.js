'use strict';

const { ipcRenderer } = require('electron');
const { apiRequest, unwrapResponse } = require('./api-client.js');
const API = require('./api-paths.js');
const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');
const { sanitizeFilename, saveExcel, applyHeaderStyle, applyDataStyle } = require('./shared-utils.js');
const { runWithBusy } = require('./busy-overlay.js');

const ADMIN_ACCESS_LEVELS = [1, 4, 6];
const GROUP_MENU_ROLE_KEYS = ['root', 'admin', 'administrator', 'manager', 'руководитель'];
const GROUP_DANGER_ROLE_KEYS = ['root', 'admin', 'administrator', 'leader', 'руководитель'];
const DANGER_MENU_ITEMS = [
  { cmd: 'danger-delete-groups', label: 'Удалить все группы' },
  { cmd: 'danger-clear-students', label: 'Очистить учеников из групп' },
  { cmd: 'danger-clear-pixels', label: 'Очистить все пиксели' },
  { cmd: 'danger-clear-attendance', label: 'Очистить всю посещаемость' }
];
const excelIcon = '<svg class="excel-btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '</svg>';

const STUDENT_COLUMNS = [
  { key: 'surname', label: 'Фамилия' },
  { key: 'name', label: 'Имя' },
  { key: 'patronymic', label: 'Отчество' },
  { key: 'birthDay', label: 'Дата рождения' },
  { key: 'navigator', label: 'Навигатор' },
  { key: 'parentSurname', label: 'Фамилия родителя' },
  { key: 'parentName', label: 'Имя родителя' },
  { key: 'parentPatronymic', label: 'Отчество родителя' },
  { key: 'email', label: 'E-mail' },
  { key: 'phone', label: 'Телефон' }
];

function hasGroupManageAccess(user) {
  if (!user || typeof user !== 'object') return false;
  var level = user.accessLevel != null ? user.accessLevel : user.access_level_id;
  var n = Number(level);
  if (!isNaN(n) && ADMIN_ACCESS_LEVELS.indexOf(n) >= 0) return true;
  var roleRaw = user.role || user.role_name || user.access_name || user.accessName || '';
  var role = String(roleRaw).trim().toLowerCase();
  if (!role) return false;
  return GROUP_MENU_ROLE_KEYS.some(function (key) { return role.indexOf(key) >= 0; });
}

function hasGroupDangerAccess(user) {
  if (!user || typeof user !== 'object') return false;
  var level = user.accessLevel != null ? user.accessLevel : user.access_level_id;
  var n = Number(level);
  if (!isNaN(n) && ADMIN_ACCESS_LEVELS.indexOf(n) >= 0) return true;
  var roleRaw = user.role || user.role_name || user.access_name || user.accessName || '';
  var role = String(roleRaw).trim().toLowerCase();
  if (!role) return false;
  return GROUP_DANGER_ROLE_KEYS.some(function (key) { return role.indexOf(key) >= 0; });
}

function asInt(v) {
  var n = Number(v);
  return isFinite(n) ? Math.trunc(n) : 0;
}

function studentIdFromAny(s) {
  if (!s || typeof s !== 'object') return null;
  var variants = [s.id, s.id_student, s.student_id, s.idStudent];
  for (var i = 0; i < variants.length; i++) {
    var n = Number(variants[i]);
    if (isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

function studentCellValue(student, key) {
  var v = student ? student[key] : '';
  if (key === 'navigator') return (v === 1 || v === true || String(v) === '1') ? 'Да' : 'Нет';
  return v == null || v === '' ? '—' : String(v);
}

function studentFullName(student) {
  return [student && student.surname, student && student.name, student && student.patronymic]
    .filter(Boolean)
    .join(' ')
    .trim() || '—';
}

function studentMetaText(student) {
  if (student && student.birthDay) return 'ДР: ' + String(student.birthDay);
  return 'Дата рождения не указана';
}

module.exports = function renderGroupsView(container) {
  if (!container) return;
  var groups = [];
  var selectedGroupId = null;
  var students = [];
  var canEdit = false;
  var canDangerActions = false;
  var editOpen = false;
  var menuOpen = false;
  var compositionOpen = false;
  var transferOpen = false;
  var clearConfirmOpen = false;
  var clearInProgress = false;
  var dangerConfirmOpen = false;
  var dangerInProgress = false;
  var dangerCmd = '';
  var composeQuery = '';
  var draftGroups = [];
  var studentsCatalog = [];
  var transferState = null;

  function selectedGroup() {
    return groups.find(function (g) { return String(g.id) === String(selectedGroupId); }) || null;
  }

  function setMsg(text, kind) {
    var el = document.getElementById('groupsMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'groups-msg' + (kind ? ' groups-msg--' + kind : '');
  }

  function setEditMsg(text, kind) {
    var el = document.getElementById('groupsEditMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'groups-msg' + (kind ? ' groups-msg--' + kind : '');
  }

  function setComposeMsg(text, kind) {
    var el = document.getElementById('groupsComposeMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'groups-msg' + (kind ? ' groups-msg--' + kind : '');
  }

  function setTransferMsg(text, kind) {
    var el = document.getElementById('groupsTransferMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'groups-msg' + (kind ? ' groups-msg--' + kind : '');
  }

  async function fetchStudentsByGroupId(groupId) {
    var id = parseInt(groupId, 10);
    if (isNaN(id) || id <= 0) return [];
    var res = await apiRequest('GET', API.STUDENTS.FULL_BY_GROUP(id));
    var list = unwrapResponse(res);
    return Array.isArray(list) ? list : [];
  }

  function compareStudentsByName(a, b) {
    return studentFullName(a).localeCompare(studentFullName(b), 'ru');
  }

  async function initTransferState(leftGroupId, rightGroupId) {
    var leftId = parseInt(leftGroupId, 10);
    var rightId = parseInt(rightGroupId, 10);
    if (isNaN(leftId) || leftId <= 0 || isNaN(rightId) || rightId <= 0 || leftId === rightId) {
      transferState = null;
      return;
    }
    var pair = await Promise.all([fetchStudentsByGroupId(leftId), fetchStudentsByGroupId(rightId)]);
    var left = pair[0];
    var right = pair[1];
    var byId = {};
    left.forEach(function (s) {
      var id = String(s.id);
      byId[id] = { student: s, origin: 'left', side: 'left' };
    });
    right.forEach(function (s) {
      var id = String(s.id);
      if (byId[id]) {
        byId[id].origin = 'right';
        byId[id].side = 'right';
        byId[id].student = s;
        return;
      }
      byId[id] = { student: s, origin: 'right', side: 'right' };
    });
    transferState = {
      leftGroupId: leftId,
      rightGroupId: rightId,
      byId: byId,
      selectedLeft: {},
      selectedRight: {}
    };
  }

  function transferStudentsBySide(side) {
    if (!transferState) return [];
    var out = [];
    Object.keys(transferState.byId).forEach(function (id) {
      var rec = transferState.byId[id];
      if (rec && rec.side === side) out.push(rec.student);
    });
    out.sort(compareStudentsByName);
    return out;
  }

  function moveSelectedTransfer(direction) {
    if (!transferState) return;
    var fromSelected = direction === 'right' ? transferState.selectedLeft : transferState.selectedRight;
    var toSide = direction === 'right' ? 'right' : 'left';
    Object.keys(fromSelected).forEach(function (id) {
      if (!fromSelected[id]) return;
      if (!transferState.byId[id]) return;
      transferState.byId[id].side = toSide;
      fromSelected[id] = false;
    });
  }

  function moveAllTransfer(direction) {
    if (!transferState) return;
    var fromSide = direction === 'right' ? 'left' : 'right';
    var toSide = direction === 'right' ? 'right' : 'left';
    Object.keys(transferState.byId).forEach(function (id) {
      if (transferState.byId[id].side === fromSide) transferState.byId[id].side = toSide;
    });
    transferState.selectedLeft = {};
    transferState.selectedRight = {};
  }

  async function saveTransferChanges() {
    if (!transferState) return;
    var ids = Object.keys(transferState.byId);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var rec = transferState.byId[id];
      if (!rec) continue;
      if (rec.side === rec.origin) continue;
      var oldGroupId = rec.origin === 'left' ? transferState.leftGroupId : transferState.rightGroupId;
      var newGroupId = rec.side === 'left' ? transferState.leftGroupId : transferState.rightGroupId;
      await apiRequest('PUT', API.STUDENTS.MOVE_TO_GROUP, {
        student_id: parseInt(id, 10),
        old_group_id: oldGroupId,
        new_group_id: newGroupId
      });
      rec.origin = rec.side;
    }
    await loadStudentsForSelected();
  }

  function closeCommandPopups() {
    menuOpen = false;
    editOpen = false;
    compositionOpen = false;
    transferOpen = false;
    clearConfirmOpen = false;
    dangerConfirmOpen = false;
    renderEditModal();
    renderCompositionModal();
    renderTransferModal();
    renderClearConfirmModal();
    renderDangerConfirmModal();
  }

  function hideMenuDropdown() {
    var menuBtn = document.getElementById('groupsMenuBtn');
    var menuDd = document.getElementById('groupsMenuDd');
    if (menuDd) menuDd.hidden = true;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    menuOpen = false;
  }

  function renderStudentsTable() {
    var tableWrap = document.getElementById('groupsTableWrap');
    var titleEl = document.getElementById('groupsSelectedTitle');
    if (!tableWrap || !titleEl) return;
    var head = STUDENT_COLUMNS.map(function (c) { return '<th>' + escapeHtml(c.label) + '</th>'; }).join('');
    function emptyTableHtml() {
      return '<div class="groups-table-scroll"><table class="groups-table"><thead><tr>' + head + '</tr></thead><tbody></tbody></table></div>';
    }
    var g = selectedGroup();
    if (!g) {
      titleEl.textContent = '';
      titleEl.hidden = true;
      tableWrap.innerHTML = emptyTableHtml();
      return;
    }
    titleEl.hidden = false;
    titleEl.textContent = g.name || '';
    var body = students.map(function (s) {
      var cells = STUDENT_COLUMNS.map(function (c) {
        return '<td>' + escapeHtml(studentCellValue(s, c.key)) + '</td>';
      }).join('');
      return '<tr>' + cells + '</tr>';
    }).join('');
    tableWrap.innerHTML =
      '<div class="groups-table-scroll">' +
      '<table class="groups-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>' +
      '</div>';
  }

  function renderEditModal() {
    var modal = document.getElementById('groupsEditModal');
    var panel = document.getElementById('groupsEditModalBody');
    if (!modal || !panel) return;
    if (!editOpen) {
      modal.hidden = true;
      panel.innerHTML = '';
      return;
    }
    var rows = draftGroups.map(function (g, idx) {
      return '<div class="groups-edit-row" data-row-index="' + idx + '">' +
        '<input type="text" class="groups-edit-input" data-row-index="' + idx + '" value="' + escapeHtmlAttr(g.name || '') + '" placeholder="Название группы">' +
        '<button type="button" class="groups-edit-del" data-row-index="' + idx + '">Удалить</button>' +
        '</div>';
    }).join('');
    modal.hidden = false;
    panel.innerHTML =
      '<div class="groups-edit-head">' +
      '<div class="groups-edit-actions">' +
      '<button type="button" class="groups-edit-add" id="groupsEditAddBtn">Добавить группу</button>' +
      '<button type="button" class="groups-edit-save" id="groupsEditSaveBtn">Сохранить</button>' +
      '</div>' +
      '</div>' +
      '<div class="groups-msg" id="groupsEditMsg"></div>' +
      '<div class="groups-edit-list">' + rows + '</div>';

    panel.querySelectorAll('.groups-edit-input').forEach(function (input) {
      input.addEventListener('input', function () {
        var idx = parseInt(input.getAttribute('data-row-index'), 10);
        if (isNaN(idx) || !draftGroups[idx]) return;
        draftGroups[idx].name = input.value;
      });
    });
    panel.querySelectorAll('.groups-edit-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-row-index'), 10);
        if (isNaN(idx)) return;
        var row = draftGroups[idx];
        if (row && row.id != null) {
          if (!window.confirm('Удалить группу "' + (row.name || '—') + '"?')) return;
        }
        draftGroups.splice(idx, 1);
        renderEditModal();
      });
    });
    var addBtn = document.getElementById('groupsEditAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        draftGroups.push({ id: null, name: '' });
        renderEditModal();
      });
    }
    var saveBtn = document.getElementById('groupsEditSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        setEditMsg('');
        for (var i = 0; i < draftGroups.length; i++) {
          if (!String(draftGroups[i].name || '').trim()) {
            setEditMsg('Название группы не может быть пустым.', 'err');
            return;
          }
        }
        saveBtn.disabled = true;
        try {
          var originalById = {};
          groups.forEach(function (g) { if (g.id != null) originalById[String(g.id)] = g; });
          var draftIds = {};
          draftGroups.forEach(function (g) { if (g.id != null) draftIds[String(g.id)] = true; });
          var key;
          for (key in originalById) {
            if (!Object.prototype.hasOwnProperty.call(originalById, key)) continue;
            if (!draftIds[key]) await apiRequest('DELETE', API.GROUPS.BY_ID(key));
          }
          for (i = 0; i < draftGroups.length; i++) {
            var row = draftGroups[i];
            var name = String(row.name).trim();
            if (row.id == null) {
              await apiRequest('POST', API.GROUPS.LIST, { name: name });
              continue;
            }
            var orig = originalById[String(row.id)];
            if (!orig || String(orig.name || '') !== name) {
              await apiRequest('PUT', API.GROUPS.BY_ID(row.id), { name: name });
            }
          }
          await loadGroups();
          if (selectedGroupId != null && !groups.some(function (g) { return String(g.id) === String(selectedGroupId); })) {
            selectedGroupId = null;
            students = [];
          }
          render();
          setMsg('Группы обновлены.', 'ok');
        } catch (err) {
          if (err && Number(err.status) === 404) {
            setEditMsg('На текущем API нет маршрутов для добавления/редактирования групп. По документации доступны только чтение списка групп и обновление пикселей.', 'err');
          } else {
            setEditMsg((err && err.message) || 'Не удалось сохранить изменения.', 'err');
          }
        } finally {
          saveBtn.disabled = false;
        }
      });
    }
  }

  function renderCompositionModal() {
    var modal = document.getElementById('groupsComposeModal');
    var body = document.getElementById('groupsComposeModalBody');
    if (!modal || !body) return;
    if (!compositionOpen) {
      modal.hidden = true;
      body.innerHTML = '';
      return;
    }
    var g = selectedGroup();
    if (!g) {
      body.innerHTML = '<div class="groups-msg groups-msg--err">Сначала выберите группу.</div>';
      modal.hidden = false;
      return;
    }
    var groupsOptions = groups.map(function (x) {
      var selected = String(x.id) === String(g.id) ? ' selected' : '';
      return '<option value="' + escapeHtmlAttr(String(x.id)) + '"' + selected + '>' + escapeHtml(x.name || '—') + '</option>';
    }).join('');

    var membersHtml = students.length
      ? students.map(function (s) {
        return '<label class="groups-compose-item">' +
          '<input type="checkbox" class="groups-compose-item__check" data-student-id="' + escapeHtmlAttr(String(s.id)) + '" checked>' +
          '<span class="groups-compose-item__body">' +
          '<span class="groups-compose-item__name">' + escapeHtml(studentFullName(s)) + '</span>' +
          '<span class="groups-compose-item__meta">' + escapeHtml(studentMetaText(s)) + '</span>' +
          '</span>' +
          '</label>';
      }).join('')
      : '<div class="groups-compose-empty">В этой группе пока нет учеников.</div>';

    var query = String(composeQuery || '').trim().toLowerCase();
    var filtered = studentsCatalog.filter(function (s) {
      if (!query) return true;
      return studentFullName(s).toLowerCase().indexOf(query) >= 0;
    });

    var searchHtml = filtered.length
      ? filtered.map(function (s) {
        var inGroup = students.some(function (x) { return String(x.id) === String(s.id); });
        return '<label class="groups-compose-item">' +
          '<input type="checkbox" class="groups-compose-item__check" data-student-id="' + escapeHtmlAttr(String(s.id)) + '"' + (inGroup ? ' checked' : '') + '>' +
          '<span class="groups-compose-item__body">' +
          '<span class="groups-compose-item__name">' + escapeHtml(studentFullName(s)) + '</span>' +
          '<span class="groups-compose-item__meta">' + escapeHtml(studentMetaText(s)) + '</span>' +
          '</span>' +
          '</label>';
      }).join('')
      : '<div class="groups-compose-empty">По запросу ничего не найдено.</div>';

    body.innerHTML =
      '<div class="groups-compose-controls">' +
      '<label class="groups-compose-control">' +
      '<span class="groups-compose-control__label">Группа</span>' +
      '<select id="groupsComposeGroupSelect" class="groups-edit-input">' + groupsOptions + '</select>' +
      '</label>' +
      '<label class="groups-compose-control">' +
      '<span class="groups-compose-control__label">Поиск</span>' +
      '<input id="groupsComposeSearchInput" class="groups-edit-input" type="text" value="' + escapeHtmlAttr(composeQuery) + '" placeholder="ФИО, телефон, e-mail">' +
      '</label>' +
      '</div>' +
      '<div class="groups-msg" id="groupsComposeMsg"></div>' +
      '<div class="groups-compose-panels">' +
      '<div class="groups-compose-panel">' +
      '<div class="groups-compose-panel__title">В группе</div>' +
      '<div class="groups-compose-panel__list">' + membersHtml + '</div>' +
      '</div>' +
      '<div class="groups-compose-panel">' +
      '<div class="groups-compose-panel__title">Результат поиска</div>' +
      '<div class="groups-compose-panel__list">' + searchHtml + '</div>' +
      '</div>' +
      '</div>';
    modal.hidden = false;

    var groupSelect = document.getElementById('groupsComposeGroupSelect');
    if (groupSelect) {
      groupSelect.addEventListener('change', function () {
        var nextId = parseInt(groupSelect.value, 10);
        if (isNaN(nextId) || nextId <= 0) return;
        selectedGroupId = nextId;
        loadStudentsForSelected().catch(function (err) {
          setComposeMsg((err && err.message) || 'Не удалось загрузить выбранную группу.', 'err');
        });
      });
    }

    var searchInput = document.getElementById('groupsComposeSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        composeQuery = searchInput.value;
        renderCompositionModal();
      });
    }

    body.querySelectorAll('.groups-compose-item__check').forEach(function (checkbox) {
      checkbox.addEventListener('change', async function () {
        var sid = parseInt(checkbox.getAttribute('data-student-id'), 10);
        if (isNaN(sid) || sid <= 0) return;
        var shouldBeInGroup = !!checkbox.checked;
        checkbox.disabled = true;
        try {
          if (shouldBeInGroup) {
            await apiRequest('POST', API.STUDENTS.ADD_TO_GROUP, { student_id: sid, group_id: g.id });
          } else {
            await apiRequest('DELETE', API.STUDENTS.DELETE_FROM_GROUP, { student_id: sid, group_id: g.id });
          }
          await loadStudentsForSelected();
          setComposeMsg(shouldBeInGroup ? 'Ученик зачислен в группу.' : 'Ученик удалён из группы.', 'ok');
        } catch (err) {
          setComposeMsg((err && err.message) || 'Не удалось обновить состав группы.', 'err');
        }
      });
    });
  }

  function renderTransferModal() {
    var modal = document.getElementById('groupsTransferModal');
    var body = document.getElementById('groupsTransferModalBody');
    if (!modal || !body) return;
    if (!transferOpen) {
      modal.hidden = true;
      body.innerHTML = '';
      transferState = null;
      return;
    }
    if (!transferState) {
      body.innerHTML = '<div class="groups-msg groups-msg--err">Не удалось инициализировать окно перевода. Выберите две разные группы.</div>';
      modal.hidden = false;
      return;
    }
    var leftOptions = groups.map(function (x) {
      var selected = String(x.id) === String(transferState.leftGroupId) ? ' selected' : '';
      return '<option value="' + escapeHtmlAttr(String(x.id)) + '"' + selected + '>' + escapeHtml(x.name || '—') + '</option>';
    }).join('');
    var rightOptions = groups.map(function (x) {
      var selected = String(x.id) === String(transferState.rightGroupId) ? ' selected' : '';
      return '<option value="' + escapeHtmlAttr(String(x.id)) + '"' + selected + '>' + escapeHtml(x.name || '—') + '</option>';
    }).join('');

    var leftList = transferStudentsBySide('left');
    var rightList = transferStudentsBySide('right');

    function buildTransferItems(list, side) {
      if (!list.length) return '<div class="groups-transfer-empty">Список пуст.</div>';
      return list.map(function (s) {
        var id = String(s.id);
        var checked = side === 'left' ? !!transferState.selectedLeft[id] : !!transferState.selectedRight[id];
        return '<label class="groups-transfer-item">' +
          '<input type="checkbox" class="groups-transfer-item__check" data-side="' + side + '" data-student-id="' + escapeHtmlAttr(id) + '"' + (checked ? ' checked' : '') + '>' +
          '<span class="groups-transfer-item__body">' +
          '<span class="groups-transfer-item__name">' + escapeHtml(studentFullName(s)) + '</span>' +
          '<span class="groups-transfer-item__meta">' + escapeHtml(studentMetaText(s)) + '</span>' +
          '</span>' +
          '</label>';
      }).join('');
    }

    body.innerHTML =
      '<div class="groups-msg" id="groupsTransferMsg"></div>' +
      '<div class="groups-transfer-layout">' +
      '<div class="groups-transfer-top groups-transfer-top--left">' +
      '<label class="groups-transfer-label">Первая группа</label>' +
      '<select id="groupsTransferLeftSelect" class="groups-edit-input">' + leftOptions + '</select>' +
      '</div>' +
      '<div class="groups-transfer-top groups-transfer-top--center">' +
      '<button type="button" class="groups-edit-save" id="groupsTransferSaveBtn">Сохранить</button>' +
      '</div>' +
      '<div class="groups-transfer-top groups-transfer-top--right">' +
      '<label class="groups-transfer-label">Вторая группа</label>' +
      '<select id="groupsTransferRightSelect" class="groups-edit-input">' + rightOptions + '</select>' +
      '</div>' +
      '<div class="groups-transfer-panel groups-transfer-panel--left">' + buildTransferItems(leftList, 'left') + '</div>' +
      '<div class="groups-transfer-controls">' +
      '<button type="button" class="groups-transfer-btn" id="groupsTransferRightBtn" aria-label="Перенести выбранных вправо">⇒</button>' +
      '<button type="button" class="groups-transfer-btn" id="groupsTransferLeftBtn" aria-label="Перенести выбранных влево">⇐</button>' +
      '<button type="button" class="groups-transfer-btn groups-transfer-btn--wide" id="groupsTransferAllRightBtn">Всех вправо</button>' +
      '<button type="button" class="groups-transfer-btn groups-transfer-btn--wide" id="groupsTransferAllLeftBtn">Всех влево</button>' +
      '</div>' +
      '<div class="groups-transfer-panel groups-transfer-panel--right">' + buildTransferItems(rightList, 'right') + '</div>' +
      '<div class="groups-transfer-bottom groups-transfer-bottom--left"></div>' +
      '<div class="groups-transfer-bottom groups-transfer-bottom--center"></div>' +
      '<div class="groups-transfer-bottom groups-transfer-bottom--right">' +
      '<button type="button" class="groups-edit-del" id="groupsTransferCancelBtn">Отменить изменения</button>' +
      '</div>' +
      '</div>';
    modal.hidden = false;

    var leftSelect = document.getElementById('groupsTransferLeftSelect');
    var rightSelect = document.getElementById('groupsTransferRightSelect');
    if (leftSelect && rightSelect) {
      leftSelect.addEventListener('change', async function () {
        var left = parseInt(leftSelect.value, 10);
        var right = parseInt(rightSelect.value, 10);
        if (left === right) {
          setTransferMsg('Выберите две разные группы.', 'err');
          return;
        }
        try {
          await initTransferState(left, right);
          renderTransferModal();
        } catch (err) {
          setTransferMsg((err && err.message) || 'Не удалось загрузить группы.', 'err');
        }
      });
      rightSelect.addEventListener('change', async function () {
        var left = parseInt(leftSelect.value, 10);
        var right = parseInt(rightSelect.value, 10);
        if (left === right) {
          setTransferMsg('Выберите две разные группы.', 'err');
          return;
        }
        try {
          await initTransferState(left, right);
          renderTransferModal();
        } catch (err) {
          setTransferMsg((err && err.message) || 'Не удалось загрузить группы.', 'err');
        }
      });
    }

    body.querySelectorAll('.groups-transfer-item__check').forEach(function (checkbox) {
      checkbox.addEventListener('change', function () {
        var id = checkbox.getAttribute('data-student-id');
        var side = checkbox.getAttribute('data-side');
        if (!id) return;
        if (side === 'left') transferState.selectedLeft[id] = checkbox.checked;
        if (side === 'right') transferState.selectedRight[id] = checkbox.checked;
      });
    });

    var moveRightBtn = document.getElementById('groupsTransferRightBtn');
    if (moveRightBtn) {
      moveRightBtn.addEventListener('click', function () {
        moveSelectedTransfer('right');
        renderTransferModal();
      });
    }
    var moveLeftBtn = document.getElementById('groupsTransferLeftBtn');
    if (moveLeftBtn) {
      moveLeftBtn.addEventListener('click', function () {
        moveSelectedTransfer('left');
        renderTransferModal();
      });
    }
    var allRightBtn = document.getElementById('groupsTransferAllRightBtn');
    if (allRightBtn) {
      allRightBtn.addEventListener('click', function () {
        moveAllTransfer('right');
        renderTransferModal();
      });
    }
    var allLeftBtn = document.getElementById('groupsTransferAllLeftBtn');
    if (allLeftBtn) {
      allLeftBtn.addEventListener('click', function () {
        moveAllTransfer('left');
        renderTransferModal();
      });
    }

    var saveBtn = document.getElementById('groupsTransferSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        saveBtn.disabled = true;
        try {
          await saveTransferChanges();
          renderTransferModal();
          setTransferMsg('Изменения сохранены.', 'ok');
        } catch (err) {
          setTransferMsg((err && err.message) || 'Не удалось сохранить изменения.', 'err');
        } finally {
          var btn = document.getElementById('groupsTransferSaveBtn');
          if (btn) btn.disabled = false;
        }
      });
    }

    var cancelBtn = document.getElementById('groupsTransferCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async function () {
        try {
          await initTransferState(transferState.leftGroupId, transferState.rightGroupId);
          renderTransferModal();
          setTransferMsg('Изменения отменены.', 'ok');
        } catch (err) {
          setTransferMsg((err && err.message) || 'Не удалось отменить изменения.', 'err');
        }
      });
    }
  }

  function renderClearConfirmModal() {
    var modal = document.getElementById('groupsClearModal');
    var body = document.getElementById('groupsClearModalBody');
    if (!modal || !body) return;
    if (!clearConfirmOpen) {
      modal.hidden = true;
      body.innerHTML = '';
      return;
    }
    var g = selectedGroup();
    if (!g) {
      body.innerHTML = '<div class="groups-msg groups-msg--err">Сначала выберите группу.</div>';
      modal.hidden = false;
      return;
    }
    body.innerHTML =
      '<p class="groups-modal-subtitle">Вы действительно хотите удалить <b>всех учеников</b> из группы <b>' + escapeHtml(g.name || '—') + '</b>?</p>' +
      '<div class="groups-msg" id="groupsClearMsg"></div>' +
      '<div class="groups-transfer-bottom groups-transfer-bottom--right">' +
      '<button type="button" class="groups-edit-del" id="groupsClearCancelBtn">Отмена</button>' +
      '<button type="button" class="groups-edit-save" id="groupsClearApplyBtn">Очистить</button>' +
      '</div>';
    modal.hidden = false;

    var cancelBtn = document.getElementById('groupsClearCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        clearConfirmOpen = false;
        renderClearConfirmModal();
      });
    }
    var applyBtn = document.getElementById('groupsClearApplyBtn');
    var msgEl = document.getElementById('groupsClearMsg');
    if (applyBtn) {
      applyBtn.disabled = !!clearInProgress;
      applyBtn.addEventListener('click', async function () {
        if (clearInProgress) return;
        clearInProgress = true;
        applyBtn.disabled = true;
        if (msgEl) {
          msgEl.textContent = 'Очистка...';
          msgEl.className = 'groups-msg';
        }
        try {
          if (!students.length) {
            clearConfirmOpen = false;
            renderClearConfirmModal();
            setMsg('В выбранной группе нет учеников.', 'ok');
            return;
          }
          for (var i = 0; i < students.length; i++) {
            var sid = parseInt(students[i].id, 10);
            if (isNaN(sid) || sid <= 0) continue;
            await apiRequest('DELETE', API.STUDENTS.DELETE_FROM_GROUP, { student_id: sid, group_id: g.id });
          }
          await loadStudentsForSelected();
          clearConfirmOpen = false;
          renderClearConfirmModal();
          setMsg('Все записи в группе очищены.', 'ok');
        } catch (err) {
          if (msgEl) {
            msgEl.textContent = (err && err.message) || 'Не удалось очистить группу.';
            msgEl.className = 'groups-msg groups-msg--err';
          }
        } finally {
          clearInProgress = false;
          var currentApplyBtn = document.getElementById('groupsClearApplyBtn');
          if (currentApplyBtn) currentApplyBtn.disabled = false;
        }
      });
    }
  }

  function dangerItemLabel(cmd) {
    var item = DANGER_MENU_ITEMS.find(function (x) { return x.cmd === cmd; });
    return item ? item.label : 'Опасная операция';
  }

  async function clearStudentsFromAllGroups() {
    var allGroups = groups.slice();
    for (var gi = 0; gi < allGroups.length; gi++) {
      /* eslint-disable no-await-in-loop */
      var g = allGroups[gi];
      var res = await apiRequest('GET', API.STUDENTS.FULL_BY_GROUP(g.id));
      var list = unwrapResponse(res);
      list = Array.isArray(list) ? list : [];
      for (var si = 0; si < list.length; si++) {
        var sid = studentIdFromAny(list[si]);
        if (!sid) continue;
        await apiRequest('DELETE', API.STUDENTS.DELETE_FROM_GROUP, { student_id: sid, group_id: g.id });
      }
      /* eslint-enable no-await-in-loop */
    }
  }

  async function clearAllPixels() {
    try {
      await apiRequest('POST', API.GROUPS.PIXELS_CLEAR_ALL, {});
      return;
    } catch (err) {
      if (!err || Number(err.status) !== 404) throw err;
    }
    for (var gi = 0; gi < groups.length; gi++) {
      /* eslint-disable no-await-in-loop */
      var g = groups[gi];
      var pxRes = await apiRequest('GET', API.GROUPS.PIXELS_BY_GROUP(g.id));
      var rows = unwrapResponse(pxRes);
      rows = Array.isArray(rows) ? rows : [];
      for (var pi = 0; pi < rows.length; pi++) {
        var row = rows[pi];
        var sid = studentIdFromAny(row);
        if (!sid) continue;
        var payload = { id_student: sid, id: sid };
        Object.keys(row).forEach(function (key) {
          if (key.indexOf('__') === 0) return;
          if (key === 'id' || key === 'id_student' || key === 'student_id' || key === 'idStudent') return;
          if (key === 'attendance' || key === 'attendance_points' || key === 'visit_points' || key === 'visits' || key === 'presence_pixels') return;
          if (typeof row[key] === 'number' || (/^-?\d+$/.test(String(row[key] || '')))) {
            payload[key] = 0;
          } else {
            payload[key] = asInt(row[key]);
          }
        });
        await apiRequest('PUT', API.GROUPS.PIXELS_UPDATE, payload);
      }
      /* eslint-enable no-await-in-loop */
    }
  }

  async function runDangerAction(cmd) {
    if (cmd === 'danger-delete-groups') {
      for (var i = 0; i < groups.length; i++) {
        /* eslint-disable no-await-in-loop */
        await apiRequest('DELETE', API.GROUPS.BY_ID(groups[i].id));
        /* eslint-enable no-await-in-loop */
      }
      return;
    }
    if (cmd === 'danger-clear-students') {
      await clearStudentsFromAllGroups();
      return;
    }
    if (cmd === 'danger-clear-pixels') {
      await clearAllPixels();
      return;
    }
    if (cmd === 'danger-clear-attendance') {
      await apiRequest('POST', API.ATTENDANCE.CLEAR_ALL, {});
    }
  }

  function renderDangerConfirmModal() {
    var modal = document.getElementById('groupsDangerModal');
    var body = document.getElementById('groupsDangerModalBody');
    if (!modal || !body) return;
    if (!dangerConfirmOpen) {
      modal.hidden = true;
      body.innerHTML = '';
      return;
    }
    var actionLabel = dangerItemLabel(dangerCmd);
    body.innerHTML =
      '<div class="groups-danger-warning">' +
      '<h5 class="groups-danger-warning__title">ВНИМАНИЕ: НЕОБРАТИМОЕ ДЕЙСТВИЕ</h5>' +
      '<p class="groups-danger-warning__text">Вы собираетесь выполнить: <b>' + escapeHtml(actionLabel) + '</b>.</p>' +
      '<p class="groups-danger-warning__text">Это действие нельзя отменить. Все затронутые данные будут удалены без возможности восстановления.</p>' +
      '</div>' +
      '<div class="groups-msg" id="groupsDangerMsg"></div>' +
      '<div class="groups-transfer-bottom groups-transfer-bottom--right">' +
      '<button type="button" class="groups-edit-del" id="groupsDangerCancelBtn">Отмена</button>' +
      '<button type="button" class="groups-edit-save" id="groupsDangerApplyBtn">Понимаю, выполнить</button>' +
      '</div>';
    modal.hidden = false;

    var cancelBtn = document.getElementById('groupsDangerCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        dangerConfirmOpen = false;
        dangerCmd = '';
        renderDangerConfirmModal();
      });
    }
    var applyBtn = document.getElementById('groupsDangerApplyBtn');
    var msgEl = document.getElementById('groupsDangerMsg');
    if (applyBtn) {
      applyBtn.disabled = !!dangerInProgress;
      applyBtn.addEventListener('click', async function () {
        if (dangerInProgress || !dangerCmd) return;
        dangerInProgress = true;
        applyBtn.disabled = true;
        if (msgEl) {
          msgEl.textContent = 'Выполняется: ' + actionLabel + '...';
          msgEl.className = 'groups-msg';
        }
        try {
          await runDangerAction(dangerCmd);
          await loadGroups();
          if (selectedGroupId != null && !groups.some(function (g) { return String(g.id) === String(selectedGroupId); })) {
            selectedGroupId = null;
            students = [];
          } else if (selectedGroupId != null) {
            await loadStudentsForSelected();
          }
          dangerConfirmOpen = false;
          dangerCmd = '';
          render();
          setMsg(actionLabel + ': успешно выполнено.', 'ok');
        } catch (err) {
          if (msgEl) {
            msgEl.textContent = (err && err.message) || ('Не удалось выполнить действие: ' + actionLabel + '.');
            msgEl.className = 'groups-msg groups-msg--err';
          }
        } finally {
          dangerInProgress = false;
          var currentBtn = document.getElementById('groupsDangerApplyBtn');
          if (currentBtn) currentBtn.disabled = false;
        }
      });
    }
  }

  function render() {
    var selectedIdStr = selectedGroupId != null ? String(selectedGroupId) : '';
    var groupSelectOptions = ['<option value="">Выберите группу</option>'].concat(groups.map(function (g) {
      var val = String(g && g.id != null ? g.id : '');
      var isSelected = selectedIdStr && selectedIdStr === val ? ' selected' : '';
      return '<option value="' + escapeHtmlAttr(val) + '"' + isSelected + '>' + escapeHtml(String(g && g.name ? g.name : '—')) + '</option>';
    })).join('');
    var dangerMenuHtml = canDangerActions
      ? DANGER_MENU_ITEMS.map(function (item) {
          return '<button type="button" class="groups-menu-item groups-menu-item--danger" data-cmd="' + item.cmd + '">' + item.label + '</button>';
        }).join('')
      : '';
    container.innerHTML = [
      '<div class="groups-view">',
      '  <div class="groups-toolbar">',
      canEdit ? '    <div class="groups-menu-wrap"><button type="button" class="groups-menu-btn" id="groupsMenuBtn" aria-haspopup="menu" aria-expanded="' + (menuOpen ? 'true' : 'false') + '">☰ Меню</button><div class="groups-menu-dd" id="groupsMenuDd" ' + (menuOpen ? '' : 'hidden') + '><button type="button" class="groups-menu-item" data-cmd="edit">Редактировать группы</button><button type="button" class="groups-menu-item" data-cmd="compose">Изменить состав группы</button><button type="button" class="groups-menu-item" data-cmd="transfer">Перенести группу на другой модуль</button><button type="button" class="groups-menu-item groups-menu-item--danger" data-cmd="clear-all">Очистить записи выбранной группы</button>' + dangerMenuHtml + '</div></div>' : '',
      '    <div class="groups-search-wrap">',
      '      <select id="groupsGroupSelect" class="search-input groups-search-input">' + groupSelectOptions + '</select>',
      '    </div>',
      '    <button type="button" class="excel-btn" id="groupsExcelOne" aria-label="Скачать Excel по группе">' + excelIcon + '<span class="excel-btn__text">Excel</span></button>',
      '    <button type="button" class="excel-btn" id="groupsExcelAll" aria-label="Скачать все группы">' + excelIcon + '<span class="excel-btn__text">Скачать все</span></button>',
      '  </div>',
      '  <div class="groups-msg" id="groupsMsg"></div>',
      '  <h3 class="groups-selected-title" id="groupsSelectedTitle" hidden></h3>',
      '  <div class="groups-table-wrap" id="groupsTableWrap"></div>',
      '  <div class="groups-modal-overlay" id="groupsEditModal" hidden>',
      '    <div class="groups-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="groupsEditModalTitle">',
      '      <div class="groups-modal-head">',
      '        <h4 class="groups-modal-title" id="groupsEditModalTitle">Редактирование групп</h4>',
      '        <button type="button" class="groups-modal-close" id="groupsEditModalClose" aria-label="Закрыть">&times;</button>',
      '      </div>',
      '      <div class="groups-modal-body" id="groupsEditModalBody"></div>',
      '    </div>',
      '  </div>',
      '  <div class="groups-modal-overlay" id="groupsComposeModal" hidden>',
      '    <div class="groups-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="groupsComposeModalTitle">',
      '      <div class="groups-modal-head">',
      '        <h4 class="groups-modal-title" id="groupsComposeModalTitle">Изменить состав группы</h4>',
      '        <button type="button" class="groups-modal-close" id="groupsComposeModalClose" aria-label="Закрыть">&times;</button>',
      '      </div>',
      '      <div class="groups-modal-body" id="groupsComposeModalBody"></div>',
      '    </div>',
      '  </div>',
      '  <div class="groups-modal-overlay" id="groupsTransferModal" hidden>',
      '    <div class="groups-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="groupsTransferModalTitle">',
      '      <div class="groups-modal-head">',
      '        <h4 class="groups-modal-title" id="groupsTransferModalTitle">Перенести группу на другой модуль</h4>',
      '        <button type="button" class="groups-modal-close" id="groupsTransferModalClose" aria-label="Закрыть">&times;</button>',
      '      </div>',
      '      <div class="groups-modal-body" id="groupsTransferModalBody"></div>',
      '    </div>',
      '  </div>',
      '  <div class="groups-modal-overlay" id="groupsClearModal" hidden>',
      '    <div class="groups-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="groupsClearModalTitle">',
      '      <div class="groups-modal-head">',
      '        <h4 class="groups-modal-title" id="groupsClearModalTitle">Очистить группу</h4>',
      '        <button type="button" class="groups-modal-close" id="groupsClearModalClose" aria-label="Закрыть">&times;</button>',
      '      </div>',
      '      <div class="groups-modal-body" id="groupsClearModalBody"></div>',
      '    </div>',
      '  </div>',
      '  <div class="groups-modal-overlay" id="groupsDangerModal" hidden>',
      '    <div class="groups-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="groupsDangerModalTitle">',
      '      <div class="groups-modal-head">',
      '        <h4 class="groups-modal-title" id="groupsDangerModalTitle">Опасное действие</h4>',
      '        <button type="button" class="groups-modal-close" id="groupsDangerModalClose" aria-label="Закрыть">&times;</button>',
      '      </div>',
      '      <div class="groups-modal-body" id="groupsDangerModalBody"></div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
    renderEditModal();
    renderCompositionModal();
    renderTransferModal();
    renderClearConfirmModal();
    renderDangerConfirmModal();
    renderStudentsTable();
    wire();
  }

  function applyGroupFill(row, argb) {
    if (!argb) return;
    row.eachCell(function (cell) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } };
    });
  }

  async function exportSelectedGroupExcel() {
    var g = selectedGroup();
    if (!g) {
      setMsg('Сначала выберите группу.', 'err');
      return;
    }
    var list = students;
    if (!list || !list.length) {
      setMsg('В выбранной группе нет учеников для выгрузки.', 'err');
      return;
    }
    await runWithBusy('Формируем отчет по выбранной группе...', async function () {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Группа');
      ws.addRow(STUDENT_COLUMNS.map(function (c) { return c.label; }));
      applyHeaderStyle(ws.getRow(1));
      list.forEach(function (s, idx) {
        var row = ws.addRow(STUDENT_COLUMNS.map(function (c) { return studentCellValue(s, c.key); }));
        applyDataStyle(row, idx % 2 === 1);
      });
      ws.columns.forEach(function (c) { c.width = 20; });
      const buffer = await wb.xlsx.writeBuffer();
      await saveExcel(buffer, sanitizeFilename('Группа_' + (g.name || 'export')) + '.xlsx');
    });
  }

  async function exportAllGroupsExcel() {
    if (!groups.length) {
      setMsg('Список групп пуст.', 'err');
      return;
    }
    await runWithBusy('Формируем общий отчет по группам...', async function () {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Все группы');
      var headers = ['Группа'].concat(STUDENT_COLUMNS.map(function (c) { return c.label; }));
      ws.addRow(headers);
      applyHeaderStyle(ws.getRow(1));
      var fills = ['FFEFF3FF', 'FFEFFAF1', 'FFFFF8EE', 'FFF7F2FF', 'FFEFF8FA'];
      var rowIndex = 0;
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[gi];
        var st;
        try {
          var res = await apiRequest('GET', API.STUDENTS.FULL_BY_GROUP(g.id));
          st = unwrapResponse(res);
        } catch (_) {
          st = [];
        }
        st = Array.isArray(st) ? st : [];
        if (!st.length) {
          var emptyRow = ws.addRow([g.name || '—', '—']);
          applyDataStyle(emptyRow, rowIndex % 2 === 1);
          applyGroupFill(emptyRow, fills[gi % fills.length]);
          rowIndex++;
          continue;
        }
        for (var si = 0; si < st.length; si++) {
          var s = st[si];
          var row = ws.addRow([g.name || '—'].concat(STUDENT_COLUMNS.map(function (c) { return studentCellValue(s, c.key); })));
          applyDataStyle(row, rowIndex % 2 === 1);
          applyGroupFill(row, fills[gi % fills.length]);
          rowIndex++;
        }
      }
      ws.columns.forEach(function (c) { c.width = 20; });
      const buffer = await wb.xlsx.writeBuffer();
      await saveExcel(buffer, 'Все_группы.xlsx');
    });
  }

  async function loadGroups() {
    var res = await apiRequest('GET', API.GROUPS.LIST);
    var list = unwrapResponse(res);
    groups = Array.isArray(list) ? list : [];
    groups.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'ru'); });
    draftGroups = groups.map(function (g) { return { id: g.id, name: g.name || '' }; });
    if (!groups.length) {
      selectedGroupId = null;
      return;
    }
    var hasSelected = groups.some(function (g) { return String(g.id) === String(selectedGroupId); });
    if (!hasSelected) selectedGroupId = groups[0].id;
  }

  async function loadStudentsForSelected() {
    var g = selectedGroup();
    if (!g) {
      students = [];
      renderStudentsTable();
      renderCompositionModal();
      renderTransferModal();
      return;
    }
    setMsg('');
    var res = await apiRequest('GET', API.STUDENTS.FULL_BY_GROUP(g.id));
    var list = unwrapResponse(res);
    students = Array.isArray(list) ? list : [];
    renderStudentsTable();
    renderCompositionModal();
    renderTransferModal();
  }

  function wire() {
    var groupSelect = document.getElementById('groupsGroupSelect');
    if (groupSelect) {
      groupSelect.addEventListener('change', function () {
        selectedGroupId = groupSelect.value ? parseInt(groupSelect.value, 10) : null;
        if (selectedGroupId == null || isNaN(selectedGroupId)) selectedGroupId = null;
        loadStudentsForSelected().catch(function (e) {
          setMsg((e && e.message) || 'Не удалось загрузить учеников.', 'err');
        });
      });
    }

    var oneBtn = document.getElementById('groupsExcelOne');
    if (oneBtn) {
      oneBtn.addEventListener('click', function () {
        exportSelectedGroupExcel().catch(function (e) {
          setMsg((e && e.message) || 'Не удалось выгрузить Excel.', 'err');
        });
      });
    }
    var allBtn = document.getElementById('groupsExcelAll');
    if (allBtn) {
      allBtn.addEventListener('click', function () {
        exportAllGroupsExcel().catch(function (e) {
          setMsg((e && e.message) || 'Не удалось выгрузить все группы.', 'err');
        });
      });
    }

    var menuBtn = document.getElementById('groupsMenuBtn');
    var menuDd = document.getElementById('groupsMenuDd');
    if (menuBtn && menuDd) {
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        menuOpen = !menuOpen;
        menuDd.hidden = !menuOpen;
        menuBtn.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
      });
      menuDd.querySelectorAll('.groups-menu-item').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var cmd = btn.getAttribute('data-cmd');
          hideMenuDropdown();
          closeCommandPopups();
          if (cmd === 'edit') {
            editOpen = true;
            draftGroups = groups.map(function (g) { return { id: g.id, name: g.name || '' }; });
            renderEditModal();
            return;
          }
          if (cmd === 'compose') {
            if (!selectedGroup() && groups.length) selectedGroupId = groups[0].id;
            compositionOpen = true;
            composeQuery = '';
            try {
              if (!studentsCatalog.length) {
                var sr = await apiRequest('GET', API.STUDENTS.SEARCH_NEW);
                var sa = unwrapResponse(sr);
                studentsCatalog = Array.isArray(sa) ? sa : [];
              }
              await loadStudentsForSelected();
            } catch (_) { studentsCatalog = []; }
            renderCompositionModal();
            return;
          }
          if (cmd === 'transfer') {
            if (groups.length < 2) {
              setMsg('Нужно минимум две группы для перевода.', 'err');
              return;
            }
            var leftId = selectedGroup() ? selectedGroup().id : groups[0].id;
            var rightId = groups.find(function (x) { return String(x.id) !== String(leftId); });
            rightId = rightId ? rightId.id : null;
            if (rightId == null) {
              setMsg('Нужно минимум две разные группы для перевода.', 'err');
              return;
            }
            transferOpen = true;
            try {
              await initTransferState(leftId, rightId);
              renderTransferModal();
            } catch (err) {
              transferOpen = false;
              setMsg((err && err.message) || 'Не удалось открыть окно перевода.', 'err');
            }
          }
          if (cmd === 'clear-all') {
            if (!selectedGroup()) {
              setMsg('Сначала выберите группу в поиске.', 'err');
              return;
            }
            clearConfirmOpen = true;
            renderClearConfirmModal();
            return;
          }
          if (cmd && cmd.indexOf('danger-') === 0) {
            if (!canDangerActions) {
              setMsg('Недостаточно прав для выполнения этого действия.', 'err');
              return;
            }
            dangerCmd = cmd;
            dangerConfirmOpen = true;
            renderDangerConfirmModal();
          }
        });
      });
      document.addEventListener('click', function (e) {
        if (!e.target.closest('.groups-menu-wrap')) {
          hideMenuDropdown();
        }
      });
    }
    var modal = document.getElementById('groupsEditModal');
    var modalClose = document.getElementById('groupsEditModalClose');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) {
          editOpen = false;
          renderEditModal();
        }
      });
    }
    if (modalClose) {
      modalClose.addEventListener('click', function () {
        editOpen = false;
        renderEditModal();
      });
    }
    var composeModal = document.getElementById('groupsComposeModal');
    var composeClose = document.getElementById('groupsComposeModalClose');
    if (composeModal) {
      composeModal.addEventListener('click', function (e) {
        if (e.target === composeModal) {
          compositionOpen = false;
          renderCompositionModal();
        }
      });
    }
    if (composeClose) {
      composeClose.addEventListener('click', function () {
        compositionOpen = false;
        renderCompositionModal();
      });
    }
    var transferModal = document.getElementById('groupsTransferModal');
    var transferClose = document.getElementById('groupsTransferModalClose');
    if (transferModal) {
      transferModal.addEventListener('click', function (e) {
        if (e.target === transferModal) {
          transferOpen = false;
          renderTransferModal();
        }
      });
    }
    if (transferClose) {
      transferClose.addEventListener('click', function () {
        transferOpen = false;
        renderTransferModal();
      });
    }
    var clearModal = document.getElementById('groupsClearModal');
    var clearClose = document.getElementById('groupsClearModalClose');
    if (clearModal) {
      clearModal.addEventListener('click', function (e) {
        if (e.target === clearModal) {
          clearConfirmOpen = false;
          renderClearConfirmModal();
        }
      });
    }
    if (clearClose) {
      clearClose.addEventListener('click', function () {
        clearConfirmOpen = false;
        renderClearConfirmModal();
      });
    }
    var dangerModal = document.getElementById('groupsDangerModal');
    var dangerClose = document.getElementById('groupsDangerModalClose');
    if (dangerModal) {
      dangerModal.addEventListener('click', function (e) {
        if (e.target === dangerModal) {
          dangerConfirmOpen = false;
          dangerCmd = '';
          renderDangerConfirmModal();
        }
      });
    }
    if (dangerClose) {
      dangerClose.addEventListener('click', function () {
        dangerConfirmOpen = false;
        dangerCmd = '';
        renderDangerConfirmModal();
      });
    }
  }

  (async function init() {
    container.innerHTML = '<div class="groups-view"><div class="events-loading">Загрузка групп...</div></div>';
    try {
      var user = await ipcRenderer.invoke('get-user');
      canEdit = hasGroupManageAccess(user);
      canDangerActions = hasGroupDangerAccess(user);
      await loadGroups();
      render();
      await loadStudentsForSelected();
    } catch (err) {
      container.innerHTML = '<p class="content-error">Не удалось загрузить группы: ' + escapeHtml((err && err.message) || 'ошибка') + '</p>';
    }
  })();
};
