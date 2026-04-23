'use strict';

const { EVENT_SCHEMA_STRING_MAX } = require('./event-constants.js');

function getMaxStringLenForEventField(eventType, k) {
  var m = EVENT_SCHEMA_STRING_MAX[eventType];
  return m && Object.prototype.hasOwnProperty.call(m, k) ? m[k] : undefined;
}

function isEventUintFieldKey(eventType, k) {
  if (eventType === 'org' && (k === 'amount_of_applications' || k === 'amount_of_planning_application')) return true;
  if (eventType === 'part' && (k === 'participants_amount' || k === 'winner_amount' || k === 'runner_up_amount')) return true;
  return false;
}

function validateEventSchemaFields(form, eventType, formKeys) {
  var ok = true;
  if (!form || !formKeys) return false;
  formKeys.forEach(function (k) {
    var el = form.elements.namedItem(k);
    if (!el) return;
    var wrap = el.closest('.event-edit-field');
    if (wrap) wrap.classList.remove('event-edit-field--invalid');
  });
  formKeys.forEach(function (k) {
    var el = form.elements.namedItem(k);
    if (!el) return;
    var wrap = el.closest('.event-edit-field');
    if (isEventUintFieldKey(eventType, k)) {
      var txt = (el.value || '').trim();
      if (txt === '') return;
      if (!/^\d+$/.test(txt)) {
        ok = false;
        if (wrap) wrap.classList.add('event-edit-field--invalid');
        return;
      }
      var n = parseInt(txt, 10);
      if (n > 4294967295) {
        ok = false;
        if (wrap) wrap.classList.add('event-edit-field--invalid');
      }
      return;
    }
    var max = getMaxStringLenForEventField(eventType, k);
    if (max == null || max <= 0) return;
    var val = el.type === 'date' ? (el.value || '') : String(el.value || '');
    if (val.length > max) {
      ok = false;
      if (wrap) wrap.classList.add('event-edit-field--invalid');
    }
  });
  return ok;
}

function clearEventFieldInvalid(form) {
  if (!form) return;
  form.querySelectorAll('.event-edit-field--invalid').forEach(function (lbl) {
    lbl.classList.remove('event-edit-field--invalid');
  });
}

function validateEventRequiredFields(form, eventType) {
  var ok = true;
  var req = ['name'];
  if (eventType === 'part') req.push('registration_deadline');
  req.forEach(function (name) {
    var el = form.elements.namedItem(name);
    if (!el) return;
    var wrap = el.closest('.event-edit-field');
    var val = (el.value || '').trim();
    if (val === '') {
      ok = false;
      if (wrap) wrap.classList.add('event-edit-field--invalid');
    }
  });
  return ok;
}

function attachEventFormValidationListeners(form) {
  if (!form) return;
  form.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.name) return;
    var wrap = t.closest('.event-edit-field');
    if (wrap) wrap.classList.remove('event-edit-field--invalid');
  });
  form.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.name) return;
    var wrap = t.closest('.event-edit-field');
    if (wrap) wrap.classList.remove('event-edit-field--invalid');
  });
}

function isEventRequiredFieldKey(k, eventType) {
  if (k === 'name') return true;
  if (eventType === 'part' && k === 'registration_deadline') return true;
  return false;
}

module.exports = {
  getMaxStringLenForEventField,
  isEventUintFieldKey,
  validateEventSchemaFields,
  clearEventFieldInvalid,
  validateEventRequiredFields,
  attachEventFormValidationListeners,
  isEventRequiredFieldKey
};
