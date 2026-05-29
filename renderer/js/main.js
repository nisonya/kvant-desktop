'use strict';

const { ipcRenderer } = require('electron');
const path = require('path');

const requireJs = (relPath) => require(path.join(__dirname, '..', 'js', relPath));
const { setupResponsibleModal } = requireJs('events/event-responsible-modal.js');
const { setupEventUnsavedModal } = requireJs('events/event-unsaved-modal.js');

let renderEventsViewCached = null;
function renderEventsView(container, type) {
  if (!renderEventsViewCached) {
    renderEventsViewCached = requireJs('events/events-view.js');
  }
  return renderEventsViewCached(container, type);
}

let renderEmployeesViewCached = null;
function renderEmployeesView(container) {
  if (!renderEmployeesViewCached) {
    renderEmployeesViewCached = requireJs('employees-view.js');
  }
  return renderEmployeesViewCached(container);
}

let renderProfileViewCached = null;
function renderProfileView(container) {
  if (!renderProfileViewCached) {
    renderProfileViewCached = requireJs('profile-view.js');
  }
  return renderProfileViewCached(container);
}

let renderDocsViewCached = null;
function renderDocsView(container) {
  if (!renderDocsViewCached) {
    renderDocsViewCached = requireJs('docs-view.js');
  }
  return renderDocsViewCached(container);
}

let renderGroupsViewCached = null;
function renderGroupsView(container) {
  if (!renderGroupsViewCached) {
    renderGroupsViewCached = requireJs('groups-view.js');
  }
  return renderGroupsViewCached(container);
}

let renderStudentsViewCached = null;
function renderStudentsView(container) {
  if (!renderStudentsViewCached) {
    renderStudentsViewCached = requireJs('students-view.js');
  }
  return renderStudentsViewCached(container);
}

let renderScheduleViewCached = null;
function renderScheduleView(container) {
  if (!renderScheduleViewCached) {
    renderScheduleViewCached = requireJs('schedule-view.js');
  }
  return renderScheduleViewCached(container);
}

let renderAttendanceViewCached = null;
function renderAttendanceView(container) {
  if (!renderAttendanceViewCached) {
    renderAttendanceViewCached = requireJs('attendance-view.js');
  }
  return renderAttendanceViewCached(container);
}

let renderPixelsViewCached = null;
function renderPixelsView(container) {
  if (!renderPixelsViewCached) {
    renderPixelsViewCached = requireJs('pixels-view.js');
  }
  return renderPixelsViewCached(container);
}

let renderRentViewCached = null;
function renderRentView(container) {
  if (!renderRentViewCached) {
    renderRentViewCached = requireJs('rent-view.js');
  }
  return renderRentViewCached(container);
}

let renderExportViewCached = null;
function renderExportView(container) {
  if (!renderExportViewCached) {
    renderExportViewCached = requireJs('export-view.js');
  }
  return renderExportViewCached(container);
}

const VIEWS = {
  org: 'Мероприятия — Организация',
  part: 'Мероприятия — Участие',
  attendance: 'Посещаемость',
  pixels: 'Пиксели',
  rent: 'Бронь',
  docs: 'Документы',
  groups: 'Группы',
  schedule: 'Расписание',
  export: 'Выгрузка',
  students: 'Ученики',
  employees: 'Сотрудники',
  profile: 'Профиль'
};

