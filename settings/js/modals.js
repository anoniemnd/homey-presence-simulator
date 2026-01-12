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