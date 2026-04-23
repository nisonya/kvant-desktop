'use strict';

const { escapeHtml, escapeHtmlAttr } = require('../html-escape.js');
const { apiRequest, unwrapResponse } = require('../api-client.js');
const API = require('../api-paths.js');
const eventDocs = require('./event-documents.js');
const { EVENT_BASE, FIELD_LABELS } = require('./event-constants.js');
const {
  initialFormStringKeysFromRaw,
  readFormStringKeys,
  formStringsEqual
} = require('./event-form-state.js');
const {
  isEventUintFieldKey,
  validateEventSchemaFields,
  clearEventFieldInvalid,
  validateEventRequiredFields,
  attachEventFormValidationListeners
} = require('./event-form-validation.js');
const exitCtx = require('./event-detail-exit.js');
const {
  cloneRespDraft,
  respDraftsEqual,
  syncResponsibleDraftToServer,
  closeResponsibleModal,
  buildResponsibleDetailHtml,
  wireDetailResponsibleHandlers,
  openResponsibleModal
} = require('./event-responsible-modal.js');
const { createCustomSelect, initCustomSelect } = require('../custom-select.js');
const {
  unsavedModalActions,
  closeUnsavedModal,
  openUnsavedModal
} = require('./event-unsaved-modal.js');
const createEventRent = require('./event-rent.js');
const { createEventsExcelExporter } = require('./events-export.js');
const {
  formatDate, formatDateForExport, isDateLikeFieldKey,
  parseDateValueToInputIso, normalizeInputToMysqlDate,
  orgWeekdayCapsFromYyyyMmDd, getQuarterDates,
  extractDictArray, dictItemsToOptions,
  orderedKeysForEdit, emptyRawForCreate,
  applyPartReferenceDefaults, responsibleNames
} = require('./event-helpers.js');
const { renderEditField } = require('./event-field-builders.js');
const { createOpenEventDetail } = require('./event-detail.js');