const VIEW_REGISTRY = {
  org: {
    title: VIEWS.org,
    render: function (container, viewId) { renderEventsView(container, viewId); },
    logName: 'renderEventsView',
    errorText: 'Не удалось загрузить раздел мероприятий'
  },
  part: {
    title: VIEWS.part,
    render: function (container, viewId) { renderEventsView(container, viewId); },
    logName: 'renderEventsView',
    errorText: 'Не удалось загрузить раздел мероприятий'
  },
  employees: {
    title: VIEWS.employees,
    render: function (container) { renderEmployeesView(container); },
    logName: 'renderEmployeesView',
    errorText: 'Не удалось загрузить раздел сотрудников'
  },
  profile: {
    title: VIEWS.profile,
    render: function (container) { renderProfileView(container); },
    logName: 'renderProfileView',
    errorText: 'Не удалось загрузить профиль'
  },
  docs: {
    title: VIEWS.docs,
    render: function (container) { renderDocsView(container); },
    logName: 'renderDocsView',
    errorText: 'Не удалось загрузить документы'
  },
  groups: {
    title: VIEWS.groups,
    render: function (container) { renderGroupsView(container); },
    logName: 'renderGroupsView',
    errorText: 'Не удалось загрузить группы'
  },
  students: {
    title: VIEWS.students,
    render: function (container) { renderStudentsView(container); },
    logName: 'renderStudentsView',
    errorText: 'Не удалось загрузить учеников'
  },
  schedule: {
    title: VIEWS.schedule,
    render: function (container) { renderScheduleView(container); },
    logName: 'renderScheduleView',
    errorText: 'Не удалось загрузить расписание'
  },
  attendance: {
    title: VIEWS.attendance,
    render: function (container) { renderAttendanceView(container); },
    logName: 'renderAttendanceView',
    errorText: 'Не удалось загрузить посещаемость'
  },
  pixels: {
    title: VIEWS.pixels,
    render: function (container) { renderPixelsView(container); },
    logName: 'renderPixelsView',
    errorText: 'Не удалось загрузить пиксели'
  },
  rent: {
    title: VIEWS.rent,
    render: function (container) { renderRentView(container); },
    logName: 'renderRentView',
    errorText: 'Не удалось загрузить бронь'
  },
  export: {
    title: VIEWS.export,
    render: function (container) { renderExportView(container); },
    logName: 'renderExportView',
    errorText: 'Не удалось загрузить выгрузку'
  }
};

let eventRemindersCollapsed = false;

function resolveSidebarUserLabel(user) {
  if (!user || typeof user !== 'object') return '—';
  var fullName = [user.second_name, user.first_name, user.patronymic].filter(Boolean).join(' ').trim();
  var preferred = user.name || user.full_name || fullName;
  if (preferred) return String(preferred);
  var fallback = user.login || user.email
    || ((user.id != null || user.id_employees != null) ? 'Пользователь' : null);
  return fallback ? String(fallback) : '—';
}

