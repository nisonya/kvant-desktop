'use strict';

const API = require('./api-paths.js');

/**
 * @param {object} deps
 * @param {{ positionsCache: * }} deps.shared
 * @param {function} deps.apiRequest
 * @param {function(string): string} deps.escapeHtml
 * @param {function(string): string} deps.escapeHtmlAttr
 * @param {function(): Array} deps.getActiveEmployees
 * @param {function(): Array} deps.getAllWithInactive
 * @param {function} deps.onAfterPositionMutation
 */
function wireEmployeesPositionsModal(deps) {
  const shared = deps.shared;
  const apiRequest = deps.apiRequest;
  const escapeHtml = deps.escapeHtml;
  const escapeHtmlAttr = deps.escapeHtmlAttr;
  const getActiveEmployees = deps.getActiveEmployees;
  const getAllWithInactive = deps.getAllWithInactive;
  const onAfterPositionMutation = deps.onAfterPositionMutation;

  const positionsBtn = document.getElementById('empPositionsBtn');
  const posModal = document.getElementById('posModal');
  const posCloseBtn = document.getElementById('posClose');
  const posNewName = document.getElementById('posNewName');
  const posCreateBtn = document.getElementById('posCreateBtn');
  const posList = document.getElementById('posList');
  const posMsg = document.getElementById('posMsg');

  let positionsData = [];
  let employeesForPositions = [];

  function openPosModal() {
    if (!posModal) return;
    posModal.hidden = false;
    posModal.setAttribute('aria-hidden', 'false');
    if (posNewName) posNewName.value = '';
    if (posMsg) { posMsg.textContent = ''; posMsg.className = 'pos-msg'; }
    loadPositions();
  }

  function closePosModal() {
    if (!posModal) return;
    posModal.hidden = true;
    posModal.setAttribute('aria-hidden', 'true');
  }

  if (positionsBtn) positionsBtn.addEventListener('click', openPosModal);
  if (posCloseBtn) posCloseBtn.addEventListener('click', closePosModal);
  if (posModal) posModal.addEventListener('click', function (e) {
    if (e.target === posModal) closePosModal();
  });

  function countActiveByPosition(posId) {
    let count = 0;
    employeesForPositions.forEach(function (e) {
      const active = e.is_active === 1 || e.is_active === true;
      if (active && (e.position === posId || e.position_id === posId)) count++;
    });
    return count;
  }

  function renderPositionsList() {
    if (!posList) return;
    if (!positionsData.length) {
      posList.innerHTML = '<p class="pos-empty">Нет должностей</p>';
      return;
    }
    let html = '';
    positionsData.forEach(function (p) {
      const activeCount = countActiveByPosition(p.id);
      const countHtml = activeCount > 0
        ? '<span class="pos-emp-count" title="Активных сотрудников с этой должностью: ' + activeCount + '">Сотрудников: ' + activeCount + '</span>'
        : '';
      html += '<div class="pos-item" data-id="' + p.id + '">' +
        '<div class="pos-item__info">' +
          '<span class="pos-item__name" id="posName' + p.id + '">' + escapeHtml(p.name) + '</span>' +
          countHtml +
        '</div>' +
        '<div class="pos-item__actions">' +
          '<button type="button" class="pos-edit-btn" data-id="' + p.id + '" data-name="' + escapeHtmlAttr(p.name) + '" title="Редактировать">✎</button>' +
          '<button type="button" class="pos-delete-btn" data-id="' + p.id + '" data-count="' + activeCount + '" title="Удалить">✕</button>' +
        '</div>' +
        '</div>';
    });
    posList.innerHTML = html;

    posList.querySelectorAll('.pos-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        startEditPosition(parseInt(btn.dataset.id, 10), btn.dataset.name);
      });
    });
    posList.querySelectorAll('.pos-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        confirmDeletePosition(parseInt(btn.dataset.id, 10), parseInt(btn.dataset.count, 10));
      });
    });
  }

  async function loadPositions() {
    if (posList) posList.innerHTML = '<div class="events-loading">Загрузка...</div>';
    try {
      const r1 = await apiRequest('GET', API.REFERENCE.POSITIONS);
      positionsData = r1.data || r1 || [];
      if (!Array.isArray(positionsData)) positionsData = [];

      try {
        const r2 = await apiRequest('GET', API.EMPLOYEES.WITH_INACTIVE);
        employeesForPositions = r2.data || r2 || [];
        if (!Array.isArray(employeesForPositions)) employeesForPositions = [];
      } catch (e) {
        const all = getAllWithInactive();
        employeesForPositions = all.length ? all : getActiveEmployees();
      }

      renderPositionsList();
    } catch (err) {
      console.error('[positions] load', err);
      if (posList) posList.innerHTML = '<p class="pos-error">Ошибка загрузки</p>';
    }
  }

  if (posCreateBtn) {
    posCreateBtn.addEventListener('click', async function () {
      const name = (posNewName ? posNewName.value : '').trim();
      if (!name) {
        showPosMsg('Введите название должности', true);
        return;
      }
      posCreateBtn.disabled = true;
      showPosMsg('Создание...');
      try {
        await apiRequest('POST', API.REFERENCE.POSITIONS, { name: name });
        if (posNewName) posNewName.value = '';
        shared.positionsCache = null;
        showPosMsg('Должность создана', false);
        await loadPositions();
      } catch (err) {
        showPosMsg(err.message || 'Ошибка', true);
      } finally {
        posCreateBtn.disabled = false;
      }
    });
  }
  if (posNewName) {
    posNewName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (posCreateBtn) posCreateBtn.click();
      }
    });
  }

  function startEditPosition(id, currentName) {
    const nameEl = document.getElementById('posName' + id);
    if (!nameEl) return;
    const itemEl = nameEl.closest('.pos-item');
    if (!itemEl) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pos-edit-input';
    input.value = currentName;
    input.maxLength = 150;

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'pos-save-btn';
    saveBtn.textContent = 'Сохранить';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pos-cancel-btn';
    cancelBtn.textContent = 'Отмена';

    const actionsEl = itemEl.querySelector('.pos-item__actions');
    const infoEl = itemEl.querySelector('.pos-item__info');
    if (actionsEl) actionsEl.style.display = 'none';

    const editRow = document.createElement('div');
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
      const newName = input.value.trim();
      if (!newName) return;
      if (newName === currentName) { cancelEdit(); return; }
      saveBtn.disabled = true;
      try {
        await apiRequest('PUT', API.REFERENCE.POSITION_BY_ID(id), { name: newName });
        shared.positionsCache = null;
        await loadPositions();
        showPosMsg('Должность обновлена', false);
      } catch (err) {
        showPosMsg(err.message || 'Ошибка обновления', true);
        cancelEdit();
      }
    });
  }

  function confirmDeletePosition(id, activeCount) {
    if (activeCount > 0) {
      const ok = window.confirm(
        'К этой должности привязано ' + activeCount + ' активных сотрудник(ов).\n' +
        'Сначала переназначьте их на другую должность.'
      );
      if (!ok) return;
    }
    const proceed = window.confirm('Удалить должность? У неактивных сотрудников должность будет сброшена.');
    if (!proceed) return;
    deletePosition(id);
  }

  async function deletePosition(id) {
    showPosMsg('Удаление...');
    try {
      await apiRequest('DELETE', API.REFERENCE.POSITION_BY_ID(id));
      shared.positionsCache = null;
      showPosMsg('Должность удалена', false);
      await loadPositions();
      onAfterPositionMutation();
    } catch (err) {
      let msg = err.message || 'Ошибка удаления';
      if (err.status === 409 || (msg && msg.indexOf('409') >= 0) || (msg && msg.toLowerCase().indexOf('активн') >= 0)) {
        msg = 'Нельзя удалить: есть активные сотрудники с этой должностью. Переназначьте их.';
      }
      showPosMsg(msg, true);
    }
  }

  function showPosMsg(text, isError) {
    if (!posMsg) return;
    posMsg.textContent = text || '';
    posMsg.className = 'pos-msg' + (isError ? ' pos-msg--err' : (text ? ' pos-msg--ok' : ''));
  }
}

module.exports = { wireEmployeesPositionsModal };
