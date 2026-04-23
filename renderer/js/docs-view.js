'use strict';

const { ipcRenderer, shell, clipboard } = require('electron');
const { apiRequest, unwrapResponse } = require('./api-client.js');
const API = require('./api-paths.js');
const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');

const ADMIN_ACCESS_LEVELS = [1, 4, 6];
const copySvg = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="10" height="10" rx="2" ry="2"/><path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"/></svg>';

function normalizeExternalUrl(value) {
  var t = String(value || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\/\//.test(t)) return 'https:' + t;
  return 'https://' + t;
}

function hasDocsEditAccess(user) {
  var level = user && (user.accessLevel != null ? user.accessLevel : user.access_level_id);
  var n = Number(level);
  return !isNaN(n) && ADMIN_ACCESS_LEVELS.indexOf(n) >= 0;
}

module.exports = function renderDocsView(container) {
  if (!container) return;
  var docs = [];
  var draftDocs = [];
  var canEdit = false;
  var editMode = false;

  container.innerHTML = '<div class="docs-view"><div class="events-loading">Загрузка документов...</div></div>';
  var viewEl = container.querySelector('.docs-view');
  if (!viewEl) return;

  function setMsg(text, kind) {
    var msg = document.getElementById('docsMsg');
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'docs-msg' + (kind ? ' docs-msg--' + kind : '');
  }

  function render() {
    var headActions = canEdit
      ? '<button type="button" class="docs-edit-btn" id="docsToggleEditBtn">' + (editMode ? 'Отмена' : 'Редактировать') + '</button>'
      : '';
    var toolbarHtml = headActions ? '<div class="docs-toolbar"><div class="docs-actions">' + headActions + '</div></div>' : '';
    if (!editMode) {
      var rows = docs.map(function (d, idx) {
        var title = d.name || 'Без названия';
        return '<article class="docs-row" data-doc-index="' + idx + '" role="button" tabindex="0" title="Открыть ссылку">' +
          '<div class="docs-row__main">' +
          '<h4 class="docs-row__title">' + escapeHtml(title) + '</h4>' +
          '</div>' +
          '<button type="button" class="docs-copy-btn" data-doc-index="' + idx + '" aria-label="Копировать ссылку" title="Копировать ссылку">' + copySvg + '</button>' +
          '</article>';
      }).join('');
      viewEl.innerHTML =
        toolbarHtml +
        '<div class="docs-msg" id="docsMsg"></div>' +
        '<div class="docs-list">' + (rows || '<p class="content-placeholder">Документы не добавлены.</p>') + '</div>';
    } else {
      var rows = draftDocs.map(function (d, idx) {
        return '<div class="docs-edit-row" data-doc-index="' + idx + '">' +
          '<label class="docs-edit-field">' +
          '<span class="docs-edit-field__label docs-edit-field__label--name">Название</span>' +
          '<input type="text" class="docs-edit-input" data-field="name" data-doc-index="' + idx + '" placeholder="Название документа" value="' + escapeHtmlAttr(d.name || '') + '">' +
          '</label>' +
          '<label class="docs-edit-field docs-edit-field--link">' +
          '<span class="docs-edit-field__label docs-edit-field__label--link">Ссылка</span>' +
          '<input type="text" class="docs-edit-input docs-edit-input--link" data-field="link" data-doc-index="' + idx + '" placeholder="https://..." value="' + escapeHtmlAttr(d.link || '') + '">' +
          '</label>' +
          '<button type="button" class="docs-row-remove-btn" data-doc-index="' + idx + '">Удалить</button>' +
          '</div>';
      }).join('');
      viewEl.innerHTML =
        toolbarHtml +
        '<div class="docs-msg" id="docsMsg"></div>' +
        '<div class="docs-editor">' +
        '<div class="docs-edit-list">' + rows + '</div>' +
        '<div class="docs-editor-actions">' +
        '<button type="button" class="docs-add-btn" id="docsAddRowBtn">Добавить ссылку</button>' +
        '<button type="button" class="docs-save-btn" id="docsSaveBtn">Сохранить</button>' +
        '</div>' +
        '</div>';
    }
    wire();
  }

  function wire() {
    var toggleBtn = document.getElementById('docsToggleEditBtn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        editMode = !editMode;
        draftDocs = docs.map(function (d) { return { id: d.id, name: d.name || '', link: d.link || '' }; });
        render();
      });
    }

    if (!editMode) {
      viewEl.querySelectorAll('.docs-row').forEach(function (card) {
        var open = function () {
          var idx = parseInt(card.getAttribute('data-doc-index'), 10);
          var d = docs[idx];
          if (!d || !d.link) return;
          var url = normalizeExternalUrl(d.link);
          if (!url) return;
          shell.openExternal(url).catch(function (e) {
            setMsg((e && e.message) || 'Не удалось открыть ссылку.', 'err');
          });
        };
        card.addEventListener('click', open);
        card.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        });
      });
      viewEl.querySelectorAll('.docs-copy-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = parseInt(btn.getAttribute('data-doc-index'), 10);
          var d = docs[idx];
          if (!d || !d.link) {
            setMsg('Ссылка отсутствует.', 'err');
            return;
          }
          clipboard.writeText(String(d.link));
          setMsg('Ссылка скопирована.', 'ok');
        });
      });
      return;
    }

    var addBtn = document.getElementById('docsAddRowBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        draftDocs.push({ id: null, name: '', link: '' });
        render();
      });
    }

    var saveBtn = document.getElementById('docsSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        setMsg('');
        var i;
        for (i = 0; i < draftDocs.length; i++) {
          if (!String(draftDocs[i].name || '').trim() || !String(draftDocs[i].link || '').trim()) {
            setMsg('Заполните название и ссылку у всех документов.', 'err');
            return;
          }
        }
        saveBtn.disabled = true;
        try {
          var originalById = {};
          docs.forEach(function (d) { if (d.id != null) originalById[String(d.id)] = d; });
          var draftIds = {};
          draftDocs.forEach(function (d) { if (d.id != null) draftIds[String(d.id)] = true; });

          for (var k in originalById) {
            if (!Object.prototype.hasOwnProperty.call(originalById, k)) continue;
            if (!draftIds[k]) await apiRequest('DELETE', API.REFERENCE.DOC_BY_ID(k));
          }
          for (i = 0; i < draftDocs.length; i++) {
            var row = draftDocs[i];
            var payload = { name: String(row.name).trim(), link: String(row.link).trim() };
            if (row.id == null) {
              await apiRequest('POST', API.REFERENCE.DOCS, payload);
              continue;
            }
            var orig = originalById[String(row.id)];
            if (!orig || String(orig.name || '') !== payload.name || String(orig.link || '') !== payload.link) {
              await apiRequest('PUT', API.REFERENCE.DOC_BY_ID(row.id), payload);
            }
          }
          await loadDocs();
          editMode = false;
          draftDocs = docs.map(function (d) { return { id: d.id, name: d.name || '', link: d.link || '' }; });
          render();
          setMsg('Документы обновлены.', 'ok');
        } catch (err) {
          setMsg((err && err.message) || 'Не удалось сохранить документы.', 'err');
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    viewEl.querySelectorAll('.docs-edit-input').forEach(function (input) {
      input.addEventListener('input', function () {
        var idx = parseInt(input.getAttribute('data-doc-index'), 10);
        var field = input.getAttribute('data-field');
        if (isNaN(idx) || !draftDocs[idx] || !field) return;
        draftDocs[idx][field] = input.value;
      });
    });
    viewEl.querySelectorAll('.docs-row-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-doc-index'), 10);
        if (isNaN(idx)) return;
        draftDocs.splice(idx, 1);
        render();
      });
    });
  }

  async function loadDocs() {
    var res = await apiRequest('GET', API.REFERENCE.DOCS);
    var list = unwrapResponse(res);
    docs = Array.isArray(list) ? list : [];
  }

  (async function init() {
    try {
      var user = await ipcRenderer.invoke('get-user');
      canEdit = hasDocsEditAccess(user);
      await loadDocs();
      draftDocs = docs.map(function (d) { return { id: d.id, name: d.name || '', link: d.link || '' }; });
      render();
    } catch (err) {
      viewEl.innerHTML = '<p class="content-error">Не удалось загрузить документы: ' + escapeHtml((err && err.message) || 'ошибка') + '</p>';
    }
  })();
};
