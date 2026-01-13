/**
 * UTILITY FUNCTIONS
 * General helper functions used across the app
 */

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show status message
 * @param {string} message - Message to display
 * @param {string} type - Type: 'success', 'error', 'info'
 */
function showStatus(message, type) {
  const status = document.getElementById('statusMessage');
  status.textContent = message;
  status.className = 'status ' + type;
  status.style.display = 'block';

  setTimeout(() => {
    status.style.display = 'none';
  }, 5000);
}

/**
 * Format date/time for display
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
function formatDateTime(date) {
  // Use browser locale
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format time only
 * @param {number} hours - Hours
 * @param {number} minutes - Minutes
 * @returns {string} Formatted time string
 */
function formatTime(hours, minutes) {
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Format relative time (e.g., "2 hours ago")
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Relative time string
 */
function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return __('settings.daysAgo', { count: days });
  if (hours > 0) return __('settings.hoursAgo', { count: hours });
  if (minutes > 0) return __('settings.minutesAgo', { count: minutes });
  return __('settings.justNow');
}

/**
 * Get day abbreviation
 * @param {number} dayIndex - Day index (0 = Sunday)
 * @returns {string} Translated day abbreviation
 */
function getDayAbbr(dayIndex) {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return __('settings.' + days[dayIndex]);
}