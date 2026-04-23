'use strict';

function initialFormStringKeysFromRaw(raw, keys) {
  var o = {};
  keys.forEach(function (k) {
    var v = raw[k];
    o[k] = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  return o;
}

function readFormStringKeys(form, keys) {
  var o = {};
  keys.forEach(function (k) {
    var el = form.elements.namedItem(k);
    o[k] = el ? String(el.value) : '';
  });
  return o;
}

function formStringsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

module.exports = {
  initialFormStringKeysFromRaw,
  readFormStringKeys,
  formStringsEqual
};
