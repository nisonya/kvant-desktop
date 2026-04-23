'use strict';

const API = require('./api-paths.js');
const {
  sanitizeFilename,
  employeeDisplayName,
  saveExcel,
  applyHeaderStyle,
  applyDataStyle
} = require('./shared-utils.js');
const { runWithBusy } = require('./busy-overlay.js');

/**
 * @param {object} deps
 * @param {function} deps.apiRequest
 * @param {HTMLElement | null} deps.exportSizesBtn
 * @param {HTMLElement | null} deps.exportAllBtn
 * @param {function(): Array} deps.getActiveEmployees
 */
function wireEmployeesExport(deps) {
  const apiRequest = deps.apiRequest;
  const exportSizesBtn = deps.exportSizesBtn;
  const exportAllBtn = deps.exportAllBtn;
  const getActiveEmployees = deps.getActiveEmployees;

  function normalizeGender(value) {
    if (value == null) return '';
    const s = String(value).trim().toLowerCase();
    if (!s) return '';
    if (s === 'ж' || s === 'жен' || s === 'женский' || s === 'female' || s === 'f') return 'ж';
    if (s === 'м' || s === 'муж' || s === 'мужской' || s === 'male' || s === 'm') return 'м';
    return s;
  }

  function genderSortRank(value) {
    const g = normalizeGender(value);
    if (g === 'ж') return 0;
    if (g === 'м') return 1;
    return 2;
  }

  function applyGroupFill(row, argb) {
    if (!argb) return;
    row.eachCell(function (cell) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } };
    });
  }

  async function exportSizes() {
    if (exportSizesBtn) exportSizesBtn.disabled = true;
    try {
      await runWithBusy('Формируем отчет по размерам сотрудников...', async function () {
        let emps = [];
        try {
          const res = await apiRequest('GET', API.EMPLOYEES.SIZES);
          const arr = res.data || res || [];
          emps = Array.isArray(arr) ? arr : [];
        } catch (e) {
          emps = getActiveEmployees().length ? getActiveEmployees() : [];
        }
        if (!emps.length) emps = getActiveEmployees();
        if (!emps.length) { window.alert('Нет сотрудников'); return; }

        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        wb.creator = 'Kvantorium';
        wb.created = new Date();
        const sheet = wb.addWorksheet('Размеры', { views: [{ state: 'frozen', ySplit: 1 }] });

        const headers = ['№', 'ФИО', 'Пол', 'Размер'];
        const headerRow = sheet.addRow(headers);
        applyHeaderStyle(headerRow);
        sheet.getColumn(1).width = 6;
        sheet.getColumn(2).width = 36;
        sheet.getColumn(3).width = 14;
        sheet.getColumn(4).width = 18;

        const sorted = emps.slice().sort(function (a, b) {
          const rank = genderSortRank(a.gender) - genderSortRank(b.gender);
          if (rank !== 0) return rank;
          return employeeDisplayName(a).localeCompare(employeeDisplayName(b), 'ru');
        });

        sorted.forEach(function (emp, idx) {
          const g = normalizeGender(emp.gender);
          const groupFill = g === 'ж' ? 'FFFDF7FA' : (g === 'м' ? 'FFF7FAFD' : null);
          const vals = [
            idx + 1,
            employeeDisplayName(emp),
            emp.gender || '',
            emp.size != null && emp.size !== '' ? String(emp.size) : ''
          ];
          const row = sheet.addRow(vals);
          applyDataStyle(row, idx % 2 === 1);
          applyGroupFill(row, groupFill);
        });

        const buf = await wb.xlsx.writeBuffer();
        const dateStr = new Date().toISOString().slice(0, 10);
        await saveExcel(buf, sanitizeFilename('Размеры_сотрудников_' + dateStr) + '.xlsx');
      });
    } catch (err) {
      console.error('[employees] export sizes', err);
      window.alert(err.message || 'Не удалось сохранить файл');
    } finally {
      if (exportSizesBtn) exportSizesBtn.disabled = false;
    }
  }

  async function exportAll() {
    if (exportAllBtn) exportAllBtn.disabled = true;
    try {
      await runWithBusy('Формируем полный отчет по сотрудникам...', async function () {
        let emps = getActiveEmployees().length ? getActiveEmployees() : [];
        if (!emps.length) {
          try {
            const res = await apiRequest('GET', API.EMPLOYEES.ALL);
            const arr = res.data || res || [];
            emps = Array.isArray(arr) ? arr : [];
          } catch (e) {
            window.alert('Не удалось загрузить список сотрудников');
            return;
          }
        }
        if (!emps.length) { window.alert('Нет сотрудников'); return; }

        const skipKeys = { id: 1, id_employees: 1, password: 1, password_hash: 1, refresh_token: 1, token: 1 };
        const merged = {};
        emps.forEach(function (e) {
          Object.keys(e).forEach(function (k) { if (!skipKeys[k]) merged[k] = true; });
        });

        const priorityOrder = [
          'first_name', 'second_name', 'patronymic',
          'date_of_birth', 'position', 'education', 'gender',
          'contact', 'size', 'schedule'
        ];
        const fieldKeys = [];
        const seen = {};
        priorityOrder.forEach(function (k) {
          if (merged[k] && !seen[k]) { fieldKeys.push(k); seen[k] = true; }
        });
        Object.keys(merged).forEach(function (k) {
          if (!seen[k]) { fieldKeys.push(k); seen[k] = true; }
        });

        const LABELS = {
          first_name: 'Имя', second_name: 'Фамилия', patronymic: 'Отчество',
          date_of_birth: 'Дата рождения', position: 'Должность', position_name: 'Должность',
          education: 'Образование', gender: 'Пол',
          contact: 'Контакт', size: 'Размер', schedule: 'Расписание',
          KPI: 'KPI', is_active: 'Активен'
        };

        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        wb.creator = 'Kvantorium';
        wb.created = new Date();
        const sheet = wb.addWorksheet('Сотрудники', { views: [{ state: 'frozen', ySplit: 1 }] });

        const headers = ['№'].concat(fieldKeys.map(function (k) { return LABELS[k] || k; }));
        const headerRow = sheet.addRow(headers);
        applyHeaderStyle(headerRow);
        sheet.getColumn(1).width = 6;
        fieldKeys.forEach(function (k, i) {
          let w = 16;
          if (k === 'name' || k === 'first_name' || k === 'second_name') w = 24;
          if (k === 'email' || k === 'login') w = 22;
          sheet.getColumn(i + 2).width = w;
        });

        emps.forEach(function (emp, idx) {
          const vals = [idx + 1];
          fieldKeys.forEach(function (k) {
            const v = emp[k];
            if (v == null || v === '') vals.push('');
            else if (typeof v === 'boolean') vals.push(v ? 'Да' : 'Нет');
            else vals.push(String(v));
          });
          const row = sheet.addRow(vals);
          applyDataStyle(row, idx % 2 === 1);
        });

        const buf = await wb.xlsx.writeBuffer();
        const dateStr = new Date().toISOString().slice(0, 10);
        await saveExcel(buf, sanitizeFilename('Сотрудники_' + dateStr) + '.xlsx');
      });
    } catch (err) {
      console.error('[employees] export all', err);
      window.alert(err.message || 'Не удалось сохранить файл');
    } finally {
      if (exportAllBtn) exportAllBtn.disabled = false;
    }
  }

  if (exportSizesBtn) exportSizesBtn.addEventListener('click', exportSizes);
  if (exportAllBtn) exportAllBtn.addEventListener('click', exportAll);
}

module.exports = { wireEmployeesExport };
