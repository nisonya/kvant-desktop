/** @jest-environment jsdom */
'use strict';

describe('renderer/js/main.js UI wiring', () => {
  let renderEventsView;
  let renderDocsView;
  let renderStudentsView;
  let ipcInvoke;

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
        return null;
      });
      return { ipcRenderer: { invoke: ipcInvoke } };
    });

    jest.doMock('../events/events-view.js', () => jest.fn());
    renderEventsView = require('../events/events-view.js');
    jest.doMock('../docs-view.js', () => jest.fn());
    renderDocsView = require('../docs-view.js');
    jest.doMock('../students-view.js', () => jest.fn());
    renderStudentsView = require('../students-view.js');

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
});
