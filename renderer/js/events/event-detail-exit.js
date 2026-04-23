'use strict';

var eventDetailExitHandler = null;

module.exports = {
  get: function () {
    return eventDetailExitHandler;
  },
  set: function (fn) {
    eventDetailExitHandler = fn;
  },
  clear: function () {
    eventDetailExitHandler = null;
  }
};
