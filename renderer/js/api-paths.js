'use strict';

/**
 * Единая точка для путей API (релативно к baseUrl).
 */
module.exports = {
  AUTH: {
    LOGIN: '/api/auth/login',
    REFRESH: '/api/auth/refresh',
    CHANGE_PASSWORD: '/api/auth/change-password'
  },
  EMPLOYEES: {
    ALL: '/api/employees/all',
    WITH_INACTIVE: '/api/employees/with-inactive',
    LIST: '/api/employees',
    ADD: '/api/employees/add',
    BY_ID: function (id) { return '/api/employees/' + id; },
    KPI_BY_ID: function (id) { return '/api/employees/kpi/' + id; },
    SIZES: '/api/employees/sizes'
  },
  STUDENTS: {
    ROOT: '/api/students',
    BY_ID: function (id) { return '/api/students/' + id; },
    SEARCH: '/api/students/search',
    FULL_BY_GROUP: function (id) { return '/api/students/full-by-group/' + id; },
    GROUPS_BY_STUDENT: function (id) { return '/api/students/groups-by-student/' + id; },
    EXIST: '/api/students/exist',
    SEARCH_NEW: '/api/students/search-new',
    ADD_TO_GROUP: '/api/students/add-to-group',
    DELETE_FROM_GROUP: '/api/students/from-group',
    MOVE_TO_GROUP: '/api/students/update-to-group'
  },
  GROUPS: {
    LIST: '/api/groups/list',
    BY_ID: function (id) { return '/api/groups/list/' + id; },
    PIXELS_BY_GROUP: function (id) { return '/api/groups/pixels/' + id; },
    PIXELS_UPDATE: '/api/groups/pixels',
    PIXELS_CLEAR_ALL: '/api/groups/pixels/clear-all'
  },
  SCHEDULE: {
    ROOT: '/api/schedule',
    TEACHERS: '/api/schedule/teachers',
    GROUPS: '/api/schedule/groups',
    BY_TEACHER: function (id) { return '/api/schedule/by-teacher/' + id; },
    BY_GROUP: function (id) { return '/api/schedule/by-group/' + id; },
    BY_ROOM: function (id) { return '/api/schedule/by-room/' + id; }
  },
  ATTENDANCE: {
    BY_GROUP: function (id) { return '/api/attendance/by-group/' + id; },
    BY_GROUP_DATE: '/api/attendance/by-group-date',
    BY_GROUP_DATE_NEW: '/api/attendance/by-group-date-new',
    CLEAR_ALL: '/api/attendance/clear-all'
  },
  REFERENCE: {
    POSITIONS: '/api/reference/positions',
    POSITION_BY_ID: function (id) { return '/api/reference/positions/' + id; },
    ACCESS: '/api/reference/access',
    ACCESS_BY_ID: function (id) { return '/api/reference/access/' + id; },
    ROOMS: '/api/reference/rooms',
    DOCS: '/api/reference/docs',
    DOC_BY_ID: function (id) { return '/api/reference/docs/' + id; },
    LEVELS_TRY: [
      '/api/reference/levels',
      '/api/reference/type-of-part-event',
      '/api/reference/types-of-part-event',
      '/api/reference/type_of_part_event'
    ],
    TYPES_OF_HOLDING_TRY: [
      '/api/reference/types-of-holding',
      '/api/reference/form-of-holding',
      '/api/reference/forms-of-holding',
      '/api/reference/form_of_holding',
      '/api/reference/types_of_holding'
    ],
    TYPES_OF_ORGANIZATION_TRY: [
      '/api/reference/types-of-organization',
      '/api/reference/types-of-organizations',
      '/api/reference/types_of_organization',
      '/api/reference/types_of_organizations'
    ]
  },
  EVENTS: {
    ORG: '/api/events/org',
    PART: '/api/events/part',
    ORGANIZATION_LEGACY: '/api/events/organization'
  },
  RENT: {
    BY_EVENT: function (eventId) { return '/api/rent/by-event/' + eventId; },
    BY_ID: function (id) { return '/api/rent/' + id; },
    BY_DATE_ROOM: '/api/rent/by-date-room',
    ROOT: '/api/rent'
  }
};
