'use strict';

const { ipcRenderer } = require('electron');
const { apiRequest, unwrapResponse } = require('./api-client.js');
const API = require('./api-paths.js');
const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');
const { saveExcel, applyHeaderStyle } = require('./shared-utils.js');

const ADMIN_ACCESS_LEVELS = [1, 4, 6];
const MENU_ROLE_KEYS = ['root', 'admin', 'administrator', 'manager', 'руководитель'];
const IMPORT_HEADERS = [
  'Почта',
  'Фамилия Родителя',
  'Имя Родителя',
  'Отчество Родителя',
  'Телефон',
  'Фамилия ученика',
  'Имя ученика',
  'Отчество ученика',
  'Д.Р.',
  'Группа',
  'Новигатор'
];

function hasStudentsManageAccess(user) {
  if (!user || typeof user !== 'object') return false;
  var level = user.accessLevel != null ? user.accessLevel : user.access_level_id;
  var n = Number(level);
  if (!isNaN(n) && ADMIN_ACCESS_LEVELS.indexOf(n) >= 0) return true;
  var roleRaw = user.role || user.role_name || user.access_name || user.accessName || '';
  var role = String(roleRaw).trim().toLowerCase();
  if (!role) return false;
  return MENU_ROLE_KEYS.some(function (key) { return role.indexOf(key) >= 0; });
}

function studentFullName(student) {
  return [student && student.surname, student && student.name, student && student.patronymic]
    .filter(Boolean)
    .join(' ')
    .trim() || '—';
}

function studentMeta(student) {
  var parts = [];
  if (student && student.birthDay) parts.push('ДР: ' + String(student.birthDay));
  if (student && student.phone) parts.push('Тел: ' + String(student.phone));
  if (student && student.email) parts.push(String(student.email));
  return parts.join(' • ') || 'Без доп. данных';
}

function asTrimmed(value) {
  return String(value == null ? '' : value).trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatIsoDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function parseAnyDateToIso(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return formatIsoDate(v);
  if (typeof v === 'number' && isFinite(v)) {
    var ms = Math.round((v - 25569) * 86400 * 1000);
    return formatIsoDate(new Date(ms));
  }
  var s = String(v).trim();
  if (!s) return '';
  var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;
  var dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (dmy) return dmy[3] + '-' + pad2(dmy[2]) + '-' + pad2(dmy[1]);
  var dateParsed = new Date(s);
  if (!isNaN(dateParsed.getTime())) return formatIsoDate(dateParsed);
  return '';
}

function normalizeNavigator(value) {
  if (value == null) return 0;
  if (value === true || value === 1) return 1;
  var s = String(value).trim().toLowerCase();
  if (!s) return 0;
  if (s === '1' || s === 'true' || s === 'да' || s === 'yes' || s === 'y' || s === '☑' || s === '✓') return 1;
  return 0;
}

function normalizePhoneForApi(value) {
  var digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits[0] === '8') digits = '7' + digits.slice(1);
  if (digits.length !== 11 || digits[0] !== '7') return '';
  return '+7 (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7, 9) + '-' + digits.slice(9, 11);
}

function normalizePhoneInputValue(value) {
  var digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits[0] === '8') digits = '7' + digits.slice(1);
  if (digits[0] !== '7') digits = '7' + digits;
  digits = digits.slice(0, 11);
  var out = '+7';
  if (digits.length > 1) out += ' (' + digits.slice(1, 4);
  if (digits.length >= 4) out += ')';
  if (digits.length > 4) out += ' ' + digits.slice(4, 7);
  if (digits.length > 7) out += '-' + digits.slice(7, 9);
  if (digits.length > 9) out += '-' + digits.slice(9, 11);
  return out;
}

function normalizeHeaderName(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[.\-_]/g, '')
    .replace(/\s+/g, '');
}

