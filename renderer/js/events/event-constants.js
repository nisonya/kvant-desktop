'use strict';

const API = require('../api-paths.js');
const EVENT_BASE = { org: API.EVENTS.ORG, part: API.EVENTS.PART };

const EVENT_DB_TEXT_MAX_CHARS = 16383;

const EVENT_SCHEMA_STRING_MAX = {
  org: {
    name: 110,
    form_of_holding: 60,
    day_of_the_week: 23,
    result: 110,
    annotation: EVENT_DB_TEXT_MAX_CHARS,
    link: EVENT_DB_TEXT_MAX_CHARS
  },
  part: {
    name: 110,
    participants_and_works: 210,
    result: 180,
    dates_of_event: 110,
    annotation: EVENT_DB_TEXT_MAX_CHARS,
    link: EVENT_DB_TEXT_MAX_CHARS
  }
};

/** responsible_for_part_events.result_of_responsible varchar(250) */
const RESP_PART_RESULT_MAX_LEN = 250;

const FIELD_LABELS = {
  id: 'ID',
  id_events: 'ID мероприятия',
  id_event: 'ID мероприятия',
  name: 'Название',
  form_of_holding: 'Форма проведения',
  dates_of_event: 'Даты проведения',
  day_of_the_week: 'День недели',
  amount_of_applications: 'Количество заявок',
  amount_of_planning_application: 'Планируемое количество заявок',
  annotation: 'Аннотация',
  result: 'Результат',
  type: 'Тип',
  types_of_organization: 'Тип',
  link: 'Ссылка',
  id_type: 'Уровень',
  registration_deadline: 'Регистрация до',
  participants_and_works: 'Участники и работы',
  participants_amount: 'Количество участников',
  winner_amount: 'Победители',
  runner_up_amount: 'Призёры'
};

module.exports = {
  EVENT_BASE,
  EVENT_DB_TEXT_MAX_CHARS,
  EVENT_SCHEMA_STRING_MAX,
  RESP_PART_RESULT_MAX_LEN,
  FIELD_LABELS
};
