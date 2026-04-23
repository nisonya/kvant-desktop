'use strict';

const { escapeHtml, escapeHtmlAttr } = require('../html-escape.js');
const { parseDateValueToInputIso } = require('./event-helpers.js');
const {
  getMaxStringLenForEventField,
  isEventUintFieldKey,
  isEventRequiredFieldKey
} = require('./event-form-validation.js');

function buildDateField(k, lab, raw, required) {
  const iso = parseDateValueToInputIso(raw[k]);
  const reqClass = required ? ' event-edit-field--required' : '';
  const reqMark = required ? ' <abbr class="event-edit-required-mark" title="Обязательное поле">*</abbr>' : '';
  return '<label class="event-edit-field' + reqClass + '"><span class="event-edit-label">' + escapeHtml(lab) + reqMark + '</span>' +
    '<input type="date" class="event-edit-input event-edit-input--date" name="' + escapeHtmlAttr(k) + '" value="' + escapeHtmlAttr(iso) + '" autocomplete="off"></label>';
}

function buildSelectField(name, lab, currentVal, options, required) {
  const cur = currentVal == null ? '' : String(currentVal);
  const seenVal = {};
  const parts = [];
  options.forEach(function (o) {
    seenVal[o.value] = true;
    const sel = o.value === cur ? ' selected' : '';
    parts.push('<option value="' + escapeHtmlAttr(o.value) + '"' + sel + '>' + escapeHtml(o.label) + '</option>');
  });
  if (cur !== '' && !seenVal[cur]) {
    parts.unshift('<option value="' + escapeHtmlAttr(cur) + '" selected>' + escapeHtml(cur) + '</option>');
  }
  if (cur === '') {
    parts.unshift('<option value="">— Выберите —</option>');
  }
  const reqClass = required ? ' event-edit-field--required' : '';
  const reqMark = required ? ' <abbr class="event-edit-required-mark" title="Обязательное поле">*</abbr>' : '';
  return '<label class="event-edit-field' + reqClass + '"><span class="event-edit-label">' + escapeHtml(lab) + reqMark + '</span>' +
    '<select class="event-edit-input event-edit-select" name="' + escapeHtmlAttr(name) + '">' + parts.join('') + '</select></label>';
}

function buildPlainField(k, lab, raw, required, maxLen) {
  const v = raw[k];
  const str = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  const isLong = str.length > 80 || str.indexOf('\n') >= 0;
  const maxAttr = typeof maxLen === 'number' && maxLen > 0 ? ' maxlength="' + maxLen + '"' : '';
  const inputHtml = isLong
    ? '<textarea class="event-edit-input event-edit-input--block" name="' + escapeHtmlAttr(k) + '" rows="4"' + maxAttr + '>' + escapeHtml(str) + '</textarea>'
    : '<input type="text" class="event-edit-input" name="' + escapeHtmlAttr(k) + '" value="' + escapeHtmlAttr(str) + '"' + maxAttr + '>';
  const wide = isLong ? ' event-edit-field--full' : '';
  const reqClass = required ? ' event-edit-field--required' : '';
  const reqMark = required ? ' <abbr class="event-edit-required-mark" title="Обязательное поле">*</abbr>' : '';
  return '<label class="event-edit-field' + wide + reqClass + '"><span class="event-edit-label">' + escapeHtml(lab) + reqMark + '</span>' + inputHtml + '</label>';
}

function buildLinkField(k, lab, raw, required, maxLen) {
  const v = raw[k];
  const str = v === null || v === undefined ? '' : String(v);
  const maxAttr = typeof maxLen === 'number' && maxLen > 0 ? ' maxlength="' + maxLen + '"' : '';
  const reqClass = required ? ' event-edit-field--required' : '';
  const reqMark = required ? ' <abbr class="event-edit-required-mark" title="Обязательное поле">*</abbr>' : '';
  return '<label class="event-edit-field event-edit-field--full' + reqClass + '">' +
    '<span class="event-edit-label">' + escapeHtml(lab) + reqMark + '</span>' +
    '<span class="event-edit-link-row">' +
    '<input type="text" class="event-edit-input" name="' + escapeHtmlAttr(k) + '" value="' + escapeHtmlAttr(str) + '"' + maxAttr + ' autocomplete="off">' +
    '<button type="button" class="event-link-open-btn" data-action="open-external-link" data-field="' + escapeHtmlAttr(k) + '">Открыть</button>' +
    '</span>' +
    '</label>';
}