function buildImportHeaderMap(headersRow) {
  var byNorm = {};
  headersRow.forEach(function (name, idx) {
    var k = normalizeHeaderName(name);
    if (k) byNorm[k] = idx;
  });
  return {
    email: byNorm[normalizeHeaderName('Почта')],
    parentSurname: byNorm[normalizeHeaderName('Фамилия Родителя')],
    parentName: byNorm[normalizeHeaderName('Имя Родителя')],
    parentPatronymic: byNorm[normalizeHeaderName('Отчество Родителя')],
    phone: byNorm[normalizeHeaderName('Телефон')],
    surname: byNorm[normalizeHeaderName('Фамилия ученика')],
    name: byNorm[normalizeHeaderName('Имя ученика')],
    patronymic: byNorm[normalizeHeaderName('Отчество ученика')],
    birthDay: byNorm[normalizeHeaderName('Д.Р.')],
    group: byNorm[normalizeHeaderName('Группа')],
    navigator: byNorm[normalizeHeaderName('Новигатор')] != null
      ? byNorm[normalizeHeaderName('Новигатор')]
      : byNorm[normalizeHeaderName('Навигатор')]
  };
}

function getFormPayload(formEl) {
  var phoneMasked = normalizePhoneForApi(formEl.phone.value);
  return {
    surname: asTrimmed(formEl.surname.value),
    name: asTrimmed(formEl.name.value),
    patronymic: asTrimmed(formEl.patronymic.value),
    birthDay: asTrimmed(formEl.birthDay.value),
    navigator: formEl.navigator && formEl.navigator.checked ? 1 : 0,
    parentSurname: asTrimmed(formEl.parentSurname.value),
    parentName: asTrimmed(formEl.parentName.value),
    parentPatronymic: asTrimmed(formEl.parentPatronymic.value),
    email: asTrimmed(formEl.email.value),
    phone: phoneMasked
  };
}

