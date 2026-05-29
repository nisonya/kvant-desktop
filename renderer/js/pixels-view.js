'use strict';

const { ipcRenderer } = require('electron');
const { apiRequest, unwrapResponse } = require('./api-client.js');
const API = require('./api-paths.js');
const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');
const { sanitizeFilename, saveExcel, applyHeaderStyle, applyDataStyle } = require('./shared-utils.js');
const { runWithBusy } = require('./busy-overlay.js');

const excelIcon = '<svg class="excel-btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '</svg>';

const CRITERIA_COLUMNS = [
  {
    key: 'part_of_comp',
    label: 'Участие в конкурсах от технопарка',
    mode: 'fixed',
    points: 20,
    hint: 'Принимается участие в конкурсах и мероприятиях от технопарка.'
  },
  {
    key: 'make_content',
    label: 'Создание контента для соц.сетей',
    mode: 'fixed',
    points: 20,
    hint: 'Каждый месяц по заданной тематике можно сделать публикацию для соц.сетей (Лера).'
  },
  {
    key: 'invite_friend',
    label: 'Приведи друга в технопарк',
    mode: 'fixed',
    points: 30,
    hint: 'Действует один раз. Друг не должен ранее обучаться в технопарке.'
  },
  {
    key: 'clean_kvantum',
    label: 'Уборка в квантуме',
    mode: 'fixed',
    points: 10,
    hint: 'Раз в месяц по графику дежурств.'
  },
  {
    key: 'filled_project_card_on_time',
    label: 'Вовремя заполнил проектную карту',
    mode: 'fixed',
    points: 30,
    hint: 'Своевременное заполнение проектной карты согласно графику.'
  },
  {
    key: 'finished_project_with_product',
    label: 'Закрыл проект итоговым продуктом',
    mode: 'fixed',
    points: 100,
    hint: 'Полностью закрыл проект итоговым продуктом.'
  },
  {
    key: 'regional_competition',
    label: 'Региональный конкурс',
    mode: 'select',
    options: [
      { id: 'member', label: 'Участник (+20)', points: 20 },
      { id: 'winner', label: 'Призер/победитель (+40)', points: 40 }
    ],
    hint: 'Уровень конкурса: участник или призер/победитель.'
  },
  {
    key: 'interregional_competition',
    label: 'Межрегиональный конкурс',
    mode: 'select',
    options: [
      { id: 'member', label: 'Участник (+30)', points: 30 },
      { id: 'winner', label: 'Призер/победитель (+60)', points: 60 }
    ],
    hint: 'Уровень конкурса: участник или призер/победитель.'
  },
  {
    key: 'all_russian_competition',
    label: 'Всероссийский конкурс',
    mode: 'select',
    options: [
      { id: 'member', label: 'Участник (+50)', points: 50 },
      { id: 'winner', label: 'Призер/победитель (+100)', points: 100 }
    ],
    hint: 'Уровень конкурса: участник или призер/победитель.'
  },
  {
    key: 'international_competition',
    label: 'Международный конкурс',
    mode: 'select',
    options: [
      { id: 'member', label: 'Участник (+75)', points: 75 },
      { id: 'winner', label: 'Призер/победитель (+150)', points: 150 }
    ],
    hint: 'Уровень конкурса: участник или призер/победитель.'
  },
  {
    key: 'nto',
    label: 'НТО',
    mode: 'select',
    options: [
      { id: 'member', label: 'Участник (+50)', points: 50 },
      { id: 'winner', label: 'Призер/победитель (+100)', points: 100 }
    ],
    hint: 'Уровень НТО: участник или призер/победитель.'
  },
  {
    key: 'become_an_engineering_volunteer',
    label: 'Стать инженерным волонтером',
    mode: 'fixed',
    points: 30,
    hint: 'Начисляется за роль инженерного волонтера.'
  },
  {
    key: 'help_with_event',
    label: 'Помощь в проведении мероприятия',
    mode: 'fixed',
    points: 30,
    hint: 'Помощь в проведении мероприятия в качестве инженерного волонтера.'
  },
  {
    key: 'make_own_event',
    label: 'Провел свое мероприятие',
    mode: 'fixed',
    points: 100,
    hint: 'Полностью самостоятельно организовал и провел мероприятие/акцию.'
  },
  { key: 'special_achievements', label: 'Особые достижения', mode: 'number', hint: 'Количество по усмотрению наставника.' },
  { key: 'fine', label: 'Штрафы', mode: 'penalty', hint: 'Количество по усмотрению наставника (вычитается из суммы).' },
  {
    key: '__attendance_percent__',
    label: '% посещаемости',
    mode: 'readonly',
    hint: 'Только для чтения. При посещении нескольких групп берется лучший процент посещаемости.'
  },
  {
    key: '__attendance__',
    label: 'Баллы за посещаемость',
    mode: 'readonly',
    hint: '94% и выше — 100; 85–93% — 80; 70–84% — 60; 40–69% — 30; меньше 40% — 0.'
  },
  { key: '__total__', label: 'Итого', mode: 'readonly-total', hint: 'Сумма всех критериев ученика с учетом посещаемости и штрафов.' }
];

