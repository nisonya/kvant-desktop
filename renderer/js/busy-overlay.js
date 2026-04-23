'use strict';

let activeCount = 0;

function ensureOverlay() {
  let overlay = document.getElementById('globalBusyOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'globalBusyOverlay';
  overlay.className = 'global-busy-overlay';
  overlay.hidden = true;
  overlay.innerHTML =
    '<div class="global-busy-box" role="status" aria-live="polite">' +
    '<div class="global-busy-spinner" aria-hidden="true"></div>' +
    '<div class="global-busy-text" id="globalBusyText">Подготовка отчета...</div>' +
    '</div>';
  document.body.appendChild(overlay);
  return overlay;
}

function showBusy(text) {
  const overlay = ensureOverlay();
  const textEl = document.getElementById('globalBusyText');
  if (textEl) textEl.textContent = text || 'Подготовка отчета...';
  activeCount += 1;
  overlay.hidden = false;
}

function hideBusy() {
  const overlay = document.getElementById('globalBusyOverlay');
  if (!overlay) return;
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount > 0) return;
  overlay.hidden = true;
}

async function runWithBusy(text, fn) {
  showBusy(text);
  try {
    return await fn();
  } finally {
    hideBusy();
  }
}

module.exports = {
  runWithBusy,
  showBusy,
  hideBusy
};