module.exports = function renderEventsView(container, type) {
  var sortOpts = type === 'org'
    ? [
        { value: 'dates_of_event:asc', label: 'По дате: раньше' },
        { value: 'dates_of_event:desc', label: 'По дате: позже' },
        { value: 'name:asc', label: 'По названию: А–Я' },
        { value: 'name:desc', label: 'По названию: Я–А' },
        { value: 'type:asc', label: 'По типу: по возрастанию' },
        { value: 'type:desc', label: 'По типу: по убыванию' },
        { value: 'day_of_the_week:asc', label: 'По дню недели: А–Я' },
        { value: 'day_of_the_week:desc', label: 'По дню недели: Я–А' }
      ]
    : [
        { value: 'registration_deadline:asc', label: 'По дедлайну: раньше' },
        { value: 'registration_deadline:desc', label: 'По дедлайну: позже' },
        { value: 'name:asc', label: 'По названию: А–Я' },
        { value: 'name:desc', label: 'По названию: Я–А' },
        { value: 'id_type:asc', label: 'По типу (уровень): по возрастанию' },
        { value: 'id_type:desc', label: 'По типу (уровень): по убыванию' },
        { value: 'participants_amount:asc', label: 'По числу участников: по возрастанию' },
        { value: 'participants_amount:desc', label: 'По числу участников: по убыванию' }
      ];
  var defaultSort = type === 'org' ? 'dates_of_event:desc' : 'registration_deadline:desc';
  var defaultPeriod = 'all';
  var defaultSortLabel = (sortOpts.find(function (o) { return o.value === defaultSort; }) || sortOpts[0]).label;
  var typeFilterAllLabel = type === 'part' ? 'Все уровни' : 'Все типы';

  var periodOpts = [
    { value: 'all', label: 'Все' },
    { value: 'this_month', label: 'В этом месяце' },
    { value: 'this_quarter', label: 'В этом квартале' },
    { value: 'three_months', label: 'Следующие 3 месяца' },
    { value: 'this_week', label: 'На этой неделе' },
    { value: 'next_week', label: 'На следующей неделе' },
    { value: 'custom', label: 'Свой период' }
  ];

  container.innerHTML = [
    '<div class="events-view">',
    '  <div id="eventsListPanel" class="events-list-panel">',
    '  <div class="events-toolbar events-toolbar--with-excel">',
    '    <div class="events-toolbar__filters">',
    '    <input type="text" class="search-input" placeholder="Поиск..." id="eventsSearch">',
    createCustomSelect('eventsPeriod', periodOpts, defaultPeriod, 'Все'),
    createCustomSelect('eventsFilterType', [{ value: '', label: typeFilterAllLabel }], '', typeFilterAllLabel),
    createCustomSelect('eventsSortEmployee', [{ value: '', label: 'Все сотрудники' }], '', 'Все сотрудники'),
    createCustomSelect('eventsSort', sortOpts, defaultSort, defaultSortLabel),
    '    </div>',
    '    <button type="button" class="excel-btn" id="eventsExcelBtn" aria-label="Скачать Excel">',
    '      <svg class="excel-btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
    '        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    '        <polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    '        <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    '      </svg>',
    '      <span class="excel-btn__text">Excel</span>',
    '    </button>',
    '  </div>',
    '  <div class="events-period-custom" id="eventsPeriodCustom" style="display:none">',
    '    <label>С:</label> <input type="date" id="eventsDateFrom" class="events-date-input">',
    '    <label>По:</label> <input type="date" id="eventsDateTo" class="events-date-input">',
    '    <button type="button" class="events-period-apply" id="eventsPeriodApply">Применить</button>',
    '  </div>',
    '  <div class="events-list-scroll" id="eventsListScroll">',
    '    <div class="events-list" id="eventsList"><div class="events-loading">Загрузка...</div></div>',
    '  </div>',
    '  <div class="events-empty" id="eventsEmpty" style="display:none">Нет мероприятий</div>',
    '  <div class="events-error" id="eventsError" style="display:none"><span id="eventsErrorText"></span><button type="button" id="eventsErrorRetry">Повторить</button></div>',
    '  </div>',
    '  <div id="eventsDetailPanel" class="event-detail-panel" style="display:none" aria-hidden="true"></div>',
    '</div>'
  ].join('');

  const listPanel = document.getElementById('eventsListPanel');
  const detailPanel = document.getElementById('eventsDetailPanel');
  const scrollEl = document.getElementById('eventsListScroll');
  const listEl = document.getElementById('eventsList');
  const emptyEl = document.getElementById('eventsEmpty');
  const errorEl = document.getElementById('eventsError');
  const errorText = document.getElementById('eventsErrorText');
  const searchInput = document.getElementById('eventsSearch');
  const retryBtn = document.getElementById('eventsErrorRetry');

  var periodSelect = initCustomSelect('eventsPeriod', function () {
    var p = periodSelect ? periodSelect.getValue() : '';
    var customEl = document.getElementById('eventsPeriodCustom');
    if (customEl) customEl.style.display = (p === 'custom') ? 'flex' : 'none';
    resetAndLoad();
  });
  var sortEmployeeSelect = initCustomSelect('eventsSortEmployee', function () { resetAndLoad(); });
  var sortSelect = initCustomSelect('eventsSort', function () { resetAndLoad(); });
  var typeFilterSelect = initCustomSelect('eventsFilterType', function () { resetAndLoad(); });

  var dateFromInput = document.getElementById('eventsDateFrom');
  var dateToInput = document.getElementById('eventsDateTo');
  var periodApplyBtn = document.getElementById('eventsPeriodApply');
  function applyCustomPeriod() { resetAndLoad(); }
  if (periodApplyBtn) periodApplyBtn.addEventListener('click', applyCustomPeriod);
  if (dateFromInput) dateFromInput.addEventListener('change', applyCustomPeriod);
  if (dateToInput) dateToInput.addEventListener('change', applyCustomPeriod);
  const PAGE_SIZE = 10;

  var totalCount = 0;
  var currentPage = 0;
  var isLoading = false;
  var loadMorePending = false;
  var savedListScrollState = { top: 0 };
  // Справочники участия
  var partLevelsById = {};
  var partLevelsOpts = [];
  var partFormsById = {};
  var partFormsOpts = [];
  var partReferenceCachesReady = false;
  // Справочник org
  var orgTypesOpts = [];
  var orgTypesById = {};
  var orgReferenceCachesReady = false;

  function showState(s, msg) {
    if (scrollEl) scrollEl.style.display = (s === 'loading' || s === 'list') ? 'block' : 'none';
    if (emptyEl) emptyEl.style.display = s === 'empty' ? 'block' : 'none';
    if (errorEl) errorEl.style.display = s === 'error' ? 'block' : 'none';
    if (s === 'loading' && listEl) listEl.innerHTML = '<div class="events-loading">Загрузка...</div>';
    if (s === 'error' && errorText) errorText.textContent = msg || '';
  }

  function cardHtml(item, resp) {
    var dateLabel = type === 'part' ? 'регистрация до:' : 'дата проведения:';
    var dateVal = type === 'part' ? (item.registration_deadline || item.dates_of_event) : item.dates_of_event;
    var respHtml = (resp || []).map(function (r) {
      var n = [r.first_name, r.second_name].filter(Boolean).join(' ') || '—';
      return '<span class="event-card-responsible">' + escapeHtml(n) + '</span>';
    }).join('');
    var eventId = item.id || item.id_events || item.id_event;
    var idAttr = eventId != null ? ' data-event-id="' + escapeHtmlAttr(String(eventId)) + '"' : '';
    var cardClass = eventId != null ? 'event-card event-card--clickable' : 'event-card';
    var levelLine = '';
    if (type === 'part' && item.id_type != null && item.id_type !== '') {
      var levelName = partLevelsById[String(item.id_type)];
      if (levelName) levelLine = '<p class="event-card-level">' + escapeHtml(levelName) + '</p>';
    }
    var formLine = '';
    if (type === 'part' && item.form_of_holding != null && item.form_of_holding !== '') {
      var formName = partFormsById[String(item.form_of_holding)];
      if (formName) formLine = '<p class="event-card-type">' + escapeHtml(formName) + '</p>';
    }
    var orgTypeLine = '';
    if (type === 'org') {
      var tid = item.types_of_organization != null ? item.types_of_organization : item.type;
      if (tid != null && tid !== '') {
        var tName = orgTypesById[String(tid)];
        if (tName) orgTypeLine = '<p class="event-card-type">' + escapeHtml(tName) + '</p>';
      }
    }
    return '<div class="' + cardClass + '"' + idAttr + (eventId != null ? ' role="button" tabindex="0"' : '') + '>' +
      '<h3 class="event-card-title">' + escapeHtml(item.name || '—') + '</h3>' +
      formLine +
      orgTypeLine +
      levelLine +
      (type === 'org' && item.day_of_the_week ? '<p class="event-card-day">' + escapeHtml(item.day_of_the_week) + '</p>' : '') +
      '<p class="event-card-date"><span class="event-card-date-label">' + dateLabel + '</span> ' + formatDate(dateVal) + '</p>' +
      '<div class="event-card-responsibles">' + respHtml + '</div></div>';
  }

  function getFilters() {
    var period = periodSelect ? periodSelect.getValue() : 'all';
    var filters = {};
    if (period === 'custom') {
      var from = dateFromInput ? dateFromInput.value : '';
      var to = dateToInput ? dateToInput.value : '';
      if (from) filters.date_from = from;
      if (to) filters.date_to = to;
      if (!from && !to) filters.period = 'all';
    } else if (period === 'this_quarter') {
      var q = getQuarterDates();
      filters.date_from = q.date_from;
      filters.date_to = q.date_to;
    } else {
      filters.period = period;
    }
    if (searchInput && searchInput.value.trim()) filters.search = searchInput.value.trim();
    var empVal = sortEmployeeSelect ? sortEmployeeSelect.getValue() : '';
    if (empVal) filters.employee_id = parseInt(empVal, 10);
    var typeVal = typeFilterSelect ? typeFilterSelect.getValue() : '';
    if (typeVal) {
      var tid = parseInt(typeVal, 10);
      if (tid > 0) {
        if (type === 'org') filters.type = tid;
        else filters.id_type = tid;
      }
    }
    return filters;
  }

  function getSort() {
    var val = sortSelect ? sortSelect.getValue() : '';
    var field = type === 'part' ? 'registration_deadline' : 'dates_of_event';
    var order = 'asc';
    if (val) {
      var lc = val.lastIndexOf(':');
      if (lc > 0) {
        field = val.slice(0, lc);
        order = val.slice(lc + 1).trim() || 'asc';
      }
    }
    if (order !== 'asc' && order !== 'desc') order = 'asc';
    return [{ field: field, order: order }];
  }

  function getSortLabel() {
    var val = sortSelect ? sortSelect.getValue() : '';
    var found = sortOpts.find(function (o) { return o.value === val; });
    return found ? found.label : ((sortOpts[0] && sortOpts[0].label) || '');
  }

  var excelExporter = createEventsExcelExporter({
    getFilters: getFilters,
    getSort: getSort,
    getSortLabel: getSortLabel,
    fetchReferenceLevels: fetchReferenceLevels,
    fetchReferenceTypesOfHolding: fetchReferenceTypesOfHolding,
    fetchOrgEventTypes: fetchOrgEventTypes
  });

  async function exportEventsToExcel() {
    await excelExporter.exportEventsToExcel(type);
  }


  /** GET справочника: несколько суффиксов пути и для org — fallback на /api/events/organization */
  /** Справочник уровней мероприятий участия: type_of_part_event → id + name в UI */
  async function fetchReferenceLevels() {
    var paths = API.REFERENCE.LEVELS_TRY;
    var i;
    for (i = 0; i < paths.length; i++) {
      try {
        var res = await apiRequest('GET', paths[i]);
        var arr = dictItemsToOptions(extractDictArray(res));
        if (arr.length) return arr;
      } catch (e) {
        console.warn('[main] GET ' + paths[i], e);
      }
    }
    return [];
  }

  /** Таблица form_of_holding — id и отображаемое имя (только мероприятия участия) */
  async function fetchReferenceTypesOfHolding() {
    var paths = API.REFERENCE.TYPES_OF_HOLDING_TRY;
    var i;
    for (i = 0; i < paths.length; i++) {
      try {
        var res = await apiRequest('GET', paths[i]);
        var arr = dictItemsToOptions(extractDictArray(res));
        if (arr.length) return arr;
      } catch (e) {
        console.warn('[main] GET ' + paths[i], e);
      }
    }
    return [];
  }

  async function ensurePartReferenceCaches() {
    if (type !== 'part' || partReferenceCachesReady) return;
    var levelsArr;
    var formsArr;
    try {
      var pair = await Promise.all([fetchReferenceLevels(), fetchReferenceTypesOfHolding()]);
      levelsArr = pair[0];
      formsArr = pair[1];
    } catch (e) {
      console.warn('[main] part reference caches', e);
      levelsArr = [];
      formsArr = [];
    }
    partLevelsOpts = levelsArr;
    partLevelsById = {};
    partLevelsOpts.forEach(function (o) {
      partLevelsById[o.value] = o.label;
    });
    partFormsOpts = formsArr;
    partFormsById = {};
    partFormsOpts.forEach(function (o) {
      partFormsById[o.value] = o.label;
    });
    partReferenceCachesReady = true;
  }

  async function fetchOrgEventTypes() {
    var paths = API.REFERENCE.TYPES_OF_ORGANIZATION_TRY;
    var i;
    for (i = 0; i < paths.length; i++) {
      try {
        var res = await apiRequest('GET', paths[i]);
        var arr = dictItemsToOptions(extractDictArray(res));
        if (arr.length) return arr;
      } catch (e) {
        console.warn('[main] GET ' + paths[i], e);
      }
    }
    return [];
  }

  async function ensureOrgReferenceCaches() {
    if (type !== 'org' || orgReferenceCachesReady) return;
    try {
      orgTypesOpts = await fetchOrgEventTypes();
    } catch (e) {
      console.warn('[main] org reference caches', e);
      orgTypesOpts = [];
    }
    orgTypesById = {};
    orgTypesOpts.forEach(function (o) {
      orgTypesById[o.value] = o.label;
    });
    orgReferenceCachesReady = true;
  }

  var rent = createEventRent({
    type: type,
    escapeHtml: escapeHtml,
    escapeHtmlAttr: escapeHtmlAttr,
    apiRequest: apiRequest,
    parseDateValueToInputIso: parseDateValueToInputIso
  });
  var buildEventRentSectionHtml = rent.buildEventRentSectionHtml;
  var wireEventRentSection = rent.wireEventRentSection;
  var buildEventRentListHtml = rent.buildEventRentListHtml;
  var cloneRentDraft = rent.cloneRentDraft;
  var rentDraftsEqual = rent.rentDraftsEqual;
  var syncRentDraftToServer = rent.syncRentDraftToServer;

  function closeEventDetail() {
    exitCtx.clear();
    closeResponsibleModal();
    eventDocs.revokeAllEventDocBlobs();
    if (!detailPanel || !listPanel) return;
    detailPanel.style.display = 'none';
    detailPanel.setAttribute('aria-hidden', 'true');
    detailPanel.innerHTML = '';
    listPanel.style.display = '';
    if (scrollEl) {
      requestAnimationFrame(function () {
        scrollEl.scrollTop = savedListScrollState.top;
      });
    }
  }

  var openEventDetail = createOpenEventDetail({
    type: type,
    EVENT_BASE: EVENT_BASE,
    API: API,
    apiRequest: apiRequest,
    detailPanel: detailPanel,
    listPanel: listPanel,
    scrollEl: scrollEl,
    savedListScrollState: savedListScrollState,
    exitCtx: exitCtx,
    eventDocs: eventDocs,
    closeResponsibleModal: closeResponsibleModal,
    closeEventDetail: closeEventDetail,
    emptyRawForCreate: emptyRawForCreate,
    applyPartReferenceDefaults: applyPartReferenceDefaults,
    ensurePartReferenceCaches: ensurePartReferenceCaches,
    ensureOrgReferenceCaches: ensureOrgReferenceCaches,
    getPartLevelsOpts: function () { return partLevelsOpts; },
    getPartFormsOpts: function () { return partFormsOpts; },
    getOrgTypesOpts: function () { return orgTypesOpts; },
    parseDateValueToInputIso: parseDateValueToInputIso,
    orgWeekdayCapsFromYyyyMmDd: orgWeekdayCapsFromYyyyMmDd,
    dictItemsToOptions: dictItemsToOptions,
    extractDictArray: extractDictArray,
    buildEventRentSectionHtml: buildEventRentSectionHtml,
    buildEventRentListHtml: buildEventRentListHtml,
    wireEventRentSection: wireEventRentSection,
    cloneRentDraft: cloneRentDraft,
    rentDraftsEqual: rentDraftsEqual,
    syncRentDraftToServer: syncRentDraftToServer,
    orderedKeysForEdit: orderedKeysForEdit,
    FIELD_LABELS: FIELD_LABELS,
    escapeHtml: escapeHtml,
    escapeHtmlAttr: escapeHtmlAttr,
    cloneRespDraft: cloneRespDraft,
    respDraftsEqual: respDraftsEqual,
    syncResponsibleDraftToServer: syncResponsibleDraftToServer,
    buildResponsibleDetailHtml: buildResponsibleDetailHtml,
    wireDetailResponsibleHandlers: wireDetailResponsibleHandlers,
    openResponsibleModal: openResponsibleModal,
    initialFormStringKeysFromRaw: initialFormStringKeysFromRaw,
    readFormStringKeys: readFormStringKeys,
    formStringsEqual: formStringsEqual,
    clearEventFieldInvalid: clearEventFieldInvalid,
    validateEventRequiredFields: validateEventRequiredFields,
    validateEventSchemaFields: validateEventSchemaFields,
    attachEventFormValidationListeners: attachEventFormValidationListeners,
    isEventUintFieldKey: isEventUintFieldKey,
    normalizeInputToMysqlDate: normalizeInputToMysqlDate,
    renderEditField: renderEditField,
    unsavedModalActions: unsavedModalActions,
    openUnsavedModal: openUnsavedModal,
    closeUnsavedModal: closeUnsavedModal,
    resetAndLoad: resetAndLoad
  });

  function onEventCardActivate(e) {
    var card = e.target.closest('.event-card--clickable');
    if (!card) return;
    var id = card.getAttribute('data-event-id');
    if (!id) return;
    openEventDetail(id);
  }

  function onEventCardKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var card = e.target.closest('.event-card--clickable');
    if (!card || !listEl.contains(card)) return;
    e.preventDefault();
    var id = card.getAttribute('data-event-id');
    if (id) openEventDetail(id);
  }

  async function fetchPage(page) {
    var filters = getFilters();
    var sort = getSort();
    var base = EVENT_BASE[type];
    var path = base + '/list';
    try {
      var listRes = await apiRequest('POST', path, { filters: filters, sort: sort, page: page, limit: PAGE_SIZE });
      if (listRes && listRes.success === false) throw new Error(listRes.error || 'Ошибка API');
      var items = listRes.data || listRes || [];
      return Array.isArray(items) ? items : [];
    } catch (e) {
      if (type === 'org' && base === API.EVENTS.ORG && (e.message || '').indexOf('404') >= 0) {
        console.warn('[main] events org path 404, пробуем legacy organization path');
        EVENT_BASE.org = API.EVENTS.ORGANIZATION_LEGACY;
        return fetchPage(page);
      }
      throw e;
    }
  }

  async function fetchResponsibleByEvent(items, basePath) {
    var pairs = await Promise.all(items.map(async function (item) {
      var eventId = item.id || item.id_events || item.id_event;
      if (!eventId) return null;
      try {
        var rRes = await apiRequest('GET', basePath + '/responsible/' + eventId);
        var resp = rRes.data || rRes;
        if (!Array.isArray(resp)) resp = [];
        return [String(eventId), resp];
      } catch (e) {
        console.warn('[main] responsible fail', eventId, e);
        return [String(eventId), []];
      }
    }));
    var byEvent = {};
    pairs.forEach(function (p) {
      if (!p) return;
      byEvent[p[0]] = p[1];
    });
    return byEvent;
  }

  async function loadMore() {
    if (isLoading || loadMorePending) return;
    var loadedCount = currentPage * PAGE_SIZE;
    if (loadedCount >= totalCount) return;
    loadMorePending = true;
    var nextPage = currentPage + 1;
    var loader = document.createElement('div');
    loader.className = 'events-loading events-loading-more';
    loader.textContent = 'Загрузка...';
    listEl.appendChild(loader);
    try {
      isLoading = true;
      var base = EVENT_BASE[type];
      var items = await fetchPage(nextPage);
      var byEvent = await fetchResponsibleByEvent(items, base);
      loader.remove();
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var eventId = item.id || item.id_events || item.id_event;
        var resp = eventId ? (byEvent[String(eventId)] || []) : [];
        var card = document.createElement('div');
        card.innerHTML = cardHtml(item, resp);
        listEl.appendChild(card.firstElementChild || card);
      }
      currentPage = nextPage;
    } catch (err) {
      loader.remove();
      console.error('[main] loadMore error', err);
    } finally {
      isLoading = false;
      loadMorePending = false;
    }
  }

  function onScroll() {
    if (!scrollEl || !listEl) return;
    var el = scrollEl;
    var threshold = 150;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      loadMore();
    }
  }

  function resetAndLoad() {
    currentPage = 0;
    totalCount = 0;
    load();
  }

  async function load() {
    showState('loading');
    try {
      var filters = getFilters();
      var sort = getSort();
      var base = EVENT_BASE[type];

      var countRes;
      try {
        countRes = await apiRequest('POST', base + '/count', { filters: filters });
      } catch (countErr) {
        if (type === 'org' && base === API.EVENTS.ORG && (countErr.message || '').indexOf('404') >= 0) {
          console.warn('[main] events org count 404, пробуем legacy organization path');
          EVENT_BASE.org = API.EVENTS.ORGANIZATION_LEGACY;
          return load();
        }
        throw countErr;
      }
      if (countRes && countRes.success === false) throw new Error(countRes.error || 'Ошибка API');
      totalCount = countRes.total || 0;

      if (totalCount === 0) {
        showState('empty');
        return;
      }

      if (type === 'part') await ensurePartReferenceCaches();
      if (type === 'org') await ensureOrgReferenceCaches();

      var items = await fetchPage(1);
      var byEvent = await fetchResponsibleByEvent(items, base);
      currentPage = 1;

      var cards = [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var eventId = item.id || item.id_events || item.id_event;
        var resp = eventId ? (byEvent[String(eventId)] || []) : [];
        cards.push(cardHtml(item, resp));
      }

      listEl.innerHTML = cards.join('');
      listEl.className = 'events-list events-cards';
      showState('list');
    } catch (err) {
      console.error('[main] events load error', err);
      showState('error', err.message || 'Ошибка загрузки');
    }
  }

  async function loadEmployees() {
    try {
      var res = await apiRequest('GET', API.EMPLOYEES.LIST);
      var arr = res.data || res || [];
      if (!Array.isArray(arr)) arr = [];
      var opts = [{ value: '', label: 'Все сотрудники' }];
      arr.forEach(function (e) {
        var active = e.is_active !== undefined ? e.is_active : (e.active !== undefined ? e.active : true);
        if (!active) return;
        var id = e.id_employees || e.id;
        var name = e.name || [e.first_name, e.second_name, e.patronymic].filter(Boolean).join(' ') || '—';
        opts.push({ value: String(id || ''), label: name });
      });
      if (sortEmployeeSelect && sortEmployeeSelect.setOptions) {
        sortEmployeeSelect.setOptions(opts, '');
      }
    } catch (e) {
      console.warn('[main] employees load fail', e);
    }
  }

  /** Селект «тип»: org — GET types-of-organization; part — GET levels (type_of_part_event) */
  async function loadEventTypeFilterOptions() {
    if (!typeFilterSelect || !typeFilterSelect.setOptions) return;
    var base = [{ value: '', label: typeFilterAllLabel }];
    try {
      if (type === 'org') {
        await ensureOrgReferenceCaches();
        typeFilterSelect.setOptions(base.concat(orgTypesOpts.slice()), '');
      } else if (type === 'part') {
        await ensurePartReferenceCaches();
        typeFilterSelect.setOptions(base.concat(partLevelsOpts.slice()), '');
      }
    } catch (e) {
      console.warn('[main] event type filter options', e);
      typeFilterSelect.setOptions(base, '');
    }
  }

  var excelBtn = document.getElementById('eventsExcelBtn');
  if (excelBtn) excelBtn.addEventListener('click', exportEventsToExcel);

  if (searchInput) searchInput.addEventListener('input', function () { setTimeout(resetAndLoad, 300); });
  if (retryBtn) retryBtn.addEventListener('click', resetAndLoad);
  if (scrollEl) scrollEl.addEventListener('scroll', onScroll);
  if (listEl) {
    listEl.addEventListener('click', onEventCardActivate);
    listEl.addEventListener('keydown', onEventCardKeydown);
  }

  Promise.all([loadEmployees(), loadEventTypeFilterOptions()])
    .then(function () { return load(); })
    .catch(function (e) {
      console.error('[main] init fail', e);
      showState('error', e.message || 'Ошибка');
    });

  window.__openEventCreate = function () {
    openEventDetail(null, { create: true });
  };

  window.__openEventDetailInCurrentView = function (eventId) {
    if (eventId == null || eventId === '') return;
    openEventDetail(eventId);
  };

  function tryOpenPendingEvent() {
    var pending = window.__pendingEventOpen;
    if (!pending || pending.view !== type || !pending.id) return;
    window.__pendingEventOpen = null;
    openEventDetail(pending.id);
  }

  tryOpenPendingEvent();
};
