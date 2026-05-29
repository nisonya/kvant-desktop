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
    '<button type="button" class="global-busy-close" id="globalBusyClose" aria-label="Закрыть">×</button>' +
    '</div>';
  document.body.appendChild(overlay);
  const closeBtn = document.getElementById('globalBusyClose');
  if (closeBtn) closeBtn.addEventListener('click', resetBusy);
  return overlay;
}

function showBusy(text) {
  const overlay = ensureOverlay();
  const textEl = document.getElementById('globalBusyText');
  if (textEl) textEl.textContent = text || 'Подготовка отчета...';
  activeCount += 1;
  overlay.hidden = false;
  overlay.style.display = 'flex';
}

function hideBusy() {
  const overlay = document.getElementById('globalBusyOverlay');
  if (!overlay) return;
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount > 0) return;
  overlay.hidden = true;
  overlay.style.display = 'none';
}

function resetBusy() {
  activeCount = 0;
  const overlay = document.getElementById('globalBusyOverlay');
  if (overlay) {
    overlay.hidden = true;
    overlay.style.display = 'none';
  }
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
  hideBusy,
  resetBusy
};
