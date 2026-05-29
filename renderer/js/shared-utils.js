'use strict';

const { ipcRenderer, shell } = require('electron');

function sanitizeFilename(s) {
  return String(s || 'export').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

/**
 * ФИО или поле name (например для ответственных).
 * @param {{ name?: string, first_name?: string, second_name?: string, patronymic?: string, login?: string }} data
 * @param {{ surnameFirst?: boolean }} [opts] — для профиля: «Фамилия Имя Отчество»
 */
function employeeDisplayName(data, opts) {
  if (!data || typeof data !== 'object') return '—';
  if (data.name) return data.name;
  var keys = opts && opts.surnameFirst
    ? ['second_name', 'first_name', 'patronymic']
    : ['first_name', 'second_name', 'patronymic'];
  var s = keys.map(function (k) { return data[k]; }).filter(Boolean).join(' ');
  return s || data.login || '—';
}

function resetBusyOverlay() {
  try {
    require('./busy-overlay.js').resetBusy();
  } catch (_) {
    // Saving can be used on pages that do not load the global busy overlay.
  }
}

async function saveExcel(buffer, defaultName) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  const defaultPath = fs.existsSync(downloadsDir)
    ? path.join(downloadsDir, defaultName)
    : path.join(os.homedir(), defaultName);
  resetBusyOverlay();
  const dlg = await ipcRenderer.invoke('save-excel-dialog', { defaultPath: defaultPath });
  if (!dlg || dlg.canceled || !dlg.filePath) {
    resetBusyOverlay();
    return false;
  }
  await fs.promises.writeFile(dlg.filePath, Buffer.from(buffer));
  const openErr = await shell.openPath(dlg.filePath);
  if (openErr) {
    window.alert('Файл сохранён, но не удалось открыть:\n' + openErr);
  }
  return true;
}

function excelThinBorder() {
  return { style: 'thin', color: { argb: 'FFB0BEC5' } };
}

function applyHeaderStyle(row) {
  const thin = excelThinBorder();
  row.eachCell(function (cell) {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: thin, left: thin, bottom: thin, right: thin };
  });
}

function applyDataStyle(row, isAlt) {
  const thin = excelThinBorder();
  const fill = isAlt ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } } : undefined;
  row.eachCell(function (cell, col) {
    cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF263238' } };
    cell.border = { top: thin, left: thin, bottom: thin, right: thin };
    cell.alignment = { vertical: 'middle', wrapText: true };
    if (col === 1) cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    if (fill) cell.fill = fill;
  });
}

module.exports = {
  sanitizeFilename,
  employeeDisplayName,
  saveExcel,
  excelThinBorder,
  applyHeaderStyle,
  applyDataStyle
};
