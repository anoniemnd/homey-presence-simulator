/**
 * MAIN APP
 * Application initialization and global state
 */

// ========================================
// CONFIGURATION
// ========================================
const DEBUG = true; // Set to false for production

// ========================================
// GLOBAL STATE
// ========================================
window.availableDevices = [];

/**
 * Initialize app when Homey is ready
 * @param {Object} HomeyAPI - Homey API object
 */
function onHomeyReady(HomeyAPI) {
  // Set global Homey reference
  window.Homey = HomeyAPI;
  
  // Signal that we're ready
  HomeyAPI.ready();

  // Show debug section if enabled
  if (DEBUG) {
    const debugSection = document.getElementById('debugSection');
    if (debugSection) {
      debugSection.style.display = 'block';
    }
    console.log('🐛 DEBUG MODE ENABLED');
  }

  // Load initial data
  console.log('Loading settings...');
  loadSettings();
  
  console.log('Loading devices...');
  loadDevices();
  
  console.log('Loading tracked devices...');
  loadTrackedDevices();

  console.log('✅ Presence Simulator Settings initialized');
  console.log(`Version: ${DEBUG ? 'DEVELOPMENT' : 'PRODUCTION'}`);
  console.log(`Language: ${Homey.__ ? 'Homey i18n active' : 'No i18n'}`);
}

/**
 * Helper function to translate a key
 * @param {string} key - Translation key (e.g., 'settings.pageTitle')
 * @param {object} args - Optional arguments for string interpolation
 * @returns {string} Translated string
 */
// function __(key, args) {
//   // IMPORTANT: Don't create recursion - use Homey.__ directly
//   if (!window.Homey || typeof window.Homey.__ !== 'function') {
//     console.warn('Homey i18n not available');
//     return key;
//   }
//   // Call Homey's __ function directly
//   return window.Homey.__(key, args);
// }

// Make __ globally available WITHOUT overwriting it
// if (!window.__) {
//   window.__ = __;
// }