function buildOrgReadonlyDayField(k, lab, raw, required) {
  const str = raw[k] == null ? '' : String(raw[k]);
  const reqClass = required ? ' event-edit-field--required' : '';
  const reqMark = required ? ' <abbr class="event-edit-required-mark" title="Обязательное поле">*</abbr>' : '';
  return '<label class="event-edit-field' + reqClass + '"><span class="event-edit-label">' + escapeHtml(lab) + reqMark + '</span>' +
    '<input type="text" class="event-edit-input event-edit-input--readonly" name="' + escapeHtmlAttr(k) + '" value="' + escapeHtmlAttr(str) + '" readonly tabindex="-1" aria-readonly="true" autocomplete="off"></label>';
}

function buildUintField(k, lab, raw, required) {
  const v = raw[k];
  const str = v === null || v === undefined || v === '' ? '' : String(v);
  const reqClass = required ? ' event-edit-field--required' : '';
  const reqMark = required ? ' <abbr class="event-edit-required-mark" title="Обязательное поле">*</abbr>' : '';
  return '<label class="event-edit-field' + reqClass + '"><span class="event-edit-label">' + escapeHtml(lab) + reqMark + '</span>' +
    '<input type="number" class="event-edit-input" name="' + escapeHtmlAttr(k) + '" value="' + escapeHtmlAttr(str) + '" min="0" max="4294967295" step="1" inputmode="numeric" autocomplete="off"></label>';
}

function buildReadonlyUintField(k, lab, raw) {
  const v = raw[k];
  const str = v === null || v === undefined || v === '' ? '' : String(v);
  return '<label class="event-edit-field event-edit-field--readonly"><span class="event-edit-label">' + escapeHtml(lab) + '</span>' +
    '<input type="number" class="event-edit-input event-edit-input--readonly" name="' + escapeHtmlAttr(k) + '" value="' + escapeHtmlAttr(str) + '" min="0" step="1" readonly aria-readonly="true" tabindex="-1" autocomplete="off"></label>';
}

/**
 * @param {string} k — field key
 * @param {string} lab — display label
 * @param {object} raw — raw event data
 * @param {object} opts — { type, formsOpts, levelsOpts, orgTypesOpts }
 */
function renderEditField(k, lab, raw, opts) {
  const { type, formsOpts, levelsOpts, orgTypesOpts } = opts;
  const required = isEventRequiredFieldKey(k, type);
  if (isEventUintFieldKey(type, k)) {
    if (type === 'part' && (k === 'participants_amount' || k === 'winner_amount' || k === 'runner_up_amount')) {
      return buildReadonlyUintField(k, lab, raw);
    }
    return buildUintField(k, lab, raw, required);
  }
  const v = raw[k];
  const str = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (type === 'org' && k === 'types_of_organization') {
    const curOrg = raw.types_of_organization != null ? raw.types_of_organization : raw.type;
    const curStr = curOrg == null ? '' : String(curOrg);
    let selectOpts = orgTypesOpts && orgTypesOpts.length ? orgTypesOpts.slice() : [];
    if (curStr !== '') {
      const found = selectOpts.some(function (o) { return String(o.value) === curStr; });
      if (!found) selectOpts.unshift({ value: curStr, label: 'Тип #' + curStr });
    }
    if (selectOpts.length === 0) {
      selectOpts = [{ value: '', label: '— выберите тип —' }];
    }
    return buildSelectField('types_of_organization', lab, curStr, selectOpts, required);
  }
  if (type === 'org' && k === 'day_of_the_week') {
    return buildOrgReadonlyDayField(k, lab, raw, required);
  }
  if (type === 'part' && k === 'form_of_holding') {
    const opts = formsOpts && formsOpts.length ? formsOpts : [];
    return buildSelectField(k, lab, str, opts, required);
  }
  if (type === 'part' && k === 'id_type') {
    const opts = levelsOpts && levelsOpts.length ? levelsOpts : [];
    return buildSelectField(k, lab, str, opts, required);
  }
  if (k === 'registration_deadline') {
    return buildDateField(k, lab, raw, required);
  }
  if (k === 'dates_of_event' && type === 'org') {
    if (raw[k] == null || String(raw[k]).trim() === '' || parseDateValueToInputIso(raw[k]) !== '') {
      return buildDateField(k, lab, raw, required);
    }
    return buildPlainField(k, lab, raw, required, getMaxStringLenForEventField(type, k));
  }
  if (k === 'link') {
    return buildLinkField(k, lab, raw, required, getMaxStringLenForEventField(type, k));
  }
  return buildPlainField(k, lab, raw, required, getMaxStringLenForEventField(type, k));
}

module.exports = {
  renderEditField
};
