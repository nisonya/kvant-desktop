'use strict';

const API = require('./api-paths.js');
const { unwrapResponse } = require('./api-client.js');

const ROOM_NAME_MAX = 150;

/**
 * @param {object} deps
 * @param {function} deps.apiRequest
 * @param {function(string): string} deps.escapeHtml
 * @param {function(string): string} deps.escapeHtmlAttr
 * @param {function(): Promise<void>} deps.onAfterRoomsMutation
 */
function wireRentRoomsModal(deps) {
  var apiRequest = deps.apiRequest;
  var escapeHtml = deps.escapeHtml;
  var escapeHtmlAttr = deps.escapeHtmlAttr;
  var onAfterRoomsMutation = deps.onAfterRoomsMutation;

  var roomsBtn = document.getElementById('rentRoomsBtn');
  var roomsModal = document.getElementById('rentRoomsModal');
  var roomsCloseBtn = document.getElementById('rentRoomsClose');
  var roomsNewName = document.getElementById('rentRoomsNewName');
  var roomsCreateBtn = document.getElementById('rentRoomsCreateBtn');
  var roomsList = document.getElementById('rentRoomsList');
  var roomsMsg = document.getElementById('rentRoomsMsg');

  var roomsData = [];

  function openRoomsModal() {
    if (!roomsModal) return;
    roomsModal.hidden = false;
    roomsModal.setAttribute('aria-hidden', 'false');
    if (roomsNewName) roomsNewName.value = '';
    showRoomsMsg('');
    loadRooms();
  }

  function closeRoomsModal() {
    if (!roomsModal) return;
    roomsModal.hidden = true;
    roomsModal.setAttribute('aria-hidden', 'true');
  }

  if (roomsBtn) roomsBtn.addEventListener('click', openRoomsModal);
  if (roomsCloseBtn) roomsCloseBtn.addEventListener('click', closeRoomsModal);
  if (roomsModal) {
    roomsModal.addEventListener('click', function (e) {
      if (e.target === roomsModal) closeRoomsModal();
    });
  }

  function renderRoomsList() {
    if (!roomsList) return;
    if (!roomsData.length) {
      roomsList.innerHTML = '<p class="pos-empty">Нет кабинетов</p>';
      return;
    }
    var html = '';
    roomsData.forEach(function (r) {
      html += '<div class="pos-item" data-id="' + r.id + '">' +
        '<div class="pos-item__info">' +
          '<span class="pos-item__name" id="rentRoomName' + r.id + '">' + escapeHtml(r.name) + '</span>' +
        '</div>' +
        '<div class="pos-item__actions">' +
          '<button type="button" class="pos-edit-btn rent-room-edit-btn" data-id="' + r.id + '" data-name="' + escapeHtmlAttr(r.name) + '" title="Редактировать">✎</button>' +
          '<button type="button" class="pos-delete-btn rent-room-delete-btn" data-id="' + r.id + '" title="Удалить">✕</button>' +
        '</div>' +
        '</div>';
    });
    roomsList.innerHTML = html;

    roomsList.querySelectorAll('.rent-room-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        startEditRoom(parseInt(btn.getAttribute('data-id'), 10), btn.getAttribute('data-name') || '');
      });
    });
    roomsList.querySelectorAll('.rent-room-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        confirmDeleteRoom(parseInt(btn.getAttribute('data-id'), 10));
      });
    });
  }

  async function loadRooms() {
    if (roomsList) roomsList.innerHTML = '<div class="events-loading">Загрузка...</div>';
    try {
      var res = await apiRequest('GET', API.REFERENCE.ROOMS);
      roomsData = unwrapResponse(res);
      if (!Array.isArray(roomsData)) roomsData = [];
      roomsData.sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
      });
      renderRoomsList();
    } catch (err) {
      if (roomsList) roomsList.innerHTML = '<p class="pos-error">Ошибка загрузки</p>';
      showRoomsMsg((err && err.message) || 'Не удалось загрузить кабинеты', true);
    }
  }

  if (roomsCreateBtn) {
    roomsCreateBtn.addEventListener('click', async function () {
      var name = (roomsNewName ? roomsNewName.value : '').trim();
      if (!name) {
        showRoomsMsg('Введите название кабинета', true);
        return;
      }
      if (name.length > ROOM_NAME_MAX) {
        showRoomsMsg('Название не длиннее ' + ROOM_NAME_MAX + ' символов', true);
        return;
      }
      roomsCreateBtn.disabled = true;
      showRoomsMsg('Создание...');
      try {
        await apiRequest('POST', API.REFERENCE.ROOMS, { name: name });
        if (roomsNewName) roomsNewName.value = '';
        showRoomsMsg('Кабинет добавлен', false);
        await loadRooms();
        if (typeof onAfterRoomsMutation === 'function') await onAfterRoomsMutation();
      } catch (err) {
        showRoomsMsg((err && err.message) || 'Ошибка', true);
      } finally {
        roomsCreateBtn.disabled = false;
      }
    });
  }

  if (roomsNewName) {
    roomsNewName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (roomsCreateBtn) roomsCreateBtn.click();
      }
    });
  }

  function startEditRoom(id, currentName) {
    var nameEl = document.getElementById('rentRoomName' + id);
    if (!nameEl) return;
    var itemEl = nameEl.closest('.pos-item');
    if (!itemEl) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'pos-edit-input';
    input.value = currentName;
    input.maxLength = ROOM_NAME_MAX;

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'pos-save-btn';
    saveBtn.textContent = 'Сохранить';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pos-cancel-btn';
    cancelBtn.textContent = 'Отмена';

    var actionsEl = itemEl.querySelector('.pos-item__actions');
    var infoEl = itemEl.querySelector('.pos-item__info');
    if (actionsEl) actionsEl.style.display = 'none';

    var editRow = document.createElement('div');
    editRow.className = 'pos-edit-row';
    editRow.appendChild(input);
    editRow.appendChild(saveBtn);
    editRow.appendChild(cancelBtn);
    if (infoEl) infoEl.style.display = 'none';
    itemEl.appendChild(editRow);
    input.focus();
    input.select();

    function cancelEdit() {
      editRow.remove();
      if (infoEl) infoEl.style.display = '';
      if (actionsEl) actionsEl.style.display = '';
    }

    cancelBtn.addEventListener('click', cancelEdit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') cancelEdit();
      if (e.key === 'Enter') saveBtn.click();
    });

    saveBtn.addEventListener('click', async function () {
      var newName = input.value.trim();
      if (!newName) return;
      if (newName.length > ROOM_NAME_MAX) {
        showRoomsMsg('Название не длиннее ' + ROOM_NAME_MAX + ' символов', true);
        return;
      }
      if (newName === currentName) {
        cancelEdit();
        return;
      }
      saveBtn.disabled = true;
      try {
        await apiRequest('PUT', API.REFERENCE.ROOM_BY_ID(id), { name: newName });
        await loadRooms();
        showRoomsMsg('Кабинет обновлён', false);
        if (typeof onAfterRoomsMutation === 'function') await onAfterRoomsMutation();
      } catch (err) {
        showRoomsMsg((err && err.message) || 'Ошибка обновления', true);
        cancelEdit();
      }
    });
  }

  function confirmDeleteRoom(id) {
    if (!window.confirm('Удалить кабинет? Если он используется в расписании или брони, операция может быть отклонена.')) return;
    deleteRoom(id);
  }

  async function deleteRoom(id) {
    showRoomsMsg('Удаление...');
    try {
      await apiRequest('DELETE', API.REFERENCE.ROOM_BY_ID(id));
      showRoomsMsg('Кабинет удалён', false);
      await loadRooms();
      if (typeof onAfterRoomsMutation === 'function') await onAfterRoomsMutation();
    } catch (err) {
      var msg = (err && err.message) || 'Ошибка удаления';
      if (err && (err.status === 409 || String(msg).toLowerCase().indexOf('использ') >= 0)) {
        msg = 'Нельзя удалить: кабинет используется в расписании или бронировании.';
      }
      showRoomsMsg(msg, true);
    }
  }

  function showRoomsMsg(text, isError) {
    if (!roomsMsg) return;
    roomsMsg.textContent = text || '';
    roomsMsg.className = 'pos-msg' + (isError ? ' pos-msg--err' : (text ? ' pos-msg--ok' : ''));
  }
}

module.exports = { wireRentRoomsModal };