function escapeHtmlLocal(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function eventReminderTitle(item) {
  if (!item || typeof item !== 'object') return 'Без названия';
  return String(item.name || item.title || item.event_name || 'Без названия');
}

function eventReminderMeta(item) {
  if (!item || typeof item !== 'object') return '';
  var parts = [];
  var date = item.registration_deadline || item.dates_of_event || item.date || '';
  var form = item.form_of_holding || item.type || item.type_name || '';
  if (date) parts.push(String(date));
  if (form) parts.push(String(form));
  return parts.join(' · ');
}

function normalizeReminderPayload(payload) {
  var data = payload && payload.data && typeof payload.data === 'object' ? payload.data : {};
  return {
    ok: !!(payload && payload.ok),
    error: payload && payload.error ? String(payload.error) : '',
    checkedAt: payload && payload.checkedAt ? String(payload.checkedAt) : '',
    total: Number(payload && payload.total) || 0,
    data: {
      orgToday: Array.isArray(data.orgToday) ? data.orgToday : [],
      orgTomorrow: Array.isArray(data.orgTomorrow) ? data.orgTomorrow : [],
      partToday: Array.isArray(data.partToday) ? data.partToday : [],
      partTomorrow: Array.isArray(data.partTomorrow) ? data.partTomorrow : []
    }
  };
}

function reminderCheckedAtText(iso) {
  if (!iso) return '';
  var dt = new Date(iso);
  if (isNaN(dt.getTime())) return '';
  return 'Проверено: ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function buildReminderListHtml(title, items, kind) {
  var list = Array.isArray(items) ? items : [];
  var cls = 'event-reminders__section event-reminders__section--' + kind;
  if (!list.length) {
    return '<div class="' + cls + '"><h3>' + escapeHtmlLocal(title) + '</h3><p class="event-reminders__empty">Нет</p></div>';
  }
  return '<div class="' + cls + '"><h3>' + escapeHtmlLocal(title) + '</h3>' +
    '<ul>' + list.slice(0, 4).map(function (item) {
      var meta = eventReminderMeta(item);
      return '<li><span class="event-reminders__event-title">' + escapeHtmlLocal(eventReminderTitle(item)) + '</span>' +
        (meta ? '<span class="event-reminders__event-meta">' + escapeHtmlLocal(meta) + '</span>' : '') +
        '</li>';
    }).join('') + '</ul>' +
    (list.length > 4 ? '<p class="event-reminders__more">И ещё ' + String(list.length - 4) + '</p>' : '') +
    '</div>';
}

function renderEventReminders(payload) {
  var panel = document.getElementById('eventRemindersPanel');
  if (!panel) return;
  var state = normalizeReminderPayload(payload);
  var checked = reminderCheckedAtText(state.checkedAt);
  var contentHtml = '';
  if (!state.ok) {
    contentHtml = '<div class="event-reminders__message event-reminders__message--err">' +
      escapeHtmlLocal(state.error || 'Не удалось загрузить напоминания.') +
      '</div>';
  } else if (!state.total) {
    contentHtml = '<div class="event-reminders__message">На сегодня и завтра напоминаний нет.</div>';
  } else {
    contentHtml = '<div class="event-reminders__grid">' +
      buildReminderListHtml('Организация сегодня', state.data.orgToday, 'today') +
      buildReminderListHtml('Организация завтра', state.data.orgTomorrow, 'tomorrow') +
      buildReminderListHtml('Участие сегодня', state.data.partToday, 'part-today') +
      buildReminderListHtml('Участие завтра', state.data.partTomorrow, 'part-tomorrow') +
      '</div>';
  }
  panel.innerHTML =
    '<div class="event-reminders__head">' +
    '<div><div class="event-reminders__title">Напоминания</div>' +
    '<div class="event-reminders__status">' + escapeHtmlLocal(checked || (state.ok ? 'Проверено' : '')) + '</div></div>' +
    '<div class="event-reminders__actions">' +
    '<button type="button" class="event-reminders__toggle' + (eventRemindersCollapsed ? ' collapsed' : '') + '" id="eventRemindersToggle" title="' + (eventRemindersCollapsed ? 'Развернуть' : 'Свернуть') + '" aria-label="' + (eventRemindersCollapsed ? 'Развернуть напоминания' : 'Свернуть напоминания') + '" aria-expanded="' + (eventRemindersCollapsed ? 'false' : 'true') + '">' +
    '<svg class="event-reminders__toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>' +
    '</button>' +
    '<button type="button" class="event-reminders__refresh" id="eventRemindersRefresh">Обновить</button>' +
    '</div>' +
    '</div>' +
    (eventRemindersCollapsed ? '' : contentHtml);
  var toggleBtn = document.getElementById('eventRemindersToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      eventRemindersCollapsed = !eventRemindersCollapsed;
      renderEventReminders(state);
    });
  }
  var refreshBtn = document.getElementById('eventRemindersRefresh');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshEventReminders);
}

function setEventRemindersVisible(visible) {
  var panel = document.getElementById('eventRemindersPanel');
  if (!panel) return;
  panel.hidden = !visible;
}

function isEventsListView(viewId) {
  return viewId === 'org' || viewId === 'part';
}

function ensureEventRemindersPanel() {
  var contentTitle = document.getElementById('contentTitle');
  var contentBody = document.getElementById('contentBody');
  if (!contentTitle || !contentBody || document.getElementById('eventRemindersPanel')) return;
  var panel = document.createElement('section');
  panel.id = 'eventRemindersPanel';
  panel.className = 'event-reminders';
  panel.setAttribute('aria-live', 'polite');
  panel.hidden = true;
  contentTitle.parentNode.insertBefore(panel, contentBody);
}

function refreshEventReminders() {
  var panel = document.getElementById('eventRemindersPanel');
  if (panel) {
    panel.innerHTML = '<div class="event-reminders__head"><div><div class="event-reminders__title">Напоминания</div><div class="event-reminders__status">Проверяем...</div></div></div>';
  }
  ipcRenderer.invoke('get-event-reminders').then(renderEventReminders).catch(function (err) {
    renderEventReminders({
      ok: false,
      checkedAt: new Date().toISOString(),
      error: (err && err.message) || 'Не удалось загрузить напоминания.'
    });
  });
}

