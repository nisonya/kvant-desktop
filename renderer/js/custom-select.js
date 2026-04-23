'use strict';

const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');

function createCustomSelect(id, options, selectedValue, placeholder) {
  var html = '<div class="custom-select" id="' + id + '">';
  html += '<button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false">';
  html += '<span class="custom-select-value">' + escapeHtml(placeholder || 'Выберите') + '</span>';
  html += '<span class="custom-select-arrow"></span></button>';
  html += '<div class="custom-select-dropdown" role="listbox">';
  options.forEach(function (opt) {
    var val = opt.value !== undefined && opt.value !== null ? String(opt.value) : '';
    var label = opt.label || opt.name || val || '—';
    var sel = (selectedValue === val || (selectedValue === '' && val === '')) ? ' custom-select-option--selected' : '';
    html += '<div class="custom-select-option' + sel + '" role="option" data-value="' + escapeHtmlAttr(String(opt.value === '' ? '' : opt.value)) + '">' + escapeHtml(label) + '</div>';
  });

  html += '</div></div>';
  return html;
}

function initCustomSelect(containerId, onChange) {
  var wrap = document.getElementById(containerId);
  if (!wrap) return null;
  var trigger = wrap.querySelector('.custom-select-trigger');
  var valueEl = wrap.querySelector('.custom-select-value');
  var dropdown = wrap.querySelector('.custom-select-dropdown');
  var options = wrap.querySelectorAll('.custom-select-option');
  var currentValue = '';

  options.forEach(function (opt) {
    if (opt.classList.contains('custom-select-option--selected')) {
      var iv = opt.getAttribute('data-value');
      currentValue = iv !== null ? iv : (opt.dataset.value != null ? String(opt.dataset.value) : '');
    }
    opt.addEventListener('click', function () {
      var v = this.getAttribute('data-value');
      if (v === null) v = this.dataset.value != null ? String(this.dataset.value) : '';
      currentValue = v;
      valueEl.textContent = this.textContent;
      options.forEach(function (o) { o.classList.remove('custom-select-option--selected'); });
      this.classList.add('custom-select-option--selected');
      wrap.classList.remove('custom-select--open');
      trigger.setAttribute('aria-expanded', 'false');
      if (onChange) onChange(v);
    });
  });

  trigger.addEventListener('click', function (e) {
    e.stopPropagation();
    var isOpen = wrap.classList.toggle('custom-select--open');
    trigger.setAttribute('aria-expanded', isOpen);
  });

  document.addEventListener('click', function () {
    wrap.classList.remove('custom-select--open');
    trigger.setAttribute('aria-expanded', 'false');
  });

  return {
    getValue: function () { return currentValue; },
    setOptions: function (opts, selectedVal) {
      var requested = selectedVal !== undefined
        ? String(selectedVal != null ? selectedVal : '')
        : String(currentValue != null ? currentValue : '');
      var hasRequested = opts.some(function (o) {
        var v = o.value !== undefined && o.value !== null ? String(o.value) : '';
        return requested === v || (requested === '' && v === '');
      });
      var sel = hasRequested ? requested : (opts[0] ? String(opts[0].value !== undefined && opts[0].value !== null ? opts[0].value : '') : '');
      currentValue = sel;
      dropdown.innerHTML = opts.map(function (o) {
        var v = o.value !== undefined && o.value !== null ? String(o.value) : '';
        var lbl = o.label || o.name || v || '—';
        var s = (sel === v || (sel === '' && v === '')) ? ' custom-select-option--selected' : '';
        return '<div class="custom-select-option' + s + '" role="option" data-value="' + escapeHtmlAttr(v) + '">' + escapeHtml(lbl) + '</div>';
      }).join('');
      var selOpt = opts.find(function (o) {
        var v = o.value !== undefined && o.value !== null ? String(o.value) : '';
        return sel === v || (sel === '' && v === '');
      });
      valueEl.textContent = selOpt ? (selOpt.label || selOpt.name || '—') : (opts[0] ? (opts[0].label || opts[0].name || '—') : '');
      var newOpts = dropdown.querySelectorAll('.custom-select-option');
      newOpts.forEach(function (opt) {
        opt.addEventListener('click', function () {
          var dv = this.getAttribute('data-value');
          currentValue = dv !== null ? dv : (this.dataset.value != null ? String(this.dataset.value) : '');
          valueEl.textContent = this.textContent;
          newOpts.forEach(function (o) { o.classList.remove('custom-select-option--selected'); });
          this.classList.add('custom-select-option--selected');
          wrap.classList.remove('custom-select--open');
          trigger.setAttribute('aria-expanded', 'false');
          if (onChange) onChange(currentValue);
        });
      });
    }
  };
}

module.exports = {
  createCustomSelect,
  initCustomSelect
};
