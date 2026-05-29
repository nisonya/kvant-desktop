'use strict';

const { apiRequest, apiFetchBlob, apiRequestMultipart, unwrapResponse } = require('../api-client.js');
const { escapeHtml, escapeHtmlAttr } = require('../html-escape.js');

var eventDetailDocBlobUrls = [];

function revokeAllEventDocBlobs() {
  eventDetailDocBlobUrls.forEach(function (u) {
    try { URL.revokeObjectURL(u); } catch (e) {}
  });
  eventDetailDocBlobUrls = [];
}

/**
 * Сообщение пользователю при ошибке загрузки списка документов (GET …/documents).
 */
function formatDocumentListError(err) {
  var m = err && err.message ? String(err.message) : 'Не удалось загрузить список документов';
  if (/503|Service Unavailable|недоступен/i.test(m)) {
    return 'Хранилище документов на сервере не настроено или временно недоступно (код 503).';
  }
  if (/404|не найден/i.test(m)) {
    return 'Мероприятие не найдено или список документов недоступен.';
  }
  if (/401|Сессия|истекла/i.test(m)) {
    return 'Сессия истекла. Войдите снова.';
  }
  return m;
}

function formatDocumentOperationError(err, fallback) {
  var m = err && err.message ? String(err.message) : '';
  if (/503|Service Unavailable/i.test(m)) {
    return 'Сервис документов недоступен. Проверьте настройки сервера.';
  }
  if (/413|слишком больш|too large|размер/i.test(m)) {
    return 'Файл слишком большой (лимит на сервере до 50 МБ).';
  }
  if (/400/.test(m) && /file|файл/i.test(m)) {
    return m;
  }
  return m || fallback;
}

function formatEventDocFileSize(bytes) {
  if (bytes == null || bytes === '') return '—';
  var n = Number(bytes);
  if (isNaN(n)) return '—';
  if (n < 1024) return n + ' Б';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
  return (n / 1024 / 1024).toFixed(1) + ' МБ';
}

function eventDocMimeCategory(mime, filename) {
  var m = (mime || '').toLowerCase();
  if (m.indexOf('image/') === 0) return 'image';
  if (m === 'application/pdf' || /\.pdf$/i.test(filename || '')) return 'pdf';
  return 'other';
}

