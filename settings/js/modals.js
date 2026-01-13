/**
 * MODAL FUNCTIONS
 * Handles confirmation modals and other dialogs
 */

// Modal state (global)
if (typeof modalResolve === 'undefined') {
  var modalResolve = null;
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
    
    // Update button text
    const buttons = document.querySelectorAll('#confirmModal button');
    if (buttons[0]) buttons[0].textContent = __('settings.cancel');
    if (buttons[1]) buttons[1].textContent = __('settings.confirm');
    
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