const EDITABLE_PIXEL_KEYS = CRITERIA_COLUMNS
  .filter(function (c) { return c.mode !== 'readonly' && c.mode !== 'readonly-total' && c.key.indexOf('__') !== 0; })
  .map(function (c) { return c.key; });

const ADMIN_ACCESS_LEVELS = [1, 4, 6];
const DANGER_ROLE_KEYS = ['root', 'admin', 'administrator', 'leader', 'руководитель'];

function asInt(value) {
  var n = Number(value);
  if (!isFinite(n)) return 0;
  return Math.trunc(n);
}

function getStudentId(row) {
  if (!row || typeof row !== 'object') return null;
  var candidates = [row.id_student, row.student_id, row.idStudent, row.id];
  for (var i = 0; i < candidates.length; i++) {
    var n = Number(candidates[i]);
    if (isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

function getStudentName(row) {
  if (!row || typeof row !== 'object') return '—';
  if (row.name) return String(row.name);
  var combined = [row.surname, row.second_name, row.nameStudent, row.name, row.first_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return combined || '—';
}

function normalizeStudentNameKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getAttendanceStudentName(row) {
  if (!row || typeof row !== 'object') return '—';
  var direct = row.full_name || row.fio;
  if (direct && String(direct).trim()) return String(direct).trim();
  var parts = [
    row.surnameStudent || row.surname || row.second_name || row.last_name,
    row.nameStudent || row.first_name || row.name,
    row.patronymic
  ].map(function (v) { return v == null ? '' : String(v).trim(); }).filter(Boolean);
  return parts.length ? parts.join(' ') : getStudentName(row);
}

function getAttendancePercent(row) {
  if (!row || typeof row !== 'object') return 0;
  if (row.__attendancePercent != null) return asInt(row.__attendancePercent);
  var directKeys = ['attendance_percent', 'attendancePercent', 'presence_percent', 'visit_percent'];
  for (var i = 0; i < directKeys.length; i++) {
    var value = row[directKeys[i]];
    if (value != null && value !== '') return Math.max(0, Math.min(100, asInt(value)));
  }
  return 0;
}

function attendancePercentToPoints(percent) {
  var n = Math.max(0, Math.min(100, asInt(percent)));
  if (n >= 94) return 100;
  if (n >= 85) return 80;
  if (n >= 70) return 60;
  if (n >= 40) return 30;
  return 0;
}

function getAttendancePoints(row) {
  return attendancePercentToPoints(getAttendancePercent(row));
}

function getColumnValue(row, columnKey) {
  if (columnKey === '__attendance_percent__') return getAttendancePercent(row) + '%';
  if (columnKey === '__attendance__') return getAttendancePoints(row);
  if (columnKey === '__total__') return computeTotal(row);
  return getEditablePixelValue(row, columnKey);
}

function getEditablePixelValue(row, key) {
  var value = asInt(row && row[key]);
  return key === 'fine' ? Math.abs(value) : value;
}

function computeTotal(row) {
  var sum = 0;
  EDITABLE_PIXEL_KEYS.forEach(function (key) {
    var value = getEditablePixelValue(row, key);
    sum += key === 'fine' ? -value : value;
  });
  sum += getAttendancePoints(row);
  return sum;
}

function hasDangerAccess(user) {
  if (!user || typeof user !== 'object') return false;
  var level = user.accessLevel != null ? user.accessLevel : user.access_level_id;
  var n = Number(level);
  if (!isNaN(n) && ADMIN_ACCESS_LEVELS.indexOf(n) >= 0) return true;
  var roleRaw = user.role || user.role_name || user.access_name || user.accessName || '';
  var role = String(roleRaw).trim().toLowerCase();
  if (!role) return false;
  return DANGER_ROLE_KEYS.some(function (key) { return role.indexOf(key) >= 0; });
}

module.exports = function renderPixelsView(container) {
  if (!container) return;

  var groups = [];
  var selectedGroupId = null;
  var rows = [];
  var attendancePercentByStudentId = {};
  var attendancePercentByStudentName = {};
  var loading = false;
  var canDangerActions = false;
  var actionState = {
    open: false,
    rowIndex: -1,
    columnKey: '',
    selectedOptionId: '',
    customValue: '',
    saving: false
  };
  var clearConfirmOpen = false;
  var clearInProgress = false;

  function selectedGroup() {
    return groups.find(function (g) { return String(g.id) === String(selectedGroupId); }) || null;
  }

  function setMsg(text, kind) {
    var el = document.getElementById('pixelsMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'students-msg' + (kind ? ' students-msg--' + kind : '');
  }

  function renderTable() {
    var wrap = document.getElementById('pixelsTableWrap');
    if (!wrap) return;
    if (loading) {
      wrap.innerHTML = '<div class="events-loading">Загрузка пикселей...</div>';
      return;
    }
    if (!selectedGroup()) {
      wrap.innerHTML = '<div class="students-empty">Выберите группу, чтобы посмотреть пиксели.</div>';
      return;
    }
    if (!rows.length) {
      wrap.innerHTML = '<div class="students-empty">В выбранной группе пока нет данных по пикселям.</div>';
      return;
    }
    var head = '<th class="pixels-table__name">Фамилия Имя ученика</th>' +
      CRITERIA_COLUMNS.map(function (c) {
        var hint = String(c.hint || '').trim();
        var titleAttr = hint ? (' title="' + escapeHtmlAttr(hint) + '"') : '';
        var cls = hint ? ' class="pixels-table__head pixels-table__head--hint"' : ' class="pixels-table__head"';
        return '<th' + cls + titleAttr + '>' + escapeHtml(c.label) + '</th>';
      }).join('');
    var body = rows.map(function (row, idx) {
      var nameCell = '<td class="pixels-table__name">' + escapeHtml(getStudentName(row)) + '</td>';
      var criteriaCells = CRITERIA_COLUMNS.map(function (c) {
        var val = getColumnValue(row, c.key);
        var isEditable = c.mode !== 'readonly' && c.mode !== 'readonly-total';
        var cls = 'pixels-table__cell' + (isEditable ? ' pixels-table__cell--editable' : '');
        var attrs = isEditable
          ? ' data-row-index="' + escapeHtmlAttr(String(idx)) + '" data-column-key="' + escapeHtmlAttr(c.key) + '"'
          : '';
        var text = columnTextValue(val);
        return '<td class="' + cls + '"' + attrs + '>' + escapeHtml(text) + '</td>';
      }).join('');
      return '<tr>' + nameCell + criteriaCells + '</tr>';
    }).join('');
    wrap.innerHTML =
      '<div class="pixels-table-scroll">' +
      '<table class="pixels-table">' +
      '<thead><tr>' + head + '</tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '</table>' +
      '</div>';
    wrap.querySelectorAll('.pixels-table__cell--editable').forEach(function (td) {
      td.addEventListener('click', function () {
        var rowIndex = parseInt(td.getAttribute('data-row-index'), 10);
        var columnKey = td.getAttribute('data-column-key');
        if (isNaN(rowIndex) || rowIndex < 0 || !columnKey) return;
        openActionModal(rowIndex, columnKey);
      });
    });
  }

  function columnTextValue(value) {
    return value == null ? '' : String(value);
  }

  function openActionModal(rowIndex, columnKey) {
    var column = CRITERIA_COLUMNS.find(function (c) { return c.key === columnKey; });
    var row = rows[rowIndex];
    if (!column || !row) return;
    actionState.open = true;
    actionState.rowIndex = rowIndex;
    actionState.columnKey = columnKey;
    actionState.selectedOptionId = column.options && column.options[0] ? column.options[0].id : '';
    actionState.customValue = '';
    actionState.saving = false;
    renderActionModal();
  }

  function closeActionModal() {
    actionState.open = false;
    actionState.rowIndex = -1;
    actionState.columnKey = '';
    actionState.selectedOptionId = '';
    actionState.customValue = '';
    actionState.saving = false;
    renderActionModal();
  }

  function calcDelta(column) {
    if (!column) return null;
    if (column.mode === 'fixed') return asInt(column.points);
    if (column.mode === 'select') {
      var option = (column.options || []).find(function (o) { return o.id === actionState.selectedOptionId; });
      if (!option) return null;
      return asInt(option.points);
    }
    if (column.mode === 'number') {
      var n = Number(actionState.customValue);
      if (!isFinite(n)) return null;
      return Math.trunc(n);
    }
    if (column.mode === 'penalty') {
      var p = Number(actionState.customValue);
      if (!isFinite(p)) return null;
      return Math.abs(Math.trunc(p));
    }
    return null;
  }

  function showActionError(text) {
    var msgEl = document.getElementById('pixelsActionMsg');
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.className = 'students-msg students-msg--err';
  }

  async function confirmAction() {
    var row = rows[actionState.rowIndex];
    var column = CRITERIA_COLUMNS.find(function (c) { return c.key === actionState.columnKey; });
    if (!row || !column) return;
    var studentId = getStudentId(row);
    if (!studentId) {
      showActionError('Не найден id ученика для сохранения.');
      return;
    }
    var delta = calcDelta(column);
    if (delta == null) {
      if (column.mode === 'number') {
        showActionError('Введите корректное число пикселей.');
      } else if (column.mode === 'penalty') {
        showActionError('Введите корректный размер штрафа.');
      }
      return;
    }
    var updated = Object.assign({}, row);
    updated[column.key] = getEditablePixelValue(updated, column.key) + delta;
    var payload = { id_student: studentId, id: studentId };
    EDITABLE_PIXEL_KEYS.forEach(function (key) {
      payload[key] = getEditablePixelValue(updated, key);
    });

    actionState.saving = true;
    renderActionModal();
    try {
      await apiRequest('PUT', API.GROUPS.PIXELS_UPDATE, payload);
      rows[actionState.rowIndex] = updated;
      renderTable();
      setMsg('Пиксели начислены: ' + getStudentName(updated) + ' / ' + column.label + '.', 'ok');
      closeActionModal();
    } catch (err) {
      actionState.saving = false;
      renderActionModal();
      var msgEl = document.getElementById('pixelsActionMsg');
      if (msgEl) {
        msgEl.textContent = (err && err.message) || 'Не удалось сохранить пиксели.';
        msgEl.className = 'students-msg students-msg--err';
      }
    }
  }

  function renderActionModal() {
    var modal = document.getElementById('pixelsActionModal');
    var body = document.getElementById('pixelsActionBody');
    if (!modal || !body) return;
    if (!actionState.open) {
      modal.hidden = true;
      body.innerHTML = '';
      return;
    }
    var row = rows[actionState.rowIndex];
    var column = CRITERIA_COLUMNS.find(function (c) { return c.key === actionState.columnKey; });
    if (!row || !column) {
      modal.hidden = true;
      body.innerHTML = '';
      return;
    }

    var detailsHtml = '';
    if (column.mode === 'fixed') {
      detailsHtml = '<div class="pixels-action-note">Начислить <b>+' + escapeHtml(String(column.points)) + '</b> пикселей.</div>';
    } else if (column.mode === 'select') {
      detailsHtml = '<div class="pixels-action-options">' + (column.options || []).map(function (opt) {
        var checked = actionState.selectedOptionId === opt.id ? ' checked' : '';
        return '<label class="pixels-action-option">' +
          '<input type="radio" name="pixelsActionOption" value="' + escapeHtmlAttr(String(opt.id)) + '"' + checked + '>' +
          '<span>' + escapeHtml(opt.label) + '</span>' +
          '</label>';
      }).join('') + '</div>';
    } else if (column.mode === 'number') {
      detailsHtml = '<label class="pixels-action-input-wrap">' +
        '<span>Введите количество пикселей</span>' +
        '<input type="number" id="pixelsActionNumber" class="groups-edit-input" value="' + escapeHtmlAttr(String(actionState.customValue || '')) + '" placeholder="Например, 25">' +
        '</label>';
    } else if (column.mode === 'penalty') {
      detailsHtml = '<label class="pixels-action-input-wrap">' +
        '<span>Введите размер штрафа (будет вычтен)</span>' +
        '<input type="number" id="pixelsActionNumber" class="groups-edit-input" value="' + escapeHtmlAttr(String(actionState.customValue || '')) + '" placeholder="Например, 15">' +
        '</label>';
    }

    body.innerHTML =
      '<p class="groups-modal-subtitle">Начислить пиксели ученику <b>' + escapeHtml(getStudentName(row)) + '</b> по критерию <b>' + escapeHtml(column.label) + '</b>?</p>' +
      detailsHtml +
      '<div class="students-msg" id="pixelsActionMsg"></div>' +
      '<div class="groups-transfer-bottom groups-transfer-bottom--right">' +
      '<button type="button" class="groups-edit-del" id="pixelsActionCancel">Отмена</button>' +
      '<button type="button" class="groups-edit-save" id="pixelsActionConfirm"' + (actionState.saving ? ' disabled' : '') + '>Подтвердить</button>' +
      '</div>';
    modal.hidden = false;

    body.querySelectorAll('input[name="pixelsActionOption"]').forEach(function (input) {
      input.addEventListener('change', function () {
        actionState.selectedOptionId = input.value;
      });
    });
    var numberInput = document.getElementById('pixelsActionNumber');
    if (numberInput) {
      numberInput.addEventListener('input', function () {
        actionState.customValue = numberInput.value;
      });
    }
    var cancelBtn = document.getElementById('pixelsActionCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeActionModal);
    var confirmBtn = document.getElementById('pixelsActionConfirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        confirmAction().catch(function () {});
      });
    }
  }

  async function loadGroups() {
    var res = await apiRequest('GET', API.GROUPS.LIST);
    var list = unwrapResponse(res);
    groups = Array.isArray(list) ? list : [];
    groups.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'ru'); });
    if (!groups.length) {
      selectedGroupId = null;
      return;
    }
    var hasSelected = groups.some(function (g) { return String(g.id) === String(selectedGroupId); });
    if (!hasSelected) selectedGroupId = groups[0].id;
  }

  function rememberBestAttendancePercent(id, name, percent) {
    var n = Math.max(0, Math.min(100, asInt(percent)));
    if (id != null) {
      var idKey = String(id);
      attendancePercentByStudentId[idKey] = Math.max(attendancePercentByStudentId[idKey] || 0, n);
    }
    var nameKey = normalizeStudentNameKey(name);
    if (nameKey) {
      attendancePercentByStudentName[nameKey] = Math.max(attendancePercentByStudentName[nameKey] || 0, n);
    }
  }

  function buildGroupAttendancePercents(attendanceRows) {
    var dates = {};
    var presentByStudent = {};
    var nameByStudent = {};
    attendanceRows.forEach(function (row) {
      var date = String(row && row.date_of_lesson || '').trim();
      if (!date) return;
      dates[date] = true;
      var sid = getStudentId(row);
      var studentName = getAttendanceStudentName(row);
      var key = sid != null ? ('id:' + String(sid)) : ('name:' + normalizeStudentNameKey(studentName));
      if (!key || key === 'name:') return;
      nameByStudent[key] = studentName;
      if (!presentByStudent[key]) presentByStudent[key] = 0;
      if (Number(row && row.presence) === 1) presentByStudent[key] += 1;
    });
    var totalDates = Object.keys(dates).length;
    if (!totalDates) return;
    Object.keys(presentByStudent).forEach(function (key) {
      var percent = Math.round((presentByStudent[key] / totalDates) * 100);
      var id = key.indexOf('id:') === 0 ? key.slice(3) : null;
      rememberBestAttendancePercent(id, nameByStudent[key], percent);
    });
  }

  async function loadAttendancePercentIndex() {
    attendancePercentByStudentId = {};
    attendancePercentByStudentName = {};
    var targetGroups = groups.length ? groups : [];
    for (var i = 0; i < targetGroups.length; i++) {
      /* eslint-disable no-await-in-loop */
      try {
        var res = await apiRequest('GET', API.ATTENDANCE.BY_GROUP(targetGroups[i].id));
        var attendanceRows = unwrapResponse(res);
        buildGroupAttendancePercents(Array.isArray(attendanceRows) ? attendanceRows : []);
      } catch (err) {
        console.warn('[pixels] attendance percent by group', targetGroups[i] && targetGroups[i].id, err);
      }
      /* eslint-enable no-await-in-loop */
    }
  }

  function applyAttendancePercentsToRows() {
    rows = rows.map(withAttendancePercent);
  }

  function withAttendancePercent(row) {
      var sid = getStudentId(row);
      var byId = sid != null ? attendancePercentByStudentId[String(sid)] : null;
      var byName = attendancePercentByStudentName[normalizeStudentNameKey(getStudentName(row))];
      var percent = Math.max(asInt(byId), asInt(byName));
      return Object.assign({}, row, { __attendancePercent: percent });
  }

  async function loadPixelsForSelected() {
    var g = selectedGroup();
    if (!g) {
      rows = [];
      renderTable();
      return;
    }
    loading = true;
    renderTable();
    try {
      var pair = await Promise.all([
        apiRequest('GET', API.GROUPS.PIXELS_BY_GROUP(g.id)),
        loadAttendancePercentIndex()
      ]);
      var list = unwrapResponse(pair[0]);
      rows = Array.isArray(list) ? list : [];
      applyAttendancePercentsToRows();
      setMsg('');
    } catch (err) {
      rows = [];
      setMsg((err && err.message) || 'Не удалось загрузить пиксели.', 'err');
    } finally {
      loading = false;
      renderTable();
    }
  }

  function rowToExport(groupName, row) {
    var attendancePercent = getAttendancePercent(row);
    var out = {
      group: groupName || '—',
      studentId: getStudentId(row),
      studentName: getStudentName(row),
      attendancePercent: attendancePercent,
      attendance: attendancePercentToPoints(attendancePercent),
      total: computeTotal(row)
    };
    EDITABLE_PIXEL_KEYS.forEach(function (key) {
      out[key] = getEditablePixelValue(row, key);
    });
    return out;
  }

  function exportHeaders(includeGroup) {
    var head = [];
    if (includeGroup) head.push('Группа');
    head.push('Фамилия Имя ученика');
    CRITERIA_COLUMNS.forEach(function (c) {
      head.push(c.label);
    });
    return head;
  }

  function exportValues(item, includeGroup) {
    var values = [];
    if (includeGroup) values.push(item.group);
    values.push(item.studentName);
    CRITERIA_COLUMNS.forEach(function (c) {
      if (c.key === '__attendance_percent__') {
        values.push(String(item.attendancePercent) + '%');
        return;
      }
      if (c.key === '__attendance__') {
        values.push(item.attendance);
        return;
      }
      if (c.key === '__total__') {
        values.push(item.total);
        return;
      }
      values.push(item[c.key] || 0);
    });
    return values;
  }

  async function exportCurrentGroupExcel() {
    var g = selectedGroup();
    if (!g) {
      setMsg('Сначала выберите группу.', 'err');
      return;
    }
    if (!rows.length) {
      setMsg('В группе нет данных для выгрузки.', 'err');
      return;
    }
    await runWithBusy('Формируем отчет по группе...', async function () {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Пиксели');
      ws.addRow(exportHeaders(false));
      applyHeaderStyle(ws.getRow(1));
      rows.forEach(function (r, idx) {
        var row = ws.addRow(exportValues(rowToExport(g.name || '—', r), false));
        applyDataStyle(row, idx % 2 === 1);
      });
      ws.columns.forEach(function (c, i) {
        c.width = i === 0 ? 28 : 18;
      });
      var buffer = await wb.xlsx.writeBuffer();
      await saveExcel(buffer, sanitizeFilename('Пиксели_' + (g.name || 'Группа')) + '.xlsx');
    });
  }

  async function exportAllStudentsExcel() {
    if (!groups.length) {
      setMsg('Список групп пуст.', 'err');
      return;
    }
    await loadAttendancePercentIndex();
    var bestByStudent = {};
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var list = [];
      try {
        var res = await apiRequest('GET', API.GROUPS.PIXELS_BY_GROUP(g.id));
        list = unwrapResponse(res);
      } catch (_) {
        list = [];
      }
      list = Array.isArray(list) ? list : [];
      for (var j = 0; j < list.length; j++) {
        var item = rowToExport(g.name || '—', withAttendancePercent(list[j]));
        var key = item.studentId != null ? ('id:' + String(item.studentId)) : ('name:' + item.studentName.toLowerCase());
        var existing = bestByStudent[key];
        if (!existing || item.total > existing.total) {
          bestByStudent[key] = item;
        }
      }
    }
    var exportList = Object.keys(bestByStudent).map(function (k) { return bestByStudent[k]; });
    exportList.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      return String(a.studentName || '').localeCompare(String(b.studentName || ''), 'ru');
    });
    if (!exportList.length) {
      setMsg('Нет данных по пикселям для выгрузки.', 'err');
      return;
    }
    await runWithBusy('Формируем общий отчет по пикселям...', async function () {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Все ученики');
      ws.addRow(exportHeaders(true));
      applyHeaderStyle(ws.getRow(1));
      exportList.forEach(function (item, idx) {
        var row = ws.addRow(exportValues(item, true));
        applyDataStyle(row, idx % 2 === 1);
      });
      ws.columns.forEach(function (c, i) {
        c.width = i < 2 ? 28 : 18;
      });
      var buffer = await wb.xlsx.writeBuffer();
      await saveExcel(buffer, 'Пиксели_все_ученики.xlsx');
    });
  }

  async function clearAllPixels() {
    try {
      await apiRequest('POST', API.GROUPS.PIXELS_CLEAR_ALL, {});
      return;
    } catch (err) {
      if (!err || Number(err.status) !== 404) throw err;
    }
    for (var i = 0; i < groups.length; i++) {
      /* eslint-disable no-await-in-loop */
      var g = groups[i];
      var res = await apiRequest('GET', API.GROUPS.PIXELS_BY_GROUP(g.id));
      var list = unwrapResponse(res);
      list = Array.isArray(list) ? list : [];
      for (var j = 0; j < list.length; j++) {
        var row = list[j];
        var sid = getStudentId(row);
        if (!sid) continue;
        var payload = { id_student: sid, id: sid };
        EDITABLE_PIXEL_KEYS.forEach(function (key) { payload[key] = 0; });
        await apiRequest('PUT', API.GROUPS.PIXELS_UPDATE, payload);
      }
      /* eslint-enable no-await-in-loop */
    }
  }

  function renderClearConfirmModal() {
    var modal = document.getElementById('pixelsClearModal');
    var body = document.getElementById('pixelsClearModalBody');
    if (!modal || !body) return;
    if (!clearConfirmOpen) {
      modal.hidden = true;
      body.innerHTML = '';
      return;
    }
    body.innerHTML =
      '<div class="groups-danger-warning">' +
      '<h5 class="groups-danger-warning__title">ВНИМАНИЕ: НЕОБРАТИМОЕ ДЕЙСТВИЕ</h5>' +
      '<p class="groups-danger-warning__text">Вы собираетесь очистить <b>все пиксели</b> у всех учеников.</p>' +
      '<p class="groups-danger-warning__text">Эти данные нельзя восстановить автоматически.</p>' +
      '</div>' +
      '<div class="students-msg" id="pixelsClearMsg"></div>' +
      '<div class="groups-transfer-bottom groups-transfer-bottom--right">' +
      '<button type="button" class="groups-edit-del" id="pixelsClearCancel">Отмена</button>' +
      '<button type="button" class="groups-edit-save" id="pixelsClearApply">Понимаю, очистить</button>' +
      '</div>';
    modal.hidden = false;
    var cancelBtn = document.getElementById('pixelsClearCancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        clearConfirmOpen = false;
        renderClearConfirmModal();
      });
    }
    var applyBtn = document.getElementById('pixelsClearApply');
    var msgEl = document.getElementById('pixelsClearMsg');
    if (applyBtn) {
      applyBtn.disabled = !!clearInProgress;
      applyBtn.addEventListener('click', async function () {
        if (clearInProgress) return;
        clearInProgress = true;
        applyBtn.disabled = true;
        if (msgEl) {
          msgEl.textContent = 'Очистка пикселей...';
          msgEl.className = 'students-msg';
        }
        try {
          await clearAllPixels();
          await loadPixelsForSelected();
          clearConfirmOpen = false;
          renderClearConfirmModal();
          setMsg('Все пиксели очищены.', 'ok');
        } catch (err) {
          if (msgEl) {
            msgEl.textContent = (err && err.message) || 'Не удалось очистить пиксели.';
            msgEl.className = 'students-msg students-msg--err';
          }
        } finally {
          clearInProgress = false;
          var btn = document.getElementById('pixelsClearApply');
          if (btn) btn.disabled = false;
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
    container.innerHTML = [
      '<div class="pixels-view">',
      '  <div class="pixels-toolbar">',
      '    <div class="groups-search-wrap pixels-search-wrap">',
      '      <select id="pixelsGroupSelect" class="search-input groups-search-input">' + groupSelectOptions + '</select>',
      '    </div>',
      '    <button type="button" class="excel-btn" id="pixelsExcelGroup" aria-label="Скачать пиксели группы">' + excelIcon + '<span class="excel-btn__text">Скачать группу</span></button>',
      '    <button type="button" class="excel-btn" id="pixelsExcelAll" aria-label="Скачать всех учеников">' + excelIcon + '<span class="excel-btn__text">Скачать всех учеников</span></button>',
      canDangerActions ? '    <button type="button" class="groups-edit-del" id="pixelsClearAllBtn">Очистить пиксели</button>' : '',
      '  </div>',
      '  <div class="students-msg" id="pixelsMsg"></div>',
      '  <div class="pixels-table-wrap" id="pixelsTableWrap"></div>',
      '  <div class="groups-modal-overlay" id="pixelsActionModal" hidden>',
      '    <div class="groups-modal-dialog pixels-action-dialog" role="dialog" aria-modal="true" aria-labelledby="pixelsActionTitle">',
      '      <div class="groups-modal-head">',
      '        <h4 class="groups-modal-title" id="pixelsActionTitle">Начисление пикселей</h4>',
      '        <button type="button" class="groups-modal-close" id="pixelsActionClose" aria-label="Закрыть">&times;</button>',
      '      </div>',
      '      <div class="groups-modal-body" id="pixelsActionBody"></div>',
      '    </div>',
      '  </div>',
      '  <div class="groups-modal-overlay" id="pixelsClearModal" hidden>',
      '    <div class="groups-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="pixelsClearTitle">',
      '      <div class="groups-modal-head">',
      '        <h4 class="groups-modal-title" id="pixelsClearTitle">Очистка пикселей</h4>',
      '        <button type="button" class="groups-modal-close" id="pixelsClearClose" aria-label="Закрыть">&times;</button>',
      '      </div>',
      '      <div class="groups-modal-body" id="pixelsClearModalBody"></div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');

    renderTable();
    renderActionModal();
    renderClearConfirmModal();
    wire();
  }

  function wire() {
    var groupSelect = document.getElementById('pixelsGroupSelect');
    if (groupSelect) {
      groupSelect.addEventListener('change', function () {
        selectedGroupId = groupSelect.value ? parseInt(groupSelect.value, 10) : null;
        if (selectedGroupId == null || isNaN(selectedGroupId)) selectedGroupId = null;
        rows = [];
        renderTable();
        loadPixelsForSelected().catch(function (err) {
          setMsg((err && err.message) || 'Не удалось загрузить пиксели.', 'err');
        });
      });
    }

    var groupBtn = document.getElementById('pixelsExcelGroup');
    if (groupBtn) {
      groupBtn.addEventListener('click', function () {
        exportCurrentGroupExcel().catch(function (err) {
          setMsg((err && err.message) || 'Не удалось скачать файл группы.', 'err');
        });
      });
    }
    var allBtn = document.getElementById('pixelsExcelAll');
    if (allBtn) {
      allBtn.addEventListener('click', function () {
        exportAllStudentsExcel().catch(function (err) {
          setMsg((err && err.message) || 'Не удалось скачать файл всех учеников.', 'err');
        });
      });
    }
    var clearBtn = document.getElementById('pixelsClearAllBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        clearConfirmOpen = true;
        renderClearConfirmModal();
      });
    }

    var modal = document.getElementById('pixelsActionModal');
    var closeBtn = document.getElementById('pixelsActionClose');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeActionModal();
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', closeActionModal);
    var clearModal = document.getElementById('pixelsClearModal');
    var clearClose = document.getElementById('pixelsClearClose');
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
  }

  (async function init() {
    container.innerHTML = '<div class="pixels-view"><div class="events-loading">Загрузка пикселей...</div></div>';
    try {
      var user = await ipcRenderer.invoke('get-user');
      canDangerActions = hasDangerAccess(user);
      await loadGroups();
      render();
      await loadPixelsForSelected();
    } catch (err) {
      container.innerHTML = '<p class="content-error">Не удалось загрузить пиксели: ' + escapeHtml((err && err.message) || 'ошибка') + '</p>';
    }
  })();
};
