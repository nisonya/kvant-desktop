'use strict';

const { ipcRenderer } = require('electron');
const { apiRequest, unwrapResponse } = require('./api-client.js');
const API = require('./api-paths.js');
const { escapeHtml, escapeHtmlAttr } = require('./html-escape.js');

function normalizeDateValue(value) {
  return String(value == null ? '' : value).trim();
}

function compareIsoDates(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

const ADMIN_ACCESS_LEVELS = [1, 4, 6];
const DANGER_ROLE_KEYS = ['root', 'admin', 'administrator', 'leader', 'руководитель'];

function hasDangerAccess(user) {
  if (!user || typeof user !== 'object') return false;
  var level = user.accessLevel != null ? user.accessLevel : user.access_level_id;
  var n = Number(level);
  if (!isNaN(n) && ADMIN_ACCESS_LEVELS.indexOf(n) >= 0) return true;
  var roleRaw = user.role || user.role_name || user.access_name || user.accessName || '';
  var role = String(roleRaw).trim().toLowerCase();
  if (!role) return false;
  return DANGER_ROLE_KEYS.some(function (key) { return role.indexOf(key) >= 0; });
}

module.exports = function renderAttendanceView(container) {
  if (!container) return;

  var groups = [];
  var selectedGroupId = '';
  var attendance = [];
  var loading = false;
  var canDangerActions = false;
  var clearConfirmOpen = false;
  var clearInProgress = false;
  var editOpen = false;
  var editLoading = false;
  var editSaving = false;
  var editGroupId = '';
  var editDate = '';
  var editStudents = [];
  var editMessage = '';
  var message = '';

  function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function studentIdOf(row) {
    var raw = row && (row.id_student != null ? row.id_student
      : (row.idStudent != null ? row.idStudent
        : (row.student_id != null ? row.student_id : row.id)));
    if (raw == null) return null;
    var n = parseInt(String(raw), 10);
    return isNaN(n) || n <= 0 ? null : n;
  }

  function studentNameOf(row) {
    if (!row || typeof row !== 'object') return '—';
    var direct = row.name || row.full_name || row.fio;
    if (direct && String(direct).trim()) return String(direct).trim();
    var parts = [row.surnameStudent || row.surname, row.nameStudent || row.first_name || row.name, row.patronymic]
      .map(function (v) { return v == null ? '' : String(v).trim(); })
      .filter(Boolean);
    return parts.length ? parts.join(' ') : '—';
  }

  function setMessage(text, kind) {
    message = text || '';
    var el = document.getElementById('attendanceMsg');
    if (!el) return;
    el.textContent = message;
    el.className = 'students-msg' + (kind ? ' students-msg--' + kind : '');
  }

  function toPivot(rows) {
    var dateSet = {};
    var studentMap = {};
    rows.forEach(function (row) {
      var name = String(row && row.name ? row.name : '—').trim() || '—';
      var date = normalizeDateValue(row && row.date_of_lesson);
      if (!date) return;
      dateSet[date] = true;
      if (!studentMap[name]) studentMap[name] = {};
      studentMap[name][date] = Number(row && row.presence) === 1 ? '✓' : '—';
    });
    var dates = Object.keys(dateSet).sort(compareIsoDates);
    var students = Object.keys(studentMap).sort(function (a, b) { return a.localeCompare(b, 'ru'); });
    return {
      dates: dates,
      students: students.map(function (name) {
        return { name: name, byDate: studentMap[name] || {} };
      })
    };
  }

  function renderTable() {
    var wrap = document.getElementById('attendanceTableWrap');
    if (!wrap) return;
    if (loading) {
      wrap.innerHTML = '<div class="events-loading">Загрузка посещаемости...</div>';
      return;
    }
    if (!selectedGroupId) {
      wrap.innerHTML = '<div class="students-empty">Выберите группу, чтобы посмотреть посещаемость.</div>';
      return;
    }
    if (!attendance.length) {
      wrap.innerHTML = '<div class="students-empty">По выбранной группе нет данных посещаемости.</div>';
      return;
    }
    var pivot = toPivot(attendance);
    if (!pivot.dates.length || !pivot.students.length) {
      wrap.innerHTML = '<div class="students-empty">По выбранной группе нет данных посещаемости.</div>';
      return;
    }
    var head = '<th class="attendance-table__name-col">Фамилия Имя ученика</th>' +
      pivot.dates.map(function (d) { return '<th>' + escapeHtml(d) + '</th>'; }).join('');
    var body = pivot.students.map(function (s) {
      var cells = pivot.dates.map(function (d) {
        var value = s.byDate[d] || '—';
        return '<td>' + escapeHtml(value) + '</td>';
      }).join('');
      return '<tr><td class="attendance-table__name-col">' + escapeHtml(s.name) + '</td>' + cells + '</tr>';
    }).join('');
    wrap.innerHTML =
      '<div class="attendance-table-scroll">' +
      '<table class="attendance-table">' +
      '<thead><tr>' + head + '</tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '</table>' +
      '</div>';
  }

  function renderClearConfirmModal() {
    var modal = document.getElementById('attendanceClearModal');
    var body = document.getElementById('attendanceClearModalBody');
    if (!modal || !body) return;
    if (!clearConfirmOpen) {
      modal.hidden = true;
      body.innerHTML = '';
      return;
    }
    body.innerHTML =
      '<div class="groups-danger-warning">' +
      '<h5 class="groups-danger-warning__title">ВНИМАНИЕ: НЕОБРАТИМОЕ ДЕЙСТВИЕ</h5>' +
      '<p class="groups-danger-warning__text">Вы собираетесь очистить <b>всю посещаемость</b> по всем группам.</p>' +
      '<p class="groups-danger-warning__text">После очистки восстановить записи автоматически нельзя.</p>' +
      '</div>' +
      '<div class="students-msg" id="attendanceClearMsg"></div>' +
      '<div class="groups-transfer-bottom groups-transfer-bottom--right">' +
      '<button type="button" class="groups-edit-del" id="attendanceClearCancel">Отмена</button>' +
      '<button type="button" class="groups-edit-save" id="attendanceClearApply">Понимаю, очистить</button>' +
      '</div>';
    modal.hidden = false;
    var cancelBtn = document.getElementById('attendanceClearCancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        clearConfirmOpen = false;
        renderClearConfirmModal();
      });
    }
    var applyBtn = document.getElementById('attendanceClearApply');
    var msgEl = document.getElementById('attendanceClearMsg');
    if (applyBtn) {
      applyBtn.disabled = !!clearInProgress;
      applyBtn.addEventListener('click', async function () {
        if (clearInProgress) return;
        clearInProgress = true;
        applyBtn.disabled = true;
        if (msgEl) {
          msgEl.textContent = 'Очистка посещаемости...';
          msgEl.className = 'students-msg';
        }
        try {
          await apiRequest('POST', API.ATTENDANCE.CLEAR_ALL, {});
          attendance = [];
          renderTable();
          clearConfirmOpen = false;
          renderClearConfirmModal();
          setMessage('Вся посещаемость очищена.', 'ok');
        } catch (err) {
          if (msgEl) {
            msgEl.textContent = (err && err.message) || 'Не удалось очистить посещаемость.';
            msgEl.className = 'students-msg students-msg--err';
          }
        } finally {
          clearInProgress = false;
          var btn = document.getElementById('attendanceClearApply');
          if (btn) btn.disabled = false;
        }
      });
    }
  }

  async function loadEditAttendanceData() {
    if (!editGroupId || !editDate) {
      editStudents = [];
      return;
    }
    editLoading = true;
    editMessage = '';
    renderEditModal();
    try {
      var studentsRes = await apiRequest('GET', API.STUDENTS.FULL_BY_GROUP(editGroupId));
      var studentsRows = unwrapResponse(studentsRes);
      studentsRows = Array.isArray(studentsRows) ? studentsRows : [];
      var studentsList = studentsRows.map(function (row) {
        return { id: studentIdOf(row), name: studentNameOf(row) };
      }).filter(function (s) { return s.id != null; });

      var byDateRes = await apiRequest('PUT', API.ATTENDANCE.BY_GROUP_DATE_NEW, {
        group_id: parseInt(String(editGroupId), 10),
        date: editDate
      });
      var byDateRows = unwrapResponse(byDateRes);
      byDateRows = Array.isArray(byDateRows) ? byDateRows : [];
      var presenceById = {};
      byDateRows.forEach(function (row) {
        var sid = studentIdOf(row);
        if (sid == null) return;
        presenceById[String(sid)] = Number(row && row.presence) === 1;
      });
      editStudents = studentsList.map(function (s) {
        return {
          id: s.id,
          name: s.name,
          present: !!presenceById[String(s.id)]
        };
      });
    } finally {
      editLoading = false;
      renderEditModal();
    }
  }

  function renderEditModal() {
    var modal = document.getElementById('attendanceEditModal');
    var body = document.getElementById('attendanceEditModalBody');
    if (!modal || !body) return;
    if (!editOpen) {
      modal.hidden = true;
      body.innerHTML = '';
      return;
    }
    var groupOptions = ['<option value="">Выберите группу</option>'].concat(groups.map(function (g) {
      var sid = String(g.id);
      var selectedAttr = String(editGroupId) === sid ? ' selected' : '';
      return '<option value="' + escapeHtmlAttr(sid) + '"' + selectedAttr + '>' + escapeHtml(String(g.name || '—')) + '</option>';
    })).join('');
    var studentsHtml = '';
    if (editLoading) {
      studentsHtml = '<div class="events-loading">Загрузка посещаемости...</div>';
    } else if (!editGroupId || !editDate) {
      studentsHtml = '<div class="students-empty">Выберите группу и дату.</div>';
    } else if (!editStudents.length) {
      studentsHtml = '<div class="students-empty">В выбранной группе нет учеников.</div>';
    } else {
      studentsHtml = '<div class="attendance-edit-list">' + editStudents.map(function (s, idx) {
        return '<label class="attendance-edit-item">' +
          '<input type="checkbox" class="attendance-edit-check" data-row-index="' + idx + '"' + (s.present ? ' checked' : '') + (editSaving ? ' disabled' : '') + '>' +
          '<span class="attendance-edit-name">' + escapeHtml(s.name) + '</span>' +
          '</label>';
      }).join('') + '</div>';
    }
    body.innerHTML =
      '<div class="attendance-edit-controls">' +
      '<label class="attendance-edit-control"><span class="attendance-edit-label">Группа</span><select id="attendanceEditGroupSelect" class="groups-edit-input"' + (editSaving ? ' disabled' : '') + '>' + groupOptions + '</select></label>' +
      '<label class="attendance-edit-control"><span class="attendance-edit-label">Дата</span><input type="date" id="attendanceEditDate" class="groups-edit-input" value="' + escapeHtmlAttr(editDate || '') + '"' + (editSaving ? ' disabled' : '') + '></label>' +
      '<button type="button" class="groups-edit-save" id="attendanceEditLoadBtn"' + (editSaving ? ' disabled' : '') + '>Загрузить</button>' +
      '</div>' +
      '<div class="students-msg' + (editMessage ? ' students-msg--err' : '') + '" id="attendanceEditMsg">' + escapeHtml(editMessage || '') + '</div>' +
      studentsHtml +
      '<div class="groups-transfer-bottom groups-transfer-bottom--right">' +
      '<button type="button" class="groups-edit-del" id="attendanceEditCancel"' + (editSaving ? ' disabled' : '') + '>Отмена</button>' +
      '<button type="button" class="groups-edit-save" id="attendanceEditSave"' + (editSaving ? ' disabled' : '') + '>' + (editSaving ? 'Сохранение...' : 'Сохранить') + '</button>' +
      '</div>';
    modal.hidden = false;

    var cancelBtn = document.getElementById('attendanceEditCancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        editOpen = false;
        renderEditModal();
      });
    }
    var groupSelect = document.getElementById('attendanceEditGroupSelect');
    if (groupSelect) {
      groupSelect.addEventListener('change', function () {
        editGroupId = groupSelect.value;
      });
    }
    var dateInput = document.getElementById('attendanceEditDate');
    if (dateInput) {
      dateInput.addEventListener('change', function () {
        editDate = dateInput.value;
      });
    }
    var loadBtn = document.getElementById('attendanceEditLoadBtn');
    if (loadBtn) {
      loadBtn.addEventListener('click', function () {
        loadEditAttendanceData().catch(function (err) {
          editMessage = (err && err.message) || 'Не удалось загрузить посещаемость на выбранную дату.';
          editLoading = false;
          renderEditModal();
        });
      });
    }
    body.querySelectorAll('.attendance-edit-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var idx = parseInt(cb.getAttribute('data-row-index'), 10);
        if (isNaN(idx) || !editStudents[idx]) return;
        editStudents[idx].present = !!cb.checked;
      });
    });
    var saveBtn = document.getElementById('attendanceEditSave');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        if (editSaving) return;
        if (!editGroupId || !editDate) {
          editMessage = 'Выберите группу и дату.';
          renderEditModal();
          return;
        }
        if (!editStudents.length) {
          editMessage = 'Нет учеников для сохранения.';
          renderEditModal();
          return;
        }
        editSaving = true;
        editMessage = '';
        renderEditModal();
        try {
          var tasks = editStudents.map(function (s) {
            return apiRequest('POST', '/api/attendance/', {
              student_id: s.id,
              group_id: parseInt(String(editGroupId), 10),
              date_of_lesson: editDate,
              presence: s.present ? 1 : 0
            });
          });
          var results = await Promise.allSettled(tasks);
          var failed = results.filter(function (r) { return r.status === 'rejected'; });
          if (failed.length) {
            editMessage = 'Сохранено с ошибками: ' + failed.length + ' из ' + results.length + '.';
            editSaving = false;
            renderEditModal();
            return;
          }
          selectedGroupId = String(editGroupId);
          editOpen = false;
          render();
          await loadAttendanceForSelected();
          setMessage('Посещаемость сохранена.', 'ok');
        } catch (err) {
          editMessage = (err && err.message) || 'Не удалось сохранить посещаемость.';
          editSaving = false;
          renderEditModal();
        }
      });
    }
  }

  function render() {
    container.innerHTML = [
      '<div class="attendance-view">',
      '  <div class="attendance-toolbar">',
      '    <select id="attendanceGroupSelect" class="search-input attendance-group-select">',
      '      <option value="">Выберите группу</option>',
      groups.map(function (g) {
        var selectedAttr = String(selectedGroupId) === String(g.id) ? ' selected' : '';
        return '<option value="' + escapeHtmlAttr(String(g.id)) + '"' + selectedAttr + '>' + escapeHtml(String(g.name || '—')) + '</option>';
      }).join(''),
      '    </select>',
      '    <button type="button" class="groups-edit-save" id="attendanceEditBtn">Редактировать посещаемость</button>',
      canDangerActions ? '    <button type="button" class="groups-edit-del" id="attendanceClearAllBtn">Очистить посещаемость</button>' : '',
      '  </div>',
      '  <div class="students-msg" id="attendanceMsg"></div>',
      '  <div class="attendance-table-wrap" id="attendanceTableWrap"></div>',
      '  <div class="groups-modal-overlay" id="attendanceEditModal" hidden>',
      '    <div class="groups-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="attendanceEditTitle">',
      '      <div class="groups-modal-head">',
      '        <h4 class="groups-modal-title" id="attendanceEditTitle">Редактирование посещаемости</h4>',
      '        <button type="button" class="groups-modal-close" id="attendanceEditClose" aria-label="Закрыть">&times;</button>',
      '      </div>',
      '      <div class="groups-modal-body" id="attendanceEditModalBody"></div>',
      '    </div>',
      '  </div>',
      '  <div class="groups-modal-overlay" id="attendanceClearModal" hidden>',
      '    <div class="groups-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="attendanceClearTitle">',
      '      <div class="groups-modal-head">',
      '        <h4 class="groups-modal-title" id="attendanceClearTitle">Очистка посещаемости</h4>',
      '        <button type="button" class="groups-modal-close" id="attendanceClearClose" aria-label="Закрыть">&times;</button>',
      '      </div>',
      '      <div class="groups-modal-body" id="attendanceClearModalBody"></div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
    setMessage(message, '');
    renderTable();
    renderEditModal();
    renderClearConfirmModal();

    var select = document.getElementById('attendanceGroupSelect');
    if (select) {
      select.addEventListener('change', function () {
        selectedGroupId = select.value;
        loadAttendanceForSelected().catch(function (err) {
          setMessage((err && err.message) || 'Не удалось загрузить посещаемость.', 'err');
        });
      });
    }
    var editBtn = document.getElementById('attendanceEditBtn');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        editOpen = true;
        editGroupId = selectedGroupId || (groups[0] ? String(groups[0].id) : '');
        editDate = editDate || todayIsoDate();
        editMessage = '';
        renderEditModal();
        loadEditAttendanceData().catch(function (err) {
          editMessage = (err && err.message) || 'Не удалось загрузить посещаемость на выбранную дату.';
          editLoading = false;
          renderEditModal();
        });
      });
    }
    var editModal = document.getElementById('attendanceEditModal');
    var editClose = document.getElementById('attendanceEditClose');
    if (editModal) {
      editModal.addEventListener('click', function (e) {
        if (e.target === editModal) {
          editOpen = false;
          renderEditModal();
        }
      });
    }
    if (editClose) {
      editClose.addEventListener('click', function () {
        editOpen = false;
        renderEditModal();
      });
    }
    var clearBtn = document.getElementById('attendanceClearAllBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        clearConfirmOpen = true;
        renderClearConfirmModal();
      });
    }
    var clearModal = document.getElementById('attendanceClearModal');
    var clearClose = document.getElementById('attendanceClearClose');
    if (clearModal) {
      clearModal.addEventListener('click', function (e) {
        if (e.target === clearModal) {
          clearConfirmOpen = false;
          renderClearConfirmModal();
        }
      });
    }
    if (clearClose) {
      clearClose.addEventListener('click', function () {
        clearConfirmOpen = false;
        renderClearConfirmModal();
      });
    }
  }

  async function loadGroups() {
    var res = await apiRequest('GET', API.GROUPS.LIST);
    var list = unwrapResponse(res);
    groups = Array.isArray(list) ? list : [];
    groups.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'ru'); });
    if (!groups.length) {
      selectedGroupId = '';
      return;
    }
    var hasSelected = groups.some(function (g) { return String(g.id) === String(selectedGroupId); });
    if (!hasSelected) selectedGroupId = String(groups[0].id);
  }

  async function loadAttendanceForSelected() {
    if (!selectedGroupId) {
      attendance = [];
      renderTable();
      return;
    }
    loading = true;
    renderTable();
    try {
      var res = await apiRequest('GET', API.ATTENDANCE.BY_GROUP(selectedGroupId));
      var rows = unwrapResponse(res);
      attendance = Array.isArray(rows) ? rows : [];
      setMessage('');
    } catch (err) {
      attendance = [];
      setMessage((err && err.message) || 'Не удалось загрузить посещаемость.', 'err');
    } finally {
      loading = false;
      renderTable();
    }
  }

  (async function init() {
    container.innerHTML = '<div class="attendance-view"><div class="events-loading">Загрузка групп...</div></div>';
    try {
      var user = await ipcRenderer.invoke('get-user');
      canDangerActions = hasDangerAccess(user);
      await loadGroups();
      render();
      await loadAttendanceForSelected();
    } catch (err) {
      container.innerHTML = '<p class="content-error">Не удалось загрузить посещаемость: ' + escapeHtml((err && err.message) || 'ошибка') + '</p>';
    }
  })();
};