function sortEventDocumentsList(documents) {
  if (!documents || !documents.length) return [];
  return documents.slice().sort(function (a, b) {
    var so = (a.sort_order != null ? Number(a.sort_order) : 0) - (b.sort_order != null ? Number(b.sort_order) : 0);
    if (so !== 0) return so;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
}

function buildEventDocumentsSlidesInnerHtml(documents) {
  var sorted = sortEventDocumentsList(documents);
  if (!sorted.length) {
    return '<p class="event-doc-empty">Нет документов. Нажмите «Добавить документ».</p>';
  }
  return sorted.map(function (doc) {
    var id = doc.id != null ? String(doc.id) : '';
    var name = doc.original_filename || 'файл';
    var sz = formatEventDocFileSize(doc.size_bytes);
    return '<div class="event-doc-slide" data-doc-id="' + escapeHtmlAttr(id) + '">' +
      '<div class="event-doc-slide__preview-wrap">' +
      '<div class="event-doc-slide__preview event-doc-preview--loading" data-doc-preview>Загрузка…</div></div>' +
      '<div class="event-doc-slide__meta">' +
      '<span class="event-doc-slide__name" title="' + escapeHtmlAttr(name) + '">' + escapeHtml(name) + '</span>' +
      '<span class="event-doc-slide__size">' + escapeHtml(sz) + '</span></div>' +
      '<div class="event-doc-slide__actions">' +
      '<button type="button" class="event-doc-btn event-doc-btn--dl">Скачать</button>' +
      '<button type="button" class="event-doc-btn event-doc-btn--rm">Удалить</button>' +
      '</div></div>';
  }).join('');
}

/**
 * @param {boolean} createMode
 * @param {Array} documents
 * @param {string} [listError] — ошибка при первичной загрузке списка (показывается над каруселью)
 */
function buildEventDocumentsSectionHtml(createMode, documents, listError) {
  listError = listError || '';
  var slides = buildEventDocumentsSlidesInnerHtml(documents);
  if (createMode) {
    return '<section class="event-detail-card event-detail-card--docs" id="eventDocumentsSection" aria-labelledby="eventDocsHeading">' +
      '<h3 class="event-detail-card__title" id="eventDocsHeading">Документы</h3>' +
      '<p class="event-doc-placeholder">После сохранения мероприятия здесь можно будет прикреплять файлы.</p></section>';
  }
  var msgHtml = listError
    ? '<p class="event-doc-msg event-doc-msg--err" id="eventDocMsg" style="display:block">' + escapeHtml(listError) + '</p>'
    : '<p class="event-doc-msg" id="eventDocMsg" style="display:none"></p>';
  return '<section class="event-detail-card event-detail-card--docs" id="eventDocumentsSection" aria-labelledby="eventDocsHeading">' +
    '<div class="event-detail-card-head">' +
    '<h3 class="event-detail-card__title" id="eventDocsHeading">Документы</h3>' +
    '<button type="button" class="event-doc-btn event-doc-btn--add" id="eventDocAddBtn">Добавить документ</button>' +
    '</div>' +
    '<input type="file" id="eventDocFileInput" class="event-doc-file-input" tabindex="-1" aria-hidden="true" multiple>' +
    '<div class="event-doc-upload-overlay" id="eventDocUploadOverlay" style="display:none">' +
    '<div class="event-doc-upload-overlay__inner">' +
    '<div class="event-doc-upload-spinner"></div>' +
    '<span class="event-doc-upload-overlay__text" id="eventDocUploadText">Загрузка файла…</span>' +
    '</div></div>' +
    msgHtml +
    '<div class="event-doc-carousel-outer">' +
    '<button type="button" class="event-doc-carousel__arrow event-doc-carousel__arrow--prev" id="eventDocPrev" aria-label="Назад">‹</button>' +
    '<div class="event-doc-carousel" id="eventDocCarousel">' + slides + '</div>' +
    '<button type="button" class="event-doc-carousel__arrow event-doc-carousel__arrow--next" id="eventDocNext" aria-label="Вперёд">›</button>' +
    '</div></section>';
}

async function hydrateEventDocumentPreviews(carouselEl, documents, basePath) {
  if (!carouselEl || !documents || !documents.length) return;
  var byId = {};
  documents.forEach(function (d) {
    if (d.id != null) byId[String(d.id)] = d;
  });
  var slides = carouselEl.querySelectorAll('.event-doc-slide');
  var tasks = [];
  for (var i = 0; i < slides.length; i++) {
    (function (slide) {
      var id = slide.getAttribute('data-doc-id');
      var doc = byId[id];
      var prevEl = slide.querySelector('[data-doc-preview]');
      if (!doc || !prevEl) return;
      var cat = eventDocMimeCategory(doc.mime_type, doc.original_filename);
      tasks.push((async function () {
        if (cat === 'other') {
          prevEl.classList.remove('event-doc-preview--loading');
          var fn = doc.original_filename || '';
          var ext = (fn.indexOf('.') >= 0 ? fn.split('.').pop() : '') || 'file';
          prevEl.innerHTML = '<div class="event-doc-preview-fallback"><span class="event-doc-preview-fallback__ext">' +
            escapeHtml(String(ext).toUpperCase()) + '</span>' +
            '<span class="event-doc-preview-fallback__hint">Предпросмотр недоступен</span></div>';
          return;
        }
        var path = basePath + '/documents/' + id + '/download';
        try {
          var blob = await apiFetchBlob(path);
          var url = URL.createObjectURL(blob);
          eventDetailDocBlobUrls.push(url);
          prevEl.classList.remove('event-doc-preview--loading');
          if (cat === 'image') {
            prevEl.innerHTML = '<img class="event-doc-preview-img" src="' + url + '" alt="' + escapeHtmlAttr(doc.original_filename || '') + '">';
          } else {
            prevEl.innerHTML = '<iframe class="event-doc-preview-iframe" src="' + url + '" title="' + escapeHtmlAttr(doc.original_filename || '') + '"></iframe>';
          }
        } catch (e) {
          console.warn('[event-documents] preview', e);
          prevEl.classList.remove('event-doc-preview--loading');
          var hint = formatDocumentOperationError(e, 'Не удалось загрузить превью');
          prevEl.innerHTML = '<div class="event-doc-preview-err">' + escapeHtml(hint) + '</div>';
        }
      })());
    })(slides[i]);
  }
  await Promise.all(tasks);
}

function wireEventDocumentsSection(eventId, createMode, basePath) {
  if (createMode) return;
  var carousel = document.getElementById('eventDocCarousel');
  var addBtn = document.getElementById('eventDocAddBtn');
  var fileInput = document.getElementById('eventDocFileInput');
  var msgEl = document.getElementById('eventDocMsg');
  var prevBtn = document.getElementById('eventDocPrev');
  var nextBtn = document.getElementById('eventDocNext');

  function showDocMsg(text, isErr) {
    if (!msgEl) return;
    if (!text) {
      msgEl.textContent = '';
      msgEl.style.display = 'none';
      msgEl.className = 'event-doc-msg';
      return;
    }
    msgEl.textContent = text;
    msgEl.style.display = 'block';
    msgEl.className = 'event-doc-msg' + (isErr ? ' event-doc-msg--err' : '');
  }

  async function refreshEventDocumentsPanel(docs) {
    revokeAllEventDocBlobs();
    var carouselEl = document.getElementById('eventDocCarousel');
    if (!carouselEl) return;
    carouselEl.innerHTML = buildEventDocumentsSlidesInnerHtml(docs || []);
    try {
      await hydrateEventDocumentPreviews(carouselEl, docs || [], basePath);
    } catch (e) {
      console.warn('[event-documents] hydrate after refresh', e);
      showDocMsg(formatDocumentOperationError(e, 'Не удалось обновить превью документов'), true);
    }
  }

  async function fetchDocumentsList() {
    var docRes = await apiRequest('GET', basePath + '/' + eventId + '/documents');
    var docs = unwrapResponse(docRes);
    return Array.isArray(docs) ? docs : [];
  }

  var uploadOverlay = document.getElementById('eventDocUploadOverlay');
  var uploadText = document.getElementById('eventDocUploadText');

  function setUploadBusy(busy, text) {
    if (addBtn) addBtn.disabled = busy;
    if (uploadOverlay) uploadOverlay.style.display = busy ? 'flex' : 'none';
    if (uploadText && text) uploadText.textContent = text;
  }

  if (addBtn && fileInput) {
    addBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', async function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      fileInput.value = '';
      if (!files || !files.length) return;
      showDocMsg('');
      var total = files.length;
      var errors = [];
      setUploadBusy(true, total === 1
        ? 'Загрузка файла…'
        : 'Загрузка 1 из ' + total + '…');
      try {
        for (var fi = 0; fi < total; fi++) {
          if (total > 1) {
            setUploadBusy(true, 'Загрузка ' + (fi + 1) + ' из ' + total + '…');
          }
          try {
            var fd = new FormData();
            fd.append('file', files[fi]);
            await apiRequestMultipart(basePath + '/' + eventId + '/documents', fd);
          } catch (err) {
            console.error('[event-documents] upload', files[fi].name, err);
            errors.push((files[fi].name || 'файл') + ': ' + formatDocumentOperationError(err, 'ошибка'));
          }
        }
      } finally {
        setUploadBusy(false);
      }
      if (errors.length) {
        showDocMsg(errors.join('; '), true);
      }
      try {
        var list = await fetchDocumentsList();
        await refreshEventDocumentsPanel(list);
      } catch (fetchErr) {
        showDocMsg(formatDocumentListError(fetchErr), true);
      }
    });
  }

  if (carousel) {
    carousel.addEventListener('click', async function (e) {
      var dl = e.target.closest('.event-doc-btn--dl');
      var rm = e.target.closest('.event-doc-btn--rm');
      var slide = e.target.closest('.event-doc-slide');
      if (!slide || !carousel.contains(slide)) return;
      var docId = slide.getAttribute('data-doc-id');
      if (!docId) return;

      if (dl) {
        var nameEl = slide.querySelector('.event-doc-slide__name');
        var fname = nameEl ? nameEl.getAttribute('title') || nameEl.textContent : 'document';
        showDocMsg('');
        try {
          var path = basePath + '/documents/' + docId + '/download';
          var blob = await apiFetchBlob(path);
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = fname || 'document';
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e2) {} }, 2000);
        } catch (err) {
          console.error('[event-documents] download', err);
          showDocMsg(formatDocumentOperationError(err, 'Не удалось скачать файл'), true);
        }
        return;
      }

      if (rm) {
        if (!window.confirm('Удалить этот документ?')) return;
        showDocMsg('');
        try {
          await apiRequest('DELETE', basePath + '/documents/' + docId);
          var list;
          try {
            list = await fetchDocumentsList();
          } catch (fetchErr) {
            showDocMsg(formatDocumentListError(fetchErr), true);
            return;
          }
          await refreshEventDocumentsPanel(list);
        } catch (err) {
          console.error('[event-documents] delete', err);
          showDocMsg(formatDocumentOperationError(err, 'Не удалось удалить документ'), true);
        }
      }
    });
  }

  function scrollCarousel(delta) {
    if (!carousel) return;
    var w = carousel.clientWidth || 400;
    carousel.scrollBy({ left: delta * Math.min(420, w * 0.85), behavior: 'smooth' });
  }
  if (prevBtn) prevBtn.addEventListener('click', function () { scrollCarousel(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { scrollCarousel(1); });
}

module.exports = {
  revokeAllEventDocBlobs,
  formatDocumentListError,
  buildEventDocumentsSlidesInnerHtml,
  buildEventDocumentsSectionHtml,
  hydrateEventDocumentPreviews,
  wireEventDocumentsSection
};
