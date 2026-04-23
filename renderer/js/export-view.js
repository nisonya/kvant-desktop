'use strict';

const { apiRequest, unwrapResponse } = require('./api-client.js');
const API = require('./api-paths.js');
const {
  sanitizeFilename,
  saveExcel,
  excelThinBorder,
  applyHeaderStyle,
  applyDataStyle
} = require('./shared-utils.js');
const { runWithBusy } = require('./busy-overlay.js');

const EVENT_BASE = {
  part: API.EVENTS.PART,
  org: API.EVENTS.ORG
};

const RESULT_DATE_KEYS = [
  'result_date',
  'date_of_result',
  'updated_at',
  'created_at',
  'date_update',
  'date_created'
];

function asIsoDate(value) {
  if (value == null) return '';
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  var raw = String(value).trim();
  if (!raw) return '';
  var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

function inRange(isoDate, fromIso, toIso) {
  if (!fromIso && !toIso) return true;
  if (!isoDate) return false;
  if (fromIso && isoDate < fromIso) return false;
  if (toIso && isoDate > toIso) return false;
  return true;
}

function formatDateRu(value) {
  var iso = asIsoDate(value);
  if (!iso) return '';
  var parts = iso.split('-');
  return parts[2] + '.' + parts[1] + '.' + parts[0];
}

function employeeName(emp) {
  if (!emp || typeof emp !== 'object') return '—';
  var full = [emp.second_name, emp.first_name, emp.patronymic].filter(Boolean).join(' ').trim();
  return full || emp.name || emp.login || '—';
}

function employeeId(emp) {
  var id = emp && (emp.id_employees != null ? emp.id_employees : emp.id);
  var n = parseInt(String(id), 10);
  return isNaN(n) || n <= 0 ? null : n;
}

function readPositionId(row) {
  var raw = row && (
    row.position_id != null ? row.position_id
      : (row.id_position != null ? row.id_position
        : (row.position != null ? row.position
          : (row.id_posts != null ? row.id_posts : row.post)))
  );
  var n = parseInt(String(raw), 10);
  return isNaN(n) ? null : n;
}

function eventId(item) {
  var id = item && (item.id != null ? item.id : (item.id_events != null ? item.id_events : item.id_event));
  var n = parseInt(String(id), 10);
  return isNaN(n) || n <= 0 ? null : n;
}

function eventDateForLabel(eventItem) {
  return eventItem && (eventItem.dates_of_event || eventItem.registration_deadline || '');
}

function responsibleId(resp) {
  var id = resp && (resp.id_employees != null ? resp.id_employees : resp.id);
  var n = parseInt(String(id), 10);
  return isNaN(n) || n <= 0 ? null : n;
}

function isMarkedParticipation(v) {
  return v === 1 || v === true || String(v) === '1';
}

function resultDateFromResponsible(resp) {
  var i;
  for (i = 0; i < RESULT_DATE_KEYS.length; i++) {
    var k = RESULT_DATE_KEYS[i];
    var iso = asIsoDate(resp ? resp[k] : '');
    if (iso) return iso;
  }
  return '';
}

function resultSummary(resp) {
  var out = [];
  if (!resp || typeof resp !== 'object') return '';
  if (resp.responsible_participants != null && resp.responsible_participants !== '') {
    out.push('Участников: ' + String(resp.responsible_participants));
  }
  if (resp.responsible_winners != null && resp.responsible_winners !== '') {
    out.push('Победителей: ' + String(resp.responsible_winners));
  }
  if (resp.responsible_runner_up != null && resp.responsible_runner_up !== '') {
    out.push('Призеров: ' + String(resp.responsible_runner_up));
  }
  if (resp.result_of_responsible != null && String(resp.result_of_responsible).trim()) {
    out.push('Комментарий: ' + String(resp.result_of_responsible).trim());
  }
  return out.join('; ');
}

async function fetchAllEvents(type) {
  var base = EVENT_BASE[type];
  var page = 1;
  var limit = 100;
  var all = [];
  while (true) {
    var listPath = base + '/list';
    try {
      var listRes = await apiRequest('POST', listPath, { filters: {}, sort: [], page: page, limit: limit });
      if (listRes && listRes.success === false) throw new Error(listRes.error || 'Ошибка API');
      var items = listRes.data || listRes || [];
      if (!Array.isArray(items)) items = [];
      all = all.concat(items);
      if (items.length < limit) break;
      page++;
    } catch (err) {
      if (type === 'org' && base === API.EVENTS.ORG && (err.message || '').indexOf('404') >= 0) {
        EVENT_BASE.org = API.EVENTS.ORGANIZATION_LEGACY;
        base = EVENT_BASE.org;
        continue;
      }
      throw err;
    }
  }
  return all;
}

async function fetchEventFullInfo(type, item) {
  var eid = eventId(item);
  if (!eid) return item;
  var base = EVENT_BASE[type];
  try {
    var infRes = await apiRequest('GET', base + '/full-inf/' + eid);
    if (infRes && infRes.success === false) return item;
    var raw = unwrapResponse(infRes);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.data != null && typeof raw.data === 'object') {
      raw = raw.data;
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return Object.assign({}, item, raw);
    }
    return item;
  } catch (err) {
    if (type === 'org' && base === API.EVENTS.ORG && (err.message || '').indexOf('404') >= 0) {
      EVENT_BASE.org = API.EVENTS.ORGANIZATION_LEGACY;
      try {
        var fallbackRes = await apiRequest('GET', EVENT_BASE.org + '/full-inf/' + eid);
        if (fallbackRes && fallbackRes.success === false) return item;
        var fallbackRaw = unwrapResponse(fallbackRes);
        if (fallbackRaw && typeof fallbackRaw === 'object' && !Array.isArray(fallbackRaw) && fallbackRaw.data != null && typeof fallbackRaw.data === 'object') {
          fallbackRaw = fallbackRaw.data;
        }
        if (fallbackRaw && typeof fallbackRaw === 'object' && !Array.isArray(fallbackRaw)) {
          return Object.assign({}, item, fallbackRaw);
        }
      } catch (_) {
        return item;
      }
    }
    return item;
  }
}

