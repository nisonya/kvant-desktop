'use strict';

const API = require('./api-paths.js');
const { unwrapResponse } = require('./api-client.js');

const EDIT_FIELDS = [
  { key: 'second_name', label: 'Фамилия', required: true },
  { key: 'first_name', label: 'Имя', required: true },
  { key: 'patronymic', label: 'Отчество' },
  { key: 'date_of_birth', label: 'Дата рождения', type: 'date', required: true },
  { key: 'position', label: 'Должность', dropdown: 'positions' },
  { key: 'contact', label: 'Контактный номер', type: 'tel' },
  { key: 'gender', label: 'Пол', select: ['Мужской', 'Женский'] },
  { key: 'education', label: 'Образование', select: ['СПО', 'Высшее', 'Высшее педагогическое'] },
  { key: 'size', label: 'Размер одежды' },
  { key: 'KPI', label: 'KPI' }
];

/**
 * @param {object} deps
 * @param {{ positionsCache: * }} deps.shared
 * @param {function} deps.apiRequest
 * @param {function(string): string} deps.escapeHtml
 * @param {function(string): string} deps.escapeHtmlAttr
 * @param {function(object): string} deps.employeeDisplayName
 * @param {function(): object} deps.getCurrentUser
 * @param {function} deps.onListReload
 */
