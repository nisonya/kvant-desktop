'use strict';

const exitCtx = require('./event-detail-exit.js');
const { closeResponsibleModal } = require('./event-responsible-modal.js');

var unsavedModalActions = { saveExit: null, discardExit: null, cancel: null };

function closeUnsavedModal() {
  var modal = document.getElementById('eventUnsavedModal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
}

function openUnsavedModal() {
  var modal = document.getElementById('eventUnsavedModal');
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
}

function setupEventUnsavedModal() {
  var modal = document.getElementById('eventUnsavedModal');
  if (!modal) return;
  var saveBtn = document.getElementById('eventUnsavedSaveExit');
  var discardBtn = document.getElementById('eventUnsavedDiscardExit');
  var closeBtn = document.getElementById('eventUnsavedClose');
  if (saveBtn) saveBtn.addEventListener('click', async function () {
    if (unsavedModalActions.saveExit) await unsavedModalActions.saveExit();
  });
  if (discardBtn) discardBtn.addEventListener('click', function () {
    if (unsavedModalActions.discardExit) unsavedModalActions.discardExit();
  });
  if (closeBtn) closeBtn.addEventListener('click', function () {
    if (unsavedModalActions.cancel) unsavedModalActions.cancel();
  });
  modal.addEventListener('click', function (e) {
    if (e.target === modal && unsavedModalActions.cancel) unsavedModalActions.cancel();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var unsaved = document.getElementById('eventUnsavedModal');
    if (unsaved && !unsaved.hidden) {
      e.preventDefault();
      if (unsavedModalActions.cancel) unsavedModalActions.cancel();
      return;
    }
    var respModal = document.getElementById('eventRespModal');
    if (respModal && !respModal.hidden) {
      e.preventDefault();
      closeResponsibleModal();
      return;
    }
    var dp = document.getElementById('eventsDetailPanel');
    if (dp && dp.style.display !== 'none' && dp.getAttribute('aria-hidden') !== 'true' && exitCtx.get()) {
      e.preventDefault();
      exitCtx.get()();
    }
  });
}

module.exports = {
  unsavedModalActions,
  closeUnsavedModal,
  openUnsavedModal,
  setupEventUnsavedModal
};
