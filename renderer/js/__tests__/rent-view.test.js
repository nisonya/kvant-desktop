/** @jest-environment jsdom */
'use strict';

describe('renderer/js/rent-view.js calendar', () => {
  let apiRequest;

  function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function shiftIsoMonth(iso, delta) {
    var parts = iso.split('-').map(function (x) { return parseInt(x, 10); });
    var dt = new Date(parts[0], parts[1] - 1 + delta, 1);
    var days = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    var day = Math.min(parts[2], days);
    return String(dt.getFullYear()) + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' +
      String(day).padStart(2, '0');
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    document.body.innerHTML = '<div id="root"></div>';

    jest.doMock('electron', () => ({
      ipcRenderer: {
        invoke: jest.fn(async function (channel) {
          if (channel === 'get-user') return { accessLevel: 1 };
          return null;
        })
      }
    }));

    jest.doMock('../api-client.js', () => {
      apiRequest = jest.fn(async function (method, path) {
        if (method === 'GET' && path === '/api/reference/rooms') {
          return { data: [{ id: 1, name: '101' }] };
        }
        if (method === 'POST' && path === '/api/rent/by-date-room') {
          return { data: [] };
        }
        if (method === 'GET' && path === '/api/schedule/by-room/1') {
          return { data: [] };
        }
        return { data: [] };
      });
      return {
        apiRequest: apiRequest,
        unwrapResponse: function (res) { return res.data != null ? res.data : res; }
      };
    });
  });

  test('стрелка календаря переносит выбранную дату на следующий месяц', async () => {
    const renderRentView = require('../rent-view.js');
    const root = document.getElementById('root');

    renderRentView(root);
    await flushPromises();
    await flushPromises();

    const initialLabel = document.querySelector('.rent-selected-date').textContent;
    const initialIso = initialLabel.replace('Дата: ', '');
    const expectedIso = shiftIsoMonth(initialIso, 1);

    document.querySelector('.rent-cal__nav[data-nav="next"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(document.querySelector('.rent-selected-date').textContent).toBe('Дата: ' + expectedIso);
    expect(apiRequest).toHaveBeenCalledWith('POST', '/api/rent/by-date-room', {
      date: expectedIso,
      room_id: 1
    });
  });
});
