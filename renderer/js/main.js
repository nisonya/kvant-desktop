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

function resolveSidebarUserLabel(user) {
  if (!user || typeof user !== 'object') return '—';
  var fullName = [user.second_name, user.first_name, user.patronymic].filter(Boolean).join(' ').trim();
  var preferred = user.name || user.full_name || fullName;
  if (preferred) return String(preferred);
  var fallback = user.login || user.email
    || ((user.id != null || user.id_employees != null) ? 'Пользователь' : null);
  return fallback ? String(fallback) : '—';
}

function showView(viewId) {
  const contentTitle = document.getElementById('contentTitle');
  const contentBody = document.getElementById('contentBody');
  if (!contentTitle || !contentBody) return;

  contentTitle.textContent = VIEWS[viewId] || viewId;
  contentBody.innerHTML = '';

  document.querySelectorAll('.nav-item').forEach(function (el) {
    el.classList.toggle('active', el.dataset.view === viewId);
  });
  document.querySelectorAll('.nav-group-row').forEach(function (row) {
    row.classList.toggle('nav-group-row--active', !!row.querySelector('.nav-item.active'));
  });

  if (viewId === 'org' || viewId === 'part') {
    try {
      renderEventsView(contentBody, viewId);
    } catch (err) {
      console.error('[main] renderEventsView failed', err);
      contentBody.innerHTML = '<p class="content-error">Не удалось загрузить раздел мероприятий: ' + (err && err.message ? err.message : 'ошибка') + '</p>';
    }
    return;
  }

  if (viewId === 'employees') {
    try {
      renderEmployeesView(contentBody);
    } catch (err) {
      console.error('[main] renderEmployeesView failed', err);
      contentBody.innerHTML = '<p class="content-error">Не удалось загрузить раздел сотрудников: ' + (err && err.message ? err.message : 'ошибка') + '</p>';
    }
    return;
  }

  if (viewId === 'profile') {
    try {
      renderProfileView(contentBody);
    } catch (err) {
      console.error('[main] renderProfileView failed', err);
      contentBody.innerHTML = '<p class="content-error">Не удалось загрузить профиль: ' + (err && err.message ? err.message : 'ошибка') + '</p>';
    }
    return;
  }

  if (viewId === 'docs') {
    try {
      renderDocsView(contentBody);
    } catch (err) {
      console.error('[main] renderDocsView failed', err);
      contentBody.innerHTML = '<p class="content-error">Не удалось загрузить документы: ' + (err && err.message ? err.message : 'ошибка') + '</p>';
    }
    return;
  }

  if (viewId === 'groups') {
    try {
      renderGroupsView(contentBody);
    } catch (err) {
      console.error('[main] renderGroupsView failed', err);
      contentBody.innerHTML = '<p class="content-error">Не удалось загрузить группы: ' + (err && err.message ? err.message : 'ошибка') + '</p>';
    }
    return;
  }

  if (viewId === 'students') {
    try {
      renderStudentsView(contentBody);
    } catch (err) {
      console.error('[main] renderStudentsView failed', err);
      contentBody.innerHTML = '<p class="content-error">Не удалось загрузить учеников: ' + (err && err.message ? err.message : 'ошибка') + '</p>';
    }
    return;
  }

  if (viewId === 'schedule') {
    try {
      renderScheduleView(contentBody);
    } catch (err) {
      console.error('[main] renderScheduleView failed', err);
      contentBody.innerHTML = '<p class="content-error">Не удалось загрузить расписание: ' + (err && err.message ? err.message : 'ошибка') + '</p>';
    }
    return;
  }

  if (viewId === 'attendance') {
    try {
      renderAttendanceView(contentBody);
    } catch (err) {
      console.error('[main] renderAttendanceView failed', err);
      contentBody.innerHTML = '<p class="content-error">Не удалось загрузить посещаемость: ' + (err && err.message ? err.message : 'ошибка') + '</p>';
    }
    return;
  }

  if (viewId === 'pixels') {
    try {
      renderPixelsView(contentBody);
    } catch (err) {
      console.error('[main] renderPixelsView failed', err);
      contentBody.innerHTML = '<p class="content-error">Не удалось загрузить пиксели: ' + (err && err.message ? err.message : 'ошибка') + '</p>';
    }
    return;
  }

  if (viewId === 'rent') {
    try {
      renderRentView(contentBody);
    } catch (err) {
      console.error('[main] renderRentView failed', err);
      contentBody.innerHTML = '<p class="content-error">Не удалось загрузить бронь: ' + (err && err.message ? err.message : 'ошибка') + '</p>';
    }
    return;
  }

  if (viewId === 'export') {
    try {
      renderExportView(contentBody);
    } catch (err) {
      console.error('[main] renderExportView failed', err);
      contentBody.innerHTML = '<p class="content-error">Не удалось загрузить выгрузку: ' + (err && err.message ? err.message : 'ошибка') + '</p>';
    }
    return;
  }

  contentBody.innerHTML = '<p class="content-placeholder">Раздел в разработке</p>';
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
  window.__openEventById = function (eventId, viewId) {
    window.__pendingEventOpen = {
      id: eventId != null ? String(eventId) : '',
      view: viewId === 'part' ? 'part' : 'org'
    };
    showView(window.__pendingEventOpen.view);
  };
  showView('part');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
