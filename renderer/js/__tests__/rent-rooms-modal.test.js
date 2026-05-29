/** @jest-environment jsdom */
'use strict';

describe('renderer/js/rent-rooms-modal.js', () => {
  function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = [
      '<button type="button" id="rentRoomsBtn">Изменить кабинеты</button>',
      '<div id="rentRoomsModal" hidden aria-hidden="true">',
      '  <button type="button" id="rentRoomsClose">Закрыть</button>',
      '  <input type="text" id="rentRoomsNewName">',
      '  <button type="button" id="rentRoomsCreateBtn">Добавить</button>',
      '  <div id="rentRoomsList"></div>',
      '  <div id="rentRoomsMsg"></div>',
      '</div>'
    ].join('');
  });

  test('добавление комнаты отправляет POST /api/reference/rooms с JSON name', async () => {
    const { wireRentRoomsModal } = require('../rent-rooms-modal.js');
    const apiRequest = jest.fn(async function (method, path) {
      if (method === 'GET' && path === '/api/reference/rooms') return { data: [] };
      if (method === 'POST' && path === '/api/reference/rooms') return { success: true, data: { id: 7 } };
      return { data: [] };
    });

    wireRentRoomsModal({
      apiRequest: apiRequest,
      escapeHtml: function (value) { return String(value); },
      escapeHtmlAttr: function (value) { return String(value); },
      onAfterRoomsMutation: jest.fn()
    });

    document.getElementById('rentRoomsBtn')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    document.getElementById('rentRoomsNewName').value = 'Кабинет 101';
    document.getElementById('rentRoomsCreateBtn')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('POST', '/api/reference/rooms', { name: 'Кабинет 101' });
  });
});