module.exports = function renderStudentsView(container) {
  if (!container) return;

  var students = [];
  var groups = [];
  var query = '';
  var msg = { text: '', kind: '' };
  var canManage = false;
  var menuOpen = false;
  var importInProgress = false;
  var studentGroupsById = {};
  var groupsLoadingById = {};
  var listRenderToken = 0;

  function studentActiveGroupCount(student) {
    var n = Number(student && student.isActive);
    return isNaN(n) ? 0 : n;
  }

  function setMsg(text, kind) {
    msg = { text: text || '', kind: kind || '' };
    var el = document.getElementById('studentsMsg');
    if (!el) return;
    el.textContent = msg.text;
    el.className = 'students-msg' + (msg.kind ? ' students-msg--' + msg.kind : '');
  }

  function setImportProgress(current, total, label) {
    var wrap = document.getElementById('studentsImportProgress');
    var bar = document.getElementById('studentsImportProgressBar');
    var text = document.getElementById('studentsImportProgressText');
    if (!wrap || !bar || !text) return;
    if (!importInProgress) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    var ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
    bar.style.width = Math.round(ratio * 100) + '%';
    text.textContent = (label || 'Обработка...') + ' ' + current + '/' + total;
  }

  function studentIdentityKey(data) {
    return [
      asTrimmed(data.surname).toLowerCase(),
      asTrimmed(data.name).toLowerCase(),
      asTrimmed(data.patronymic).toLowerCase(),
      asTrimmed(data.birthDay)
    ].join('|');
  }

  function studentPayloadEquals(student, payload) {
    return asTrimmed(student.surname) === asTrimmed(payload.surname)
      && asTrimmed(student.name) === asTrimmed(payload.name)
      && asTrimmed(student.patronymic) === asTrimmed(payload.patronymic)
      && asTrimmed(student.birthDay) === asTrimmed(payload.birthDay)
      && Number(student.navigator ? 1 : 0) === Number(payload.navigator ? 1 : 0)
      && asTrimmed(student.parentSurname) === asTrimmed(payload.parentSurname)
      && asTrimmed(student.parentName) === asTrimmed(payload.parentName)
      && asTrimmed(student.parentPatronymic) === asTrimmed(payload.parentPatronymic)
      && asTrimmed(student.email) === asTrimmed(payload.email)
      && asTrimmed(normalizePhoneForApi(student.phone)) === asTrimmed(payload.phone);
  }

  async function ensureStudentInGroup(studentId, groupId, groupsCache) {
    var sid = String(studentId);
    if (!groupsCache[sid]) {
      var groupsRes = await apiRequest('GET', API.STUDENTS.GROUPS_BY_STUDENT(studentId));
      groupsCache[sid] = Array.isArray(unwrapResponse(groupsRes)) ? unwrapResponse(groupsRes) : [];
    }
    var has = groupsCache[sid].some(function (g) { return String(g.id) === String(groupId); });
    if (has) return;
    await apiRequest('POST', API.STUDENTS.ADD_TO_GROUP, { student_id: Number(studentId), group_id: Number(groupId) });
    groupsCache[sid].push({ id: Number(groupId) });
  }

  async function downloadImportTemplate() {
    const ExcelJS = require('exceljs');
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('Импорт учеников');
    ws.addRow(IMPORT_HEADERS);
    applyHeaderStyle(ws.getRow(1));
    ws.addRow(new Array(IMPORT_HEADERS.length).fill(''));
    for (var c = 1; c <= IMPORT_HEADERS.length; c++) ws.getColumn(c).width = 22;
    for (var r = 2; r <= 3000; r++) {
      var cell = ws.getCell(r, 11);
      cell.value = 0;
      cell.numFmt = '[=1]"☑";[=0]"☐";;';
      cell.dataValidation = { type: 'list', allowBlank: true, formulae: ['"0,1"'] };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    var buffer = await wb.xlsx.writeBuffer();
    await saveExcel(buffer, 'Шаблон_импорта_учеников.xlsx');
  }

  async function processImportWorkbook(fileBuffer) {
    const ExcelJS = require('exceljs');
    var wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fileBuffer);
    var ws = wb.worksheets[0];
    if (!ws) throw new Error('Файл не содержит листов.');

    var headerRow = ws.getRow(1);
    var headers = [];
    for (var c = 1; c <= ws.columnCount; c++) headers.push(headerRow.getCell(c).text || '');
    var map = buildImportHeaderMap(headers);
    var requiredMapKeys = ['email', 'parentSurname', 'parentName', 'parentPatronymic', 'phone', 'surname', 'name', 'patronymic', 'birthDay', 'group', 'navigator'];
    for (var i = 0; i < requiredMapKeys.length; i++) {
      if (map[requiredMapKeys[i]] == null) throw new Error('В шаблоне отсутствует столбец: ' + IMPORT_HEADERS[i]);
    }

    var groupByName = {};
    groups.forEach(function (g) { groupByName[String(g.name || '').trim().toLowerCase()] = g; });

    var existingByKey = {};
    students.forEach(function (s) { existingByKey[studentIdentityKey(s)] = s; });
    var studentGroupsCache = {};

    var workRows = [];
    ws.eachRow(function (row, rowNum) {
      if (rowNum === 1) return;
      var raw = {
        email: row.getCell(map.email + 1).value,
        parentSurname: row.getCell(map.parentSurname + 1).value,
        parentName: row.getCell(map.parentName + 1).value,
        parentPatronymic: row.getCell(map.parentPatronymic + 1).value,
        phone: row.getCell(map.phone + 1).value,
        surname: row.getCell(map.surname + 1).value,
        name: row.getCell(map.name + 1).value,
        patronymic: row.getCell(map.patronymic + 1).value,
        birthDay: row.getCell(map.birthDay + 1).value,
        group: row.getCell(map.group + 1).value,
        navigator: row.getCell(map.navigator + 1).value
      };
      var payload = {
        surname: asTrimmed(raw.surname),
        name: asTrimmed(raw.name),
        patronymic: asTrimmed(raw.patronymic),
        birthDay: parseAnyDateToIso(raw.birthDay),
        navigator: normalizeNavigator(raw.navigator),
        parentSurname: asTrimmed(raw.parentSurname),
        parentName: asTrimmed(raw.parentName),
        parentPatronymic: asTrimmed(raw.parentPatronymic),
        email: asTrimmed(raw.email),
        phone: normalizePhoneForApi(raw.phone)
      };
      var groupName = asTrimmed(raw.group);
      var rowHasData = Object.keys(payload).some(function (k) { return String(payload[k] || '').trim() !== ''; }) || !!groupName;
      if (!rowHasData) return;
      workRows.push({ rowNum: rowNum, payload: payload, groupName: groupName });
    });

    var errors = [];
    importInProgress = true;
    setImportProgress(0, workRows.length, 'Подготовка');
    try {
      for (var r = 0; r < workRows.length; r++) {
        var item = workRows[r];
        setImportProgress(r + 1, workRows.length, 'Обработка строки');
        try {
          var p = item.payload;
          var required = ['surname', 'name', 'patronymic', 'birthDay', 'parentSurname', 'parentName', 'parentPatronymic', 'email', 'phone'];
          var missing = required.filter(function (k) { return !asTrimmed(p[k]); });
          if (missing.length) throw new Error('Не заполнены обязательные поля: ' + missing.join(', '));
          if (!item.groupName) throw new Error('Не указана группа.');
          var g = groupByName[item.groupName.toLowerCase()];
          if (!g) throw new Error('Группа "' + item.groupName + '" не найдена.');

          var key = studentIdentityKey(p);
          var existing = existingByKey[key];
          var studentId = null;
          if (!existing) {
            var createdRes = await apiRequest('POST', API.STUDENTS.ROOT, p);
            var created = unwrapResponse(createdRes) || {};
            studentId = parseInt(created.id, 10);
            if (isNaN(studentId) || studentId <= 0) throw new Error('Не удалось получить id созданного ученика.');
            var fullStudent = Object.assign({ id: studentId }, p, { isActive: 0 });
            students.push(fullStudent);
            existingByKey[key] = fullStudent;
          } else {
            studentId = parseInt(existing.id, 10);
            if (isNaN(studentId) || studentId <= 0) throw new Error('Некорректный id существующего ученика.');
            if (!studentPayloadEquals(existing, p)) {
              await apiRequest('PUT', API.STUDENTS.ROOT, Object.assign({ id: studentId }, p));
              Object.assign(existing, p);
            }
          }
          await ensureStudentInGroup(studentId, g.id, studentGroupsCache);
        } catch (err) {
          errors.push('Строка ' + item.rowNum + ': ' + ((err && err.message) || 'неизвестная ошибка'));
        }
      }
      await Promise.all([loadStudents(), loadGroups()]);
      renderList();
      if (!errors.length) {
        setMsg('Импорт завершён успешно. Обработано строк: ' + workRows.length + '.', 'ok');
        return;
      }
      setMsg(
        'Импорт завершён с ошибками. Успешно: ' + (workRows.length - errors.length) + ' из ' + workRows.length + '.\n' + errors.join('\n'),
        'err'
      );
    } finally {
      importInProgress = false;
      setImportProgress(0, 0, '');
    }
  }

  function renderList() {
    var listEl = document.getElementById('studentsList');
    if (!listEl) return;
    listRenderToken += 1;
    var renderToken = listRenderToken;
    var q = String(query || '').trim().toLowerCase();
    var filtered = students.filter(function (s) {
      if (!q) return true;
      return studentFullName(s).toLowerCase().indexOf(q) >= 0;
    });
    filtered.sort(function (a, b) {
      if (q) {
        var aActive = studentActiveGroupCount(a) > 0 ? 1 : 0;
        var bActive = studentActiveGroupCount(b) > 0 ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
      }
      return studentFullName(a).localeCompare(studentFullName(b), 'ru');
    });
    if (!filtered.length) {
      listEl.innerHTML = '<div class="students-empty">Ученики не найдены.</div>';
      return;
    }
    listEl.innerHTML = filtered.map(function (s) {
      var sid = String(s.id);
      var activeCount = studentActiveGroupCount(s);
      var groupsHtml = '';
      if (activeCount <= 0) {
        groupsHtml = '<span class="student-group-tag student-group-tag--empty">Без группы</span>';
      } else if (Array.isArray(studentGroupsById[sid])) {
        groupsHtml = studentGroupsById[sid].map(function (g) {
          return '<span class="student-group-tag">' + escapeHtml(String(g.name || '—')) + '</span>';
        }).join('') || '<span class="student-group-tag student-group-tag--empty">Без группы</span>';
      } else if (groupsLoadingById[sid]) {
        groupsHtml = '<span class="student-group-loading">Загрузка групп...</span>';
      } else {
        groupsHtml = '<span class="student-group-loading">Группы загружаются...</span>';
      }

      return '<article class="student-card">' +
        '<div class="student-card__main">' +
        '<h3 class="student-card__name">' + escapeHtml(studentFullName(s)) + '</h3>' +
        '<p class="student-card__meta">' + escapeHtml(studentMeta(s)) + '</p>' +
        '<div class="student-card__groups" data-groups-for="' + escapeHtmlAttr(sid) + '">' + groupsHtml + '</div>' +
        '</div>' +
        '<button type="button" class="student-card__edit" data-action="edit" data-id="' + escapeHtmlAttr(sid) + '">Редактировать</button>' +
        '</article>';
    }).join('');
    listEl.querySelectorAll('[data-action="edit"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.getAttribute('data-id'), 10);
        if (isNaN(id) || id <= 0) return;
        openStudentModal('edit', id).catch(function (err) {
          setMsg((err && err.message) || 'Не удалось открыть форму редактирования.', 'err');
        });
      });
    });

    hydrateVisibleGroups(filtered, renderToken);
  }

  async function hydrateVisibleGroups(list, renderToken) {
    var idsToLoad = list
      .filter(function (s) {
        var sid = String(s.id);
        return studentActiveGroupCount(s) > 0 && !Array.isArray(studentGroupsById[sid]) && !groupsLoadingById[sid];
      })
      .map(function (s) { return String(s.id); });
    if (!idsToLoad.length) return;

    idsToLoad.forEach(function (sid) { groupsLoadingById[sid] = true; });
    await Promise.all(idsToLoad.map(async function (sid) {
      try {
        var res = await apiRequest('GET', API.STUDENTS.GROUPS_BY_STUDENT(sid));
        var rows = unwrapResponse(res);
        studentGroupsById[sid] = Array.isArray(rows) ? rows : [];
      } catch (_) {
        studentGroupsById[sid] = [];
      } finally {
        groupsLoadingById[sid] = false;
      }
    }));
    if (renderToken === listRenderToken) renderList();
  }

  function closeModal() {
    var overlay = document.getElementById('studentFormModal');
    var body = document.getElementById('studentFormModalBody');
    if (!overlay || !body) return;
    overlay.hidden = true;
    body.innerHTML = '';
  }

  function render() {
    container.innerHTML = [
      '<div class="students-view">',
      '  <div class="students-toolbar">',
      canManage ? '    <div class="students-menu-wrap"><button type="button" class="students-menu-btn" id="studentsMenuBtn" aria-haspopup="menu" aria-expanded="' + (menuOpen ? 'true' : 'false') + '">☰ Меню</button><div class="students-menu-dd" id="studentsMenuDd" ' + (menuOpen ? '' : 'hidden') + '><button type="button" class="students-menu-item" data-cmd="import">Импортировать учеников</button><button type="button" class="students-menu-item" data-cmd="template">Скачать шаблон импортирования</button></div></div>' : '',
      '    <input id="studentsSearchInput" class="search-input students-search-input" type="text" placeholder="Поиск по ученикам..." value="' + escapeHtmlAttr(query) + '">',
      '    <button type="button" id="studentsCreateBtn" class="students-create-btn">Создать</button>',
      '  </div>',
      '  <input type="file" id="studentsImportInput" accept=".xlsx,.xlsm,.xls" hidden>',
      '  <div class="students-msg" id="studentsMsg"></div>',
      '  <div class="students-import-progress" id="studentsImportProgress" hidden><div class="students-import-progress__track"><div class="students-import-progress__bar" id="studentsImportProgressBar"></div></div><div class="students-import-progress__text" id="studentsImportProgressText"></div></div>',
      '  <div class="students-list" id="studentsList"></div>',
      '  <div class="modal-overlay student-form-modal" id="studentFormModal" hidden>',
      '    <div class="student-form-dialog" role="dialog" aria-modal="true" aria-labelledby="studentFormTitle">',
      '      <div class="modal-header">',
      '        <h3 class="modal-title" id="studentFormTitle">Ученик</h3>',
      '        <button type="button" class="modal-close" id="studentFormClose" aria-label="Закрыть">&times;</button>',
      '      </div>',
      '      <div class="modal-body student-form-modal__body" id="studentFormModalBody"></div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');

    setMsg(msg.text, msg.kind);
    renderList();
    setImportProgress(0, 0, '');

    var searchInput = document.getElementById('studentsSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        query = searchInput.value;
        renderList();
      });
    }

    var createBtn = document.getElementById('studentsCreateBtn');
    if (createBtn) {
      createBtn.addEventListener('click', function () {
        openStudentModal('create').catch(function (err) {
          setMsg((err && err.message) || 'Не удалось открыть форму создания.', 'err');
        });
      });
    }

    var menuBtn = document.getElementById('studentsMenuBtn');
    var menuDd = document.getElementById('studentsMenuDd');
    var importInput = document.getElementById('studentsImportInput');
    if (menuBtn && menuDd) {
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        menuOpen = !menuOpen;
        menuDd.hidden = !menuOpen;
        menuBtn.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
      });
      menuDd.querySelectorAll('.students-menu-item').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var cmd = btn.getAttribute('data-cmd');
          menuOpen = false;
          menuDd.hidden = true;
          menuBtn.setAttribute('aria-expanded', 'false');
          if (cmd === 'template') {
            try {
              await downloadImportTemplate();
            } catch (err) {
              setMsg((err && err.message) || 'Не удалось скачать шаблон.', 'err');
            }
            return;
          }
          if (cmd === 'import' && importInput && !importInProgress) {
            importInput.value = '';
            importInput.click();
          }
        });
      });
      document.addEventListener('click', function (e) {
        if (!e.target.closest('.students-menu-wrap')) {
          menuOpen = false;
          menuDd.hidden = true;
          menuBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }
    if (importInput) {
      importInput.addEventListener('change', async function () {
        if (!importInput.files || !importInput.files[0]) return;
        if (importInProgress) return;
        try {
          var arrayBuffer = await importInput.files[0].arrayBuffer();
          await processImportWorkbook(Buffer.from(arrayBuffer));
        } catch (err) {
          importInProgress = false;
          setImportProgress(0, 0, '');
          setMsg((err && err.message) || 'Не удалось импортировать файл.', 'err');
        }
      });
    }

    var overlay = document.getElementById('studentFormModal');
    var closeBtn = document.getElementById('studentFormClose');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeModal();
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
  }

  function buildFormHtml(mode, data, groupIdForCreate) {
    var isCreate = mode === 'create';
    var title = isCreate ? 'Создать ученика' : 'Редактировать ученика';
    var groupOptions = ['<option value="">— Без группы —</option>'].concat(groups.map(function (g) {
      var selected = groupIdForCreate != null && String(g.id) === String(groupIdForCreate) ? ' selected' : '';
      return '<option value="' + escapeHtmlAttr(String(g.id)) + '"' + selected + '>' + escapeHtml(g.name || '—') + '</option>';
    })).join('');

    return {
      title: title,
      html:
        '<form id="studentForm" class="student-form">' +
        '<div class="student-form-grid">' +
        '<label class="student-form-field"><span>Фамилия *</span><input name="surname" class="student-form-input" required value="' + escapeHtmlAttr(data.surname || '') + '"></label>' +
        '<label class="student-form-field"><span>Имя *</span><input name="name" class="student-form-input" required value="' + escapeHtmlAttr(data.name || '') + '"></label>' +
        '<label class="student-form-field"><span>Отчество *</span><input name="patronymic" class="student-form-input" required value="' + escapeHtmlAttr(data.patronymic || '') + '"></label>' +
        '<label class="student-form-field"><span>Дата рождения *</span><input name="birthDay" type="date" class="student-form-input" required value="' + escapeHtmlAttr(data.birthDay || '') + '"></label>' +
        '<label class="student-form-field"><span>Фамилия родителя *</span><input name="parentSurname" class="student-form-input" required value="' + escapeHtmlAttr(data.parentSurname || '') + '"></label>' +
        '<label class="student-form-field"><span>Имя родителя *</span><input name="parentName" class="student-form-input" required value="' + escapeHtmlAttr(data.parentName || '') + '"></label>' +
        '<label class="student-form-field"><span>Отчество родителя *</span><input name="parentPatronymic" class="student-form-input" required value="' + escapeHtmlAttr(data.parentPatronymic || '') + '"></label>' +
        '<label class="student-form-field"><span>E-mail *</span><input name="email" type="email" class="student-form-input" required value="' + escapeHtmlAttr(data.email || '') + '"></label>' +
        '<label class="student-form-field"><span>Телефон *</span><input name="phone" class="student-form-input" type="tel" inputmode="tel" maxlength="18" placeholder="+7 (___) ___-__-__" required value="' + escapeHtmlAttr(data.phone || '') + '"></label>' +
        '<label class="student-form-field student-form-field--checkbox"><span>Навигатор</span><input name="navigator" type="checkbox" ' + (data.navigator ? 'checked' : '') + '></label>' +
        (isCreate
          ? '<label class="student-form-field"><span>Группа (необязательно)</span><select name="groupId" class="student-form-input">' + groupOptions + '</select></label>'
          : ''
        ) +
        '</div>' +
        '<div class="student-form-msg" id="studentFormMsg"></div>' +
        '<div class="student-form-actions">' +
        '<button type="submit" class="students-create-btn">' + (isCreate ? 'Создать' : 'Сохранить') + '</button>' +
        '<button type="button" class="student-form-cancel" id="studentFormCancel">Отмена</button>' +
        '</div>' +
        '</form>'
    };
  }

  function setModalMsg(text, kind) {
    var el = document.getElementById('studentFormMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'student-form-msg' + (kind ? ' student-form-msg--' + kind : '');
  }

  async function openStudentModal(mode, studentId) {
    var overlay = document.getElementById('studentFormModal');
    var titleEl = document.getElementById('studentFormTitle');
    var bodyEl = document.getElementById('studentFormModalBody');
    if (!overlay || !titleEl || !bodyEl) return;

    var initial = {
      surname: '',
      name: '',
      patronymic: '',
      birthDay: '',
      navigator: 0,
      parentSurname: '',
      parentName: '',
      parentPatronymic: '',
      email: '',
      phone: ''
    };
    var groupIdForCreate = null;

    if (mode === 'edit') {
      var studentResp = await apiRequest('GET', API.STUDENTS.BY_ID(studentId));
      var studentData = unwrapResponse(studentResp) || {};
      initial = {
        surname: studentData.surname || '',
        name: studentData.name || '',
        patronymic: studentData.patronymic || '',
        birthDay: studentData.birthDay || '',
        navigator: studentData.navigator === 1 || studentData.navigator === true || String(studentData.navigator) === '1',
        parentSurname: studentData.parentSurname || '',
        parentName: studentData.parentName || '',
        parentPatronymic: studentData.parentPatronymic || '',
        email: studentData.email || '',
        phone: normalizePhoneInputValue(studentData.phone || '')
      };
    }

    var built = buildFormHtml(mode, initial, groupIdForCreate);
    titleEl.textContent = built.title;
    bodyEl.innerHTML = built.html;
    overlay.hidden = false;

    var form = document.getElementById('studentForm');
    var cancelBtn = document.getElementById('studentFormCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (!form) return;
    if (form.phone) {
      form.phone.value = normalizePhoneInputValue(form.phone.value);
      form.phone.addEventListener('input', function () {
        form.phone.value = normalizePhoneInputValue(form.phone.value);
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      setModalMsg('');
      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        var payload = getFormPayload(form);
        if (!payload.phone) {
          setModalMsg('Укажите телефон в формате +7 (___) ___-__-__.', 'err');
          return;
        }
        if (mode === 'create') {
          var createdRes = await apiRequest('POST', API.STUDENTS.ROOT, payload);
          var created = unwrapResponse(createdRes) || {};
          var newId = parseInt(created.id, 10);
          var selectedGroupId = parseInt(form.groupId && form.groupId.value, 10);
          if (!isNaN(newId) && newId > 0 && !isNaN(selectedGroupId) && selectedGroupId > 0) {
            await apiRequest('POST', API.STUDENTS.ADD_TO_GROUP, { student_id: newId, group_id: selectedGroupId });
          }
          await loadStudents();
          closeModal();
          setMsg('Ученик создан.', 'ok');
          renderList();
          return;
        }
        payload.id = studentId;
        await apiRequest('PUT', API.STUDENTS.ROOT, payload);
        await loadStudents();
        closeModal();
        setMsg('Данные ученика обновлены.', 'ok');
        renderList();
      } catch (err) {
        setModalMsg((err && err.message) || 'Не удалось сохранить ученика.', 'err');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  async function loadStudents() {
    var res = await apiRequest('GET', API.STUDENTS.SEARCH_NEW);
    var list = unwrapResponse(res);
    students = Array.isArray(list) ? list : [];
    studentGroupsById = {};
    groupsLoadingById = {};
    students.sort(function (a, b) { return studentFullName(a).localeCompare(studentFullName(b), 'ru'); });
  }

  async function loadGroups() {
    var res = await apiRequest('GET', API.GROUPS.LIST);
    var list = unwrapResponse(res);
    groups = Array.isArray(list) ? list : [];
    groups.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'ru'); });
  }

  (async function init() {
    container.innerHTML = '<div class="students-view"><div class="events-loading">Загрузка учеников...</div></div>';
    try {
      var user = await ipcRenderer.invoke('get-user');
      canManage = hasStudentsManageAccess(user);
      await Promise.all([loadStudents(), loadGroups()]);
      render();
    } catch (err) {
      container.innerHTML = '<p class="content-error">Не удалось загрузить учеников: ' + escapeHtml((err && err.message) || 'ошибка') + '</p>';
    }
  })();
};
