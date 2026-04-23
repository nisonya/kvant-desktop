'use strict';

const { shell } = require('electron');
const { unwrapResponse } = require('../api-client.js');

function normalizeExternalUrl(s) {
  var t = String(s || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\/\//.test(t)) return 'https:' + t;
  return 'https://' + t;
}

/**
 * Экран детали мероприятия: загрузка full-inf, форма, ответственные, аренда, документы, сохранение.
 * Зависимости передаются из events-view (как в event-rent.js).
 */
function createOpenEventDetail(deps) {
  async function openEventDetail(eventId, options) {
    var {
      type, EVENT_BASE, API, apiRequest, detailPanel, listPanel, scrollEl, savedListScrollState,
      exitCtx, eventDocs, closeResponsibleModal, closeEventDetail,
      emptyRawForCreate, applyPartReferenceDefaults,
      ensurePartReferenceCaches, ensureOrgReferenceCaches,
      getPartLevelsOpts, getPartFormsOpts, getOrgTypesOpts,
      parseDateValueToInputIso, orgWeekdayCapsFromYyyyMmDd, dictItemsToOptions, extractDictArray,
      buildEventRentSectionHtml, buildEventRentListHtml, wireEventRentSection,
      cloneRentDraft, rentDraftsEqual, syncRentDraftToServer,
      orderedKeysForEdit, FIELD_LABELS, escapeHtml, escapeHtmlAttr,
      cloneRespDraft, respDraftsEqual, syncResponsibleDraftToServer,
      buildResponsibleDetailHtml, wireDetailResponsibleHandlers, openResponsibleModal,
      initialFormStringKeysFromRaw, readFormStringKeys, formStringsEqual,
      clearEventFieldInvalid, validateEventRequiredFields, validateEventSchemaFields,
      attachEventFormValidationListeners, isEventUintFieldKey, normalizeInputToMysqlDate,
      renderEditField, unsavedModalActions, openUnsavedModal, closeUnsavedModal, resetAndLoad
    } = deps;

options = options || {};
var createMode = options.create === true;
if (!createMode && (eventId == null || eventId === '')) return;
if (!detailPanel || !listPanel || !scrollEl) return;
exitCtx.clear();
savedListScrollState.top = scrollEl.scrollTop;
listPanel.style.display = 'none';
detailPanel.style.display = 'flex';
detailPanel.setAttribute('aria-hidden', 'false');
var base = EVENT_BASE[type];
eventDocs.revokeAllEventDocBlobs();
detailPanel.innerHTML = '<div class="event-detail-inner"><div class="event-detail-loading">Загрузка...</div></div>';

try {
  var raw;
  var formsOpts = [];
  var levelsOpts = [];
  var respListDetail = [];

  if (createMode) {
    raw = emptyRawForCreate(type);
    if (type === 'part') {
      await ensurePartReferenceCaches();
      levelsOpts = getPartLevelsOpts();
      formsOpts = getPartFormsOpts();
      applyPartReferenceDefaults(raw, levelsOpts, formsOpts);
    }
    if (type === 'org') {
      await ensureOrgReferenceCaches();
    }
  } else {
    var infRes;
    try {
      infRes = await apiRequest('GET', base + '/full-inf/' + eventId);
    } catch (getErr) {
      if (type === 'org' && base === API.EVENTS.ORG && (getErr.message || '').indexOf('404') >= 0) {
        console.warn('[main] events org full-inf 404, пробуем legacy organization path');
        EVENT_BASE.org = API.EVENTS.ORGANIZATION_LEGACY;
        base = EVENT_BASE.org;
        infRes = await apiRequest('GET', base + '/full-inf/' + eventId);
      } else {
        throw getErr;
      }
    }
    if (infRes && infRes.success === false) throw new Error(infRes.error || 'Ошибка API');
    raw = unwrapResponse(infRes);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.data != null && typeof raw.data === 'object') raw = raw.data;

    if (type === 'part') {
      await ensurePartReferenceCaches();
      levelsOpts = getPartLevelsOpts();
      formsOpts = getPartFormsOpts();
    }
    if (type === 'org') {
      await ensureOrgReferenceCaches();
    }

    try {
      if (type === 'part') {
        try {
          var rNew = await apiRequest('GET', base + '/responsible-new/' + eventId);
          respListDetail = unwrapResponse(rNew);
        } catch (e) {
          if ((e.message || '').indexOf('404') >= 0) {
            var rFallback = await apiRequest('GET', base + '/responsible/' + eventId);
            respListDetail = unwrapResponse(rFallback);
          } else {
            throw e;
          }
        }
      } else {
        var rRes = await apiRequest('GET', base + '/responsible/' + eventId);
        respListDetail = unwrapResponse(rRes);
      }
      respListDetail = Array.isArray(respListDetail) ? respListDetail : [];
    } catch (e) {
      console.warn('[main] detail responsible', e);
    }
  }

  if (type === 'org' && raw) {
    if (raw.types_of_organization == null && raw.type != null) {
      raw.types_of_organization = raw.type;
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'types_of_organization')) {
      raw.types_of_organization = '';
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'day_of_the_week')) {
      raw.day_of_the_week = '';
    }
    var isoForWeek = parseDateValueToInputIso(raw.dates_of_event);
    if (isoForWeek !== '') {
      raw.day_of_the_week = orgWeekdayCapsFromYyyyMmDd(isoForWeek);
    }
    /** API: POST/PUT ожидают поле type (id из GET /api/reference/types-of-organization); по умолчанию — первый тип */
    var orgTypesOpts = getOrgTypesOpts();
    if (orgTypesOpts && orgTypesOpts.length) {
      var tSel = raw.types_of_organization != null ? raw.types_of_organization : raw.type;
      if (tSel == null || String(tSel).trim() === '') {
        raw.types_of_organization = String(orgTypesOpts[0].value);
      }
    }
  }

  var rentListRows = [];
  var roomsRentOpts = [];
  var defaultDateForRent = '';
  if (type === 'org') {
    defaultDateForRent = raw && raw.dates_of_event != null ? parseDateValueToInputIso(raw.dates_of_event) : '';
    if (!createMode) {
      try {
        var rentRes = await apiRequest('GET', API.RENT.BY_EVENT(eventId));
        rentListRows = unwrapResponse(rentRes);
        if (!Array.isArray(rentListRows)) rentListRows = [];
      } catch (e) {
        console.warn('[main] rent by-event', e);
      }
    }
    try {
      var roomsR = await apiRequest('GET', API.REFERENCE.ROOMS);
      roomsRentOpts = dictItemsToOptions(extractDictArray(roomsR));
    } catch (e) {
      console.warn('[main] reference/rooms', e);
    }
  }

  var eventDocumentsList = [];
  var eventDocumentsListError = '';
  if (!createMode) {
    try {
      var docListRes = await apiRequest('GET', base + '/' + eventId + '/documents');
      eventDocumentsList = unwrapResponse(docListRes);
      if (!Array.isArray(eventDocumentsList)) eventDocumentsList = [];
    } catch (e) {
      console.warn('[main] event documents list', e);
      eventDocumentsListError = eventDocs.formatDocumentListError(e);
    }
  }
  var stagedRentListRef = { list: cloneRentDraft(rentListRows) };
  var initialRentList = cloneRentDraft(rentListRows);
  var rentSectionHtml = buildEventRentSectionHtml(createMode, stagedRentListRef.list, roomsRentOpts);
  var documentsSectionHtml = eventDocs.buildEventDocumentsSectionHtml(createMode, eventDocumentsList, eventDocumentsListError);

  var keys = orderedKeysForEdit(raw, type);
  var titleName = createMode ? 'Новое мероприятие' : (raw.name ? String(raw.name) : 'Мероприятие');

  var formKeys = keys.filter(function (k) {
    if (k === 'id') return false;
    if (type === 'part' && k === 'level') return false;
    if (type === 'org' && k === 'type') return false;
    return true;
  });
  var stagedRespListRef = { list: cloneRespDraft(respListDetail) };
  var initialRespList = cloneRespDraft(respListDetail);
  var initialFormStrings;
  var putPath = base;

  var respSummaryHtml = buildResponsibleDetailHtml(type, stagedRespListRef.list, raw);

  async function refreshRespSummaryFromStaged() {
    var sumEl = document.getElementById('eventRespSummary');
    if (!sumEl) return;
    sumEl.innerHTML = buildResponsibleDetailHtml(type, stagedRespListRef.list, raw);
    wireDetailResponsibleHandlers(base, type, eventId, stagedRespListRef);
  }

  function isEventDetailDirty() {
    var form = document.getElementById('eventEditForm');
    if (!form) return false;
    if (!formStringsEqual(readFormStringKeys(form, formKeys), initialFormStrings)) return true;
    if (!respDraftsEqual(stagedRespListRef.list, initialRespList, type)) return true;
    if (createMode && type === 'org' && !rentDraftsEqual(stagedRentListRef.list, initialRentList)) return true;
    return false;
  }

  function getDefaultDateForRentFromForm() {
    var form = document.getElementById('eventEditForm');
    if (!form) return defaultDateForRent;
    var dateEl = form.elements.namedItem('dates_of_event');
    if (!dateEl) return defaultDateForRent;
    if (dateEl.type === 'date') {
      var v = String(dateEl.value || '').trim();
      return v || defaultDateForRent;
    }
    return parseDateValueToInputIso(dateEl.value) || defaultDateForRent;
  }

  async function reloadDetailAfterSave() {
    var refreshed = await apiRequest('GET', base + '/full-inf/' + eventId);
    var newRaw = unwrapResponse(refreshed);
    if (newRaw && newRaw.data != null) newRaw = newRaw.data;
    Object.assign(raw, newRaw || {});
    if (type === 'org' && raw && raw.types_of_organization == null && raw.type != null) {
      raw.types_of_organization = raw.type;
    }
    var form = document.getElementById('eventEditForm');
    if (form) {
      formKeys.forEach(function (k) {
        var el = form.elements.namedItem(k);
        if (!el) return;
        var v = raw[k];
        var str = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
        el.value = str;
      });
      if (type === 'org') {
        var dEl = form.elements.namedItem('dates_of_event');
        var wEl = form.elements.namedItem('day_of_the_week');
        if (dEl && wEl) {
          var isoR = dEl.type === 'date' ? String(dEl.value || '').trim() : parseDateValueToInputIso(dEl.value);
          wEl.value = isoR ? orgWeekdayCapsFromYyyyMmDd(isoR) : '';
        }
      }
    }
    var titleEl = detailPanel.querySelector('.event-detail-title');
    if (titleEl && raw.name) titleEl.textContent = String(raw.name);
    var freshResp = [];
    try {
      if (type === 'part') {
        try {
          var rN = await apiRequest('GET', base + '/responsible-new/' + eventId);
          freshResp = unwrapResponse(rN);
        } catch (e) {
          if ((e.message || '').indexOf('404') >= 0) {
            var rFb = await apiRequest('GET', base + '/responsible/' + eventId);
            freshResp = unwrapResponse(rFb);
          }
        }
      } else {
        var rOg = await apiRequest('GET', base + '/responsible/' + eventId);
        freshResp = unwrapResponse(rOg);
      }
    } catch (e) {
      console.warn('[main] reload resp after save', e);
    }
    freshResp = Array.isArray(freshResp) ? freshResp : [];
    initialRespList = cloneRespDraft(freshResp);
    stagedRespListRef.list = cloneRespDraft(freshResp);
    initialFormStrings = form
      ? readFormStringKeys(form, formKeys)
      : initialFormStringKeysFromRaw(raw, formKeys);
    var sumEl = document.getElementById('eventRespSummary');
    if (sumEl) {
      sumEl.innerHTML = buildResponsibleDetailHtml(type, stagedRespListRef.list, raw);
      wireDetailResponsibleHandlers(base, type, eventId, stagedRespListRef);
    }
    if (type === 'org') {
      var rentListEl = document.getElementById('eventRentList');
      if (rentListEl) {
        try {
          var rentR2 = await apiRequest('GET', API.RENT.BY_EVENT(eventId));
          var rowsR = unwrapResponse(rentR2);
          if (!Array.isArray(rowsR)) rowsR = [];
          rentListEl.innerHTML = buildEventRentListHtml(rowsR, roomsRentOpts);
        } catch (e) {
          console.warn('[main] reload rent after save', e);
        }
      }
    }
    var carDocReload = document.getElementById('eventDocCarousel');
    if (carDocReload) {
      try {
        eventDocs.revokeAllEventDocBlobs();
        var dRef = await apiRequest('GET', base + '/' + eventId + '/documents');
        var dList = unwrapResponse(dRef);
        if (!Array.isArray(dList)) dList = [];
        carDocReload.innerHTML = eventDocs.buildEventDocumentsSlidesInnerHtml(dList);
        await eventDocs.hydrateEventDocumentPreviews(carDocReload, dList, base);
      } catch (e) {
        console.warn('[main] reload docs after save', e);
        var docMsgEl = document.getElementById('eventDocMsg');
        if (docMsgEl) {
          docMsgEl.textContent = eventDocs.formatDocumentListError(e);
          docMsgEl.style.display = 'block';
          docMsgEl.className = 'event-doc-msg event-doc-msg--err';
        }
      }
    }
  }

  async function performSave() {
    var form = document.getElementById('eventEditForm');
    var msgEl = document.getElementById('eventSaveMsg');
    var saveBtn = document.getElementById('eventDetailSave');
    if (!form) return false;
    clearEventFieldInvalid(form);
    if (!validateEventRequiredFields(form, type)) {
      if (msgEl) { msgEl.textContent = ''; msgEl.className = 'event-save-msg'; }
      return false;
    }
    if (!validateEventSchemaFields(form, type, formKeys)) {
      if (msgEl) {
        msgEl.textContent = 'Проверьте длину текста и целые числа в допустимых пределах (см. ограничения БД).';
        msgEl.className = 'event-save-msg event-save-msg--err';
      }
      return false;
    }
    var body = {};
    if (!createMode) {
      var numId = parseInt(String(eventId), 10);
      body.id = !isNaN(numId) ? numId : eventId;
    }
    formKeys.forEach(function (k) {
      var el = form.elements.namedItem(k);
      if (!el) return;
      var txt = (el.value || '').trim();
      var orig = raw[k];
      if (type === 'part' && (k === 'id_type' || k === 'form_of_holding')) {
        if (txt === '') body[k] = null;
        else {
          var pi = parseInt(txt, 10);
          body[k] = !isNaN(pi) ? pi : txt;
        }
        return;
      }
      if (type === 'org' && k === 'types_of_organization') {
        if (txt === '') body.type = null;
        else {
          var piOrg = parseInt(txt, 10);
          body.type = !isNaN(piOrg) ? piOrg : txt;
        }
        return;
      }
      if (isEventUintFieldKey(type, k)) {
        body[k] = txt === '' ? null : parseInt(txt, 10);
        return;
      }
      if (k === 'registration_deadline') {
        if (el.type === 'date') body[k] = normalizeInputToMysqlDate(txt);
        else body[k] = txt === '' ? '' : txt;
        return;
      }
      if (k === 'dates_of_event' && type === 'org') {
        if (el.type === 'date') body[k] = normalizeInputToMysqlDate(txt);
        else body[k] = txt === '' ? '' : txt;
        return;
      }
      if (typeof orig === 'number' && txt !== '' && !isNaN(Number(txt))) body[k] = Number(txt);
      else if (typeof orig === 'number' && txt === '') body[k] = null;
      else if (typeof orig === 'boolean') body[k] = txt === 'true' || txt === '1';
      else if (orig !== null && typeof orig === 'object' && txt) {
        try { body[k] = JSON.parse(txt); } catch (e) { body[k] = txt; }
      } else {
        // Пустые необязательные строки: "" вместо null — иначе API часто трактует null как «поле не прислано» и требует его заполнить
        body[k] = txt === '' ? '' : txt;
      }
    });
    if (type === 'org') {
      delete body.types_of_organization;
    }
    if (saveBtn) saveBtn.disabled = true;
    if (msgEl) { msgEl.textContent = 'Сохранение...'; msgEl.className = 'event-save-msg'; }
    try {
      var saveRes;
      if (createMode) {
        try {
          saveRes = await apiRequest('POST', putPath, body);
        } catch (postErr) {
          if (type === 'org' && putPath === API.EVENTS.ORG && (postErr.message || '').indexOf('404') >= 0) {
            EVENT_BASE.org = API.EVENTS.ORGANIZATION_LEGACY;
            putPath = EVENT_BASE.org;
            base = EVENT_BASE.org;
            saveRes = await apiRequest('POST', putPath, body);
          } else {
            throw postErr;
          }
        }
        if (saveRes && saveRes.success === false) throw new Error(saveRes.error || 'Ошибка сохранения');
        var newId = saveRes.id != null ? saveRes.id : (saveRes.data && saveRes.data.id);
        if (newId == null || newId === '') throw new Error('Сервер не вернул id');
        await syncResponsibleDraftToServer(base, type, newId, initialRespList, stagedRespListRef.list);
        if (type === 'org') {
          await syncRentDraftToServer(newId, stagedRentListRef.list, getDefaultDateForRentFromForm);
        }
        // Для мероприятий участия итоговые количества считаются на сервере из вкладов ответственных.
        if (type === 'part') {
          var recalcBody = {};
          Object.keys(body).forEach(function (k) { recalcBody[k] = body[k]; });
          recalcBody.id = newId;
          var recalcRes = await apiRequest('PUT', putPath, recalcBody);
          if (recalcRes && recalcRes.success === false) throw new Error(recalcRes.error || 'Ошибка пересчёта итогов');
        }
        if (msgEl) { msgEl.textContent = 'Сохранено'; msgEl.className = 'event-save-msg event-save-msg--ok'; }
        await openEventDetail(newId);
        resetAndLoad();
        return true;
      }
      if (type === 'part') {
        await syncResponsibleDraftToServer(base, type, eventId, initialRespList, stagedRespListRef.list);
      }
      try {
        saveRes = await apiRequest('PUT', putPath, body);
      } catch (putErr) {
        if (type === 'org' && putPath === API.EVENTS.ORG && (putErr.message || '').indexOf('404') >= 0) {
          EVENT_BASE.org = API.EVENTS.ORGANIZATION_LEGACY;
          putPath = EVENT_BASE.org;
          base = EVENT_BASE.org;
          saveRes = await apiRequest('PUT', putPath, body);
        } else {
          throw putErr;
        }
      }
      if (saveRes && saveRes.success === false) throw new Error(saveRes.error || 'Ошибка сохранения');
      if (type !== 'part') {
        await syncResponsibleDraftToServer(base, type, eventId, initialRespList, stagedRespListRef.list);
      }
      await reloadDetailAfterSave();
      if (msgEl) { msgEl.textContent = 'Сохранено'; msgEl.className = 'event-save-msg event-save-msg--ok'; }
      return true;
    } catch (e) {
      console.error('[main] save event', e);
      if (msgEl) { msgEl.textContent = e.message || 'Ошибка'; msgEl.className = 'event-save-msg event-save-msg--err'; }
      return false;
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function requestCloseDetail() {
    closeResponsibleModal();
    if (!isEventDetailDirty()) {
      closeEventDetail();
      return;
    }
    unsavedModalActions.saveExit = async function () {
      var ok = await performSave();
      if (ok) {
        closeUnsavedModal();
        closeEventDetail();
      }
    };
    unsavedModalActions.discardExit = function () {
      closeUnsavedModal();
      closeEventDetail();
    };
    unsavedModalActions.cancel = function () {
      closeUnsavedModal();
    };
    openUnsavedModal();
  }

  exitCtx.set(requestCloseDetail);

  var editFields = keys.filter(function (k) {
    if (k === 'id') return false;
    if (type === 'part' && k === 'level') return false;
    if (type === 'org' && k === 'type') return false;
    return true;
  }).map(function (k) {
    var lab = FIELD_LABELS[k] || k;
    if (type === 'org' && k === 'dates_of_event') lab = 'Дата проведения';
    return renderEditField(k, lab, raw, { type: type, formsOpts: formsOpts, levelsOpts: levelsOpts, orgTypesOpts: getOrgTypesOpts() });
  }).join('');

  detailPanel.innerHTML = [
    '<div class="event-detail-inner">',
    '  <header class="event-detail-toolbar">',
    '    <div class="event-detail-toolbar__actions">',
    '      <button type="button" class="event-detail-back" id="eventDetailBack" aria-label="Назад к списку">',
    '        <svg class="event-detail-back__arrow" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
    '          <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/>',
    '        </svg>',
    '      </button>',
    '      <button type="button" class="event-detail-save" id="eventDetailSave">' + (createMode ? 'Создать' : 'Сохранить') + '</button>',
    '    </div>',
    '    <div class="event-detail-toolbar__meta">',
    '      <h2 class="event-detail-title">' + escapeHtml(titleName) + '</h2>',
    '      <span class="event-save-msg" id="eventSaveMsg"></span>',
    '    </div>',
    '  </header>',
    '  <div class="event-detail-body">',
    '  <section class="event-detail-card event-detail-card--resp" aria-labelledby="eventRespHeading">' +
    '    <div class="event-detail-card-head">' +
    '      <h3 class="event-detail-card__title" id="eventRespHeading">Ответственные</h3>' +
    '      <button type="button" class="event-resp-edit-btn" id="eventRespEditBtn">Добавить/Удалить</button>' +
    '    </div>' +
    '    <div id="eventRespSummary" class="event-resp-summary">' + respSummaryHtml + '</div>' +
    '  </section>',
    rentSectionHtml,
    '  <section class="event-detail-card event-detail-card--form" aria-labelledby="eventFormHeading">',
    '    <h3 class="event-detail-card__title" id="eventFormHeading">Данные мероприятия</h3>',
    '    <form class="event-edit-form event-form-grid" id="eventEditForm">' + editFields + '</form>',
    '  </section>',
    documentsSectionHtml,
    '  </div>',
    '</div>'
  ].join('');

  if (!createMode) {
    var carDocInit = document.getElementById('eventDocCarousel');
    if (carDocInit && eventDocumentsList && eventDocumentsList.length) {
      try {
        await eventDocs.hydrateEventDocumentPreviews(carDocInit, eventDocumentsList, base);
      } catch (e) {
        console.warn('[main] doc previews', e);
      }
    }
  }

  var backBtn = document.getElementById('eventDetailBack');
  if (backBtn) backBtn.addEventListener('click', requestCloseDetail);

  var saveTopBtn = document.getElementById('eventDetailSave');
  if (saveTopBtn) saveTopBtn.addEventListener('click', function () { performSave(); });

  var respEditBtn = document.getElementById('eventRespEditBtn');
  if (respEditBtn) {
    respEditBtn.addEventListener('click', function () {
      openResponsibleModal({
        eventId: eventId,
        base: base,
        type: type,
        draftMode: true,
        stagedRespListRef: stagedRespListRef,
        onRefresh: refreshRespSummaryFromStaged
      });
    });
  }
  wireDetailResponsibleHandlers(base, type, eventId, stagedRespListRef);
  wireEventRentSection(eventId, createMode, roomsRentOpts, defaultDateForRent, stagedRentListRef);
  eventDocs.wireEventDocumentsSection(eventId, createMode, base);

  var formForValidation = document.getElementById('eventEditForm');
  attachEventFormValidationListeners(formForValidation);
  if (formForValidation) {
    formForValidation.querySelectorAll('[data-action="open-external-link"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var field = btn.getAttribute('data-field') || 'link';
        var linkEl = formForValidation.elements.namedItem(field);
        var msgEl = document.getElementById('eventSaveMsg');
        var url = normalizeExternalUrl(linkEl && linkEl.value ? linkEl.value : '');
        if (!url) {
          if (msgEl) {
            msgEl.textContent = 'Укажите ссылку, чтобы открыть её в браузере.';
            msgEl.className = 'event-save-msg event-save-msg--err';
          }
          return;
        }
        try {
          var p = shell.openExternal(url);
          if (p && typeof p.catch === 'function') p.catch(function (e) {
            if (msgEl) {
              msgEl.textContent = e && e.message ? e.message : 'Не удалось открыть ссылку.';
              msgEl.className = 'event-save-msg event-save-msg--err';
            }
          });
        } catch (e) {
          if (msgEl) {
            msgEl.textContent = e && e.message ? e.message : 'Не удалось открыть ссылку.';
            msgEl.className = 'event-save-msg event-save-msg--err';
          }
        }
      });
    });
  }

  if (type === 'org' && formForValidation) {
    var dateElOrg = formForValidation.elements.namedItem('dates_of_event');
    var dowElOrg = formForValidation.elements.namedItem('day_of_the_week');
    function syncOrgDayOfWeekFromDate() {
      if (!dowElOrg) return;
      if (!dateElOrg) {
        dowElOrg.value = '';
        return;
      }
      var iso = dateElOrg.type === 'date'
        ? String(dateElOrg.value || '').trim()
        : parseDateValueToInputIso(dateElOrg.value);
      if (!iso) {
        dowElOrg.value = '';
        return;
      }
      dowElOrg.value = orgWeekdayCapsFromYyyyMmDd(iso) || '';
    }
    if (dateElOrg) {
      dateElOrg.addEventListener('change', syncOrgDayOfWeekFromDate);
      dateElOrg.addEventListener('input', syncOrgDayOfWeekFromDate);
    }
    syncOrgDayOfWeekFromDate();
  }

  var formSnap = document.getElementById('eventEditForm');
  initialFormStrings = formSnap
    ? readFormStringKeys(formSnap, formKeys)
    : initialFormStringKeysFromRaw(raw, formKeys);

} catch (err) {
  console.error('[main] event detail', err);
  detailPanel.innerHTML = '<div class="event-detail-inner event-detail-inner--error">' +
    '<button type="button" class="event-detail-back" id="eventDetailBackErr" aria-label="Назад к списку">' +
    '<svg class="event-detail-back__arrow" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
    '<p class="event-detail-error">' + escapeHtml(err.message || 'Ошибка загрузки') + '</p></div>';
  var eb = document.getElementById('eventDetailBackErr');
  if (eb) eb.addEventListener('click', closeEventDetail);
}
  }

  return openEventDetail;
}

module.exports = { createOpenEventDetail };
