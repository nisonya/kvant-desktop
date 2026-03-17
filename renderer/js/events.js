const api = window.api || {};
const ENDPOINTS = { org: '/api/events/org', part: '/api/events/part' };

function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function formatDate(str) {
  if (!str) return '—';
  const d = String(str);
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
    const [y, m, day] = d.split(/[-T]/);
    return `${day}.${m}.${y}`;
  }
  return d;
}

async function fetchEventList(type, { filters = {}, sort = [], page = 1, limit = 20 }) {
  const base = ENDPOINTS[type];
  const res = await api.post(`${base}/list`, { filters, sort, page, limit });
  if (!res || res.success === false) {
    throw new Error(res?.error || 'Ошибка загрузки списка');
  }
  const items = res.data ?? [];
  return {
    items: Array.isArray(items) ? items : [],
    page: res.page ?? page,
    limit: res.limit ?? limit,
    total: res.total
  };
}

async function fetchEventCount(type, filters = {}) {
  const base = ENDPOINTS[type];
  const res = await api.post(`${base}/count`, { filters });
  if (!res.success) throw new Error(res.error);
  return res.total ?? 0;
}

async function fetchResponsible(type, eventId) {
  try {
    const base = ENDPOINTS[type];
    const res = await api.get(`${base}/responsible/${eventId}`);
    const data = res.data ?? res;
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

async function fetchEmployeesShort() {
  try {
    const res = await api.get('/api/employees/short-list');
    const data = res.data ?? res;
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function renderEventCard(item, type, responsible = []) {
  const dateLabel = type === 'part' ? 'регистрация до:' : 'дата проведения:';
  const dateValue = type === 'part'
    ? (item.registration_deadline || item.dates_of_event)
    : item.dates_of_event;

  const metaParts = [];
  if (type === 'part' && item.form_of_holding) metaParts.push(item.form_of_holding);
  if (type === 'org' && item.day_of_the_week) metaParts.push(item.day_of_the_week);
  const metaHtml = metaParts.length ? `<p class="event-card-meta">${escapeHtml(metaParts.join(' • '))}</p>` : '';

  const personIcon = '<svg class="event-card-responsible-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  const responsibleHtml = responsible.length
    ? responsible.map(r => {
        const name = [r.first_name, r.second_name].filter(Boolean).join(' ') || '—';
        return `<span class="event-card-responsible">${personIcon}${escapeHtml(name)}</span>`;
      }).join('')
    : '';

  return `
    <div class="event-card" data-id="${item.id}">
      <h3 class="event-card-title">${escapeHtml(item.name || '—')}</h3>
      ${type === 'part' && item.form_of_holding ? `<p class="event-card-type">${escapeHtml(item.form_of_holding)}</p>` : ''}
      ${type === 'org' && item.day_of_the_week ? `<p class="event-card-day">${escapeHtml(item.day_of_the_week)}</p>` : ''}
      <p class="event-card-date"><span class="event-card-date-label">${dateLabel}</span> ${formatDate(dateValue)}</p>
      <div class="event-card-responsibles">${responsibleHtml}</div>
    </div>
  `;
}

async function loadEvents(type, { search = '', employeeId = null, sortField = 'dates_of_event', sortOrder = 'asc', page = 1 }) {
  const filters = {};
  if (search) filters.search = search;
  if (employeeId) filters.employee_id = employeeId;
  filters.period = new Date().getFullYear().toString();

  const sort = [{ field: sortField, order: sortOrder }];
  if (type === 'part') sort[0].field = sortField === 'dates_of_event' ? 'registration_deadline' : sortField;

  const { items, total } = await fetchEventList(type, { filters, sort, page, limit: 20 });

  const withResponsible = await Promise.all(items.map(async (item) => {
    const resp = await fetchResponsible(type, item.id);
    return { item, responsible: resp };
  }));

  return { items: withResponsible, total };
}

window.Events = {
  loadEvents,
  fetchEmployeesShort,
  renderEventCard,
  escapeHtml,
  formatDate
};