function wireEmployeesEditModal(deps) {
  const shared = deps.shared;
  const apiRequest = deps.apiRequest;
  const escapeHtml = deps.escapeHtml;
  const escapeHtmlAttr = deps.escapeHtmlAttr;
  const employeeDisplayName = deps.employeeDisplayName;
  const getCurrentUser = deps.getCurrentUser;
  const onListReload = deps.onListReload;

  const empEditModal = document.getElementById('empEditModal');
  const empEditClose = document.getElementById('empEditClose');
  const empEditTitle = document.getElementById('empEditTitle');
  const empEditLoading = document.getElementById('empEditLoading');
  const empEditForm = document.getElementById('empEditForm');

  let editEmpId = null;

  function closeEditModal() {
    if (!empEditModal) return;
    empEditModal.hidden = true;
    empEditModal.setAttribute('aria-hidden', 'true');
  }

  if (empEditClose) empEditClose.addEventListener('click', closeEditModal);
  if (empEditModal) empEditModal.addEventListener('click', function (e) {
    if (e.target === empEditModal) closeEditModal();
  });

  async function openEditEmployee(eid) {
    if (!empEditModal || !empEditForm) return;
    editEmpId = eid;
    empEditModal.hidden = false;
    empEditModal.setAttribute('aria-hidden', 'false');
    if (empEditLoading) empEditLoading.style.display = '';
    empEditForm.style.display = 'none';

    let empData = {};
    try {
      const res = await apiRequest('GET', API.EMPLOYEES.BY_ID(eid));
      empData = unwrapResponse(res);
    } catch (err) {
      console.error('[employees] GET employee', eid, err);
      if (empEditLoading) empEditLoading.innerHTML = '<p class="pos-error">Ошибка загрузки</p>';
      return;
    }

    if (!shared.positionsCache) {
      try {
        const r1 = await apiRequest('GET', API.REFERENCE.POSITIONS);
        shared.positionsCache = r1.data || r1 || [];
        if (!Array.isArray(shared.positionsCache)) shared.positionsCache = [];
      } catch (e) { shared.positionsCache = []; }
    }

    if (empEditTitle) {
      empEditTitle.textContent = employeeDisplayName(empData);
    }

    const currentUser = getCurrentUser();
    const selfId = currentUser ? (currentUser.id || currentUser.id_employees) : null;
    const isSelf = selfId != null && (eid === selfId || eid === Number(selfId));

    let html = '';
    EDIT_FIELDS.forEach(function (f) {
      const val = empData[f.key];
      const str = val != null ? String(val) : '';
      const req = f.required ? ' <abbr title="Обязательное поле">*</abbr>' : '';

      if (f.dropdown === 'positions') {
        let opts = '<option value="">— Выберите —</option>';
        (shared.positionsCache || []).forEach(function (o) {
          const sel = String(o.id) === str ? ' selected' : '';
          opts += '<option value="' + escapeHtmlAttr(String(o.id)) + '"' + sel + '>' + escapeHtml(o.name || String(o.id)) + '</option>';
        });
        html += '<div class="emp-add-field"><span class="emp-add-label">' + escapeHtml(f.label) + req + '</span>' +
          '<select name="' + f.key + '" class="emp-add-input">' + opts + '</select></div>';
      } else if (f.select) {
        let sopts = '<option value="">— Выберите —</option>';
        f.select.forEach(function (o) {
          const sel = str === o ? ' selected' : '';
          sopts += '<option value="' + escapeHtmlAttr(o) + '"' + sel + '>' + escapeHtml(o) + '</option>';
        });
        if (str && f.select.indexOf(str) < 0) {
          sopts = '<option value="' + escapeHtmlAttr(str) + '" selected>' + escapeHtml(str) + '</option>' + sopts;
        }
        html += '<div class="emp-add-field"><span class="emp-add-label">' + escapeHtml(f.label) + req + '</span>' +
          '<select name="' + f.key + '" class="emp-add-input">' + sopts + '</select></div>';
      } else {
        html += '<div class="emp-add-field"><span class="emp-add-label">' + escapeHtml(f.label) + req + '</span>' +
          '<input type="' + (f.type || 'text') + '" name="' + f.key + '" value="' + escapeHtmlAttr(str) + '" class="emp-add-input" autocomplete="off"></div>';
      }
    });

    if (!isSelf) {
      const isActive = empData.is_active === 1 || empData.is_active === true;
      html += '<div class="emp-add-field emp-edit-active-field">' +
        '<label class="emp-edit-employed-label">' +
        '<input type="checkbox" name="is_active"' + (isActive ? ' checked' : '') + '>' +
        '<span class="emp-edit-employed-text">Трудоустроен</span></label>' +
        '</div>';
    }

    const empIsInactive = empData.is_active === 0 || empData.is_active === false;
    const deleteHtml = (!isSelf && empIsInactive)
      ? '<button type="button" class="emp-delete-btn" id="empEditDeleteBtn">Удалить сотрудника</button>'
      : '';

    html += '<div class="emp-add-actions">' +
      '<button type="submit" class="emp-add-submit" id="empEditSaveBtn">Сохранить</button>' +
      '<button type="button" class="profile-cancel-btn" id="empEditCancelBtn">Отмена</button>' +
      deleteHtml +
      '<span class="emp-add-msg" id="empEditMsg"></span>' +
      '</div>';

    empEditForm.innerHTML = html;
    if (empEditLoading) empEditLoading.style.display = 'none';
    empEditForm.style.display = '';

    const activeCheckbox = empEditForm.querySelector('input[name="is_active"]');
    if (activeCheckbox) {
      activeCheckbox.addEventListener('change', function () {
        const delBtn = document.getElementById('empEditDeleteBtn');
        if (activeCheckbox.checked) {
          if (delBtn) delBtn.style.display = 'none';
        } else {
          if (!delBtn && !isSelf) {
            const actions = empEditForm.querySelector('.emp-add-actions');
            if (actions) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'emp-delete-btn';
              btn.id = 'empEditDeleteBtn';
              btn.textContent = 'Удалить сотрудника';
              btn.addEventListener('click', handleDeleteEmployee);
              actions.insertBefore(btn, document.getElementById('empEditMsg'));
            }
          } else if (delBtn) {
            delBtn.style.display = '';
          }
        }
      });
    }

    const cancelBtn = document.getElementById('empEditCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeEditModal);

    const deleteBtn = document.getElementById('empEditDeleteBtn');
    if (deleteBtn) deleteBtn.addEventListener('click', handleDeleteEmployee);

    async function handleDeleteEmployee() {
      const name = employeeDisplayName(empData);
      const confirmed = window.confirm('Удалить сотрудника «' + name + '» из базы?\n\nВсе связанные данные (профиль, расписание, ответственность за мероприятия) будут удалены безвозвратно.');
      if (!confirmed) return;
      const msgEl = document.getElementById('empEditMsg');
      if (msgEl) { msgEl.textContent = 'Удаление...'; msgEl.className = 'emp-add-msg'; }
      try {
        await apiRequest('DELETE', API.EMPLOYEES.BY_ID(editEmpId));
        if (msgEl) { msgEl.textContent = 'Сотрудник удалён'; msgEl.className = 'emp-add-msg emp-add-msg--ok'; }
        setTimeout(function () { closeEditModal(); onListReload(); }, 600);
      } catch (err) {
        console.error('[employees] DELETE', err);
        if (msgEl) { msgEl.textContent = err.message || 'Ошибка удаления'; msgEl.className = 'emp-add-msg emp-add-msg--err'; }
      }
    }

    empEditForm.onsubmit = async function (ev) {
      ev.preventDefault();
      const msgEl = document.getElementById('empEditMsg');
      const saveBtn = document.getElementById('empEditSaveBtn');

      const body = {};
      EDIT_FIELDS.forEach(function (f) {
        const el = empEditForm.elements.namedItem(f.key);
        if (!el) return;
        const v = el.value.trim();
        if (f.dropdown === 'positions' && v) {
          body[f.key] = parseInt(v, 10);
        } else if (v !== '') {
          body[f.key] = v;
        }
      });

      if (!body.first_name || !body.second_name || !body.date_of_birth) {
        if (msgEl) { msgEl.textContent = 'Имя, Фамилия и Дата рождения обязательны'; msgEl.className = 'emp-add-msg emp-add-msg--err'; }
        return;
      }

      if (!isSelf) {
        const cb = empEditForm.querySelector('input[name="is_active"]');
        if (cb) body.is_active = cb.checked ? 1 : 0;
      }

      if (saveBtn) saveBtn.disabled = true;
      if (msgEl) { msgEl.textContent = 'Сохранение...'; msgEl.className = 'emp-add-msg'; }

      try {
        await apiRequest('PUT', API.EMPLOYEES.BY_ID(editEmpId), body);
        if (msgEl) { msgEl.textContent = 'Сохранено'; msgEl.className = 'emp-add-msg emp-add-msg--ok'; }
        setTimeout(function () { closeEditModal(); onListReload(); }, 600);
      } catch (err) {
        console.error('[employees] PUT', err);
        if (msgEl) { msgEl.textContent = err.message || 'Ошибка'; msgEl.className = 'emp-add-msg emp-add-msg--err'; }
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    };
  }

  return { openEditEmployee, closeEditModal };
}

module.exports = { wireEmployeesEditModal };
