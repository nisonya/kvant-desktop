'use strict';

function formatDate(str) {
  if (!str) return '—';
  const d = String(str);
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
    const p = d.split(/[-T]/);
    return (p[2] || '').split(/[ T]/)[0] + '.' + (p[1] || '') + '.' + (p[0] || '');
  }
  return d;
}

function formatDateForExport(val) {
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'number' && isFinite(val)) {
    const ms = val < 1e11 ? val * 1000 : val;
    const dt = new Date(ms);
    if (!isNaN(dt.getTime())) {
      return String(dt.getDate()).padStart(2, '0') + '.' +
        String(dt.getMonth() + 1).padStart(2, '0') + '.' +
        dt.getFullYear();
    }
  }
  if (val instanceof Date) {
    if (!isNaN(val.getTime())) {
      return String(val.getDate()).padStart(2, '0') + '.' +
        String(val.getMonth() + 1).padStart(2, '0') + '.' +
        val.getFullYear();
    }
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const p = s.split(/[-T]/);
    const dayPart = (p[2] || '').split(/[ T]/)[0];
    return dayPart + '.' + (p[1] || '') + '.' + (p[0] || '');
  }
  if (/^\d{2}\.\d{2}\.\d{4}/.test(s)) return s;
  return s;
}

function isDateLikeFieldKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (key === 'dates_of_event' || key === 'registration_deadline') return true;
  return /(^|_)(date|deadline|time|at)($|_)/i.test(key) || /_at$/i.test(key);
}

/** Значение из API/БД → YYYY-MM-DD для input[type=date]; иначе '' */
function parseDateValueToInputIso(rawVal) {
  if (rawVal == null || rawVal === '') return '';
  const s = String(rawVal).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const dmy = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dmy) {
    return dmy[3] + '-' + dmy[2].padStart(2, '0') + '-' + dmy[1].padStart(2, '0');
  }
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    const ms = n < 1e12 ? n * 1000 : n;
    const dt = new Date(ms);
    if (!isNaN(dt.getTime())) {
      return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    }
  }
  return '';
}

/** Ввод пользователя → дата в формате MySQL DATE (YYYY-MM-DD) или исходная строка */
function normalizeInputToMysqlDate(txt) {
  txt = (txt || '').trim();
  if (!txt) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;
  const iso = txt.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const dmy = txt.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dmy) {
    return dmy[3] + '-' + dmy[2].padStart(2, '0') + '-' + dmy[1].padStart(2, '0');
  }
  return txt;
}

const ORG_WEEKDAYS_RU_CAPS = ['ВОСКРЕСЕНЬЕ', 'ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА'];

/** День недели для календарной даты YYYY-MM-DD → русское название заглавными */
function orgWeekdayCapsFromYyyyMmDd(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const dt = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  if (isNaN(dt.getTime())) return '';
  return ORG_WEEKDAYS_RU_CAPS[dt.getDay()];
}

function getQuarterDates() {
  const d = new Date();
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  const fromM = (q - 1) * 3;
  const toM = fromM + 2;
  const dateFrom = y + '-' + String(fromM + 1).padStart(2, '0') + '-01';
  const lastDay = new Date(y, toM + 1, 0).getDate();
  const dateTo = y + '-' + String(toM + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
  return { date_from: dateFrom, date_to: dateTo };
}

function extractDictArray(res) {
  if (!res || res.success === false) return [];
  const d = res.data !== undefined ? res.data : res;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    if (Array.isArray(d.items)) return d.items;
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.data)) return d.data;
    if (Array.isArray(d.rows)) return d.rows;
  }
  return [];
}

function dictItemsToOptions(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = {};
  arr.forEach(function (item) {
    if (item == null) return;
    let value, label;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      value = String(item);
      label = String(item);
    } else if (typeof item === 'object') {
      value = item.value != null ? item.value
        : (item.id != null ? item.id
          : (item.id_type != null ? item.id_type
            : (item.id_form_of_holding != null ? item.id_form_of_holding
              : (item.form_of_holding_id != null ? item.form_of_holding_id : item.code))));
      label = item.label != null ? item.label
        : (item.name != null ? item.name
          : (item.title != null ? item.title : null));
      if (value == null && label != null) value = label;
      if (label == null && value != null) label = String(value);
      if (value == null) return;
      value = String(value);
      label = String(label);
    } else {
      return;
    }
    if (seen[value]) return;
    seen[value] = true;
    out.push({ value: value, label: label });
  });
  return out;
}

const ORG_FIELD_ORDER = [
  'name', 'types_of_organization', 'form_of_holding', 'dates_of_event',
  'day_of_the_week', 'amount_of_applications', 'amount_of_planning_application',
  'annotation', 'result', 'link'
];

const PART_FIELD_ORDER = [
  'name', 'form_of_holding', 'id_type', 'registration_deadline',
  'participants_and_works', 'annotation', 'dates_of_event', 'link',
  'participants_amount', 'winner_amount', 'runner_up_amount', 'result'
];

function orderedKeysForEdit(data, kind) {
  const seen = {};
  const out = [];
  if (Object.prototype.hasOwnProperty.call(data, 'id')) {
    out.push('id');
    seen.id = true;
  }
  const order = kind === 'org' ? ORG_FIELD_ORDER : PART_FIELD_ORDER;
  if (kind === 'org') {
    order.forEach(function (k) {
      if (seen[k]) return;
      out.push(k);
      seen[k] = true;
    });
    Object.keys(data).forEach(function (k) {
      if (seen[k]) return;
      out.push(k);
      seen[k] = true;
    });
    return out;
  }
  order.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(data, k)) { out.push(k); seen[k] = true; }
  });
  Object.keys(data).forEach(function (k) {
    if (seen[k]) return;
    out.push(k);
    seen[k] = true;
  });
  return out;
}

function emptyRawForCreate(kind) {
  const o = {};
  (kind === 'org' ? ORG_FIELD_ORDER : PART_FIELD_ORDER).forEach(function (k) {
    o[k] = '';
  });
  return o;
}

function applyPartReferenceDefaults(raw, levelsOpts, formsOpts) {
  if (levelsOpts && levelsOpts.length > 0) {
    const lv = levelsOpts[0].value;
    if (lv != null && String(lv) !== '') raw.id_type = String(lv);
  }
  if (formsOpts && formsOpts.length > 0) {
    const fv = formsOpts[0].value;
    if (fv != null && String(fv) !== '') raw.form_of_holding = String(fv);
  }
}

function responsibleNames(resp) {
  if (!resp || !resp.length) return '—';
  return resp.map(function (r) {
    return [r.first_name, r.second_name].filter(Boolean).join(' ') || r.name || '—';
  }).join(', ');
}

module.exports = {
  formatDate,
  formatDateForExport,
  isDateLikeFieldKey,
  parseDateValueToInputIso,
  normalizeInputToMysqlDate,
  orgWeekdayCapsFromYyyyMmDd,
  getQuarterDates,
  extractDictArray,
  dictItemsToOptions,
  orderedKeysForEdit,
  emptyRawForCreate,
  applyPartReferenceDefaults,
  responsibleNames
};
