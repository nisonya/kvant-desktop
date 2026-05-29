/** @jest-environment jsdom */
'use strict';

describe('renderer/js/schedule-view.js', () => {
  let apiRequest;

  function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    document.body.innerHTML = '<div id="root"></div>';
    window.confirm = jest.fn(() => true);

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
        if (method === 'GET' && path === '/api/employees/with-inactive') {
          return { data: [{ id: 5, name: 'Наставник', position: 2, is_active: 1 }] };
        }
        if (method === 'GET' && path === '/api/reference/rooms') {
          return { data: [{ id: 7, name: '101' }] };
        }
        if (method === 'GET' && path === '/api/schedule/groups') {
          return { data: [{ id: 8, name: 'Группа 1' }] };
        }
        if (method === 'GET' && path === '/api/schedule/teachers') {
          return { data: [{ id: 5, name: 'Наставник' }] };
        }
        if (method === 'GET' && path === '/api/schedule/by-teacher/5') {
          return {
            data: [{
              id: 99,
              room_id: 7,
              group_id: 8,
              id_employees: 5,
              room: '101',
              group: 'Группа 1',
              name: 'Наставник',
              day: 1,
              startTime: '10:00:00',
              endTime: '11:00:00'
            }]
          };
        }
        if (method === 'DELETE' && path === '/api/schedule/99') {
          return { success: true, data: { ok: true } };
        }
        return { data: [] };
      });
      return {
        apiRequest: apiRequest,
        unwrapResponse: function (res) { return res.data != null ? res.data : res; }
      };
    });
  });

  test('удаление расписания использует id занятия, а не id_employees', async () => {
    const renderScheduleView = require('../schedule-view.js');
    const root = document.getElementById('root');

    renderScheduleView(root);
    await flushPromises();
    await flushPromises();

    document.querySelector('.event-rent-btn--del')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('DELETE', '/api/schedule/99');
    expect(apiRequest).not.toHaveBeenCalledWith('DELETE', '/api/schedule/5');
  });
});
