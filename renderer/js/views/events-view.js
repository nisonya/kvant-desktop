function createEventsView(type) {
  const { loadEvents, fetchEmployeesShort, renderEventCard } = window.Events || {};
  if (!loadEvents || !renderEventCard) {
    const container = document.getElementById('contentBody');
    if (container) container.innerHTML = '<p class="events-error">Модуль мероприятий не загружен</p>';
    return;
  }
  const container = document.getElementById('contentBody');
  if (!container) return;

  const typeLabel = type === 'org' ? 'Организация' : 'Участие';

  container.innerHTML = `
    <div class="events-view">
      <div class="events-toolbar">
        <input type="text" class="events-search" placeholder="Поиск..." id="eventsSearch">
        <select class="events-sort-time" id="eventsSortTime" title="Сортировка по времени">
          <option value="asc">По времени: сначала раньше</option>
          <option value="desc">По времени: сначала позже</option>
        </select>
        <select class="events-sort-employee" id="eventsSortEmployee" title="Фильтр по сотруднику">
          <option value="">Все сотрудники</option>
        </select>
      </div>
      <div class="events-list" id="eventsList">
        <div class="events-loading" id="eventsLoading">Загрузка...</div>
      </div>
      <div class="events-empty" id="eventsEmpty" style="display:none">Нет мероприятий</div>
      <div class="events-error" id="eventsError" style="display:none">
        <span class="events-error-text"></span>
        <button type="button" class="events-error-retry" id="eventsErrorRetry">Повторить</button>
      </div>
    </div>
  `;

  const listEl = document.getElementById('eventsList');
  const loadingEl = document.getElementById('eventsLoading');
  const emptyEl = document.getElementById('eventsEmpty');
  const errorEl = document.getElementById('eventsError');
  const errorTextEl = errorEl ? errorEl.querySelector('.events-error-text') : null;
  const errorRetryBtn = document.getElementById('eventsErrorRetry');
  const searchInput = document.getElementById('eventsSearch');
  const sortTimeSelect = document.getElementById('eventsSortTime');
  const sortEmployeeSelect = document.getElementById('eventsSortEmployee');

  let searchTimeout = null;
  const SORT_FIELD = type === 'part' ? 'registration_deadline' : 'dates_of_event';

  function showState(state, message = '') {
    loadingEl.style.display = state === 'loading' ? 'block' : 'none';
    emptyEl.style.display = state === 'empty' ? 'block' : 'none';
    errorEl.style.display = state === 'error' ? 'block' : 'none';
    listEl.style.display = state === 'list' ? 'flex' : 'none';
    if (state === 'error' && errorTextEl) errorTextEl.textContent = message;
  }

  async function load() {
    showState('loading');
    try {
      const search = searchInput.value.trim();
      const employeeId = sortEmployeeSelect.value ? parseInt(sortEmployeeSelect.value, 10) : null;
      const sortOrder = sortTimeSelect.value || 'asc';

      const { items, total } = await loadEvents(type, {
        search,
        employeeId,
        sortField: SORT_FIELD,
        sortOrder,
        page: 1
      });

      if (!items || items.length === 0) {
        showState('empty');
        return;
      }

      listEl.innerHTML = items.map(({ item, responsible }) =>
        renderEventCard(item, type, responsible)
      ).join('');
      listEl.className = 'events-list events-cards';
      showState('list');
    } catch (err) {
      const msg = (err && err.message) ? String(err.message) : 'Ошибка загрузки';
      showState('error', msg);
      console.error('[events]', err);
    }
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function initEmployees() {
    try {
      const employees = await fetchEmployeesShort();
      sortEmployeeSelect.innerHTML = '<option value="">Все сотрудники</option>' +
        employees.map(e => `<option value="${e.id}">${escapeHtml(e.name || '—')}</option>`).join('');
    } catch (_) {
      sortEmployeeSelect.innerHTML = '<option value="">Все сотрудники</option>';
    }
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(load, 300);
  });

  sortTimeSelect.addEventListener('change', load);
  sortEmployeeSelect.addEventListener('change', load);
  if (errorRetryBtn) errorRetryBtn.addEventListener('click', load);

  initEmployees().then(() => load()).catch((err) => {
    showState('error', (err && err.message) ? String(err.message) : 'Ошибка инициализации');
    console.error('[events] init', err);
  });
}

window.createEventsView = createEventsView;
