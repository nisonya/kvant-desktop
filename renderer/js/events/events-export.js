'use strict';

const { apiRequest, unwrapResponse } = require('../api-client.js');
const API = require('../api-paths.js');
const { sanitizeFilename, saveExcel } = require('../shared-utils.js');
const { runWithBusy } = require('../busy-overlay.js');
const { EVENT_BASE, FIELD_LABELS } = require('./event-constants.js');
const {
  isDateLikeFieldKey,
  formatDateForExport,
  orderedKeysForEdit,
  responsibleNames
} = require('./event-helpers.js');

/**
 * Конструктор экспортера Excel. Принимает функции, отвечающие за данные и форматирование,
 * чтобы можно было переиспользовать логику для других выгрузок.
 */
function createEventsExcelExporter(deps) {
  const {
    getFilters,
    getSort,
    getSortLabel,
    fetchReferenceLevels,
    fetchReferenceTypesOfHolding,
    fetchOrgEventTypes
  } = deps;

  async function fetchPageForExport(type, page, limit) {
    const filters = getFilters();
    const sort = getSort();
    const base = EVENT_BASE[type];
    const listPath = base + '/list';
    try {
      const listRes = await apiRequest('POST', listPath, { filters, sort, page, limit });
      if (listRes && listRes.success === false) throw new Error(listRes.error || 'Ошибка API');
      const items = listRes.data || listRes || [];
      return Array.isArray(items) ? items : [];
    } catch (e) {
      if (type === 'org' && base === API.EVENTS.ORG && (e.message || '').includes('404')) {
        EVENT_BASE.org = API.EVENTS.ORGANIZATION_LEGACY;
        return fetchPageForExport(type, page, limit);
      }
      throw e;
    }
  }

  async function fetchAllEventsForExport(type) {
    const limit = 100;
    let page = 1;
    let all = [];
    // простая постраничная выборка до конца
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await fetchPageForExport(type, page, limit);
      all = all.concat(batch);
      if (batch.length < limit) break;
      page++;
    }
    return all;
  }

  async function fetchResponsibleForExport(type, base, eventId) {
    if (!eventId) return [];
    if (type === 'part') {
      try {
        const rNew = await apiRequest('GET', base + '/responsible-new/' + eventId);
        const respNew = unwrapResponse(rNew);
        return Array.isArray(respNew) ? respNew : [];
      } catch (e) {
        if ((e.message || '').includes('404')) {
          try {
            const rFb = await apiRequest('GET', base + '/responsible/' + eventId);
            const respFb = unwrapResponse(rFb);
            return Array.isArray(respFb) ? respFb : [];
          } catch {
            return [];
          }
        }
        return [];
      }
    }
    try {
      const rRes = await apiRequest('GET', base + '/responsible/' + eventId);
      const resp = unwrapResponse(rRes);
      return Array.isArray(resp) ? resp : [];
    } catch {
      return [];
    }
  }

  async function enrichItemsWithFullInf(type, items) {
    const base = EVENT_BASE[type];
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const eventId = item.id || item.id_events || item.id_event;
      if (!eventId) {
        out.push(item);
        continue;
      }
      let b = base;
      let merged = item;
      try {
        let infRes = await apiRequest('GET', b + '/full-inf/' + eventId);
        if (infRes && infRes.success === false) {
          out.push(item);
          continue;
        }
        let raw = unwrapResponse(infRes);
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.data != null && typeof raw.data === 'object') raw = raw.data;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          merged = Object.assign({}, item, raw);
        }
      } catch (getErr) {
        if (type === 'org' && b === API.EVENTS.ORG && (getErr.message || '').includes('404')) {
          EVENT_BASE.org = API.EVENTS.ORGANIZATION_LEGACY;
          b = EVENT_BASE[type];
          try {
            let infRes = await apiRequest('GET', b + '/full-inf/' + eventId);
            if (infRes && infRes.success === false) {
              out.push(item);
              continue;
            }
            let raw = unwrapResponse(infRes);
            if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.data != null && typeof raw.data === 'object') raw = raw.data;
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
              merged = Object.assign({}, item, raw);
            }
          } catch (e2) {
            console.warn('[export] full-inf fallback', eventId, e2);
          }
        } else {
          console.warn('[export] full-inf', eventId, getErr);
        }
      }
      out.push(merged);
    }
    return out;
  }

  async function attachResponsiblesForExport(type, items) {
    const base = EVENT_BASE[type];
    const CHUNK = 15;
    let out = [];
    for (let i = 0; i < items.length; i += CHUNK) {
      const slice = items.slice(i, i + CHUNK);
      /* eslint-disable no-await-in-loop */
      const chunk = await Promise.all(slice.map(function (item) {
        const eventId = item.id || item.id_events || item.id_event;
        return fetchResponsibleForExport(type, base, eventId).then(function (resp) {
          return { item: item, resp: resp };
        });
      }));
      /* eslint-enable no-await-in-loop */
      out = out.concat(chunk);
    }
    return out;
  }

  async function buildEventsWorkbook(type, rowsWithResp) {
    const ExcelJS = require('exceljs');
    const excelFormsById = {};
    const excelLevelsById = {};
    const formsOpts = await fetchReferenceTypesOfHolding();
    formsOpts.forEach(function (o) {
      excelFormsById[String(o.value)] = o.label;
    });
    if (type === 'part') {
      const levelsOpts = await fetchReferenceLevels();
      levelsOpts.forEach(function (o) {
        excelLevelsById[String(o.value)] = o.label;
      });
    }
    const excelOrgTypesById = {};
    if (type === 'org') {
      const orgT = await fetchOrgEventTypes();
      orgT.forEach(function (o) {
        excelOrgTypesById[String(o.value)] = o.label;
      });
    }

    function formatExportCellValue(key, val) {
      if (val === null || val === undefined) return '';
      if (Array.isArray(val)) {
        if (isDateLikeFieldKey(key)) {
          return val.map(function (x) { return formatDateForExport(x); }).join(', ');
        }
        return JSON.stringify(val);
      }
      if (key === 'id_type') {
        const lid = excelLevelsById[String(val)];
        return lid != null && lid !== '' ? lid : String(val);
      }
      if (key === 'form_of_holding') {
        const fid = excelFormsById[String(val)];
        return fid != null && fid !== '' ? fid : String(val);
      }
      if (type === 'org' && (key === 'types_of_organization' || key === 'type')) {
        const oid = excelOrgTypesById[String(val)];
        return oid != null && oid !== '' ? oid : String(val);
      }
      if (isDateLikeFieldKey(key)) {
        return formatDateForExport(val);
      }
      if (typeof val === 'object' && !(val instanceof Date)) {
        try {
          return JSON.stringify(val);
        } catch (e) {
          return String(val);
        }
      }
      if (typeof val === 'boolean') {
        return val ? 'Да' : 'Нет';
      }
      return String(val);
    }

    const merged = {};
    rowsWithResp.forEach(function (row) {
      const item = row.item;
      if (!item || typeof item !== 'object') return;
      Object.keys(item).forEach(function (k) {
        merged[k] = item[k];
      });
    });
    const fieldKeys = orderedKeysForEdit(merged, type).filter(function (k) {
      return k !== 'id' && k !== 'id_events' && k !== 'id_event';
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Kvantorium';
    wb.created = new Date();
    const sheet = wb.addWorksheet('Мероприятия', {
      views: [{ state: 'frozen', ySplit: 3 }]
    });

    const headerLabels = fieldKeys.map(function (k) {
      return FIELD_LABELS[k] || k;
    });
    const headers = type === 'org'
      ? ['№'].concat(headerLabels).concat(['Ответственные'])
      : ['№'].concat(headerLabels).concat(['Сотрудник', 'Участвовал', 'Результат']);
    const metaCols = headers.length;
    const eventColEnd = 1 + fieldKeys.length;

    const viewTitle = type === 'org' ? 'Организация' : 'Участие';
    const sortLabel = getSortLabel();
    const thin = { style: 'thin', color: { argb: 'FFB0BEC5' } };
    const sepBottom = { style: 'medium', color: { argb: 'FF1A237E' } };
    function applyEventBlockBottom(sheetRef, rowIdx, colCount) {
      for (let bc = 1; bc <= colCount; bc++) {
        const cell = sheetRef.getCell(rowIdx, bc);
        const b = cell.border || {};
        cell.border = {
          top: b.top || thin,
          left: b.left || thin,
          bottom: sepBottom,
          right: b.right || thin
        };
      }
    }
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    const titleFont = { bold: true, size: 14, name: 'Calibri', color: { argb: 'FF1A237E' } };

    sheet.mergeCells(1, 1, 1, metaCols);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = 'Мероприятия — ' + viewTitle;
    titleCell.font = titleFont;
    titleCell.alignment = { vertical: 'middle', wrapText: true };

    sheet.mergeCells(2, 1, 2, metaCols);
    const sortCell = sheet.getCell(2, 1);
    sortCell.value = 'Сортировка: ' + sortLabel + ' · Сформировано: ' + new Date().toLocaleString('ru-RU');
    sortCell.font = { italic: true, size: 10, name: 'Calibri', color: { argb: 'FF546E7A' } };
    sortCell.alignment = { vertical: 'middle', wrapText: true };

    const headerRow = sheet.addRow(headers);
    headerRow.eachCell(function (cell) {
      cell.font = headerFont;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { top: thin, left: thin, bottom: thin, right: thin };
    });

    sheet.getColumn(1).width = 6;
    fieldKeys.forEach(function (k, i) {
      let w = 14;
      if (k === 'name') w = 36;
      if (k === 'annotation' || k === 'result' || k === 'participants_and_works') w = 42;
      if (k === 'link') w = 28;
      if (k === 'types_of_organization' || k === 'type' || k === 'day_of_the_week') w = 18;
      if (k === 'winner_amount' || k === 'runner_up_amount' || k === 'participants_amount') w = 16;
      sheet.getColumn(i + 2).width = w;
    });
    if (type === 'org') {
      sheet.getColumn(eventColEnd + 1).width = 38;
    } else {
      sheet.getColumn(eventColEnd + 1).width = 28;
      sheet.getColumn(eventColEnd + 2).width = 14;
      sheet.getColumn(eventColEnd + 3).width = 36;
    }

    if (type === 'org') {
      rowsWithResp.forEach(function (row, idx) {
        const item = row.item;
        const resp = row.resp || [];
        const values = [idx + 1];
        fieldKeys.forEach(function (k) {
          values.push(formatExportCellValue(k, item[k]));
        });
        values.push(responsibleNames(resp));
        const dataRow = sheet.addRow(values);
        const isAlt = idx % 2 === 1;
        const fillBg = isAlt ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } } : undefined;
        dataRow.eachCell(function (cell, colNumber) {
          cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF263238' } };
          cell.border = { top: thin, left: thin, bottom: thin, right: thin };
          cell.alignment = { vertical: 'top', wrapText: true };
          if (colNumber === 1) {
            cell.alignment = { vertical: 'top', horizontal: 'center', wrapText: true };
          }
          if (fillBg) {
            cell.fill = fillBg;
          }
        });
        applyEventBlockBottom(sheet, dataRow.number, headers.length);
      });
    } else {
      rowsWithResp.forEach(function (row, idx) {
        const item = row.item;
        const resp = row.resp || [];
        const num = idx + 1;
        const numRows = Math.max(1, resp.length);
        const blockStart = sheet.lastRow.number + 1;
        const isAlt = idx % 2 === 1;
        const fillBg = isAlt ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } } : undefined;

        for (let r = 0; r < numRows; r++) {
          const respPerson = resp[r];
          const rowVals = [];
          if (r === 0) {
            rowVals.push(num);
            fieldKeys.forEach(function (k) {
              rowVals.push(formatExportCellValue(k, item[k]));
            });
          } else {
            rowVals.push('');
            fieldKeys.forEach(function () {
              rowVals.push('');
            });
          }
          if (respPerson) {
            const empName = [respPerson.first_name, respPerson.second_name, respPerson.patronymic].filter(Boolean).join(' ') || respPerson.name || '—';
            const didPart = respPerson.mark_of_sending_an_application === 1 || respPerson.mark_of_sending_an_application === true;
            const participatedStr = didPart ? '☑' : '☐';
            const resultStr = respPerson.result_of_responsible != null ? String(respPerson.result_of_responsible) : '';
            rowVals.push(empName, participatedStr, resultStr);
          } else {
            rowVals.push('', '', '');
          }
          const dataRow = sheet.addRow(rowVals);
          dataRow.eachCell(function (cell, colNumber) {
            cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF263238' } };
            cell.border = { top: thin, left: thin, bottom: thin, right: thin };
            if (colNumber <= eventColEnd) {
              cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'center' : 'top', wrapText: true };
            } else {
              cell.alignment = { vertical: 'top', wrapText: true };
              if (colNumber === eventColEnd + 2) {
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
              }
            }
            if (fillBg) {
              cell.fill = fillBg;
            }
          });
        }

        if (numRows > 1) {
          for (let mc = 1; mc <= eventColEnd; mc++) {
            sheet.mergeCells(blockStart, mc, blockStart + numRows - 1, mc);
            const mcCell = sheet.getCell(blockStart, mc);
            mcCell.alignment = {
              vertical: 'middle',
              horizontal: mc === 1 ? 'center' : 'left',
              wrapText: true
            };
          }
        }
        const blockLastRow = blockStart + numRows - 1;
        applyEventBlockBottom(sheet, blockLastRow, headers.length);
      });
    }

    sheet.getCell(1, 1).border = { top: thin, left: thin, bottom: thin, right: thin };
    sheet.getCell(2, 1).border = { top: thin, left: thin, bottom: thin, right: thin };

    return wb.xlsx.writeBuffer();
  }

  async function exportEventsToExcel(type) {
    const btn = document.getElementById('eventsExcelBtn');
    if (btn) btn.disabled = true;
    try {
      await runWithBusy('Формируем отчет по мероприятиям...', async function () {
        let items = await fetchAllEventsForExport(type);
        if (!items.length) {
          window.alert('Нет мероприятий для выгрузки по текущим фильтрам.');
          return;
        }
        items = await enrichItemsWithFullInf(type, items);
        const rowsWithResp = await attachResponsiblesForExport(type, items);
        const buf = await buildEventsWorkbook(type, rowsWithResp);
        const viewSlug = type === 'org' ? 'Организация' : 'Участие';
        const dateStr = new Date().toISOString().slice(0, 10);
        const defaultName = sanitizeFilename('Мероприятия_' + viewSlug + '_' + dateStr) + '.xlsx';
        await saveExcel(buf, defaultName);
      });
    } catch (err) {
      console.error('[export] excel', err);
      window.alert(err && err.message ? err.message : 'Не удалось сохранить файл');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  return { exportEventsToExcel };
}

module.exports = { createEventsExcelExporter };