function showView(viewId) {
  const contentTitle = document.getElementById('contentTitle');
  const contentBody = document.getElementById('contentBody');
  if (!contentTitle || !contentBody) return;
  const viewConfig = VIEW_REGISTRY[viewId];

  contentTitle.textContent = (viewConfig && viewConfig.title) || viewId;
  contentBody.innerHTML = '';

  document.querySelectorAll('.nav-item').forEach(function (el) {
    el.classList.toggle('active', el.dataset.view === viewId);
  });
  document.querySelectorAll('.nav-group-row').forEach(function (row) {
    row.classList.toggle('nav-group-row--active', !!row.querySelector('.nav-item.active'));
  });

  if (viewConfig) {
    try {
      viewConfig.render(contentBody, viewId);
      setEventRemindersVisible(isEventsListView(viewId));
    } catch (err) {
      console.error('[main] ' + viewConfig.logName + ' failed', err);
      contentBody.innerHTML = '<p class="content-error">' + viewConfig.errorText + ': ' + (err && err.message ? err.message : 'ошибка') + '</p>';
      setEventRemindersVisible(false);
    }
    return;
  }

  contentBody.innerHTML = '<p class="content-placeholder">Раздел в разработке</p>';
  setEventRemindersVisible(false);
}

function init() {
  const profileName = document.getElementById('profileName');
  const profileBtn = document.getElementById('profileBtn');
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');

  if (profileName) {
    ipcRenderer.invoke('get-user').then(function (user) {
      profileName.textContent = resolveSidebarUserLabel(user);
    }).catch(function (err) {
      console.warn('[main] get-user', err);
    });
  }

  if (profileBtn) profileBtn.addEventListener('click', function () { showView('profile'); });

  if (sidebarToggle && sidebar) {
    function syncSidebarToggleState() {
      const collapsed = sidebar.classList.contains('collapsed');
      sidebarToggle.classList.toggle('collapsed', collapsed);
      const tip = collapsed ? 'Развернуть меню' : 'Свернуть меню';
      sidebarToggle.setAttribute('aria-label', tip);
      sidebarToggle.setAttribute('title', tip);
    }
    sidebarToggle.addEventListener('click', function () {
      sidebar.classList.toggle('collapsed');
      syncSidebarToggleState();
    });
    syncSidebarToggleState();
  }

  document.querySelectorAll('.nav-item').forEach(function (item) {
    item.addEventListener('click', function (e) {
      e.preventDefault();
      const v = item.dataset.view;
      if (v) showView(v);
    });
  });

  document.querySelectorAll('[data-action="new-event"]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const v = btn.dataset.view;
      if (!v) return;
      const activeNav = document.querySelector('.nav-item.active');
      const currentView = activeNav && activeNav.dataset.view;
      if (currentView !== v) showView(v);
      if (typeof window.__openEventCreate === 'function') window.__openEventCreate();
    });
  });

  setupResponsibleModal();
  setupEventUnsavedModal();
  ensureEventRemindersPanel();
  refreshEventReminders();
  window.__setEventRemindersVisible = setEventRemindersVisible;
  if (typeof ipcRenderer.on === 'function') {
    ipcRenderer.on('event-reminders-updated', function (_event, payload) {
      renderEventReminders(payload);
    });
  }
  window.__openEventById = function (eventId, viewId) {
    window.__pendingEventOpen = {
      id: eventId != null ? String(eventId) : '',
      view: viewId === 'part' ? 'part' : 'org'
    };
    showView(window.__pendingEventOpen.view);
  };
  if (typeof ipcRenderer.on === 'function') {
    ipcRenderer.on('open-event-from-notification', function (_event, payload) {
      var id = payload && payload.id;
      var view = payload && payload.view;
      if (id != null && id !== '') window.__openEventById(id, view === 'part' ? 'part' : 'org');
    });
  }
  showView('part');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
