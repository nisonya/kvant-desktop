'use strict';

const API = require('./api-paths.js');
const { unwrapResponse } = require('./api-client.js');

/**
 * @param {object} deps
 * @param {{ positionsCache: *, accessLevelsCache: * }} deps.shared
 * @param {function} deps.apiRequest
 * @param {function(string): string} deps.escapeHtml
 * @param {function(string): string} deps.escapeHtmlAttr
 * @param {function} deps.onEmployeeCreated
 */
function wireEmployeesAddModal(deps) {
  const shared = deps.shared;
  const apiRequest = deps.apiRequest;
  const escapeHtml = deps.escapeHtml;
  const escapeHtmlAttr = deps.escapeHtmlAttr;
  const onEmployeeCreated = deps.onEmployeeCreated;

  const addBtn = document.getElementById('empAddBtn');
  const addModal = document.getElementById('empAddModal');
  const addClose = document.getElementById('empAddClose');
  const addForm = document.getElementById('empAddForm');
  const addMsg = document.getElementById('empAddMsg');

  function fillSelect(selectEl, items, placeholder) {
    if (!selectEl) return;
    let html = '<option value="">' + escapeHtml(placeholder) + '</option>';
    (items || []).forEach(function (o) {
      html += '<option value="' + escapeHtmlAttr(String(o.id)) + '">' + escapeHtml(o.name || String(o.id)) + '</option>';
    });
    selectEl.innerHTML = html;
    selectEl.disabled = false;
  }

  /** Ответ справочника как в API_DOCUMENTATION: массив или { success, data: массив }. */
  function asReferenceArray(res) {
    const u = unwrapResponse(res);
    if (Array.isArray(u)) return u;
    if (u && Array.isArray(u.data)) return u.data;
    if (res && Array.isArray(res.data)) return res.data;
    return [];
  }

  async function loadAddFormDropdowns() {
    const posSelect = document.getElementById('empAddPosition');
    const accSelect = document.getElementById('empAddAccess');
    if (!shared.positionsCache) {
      try {
        const r1 = await apiRequest('GET', API.REFERENCE.POSITIONS);
        shared.positionsCache = asReferenceArray(r1);
      } catch (e) {
        console.warn('[employees] GET positions', e);
        shared.positionsCache = [];
      }
    }
    if (!shared.accessLevelsCache) {
      try {
        const r2 = await apiRequest('GET', API.REFERENCE.ACCESS);
        shared.accessLevelsCache = asReferenceArray(r2);
      } catch (e) {
        console.warn('[employees] GET access levels', e);
        shared.accessLevelsCache = [];
      }
    }
    fillSelect(posSelect, shared.positionsCache, '— Выберите должность —');
    fillSelect(accSelect, shared.accessLevelsCache, '— Выберите уровень доступа —');
  }

  /** Снимаем disabled/readonly (в т.ч. после сбоя отправки), иначе поля кажутся «не редактируемыми». */
  function ensureAddFormEditable() {
    if (!addForm) return;
    addForm.querySelectorAll('input, select, textarea, button').forEach(function (el) {
      if (el.type === 'hidden') return;
      el.disabled = false;
      el.removeAttribute('readonly');
    });
    const sb = document.getElementById('empAddSubmit');
    if (sb) sb.disabled = false;
  }

  async function openAddModal() {
    if (!addModal) return;
    addModal.hidden = false;
    addModal.setAttribute('aria-hidden', 'false');
    if (addForm) {
      addForm.reset();
      delete addForm.dataset.submitting;
    }
    ensureAddFormEditable();
    if (addMsg) { addMsg.textContent = ''; addMsg.className = 'emp-add-msg'; }
    try {
      await loadAddFormDropdowns();
    } finally {
      ensureAddFormEditable();
    }
  }

  function closeAddModal() {
    if (!addModal) return;
    addModal.hidden = true;
    addModal.setAttribute('aria-hidden', 'true');
  }

  if (addBtn) addBtn.addEventListener('click', function () { void openAddModal(); });
  if (addClose) addClose.addEventListener('click', closeAddModal);
  if (addModal) addModal.addEventListener('click', function (e) {
    if (e.target === addModal) closeAddModal();
  });

  if (addForm) {
    addForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (addForm.dataset.submitting === '1') return;
      const secondName = (addForm.elements.second_name.value || '').trim();
      const firstName = (addForm.elements.first_name.value || '').trim();
      const patronymic = (addForm.elements.patronymic.value || '').trim();
      const dateOfBirth = (addForm.elements.date_of_birth.value || '').trim();
      const position = addForm.elements.position.value || '';
      const accessLevelId = addForm.elements.access_level_id.value || '';
      const login = (addForm.elements.login.value || '').trim();
      const password = addForm.elements.password.value || '';

      if (!secondName || !firstName || !dateOfBirth || !position || !accessLevelId || !login || !password) {
        if (addMsg) { addMsg.textContent = 'Заполните все обязательные поля'; addMsg.className = 'emp-add-msg emp-add-msg--err'; }
        return;
      }
      if (login.length < 6) {
        if (addMsg) { addMsg.textContent = 'Логин — минимум 6 символов'; addMsg.className = 'emp-add-msg emp-add-msg--err'; }
        return;
      }
      const submitBtn = document.getElementById('empAddSubmit');
      addForm.dataset.submitting = '1';
      if (submitBtn) submitBtn.disabled = true;
      if (addMsg) { addMsg.textContent = 'Создание...'; addMsg.className = 'emp-add-msg'; }
      let createdOk = false;
      try {
        await apiRequest('POST', API.EMPLOYEES.ADD, {
          first_name: firstName,
          second_name: secondName,
          patronymic: patronymic || null,
          date_of_birth: dateOfBirth,
          position: parseInt(position, 10),
          login: login,
          password: password,
          access_level_id: parseInt(accessLevelId, 10),
          is_active: 1
        });
        createdOk = true;
        if (addMsg) { addMsg.textContent = 'Сотрудник создан'; addMsg.className = 'emp-add-msg emp-add-msg--ok'; }
        shared.positionsCache = null;
        setTimeout(function () {
          delete addForm.dataset.submitting;
          closeAddModal();
          onEmployeeCreated();
        }, 700);
      } catch (err) {
        console.error('[employees] create', err);
        if (addMsg) { addMsg.textContent = err.message || 'Ошибка'; addMsg.className = 'emp-add-msg emp-add-msg--err'; }
      }
      if (!createdOk) {
        delete addForm.dataset.submitting;
        if (submitBtn) submitBtn.disabled = false;
        ensureAddFormEditable();
      }
    });
  }
}

module.exports = { wireEmployeesAddModal };
