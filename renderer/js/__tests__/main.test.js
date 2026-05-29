/** @jest-environment jsdom */
'use strict';

describe('renderer/js/main.js UI wiring', () => {
  let renderEventsView;
  let renderDocsView;
  let renderStudentsView;
  let renderProfileView;
  let setupResponsibleModal;
  let setupEventUnsavedModal;
  let ipcInvoke;
  let ipcOn;
  let remindersPayload;

  function setupDom() {
    // Макет минимально повторяет main.html для навигации и контента
    document.body.innerHTML = `
      <div class="app-wrap">
        <aside>
          <div class="nav-group-row" id="row-org">
            <a href="#" class="nav-item" data-view="org">Орг</a>
          </div>
          <div class="nav-group-row" id="row-part">
            <a href="#" class="nav-item active" data-view="part">Участие</a>
          </div>
          <a href="#" class="nav-item" data-view="docs">Документы</a>
          <a href="#" class="nav-item" data-view="docs">Документы</a>
          <a href="#" class="nav-item" data-view="students">Ученики</a>
          <a href="#" class="nav-item" data-view="future">Будущий раздел</a>
          <button type="button" class="nav-item-add" data-view="org" data-action="new-event">+</button>
        </aside>
        <main>
          <h1 id="contentTitle"></h1>
          <div id="contentBody"></div>
        </main>
        <div id="profileBtn"></div>
        <span id="profileName"></span>
        <div id="sidebar"></div>
        <button id="sidebarToggle"></button>
      </div>
    `;
    // Гарантируем, что init выполнится сразу при require
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
  }

  function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    setupDom();

    jest.doMock('electron', () => {
      ipcInvoke = jest.fn().mockImplementation(async (channel) => {
        if (channel === 'get-user') return { login: 'demo-login' };
        if (channel === 'get-event-reminders') return remindersPayload;
        return null;
      });
      ipcOn = jest.fn();
      return { ipcRenderer: { invoke: ipcInvoke, on: ipcOn } };
    });
    remindersPayload = {
      ok: true,
      checkedAt: '2026-05-27T10:40:00.000Z',
      total: 0,
      data: { orgToday: [], orgTomorrow: [], partToday: [], partTomorrow: [] }
    };

    jest.doMock('../events/events-view.js', () => jest.fn());
    renderEventsView = require('../events/events-view.js');
    jest.doMock('../docs-view.js', () => jest.fn());
    renderDocsView = require('../docs-view.js');
    jest.doMock('../students-view.js', () => jest.fn());
    renderStudentsView = require('../students-view.js');
    jest.doMock('../profile-view.js', () => jest.fn());
    renderProfileView = require('../profile-view.js');
    jest.doMock('../events/event-responsible-modal.js', () => ({
      setupResponsibleModal: jest.fn()
    }));
    setupResponsibleModal = require('../events/event-responsible-modal.js').setupResponsibleModal;
    jest.doMock('../events/event-unsaved-modal.js', () => ({
      setupEventUnsavedModal: jest.fn()
    }));
    setupEventUnsavedModal = require('../events/event-unsaved-modal.js').setupEventUnsavedModal;

    // Сайд-эффекты init срабатывают при импорте
    require('../main.js');
  });

  test('init рендерит вкладку "Участие" и активирует нужные элементы', async () => {
    await flushPromises();
    const contentTitle = document.getElementById('contentTitle');
    const contentBody = document.getElementById('contentBody');
    const navPart = document.querySelector('.nav-item[data-view="part"]');
    const navOrg = document.querySelector('.nav-item[data-view="org"]');
    const rowPart = document.getElementById('row-part');
    const rowOrg = document.getElementById('row-org');

    expect(renderEventsView).toHaveBeenCalledWith(contentBody, 'part');
    expect(contentTitle.textContent).toBe('Мероприятия — Участие');
    expect(navPart.classList.contains('active')).toBe(true);
    expect(navOrg.classList.contains('active')).toBe(false);
    expect(rowPart.classList.contains('nav-group-row--active')).toBe(true);
    expect(rowOrg.classList.contains('nav-group-row--active')).toBe(false);
  });

  test('клик по вкладке "Организация" вызывает рендер и переключает активность', () => {
    renderEventsView.mockClear();
    const navOrg = document.querySelector('.nav-item[data-view="org"]');
    navOrg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const contentBody = document.getElementById('contentBody');
    expect(renderEventsView).toHaveBeenCalledWith(contentBody, 'org');
    expect(document.getElementById('contentTitle').textContent).toBe('Мероприятия — Организация');

    const navPart = document.querySelector('.nav-item[data-view="part"]');
    expect(navOrg.classList.contains('active')).toBe(true);
    expect(navPart.classList.contains('active')).toBe(false);
  });

  test('клик по документам вызывает renderDocsView', () => {
    renderDocsView.mockClear();
    const navDocs = document.querySelector('.nav-item[data-view="docs"]');
    navDocs.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const contentBody = document.getElementById('contentBody');
    expect(renderDocsView).toHaveBeenCalledWith(contentBody);
    expect(document.getElementById('contentTitle').textContent).toBe('Документы');
  });

  test('клик по вкладке "Ученики" вызывает renderStudentsView', () => {
    renderEventsView.mockClear();
    renderStudentsView.mockClear();
    const navStudents = document.querySelector('.nav-item[data-view="students"]');
    navStudents.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(renderEventsView).not.toHaveBeenCalled();
    expect(renderStudentsView).toHaveBeenCalledWith(document.getElementById('contentBody'));
    expect(document.getElementById('contentTitle').textContent).toBe('Ученики');
  });

  test('имя профиля подставляется из get-user', async () => {
    await flushPromises();
    expect(ipcInvoke).toHaveBeenCalledWith('get-user');
    expect(document.getElementById('profileName').textContent).toBe('demo-login');
  });

  test('инициализация показывает виджет напоминаний', async () => {
    await flushPromises();
    await flushPromises();

    const panel = document.getElementById('eventRemindersPanel');
    expect(panel).not.toBeNull();
    expect(panel.hidden).toBe(false);
    expect(ipcInvoke).toHaveBeenCalledWith('get-event-reminders');
    expect(panel.textContent).toContain('Напоминания');
    expect(panel.textContent).toContain('На сегодня и завтра напоминаний нет.');
    expect(ipcOn).toHaveBeenCalledWith('event-reminders-updated', expect.any(Function));
  });

  test('виджет напоминаний можно свернуть', async () => {
    await flushPromises();
    await flushPromises();

    const panel = document.getElementById('eventRemindersPanel');
    expect(panel.textContent).toContain('На сегодня и завтра напоминаний нет.');

    document.getElementById('eventRemindersToggle')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const toggle = document.getElementById('eventRemindersToggle');
    expect(toggle.classList.contains('collapsed')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.textContent).not.toContain('На сегодня и завтра напоминаний нет.');
  });

  test('виджет напоминаний скрывается вне списка мероприятий', async () => {
    await flushPromises();
    const panel = document.getElementById('eventRemindersPanel');

    document.querySelector('.nav-item[data-view="docs"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(panel.hidden).toBe(true);
  });

  test('детальный экран мероприятия может скрыть виджет напоминаний', async () => {
    await flushPromises();
    const panel = document.getElementById('eventRemindersPanel');

    window.__setEventRemindersVisible(false);

    expect(panel.hidden).toBe(true);
  });

  test('виджет напоминаний отображает события из IPC', async () => {
    remindersPayload = {
      ok: true,
      checkedAt: '2026-05-27T10:40:00.000Z',
      total: 1,
      data: {
        orgToday: [{ name: 'Открытый урок', dates_of_event: '2026-05-27' }],
        orgTomorrow: [],
        partToday: [],
        partTomorrow: []
      }
    };
    jest.resetModules();
    setupDom();
    require('../main.js');
    await flushPromises();
    await flushPromises();

    expect(document.getElementById('eventRemindersPanel').textContent).toContain('Открытый урок');
  });

  test('инициализация подключает глобальные модалки мероприятий', () => {
    expect(setupResponsibleModal).toHaveBeenCalledTimes(1);
    expect(setupEventUnsavedModal).toHaveBeenCalledTimes(1);
  });

  test('кнопка создания мероприятия переключает нужную вкладку и вызывает глобальный opener', () => {
    renderEventsView.mockClear();
    window.__openEventCreate = jest.fn();

    const addBtn = document.querySelector('[data-action="new-event"][data-view="org"]');
    addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(renderEventsView).toHaveBeenCalledWith(document.getElementById('contentBody'), 'org');
    expect(window.__openEventCreate).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.nav-item[data-view="org"]').classList.contains('active')).toBe(true);
  });

  test('глобальный openEventById сохраняет pending state и открывает нужную вкладку', () => {
    renderEventsView.mockClear();

    window.__openEventById(42, 'org');

    expect(window.__pendingEventOpen).toEqual({ id: '42', view: 'org' });
    expect(renderEventsView).toHaveBeenCalledWith(document.getElementById('contentBody'), 'org');
  });

  test('клик по профилю вызывает renderProfileView', () => {
    renderProfileView.mockClear();

    document.getElementById('profileBtn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(renderProfileView).toHaveBeenCalledWith(document.getElementById('contentBody'));
    expect(document.getElementById('contentTitle').textContent).toBe('Профиль');
  });

  test('неизвестный раздел показывает заглушку без падения', () => {
    const navFuture = document.querySelector('.nav-item[data-view="future"]');
    navFuture.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(document.getElementById('contentTitle').textContent).toBe('future');
    expect(document.getElementById('contentBody').innerHTML).toContain('Раздел в разработке');
  });
});
