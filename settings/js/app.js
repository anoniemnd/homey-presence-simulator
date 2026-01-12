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
}