async function fetchResponsibles(type, eventItem) {
  var eid = eventId(eventItem);
  if (!eid) return [];
  var base = EVENT_BASE[type];
  if (type === 'part') {
    try {
      var partNew = await apiRequest('GET', base + '/responsible-new/' + eid);
      var partRows = unwrapResponse(partNew);
      return Array.isArray(partRows) ? partRows : [];
    } catch (err) {
      if ((err.message || '').indexOf('404') < 0) return [];
    }
  }
  try {
    var r = await apiRequest('GET', base + '/responsible/' + eid);
    var rows = unwrapResponse(r);
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

async function collectEventRows(type) {
  var events = await fetchAllEvents(type);
  var full = [];
  var i;
  for (i = 0; i < events.length; i++) {
    /* eslint-disable no-await-in-loop */
    full.push(await fetchEventFullInfo(type, events[i]));
    /* eslint-enable no-await-in-loop */
  }
  var out = [];
  for (i = 0; i < full.length; i++) {
    var ev = full[i];
    /* eslint-disable no-await-in-loop */
    var responsibles = await fetchResponsibles(type, ev);
    /* eslint-enable no-await-in-loop */
    out.push({ event: ev, responsibles: responsibles });
  }
  return out;
}

function teacherReportRows(partRows, teacherIdsMap, fromIso, toIso) {
  var rows = [];
  partRows.forEach(function (row) {
    var ev = row.event;
    var deadlineIso = asIsoDate(ev && ev.registration_deadline);
    var dateByDeadline = inRange(deadlineIso, fromIso, toIso);
    (row.responsibles || []).forEach(function (resp) {
      var empId = responsibleId(resp);
      if (!empId || !teacherIdsMap[empId]) return;
      if (!isMarkedParticipation(resp.mark_of_sending_an_application)) return;
      var resultIso = resultDateFromResponsible(resp);
      if (!dateByDeadline && !inRange(resultIso, fromIso, toIso)) return;
      var contestDate = eventDateForLabel(ev);
      var contestText = String((ev && ev.name) || '—');
      if (contestDate) contestText += ' (' + formatDateRu(contestDate) + ')';
      rows.push({
        employeeName: teacherIdsMap[empId],
        contest: contestText,
        result: resultSummary(resp) || '—',
        sortDate: asIsoDate(contestDate) || deadlineIso || ''
      });
    });
  });
  rows.sort(function (a, b) {
    var byName = a.employeeName.localeCompare(b.employeeName, 'ru');
    if (byName !== 0) return byName;
    return String(b.sortDate).localeCompare(String(a.sortDate));
  });
  return rows;
}

function employeePartRows(partRows, employeeIdValue, fromIso, toIso) {
  var rows = [];
  partRows.forEach(function (row) {
    var ev = row.event;
    var deadlineIso = asIsoDate(ev && ev.registration_deadline);
    var dateByDeadline = inRange(deadlineIso, fromIso, toIso);
    (row.responsibles || []).forEach(function (resp) {
      var empId = responsibleId(resp);
      if (empId !== employeeIdValue) return;
      if (!isMarkedParticipation(resp.mark_of_sending_an_application)) return;
      var resultIso = resultDateFromResponsible(resp);
      if (!dateByDeadline && !inRange(resultIso, fromIso, toIso)) return;
      rows.push({
        name: String((ev && ev.name) || '—'),
        date: formatDateRu(eventDateForLabel(ev) || ev.registration_deadline),
        result: resultSummary(resp) || '—'
      });
    });
  });
  return rows;
}

function employeeOrgRows(orgRows, employeeIdValue, fromIso, toIso) {
  var rows = [];
  orgRows.forEach(function (row) {
    var ev = row.event;
    var orgDateIso = asIsoDate(ev && ev.dates_of_event);
    if (!inRange(orgDateIso, fromIso, toIso)) return;
    var matched = (row.responsibles || []).some(function (resp) {
      return responsibleId(resp) === employeeIdValue;
    });
    if (!matched) return;
    rows.push({
      name: String((ev && ev.name) || '—'),
      date: formatDateRu(ev && ev.dates_of_event)
    });
  });
  return rows;
}

function uniqueSheetName(base, used) {
  var cleaned = String(base || 'Сотрудник').replace(/[\\/*?:[\]]/g, ' ').trim() || 'Сотрудник';
  var name = cleaned.slice(0, 31);
  if (!used[name]) {
    used[name] = true;
    return name;
  }
  var idx = 2;
  while (idx < 1000) {
    var suffix = ' (' + idx + ')';
    var maxBase = 31 - suffix.length;
    var candidate = cleaned.slice(0, Math.max(1, maxBase)) + suffix;
    if (!used[candidate]) {
      used[candidate] = true;
      return candidate;
    }
    idx++;
  }
  return 'Sheet' + Date.now();
}

async function buildTeachersWorkbook(teachersRows, fromIso, toIso) {
  var ExcelJS = require('exceljs');
  var wb = new ExcelJS.Workbook();
  wb.creator = 'Кванториум';
  wb.created = new Date();
  var ws = wb.addWorksheet('Отчет наставников');
  ws.columns = [
    { header: 'ФИО преподавателя', key: 'teacher', width: 36 },
    { header: 'Конкурс (дата)', key: 'contest', width: 52 },
    { header: 'Результат', key: 'result', width: 56 }
  ];
  ws.mergeCells(1, 1, 1, 3);
  ws.getCell(1, 1).value = 'Отчет наставников';
  ws.getCell(1, 1).font = { bold: true, size: 14, name: 'Calibri', color: { argb: 'FF1A237E' } };
  ws.mergeCells(2, 1, 2, 3);
  ws.getCell(2, 1).value = 'Период: ' + (fromIso ? formatDateRu(fromIso) : '—') + ' — ' + (toIso ? formatDateRu(toIso) : '—');
  ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF546E7A' } };
  var headerRow = ws.getRow(3);
  headerRow.values = ['ФИО преподавателя', 'Конкурс (дата)', 'Результат'];
  applyHeaderStyle(headerRow);

  if (!teachersRows.length) {
    var empty = ws.addRow(['Нет данных за выбранный период', '', '']);
    applyDataStyle(empty, false);
  } else {
    teachersRows.forEach(function (row, idx) {
      var dr = ws.addRow([row.employeeName, row.contest, row.result]);
      applyDataStyle(dr, idx % 2 === 1);
    });
  }
  return wb.xlsx.writeBuffer();
}

async function buildEmployeesWorkbook(employees, partRows, orgRows, fromIso, toIso) {
  var ExcelJS = require('exceljs');
  var wb = new ExcelJS.Workbook();
  wb.creator = 'Кванториум';
  wb.created = new Date();
  var usedNames = {};

  employees.forEach(function (emp) {
    var eid = employeeId(emp);
    if (!eid) return;
    var sheetName = uniqueSheetName(employeeName(emp), usedNames);
    var ws = wb.addWorksheet(sheetName);
    ws.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Название', key: 'name', width: 46 },
      { header: 'Дата', key: 'date', width: 16 },
      { header: 'Результат', key: 'result', width: 42 }
    ];
    ws.mergeCells(1, 1, 1, 4);
    ws.getCell(1, 1).value = employeeName(emp);
    ws.getCell(1, 1).font = { bold: true, size: 13, name: 'Calibri', color: { argb: 'FF1A237E' } };

    var part = employeePartRows(partRows, eid, fromIso, toIso);
    var org = employeeOrgRows(orgRows, eid, fromIso, toIso);

    ws.mergeCells(2, 1, 2, 4);
    ws.getCell(2, 1).value = 'Участие в конкурсах';
    ws.getCell(2, 1).font = { bold: true, size: 11, color: { argb: 'FF102A7A' } };
    var partHeader = ws.getRow(3);
    partHeader.values = ['№', 'Название конкурса', 'Дата', 'Результат'];
    applyHeaderStyle(partHeader);
    if (!part.length) {
      var pEmpty = ws.addRow(['', 'Нет данных за выбранный период', '', '']);
      applyDataStyle(pEmpty, false);
    } else {
      part.forEach(function (row, idx) {
        var dr = ws.addRow([idx + 1, row.name, row.date || '', row.result || '']);
        applyDataStyle(dr, idx % 2 === 1);
      });
    }

    var startOrgTitle = ws.lastRow.number + 2;
    ws.mergeCells(startOrgTitle, 1, startOrgTitle, 4);
    ws.getCell(startOrgTitle, 1).value = 'Организация мероприятий';
    ws.getCell(startOrgTitle, 1).font = { bold: true, size: 11, color: { argb: 'FF102A7A' } };
    var orgHeader = ws.getRow(startOrgTitle + 1);
    orgHeader.values = ['№', 'Название мероприятия', 'Дата', ''];
    applyHeaderStyle(orgHeader);
    if (!org.length) {
      var oEmpty = ws.addRow(['', 'Нет данных за выбранный период', '', '']);
      applyDataStyle(oEmpty, false);
    } else {
      org.forEach(function (row, idx) {
        var dr2 = ws.addRow([idx + 1, row.name, row.date || '', '']);
        applyDataStyle(dr2, idx % 2 === 1);
      });
    }
  });

  if (!wb.worksheets.length) {
    var fallback = wb.addWorksheet('Отчет');
    fallback.getCell(1, 1).value = 'Нет сотрудников для выгрузки.';
  }
  return wb.xlsx.writeBuffer();
}

module.exports = function renderExportView(container) {
  if (!container) return;
  container.innerHTML = [
    '<div class="export-view">',
    '  <div class="export-toolbar">',
    '    <label class="export-field">С <input type="date" id="exportDateFrom" class="search-input export-date-input"></label>',
    '    <label class="export-field">По <input type="date" id="exportDateTo" class="search-input export-date-input"></label>',
    '  </div>',
    '  <div class="export-actions">',
    '    <button type="button" class="excel-btn" id="exportTeachersBtn">Отчет наставников</button>',
    '    <button type="button" class="excel-btn" id="exportEmployeesBtn">Отчет сотрудников</button>',
    '  </div>',
    '  <div class="students-msg" id="exportMsg"></div>',
    '</div>'
  ].join('');

  var fromInput = document.getElementById('exportDateFrom');
  var toInput = document.getElementById('exportDateTo');
  var teachersBtn = document.getElementById('exportTeachersBtn');
  var employeesBtn = document.getElementById('exportEmployeesBtn');
  var msgEl = document.getElementById('exportMsg');

  function setMsg(text, isErr) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.classList.toggle('students-msg--err', !!isErr);
    msgEl.classList.toggle('students-msg--ok', !!text && !isErr);
  }

  function getRange() {
    var fromIso = asIsoDate(fromInput ? fromInput.value : '');
    var toIso = asIsoDate(toInput ? toInput.value : '');
    if (fromIso && toIso && fromIso > toIso) {
      throw new Error('Дата "С" не может быть больше даты "По".');
    }
    return { fromIso: fromIso, toIso: toIso };
  }

  function setBusy(flag) {
    if (teachersBtn) teachersBtn.disabled = flag;
    if (employeesBtn) employeesBtn.disabled = flag;
  }

  async function loadEmployeesMap() {
    var res = await apiRequest('GET', API.EMPLOYEES.WITH_INACTIVE);
    var rows = unwrapResponse(res);
    if (!Array.isArray(rows)) rows = [];
    var byId = {};
    rows.forEach(function (emp) {
      var id = employeeId(emp);
      if (!id) return;
      byId[id] = employeeName(emp);
    });
    return { list: rows, byId: byId };
  }

  async function exportTeachersReport() {
    setMsg('');
    setBusy(true);
    try {
      await runWithBusy('Формируем отчет наставников...', async function () {
        var range = getRange();
        setMsg('Подготовка данных для отчета наставников...');
        var employeeData = await loadEmployeesMap();
        var teachersMap = {};
        employeeData.list.forEach(function (emp) {
          var id = employeeId(emp);
          if (!id) return;
          if (readPositionId(emp) === 2) teachersMap[id] = employeeName(emp);
        });
        var partRows = await collectEventRows('part');
        var rows = teacherReportRows(partRows, teachersMap, range.fromIso, range.toIso);
        var buf = await buildTeachersWorkbook(rows, range.fromIso, range.toIso);
        var dateStr = new Date().toISOString().slice(0, 10);
        await saveExcel(buf, sanitizeFilename('Отчет_наставников_' + dateStr) + '.xlsx');
        setMsg('Отчет наставников сформирован.');
      });
    } catch (err) {
      console.error('[export-view] teachers', err);
      setMsg((err && err.message) || 'Не удалось сформировать отчет наставников.', true);
      window.alert((err && err.message) || 'Не удалось сформировать отчет наставников.');
    } finally {
      setBusy(false);
    }
  }

  async function exportEmployeesReport() {
    setMsg('');
    setBusy(true);
    try {
      await runWithBusy('Формируем отчет сотрудников...', async function () {
        var range = getRange();
        setMsg('Подготовка данных для отчета сотрудников...');
        var employeeData = await loadEmployeesMap();
        var partRows = await collectEventRows('part');
        var orgRows = await collectEventRows('org');
        var buf = await buildEmployeesWorkbook(employeeData.list, partRows, orgRows, range.fromIso, range.toIso);
        var dateStr = new Date().toISOString().slice(0, 10);
        await saveExcel(buf, sanitizeFilename('Отчет_сотрудников_' + dateStr) + '.xlsx');
        setMsg('Отчет сотрудников сформирован.');
      });
    } catch (err) {
      console.error('[export-view] employees', err);
      setMsg((err && err.message) || 'Не удалось сформировать отчет сотрудников.', true);
      window.alert((err && err.message) || 'Не удалось сформировать отчет сотрудников.');
    } finally {
      setBusy(false);
    }
  }

  if (teachersBtn) teachersBtn.addEventListener('click', function () {
    exportTeachersReport();
  });
  if (employeesBtn) employeesBtn.addEventListener('click', function () {
    exportEmployeesReport();
  });
};
