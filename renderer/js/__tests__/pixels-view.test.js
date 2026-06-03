/** @jest-environment jsdom */
'use strict';

describe('renderer/js/pixels-view.js', () => {
  let apiRequest;

  function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
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
      apiRequest = jest.fn(async function (method, path, body) {
        if (method === 'GET' && path === '/api/groups/list') {
          return { data: [{ id: 1, name: 'Группа 1' }] };
        }
        if (method === 'GET' && path === '/api/groups/pixels/1') {
          return {
            data: [{
              id_student: 10,
              name: 'Иван Иванов',
              part_of_comp: 0,
              make_content: 0,
              invite_friend: 0,
              clean_kvantum: 0,
              filled_project_card_on_time: 0,
              finished_project_with_product: 0,
              regional_competition: 0,
              interregional_competition: 0,
              all_russian_competition: 0,
              international_competition: 0,
              nto: 0,
              become_an_engineering_volunteer: 0,
              help_with_event: 0,
              make_own_event: 0,
              special_achievements: 0,
              fine: 0
            }]
          };
        }
        if (method === 'GET' && path === '/api/attendance/by-group/1') {
          return { data: [] };
        }
        if (method === 'PUT' && path === '/api/groups/pixels') {
          return { success: true, data: { ok: true, body: body } };
        }
        return { data: [] };
      });
      return {
        apiRequest: apiRequest,
        unwrapResponse: function (res) { return res.data != null ? res.data : res; }
      };
    });
  });

  test('штраф отправляется положительным значением fine', async () => {
    const renderPixelsView = require('../pixels-view.js');
    const root = document.getElementById('root');

    renderPixelsView(root);
    await flushPromises();
    await flushPromises();

    document.querySelector('[data-column-key="fine"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.getElementById('pixelsActionNumber').value = '15';
    document.getElementById('pixelsActionNumber')
      .dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('pixelsActionConfirm')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('PUT', '/api/groups/pixels', expect.objectContaining({
      id_student: 10,
      fine: 15
    }));
  });

  test('позиция таблицы сохраняется после начисления пикселей', async () => {
    const renderPixelsView = require('../pixels-view.js');
    const root = document.getElementById('root');

    renderPixelsView(root);
    await flushPromises();
    await flushPromises();

    var scrollEl = document.querySelector('.pixels-table-scroll');
    scrollEl.scrollTop = 120;
    scrollEl.scrollLeft = 80;

    document.querySelector('[data-column-key="part_of_comp"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.getElementById('pixelsActionConfirm')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    var updatedScrollEl = document.querySelector('.pixels-table-scroll');
    expect(updatedScrollEl.scrollTop).toBe(120);
    expect(updatedScrollEl.scrollLeft).toBe(80);
  });
});
