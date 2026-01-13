/**
 * MODAL FUNCTIONS
 * Handles confirmation modals and other dialogs
 */

// Modal state (global)
if (typeof modalResolve === 'undefined') {
  var modalResolve = null;
}

/**
 * Show info modal (single OK button)
 * @param {string} title - Modal title
 * @param {string} message - Modal message
 * @returns {Promise<void>}
 */
function showInfoModal(title, message) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;

    // Hide cancel button, show only confirm button
    const buttons = document.querySelectorAll('#confirmModal button');
    if (buttons[0]) buttons[0].style.display = 'none'; // Cancel button
    if (buttons[1]) {
      buttons[1].textContent = __('settings.ok');
      buttons[1].style.display = 'block';
    }

    document.getElementById('confirmModal').classList.add('active');
  });
}

/**
 * Show confirmation modal
 * @param {string} title - Modal title
 * @param {string} message - Modal message
 * @returns {Promise<boolean>} True if confirmed, false if cancelled
 */
function showConfirmModal(title, message) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;

    // Show both buttons
    const buttons = document.querySelectorAll('#confirmModal button');
    if (buttons[0]) {
      buttons[0].textContent = __('settings.cancel');
      buttons[0].style.display = 'block';
    }
    if (buttons[1]) {
      buttons[1].textContent = __('settings.confirm');
      buttons[1].style.display = 'block';
    }

    document.getElementById('confirmModal').classList.add('active');
  });
}

/**
 * Close modal and resolve promise
 * @param {boolean} confirmed - Whether user confirmed or cancelled
 */
function closeModal(confirmed) {
  document.getElementById('confirmModal').classList.remove('active');
  if (modalResolve) {
    modalResolve(confirmed);
    modalResolve = null;
  }
}