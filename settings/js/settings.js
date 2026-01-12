/**
 * SETTINGS FUNCTIONS
 * Handles vacation mode toggle and app settings
 */

/**
 * Load settings from Homey
 */
async function loadSettings() {
  try {
    const vacationMode = await Homey.get('vacationModeActive');
    document.getElementById('vacationMode').checked = vacationMode || false;
    updateVacationStatus(vacationMode || false);
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

/**
 * Toggle vacation mode on/off
 */
async function toggleVacationMode() {
  try {
    const checkbox = document.getElementById('vacationMode');
    const newState = checkbox.checked;

    await Homey.set('vacationModeActive', newState);
    await Homey.api('POST', '/reload-settings');

    updateVacationStatus(newState);
    showStatus(`Simulator ${newState ? 'enabled' : 'disabled'}`, 'success');
  } catch (error) {
    // Revert checkbox on error
    checkbox.checked = !checkbox.checked;
    showStatus('Failed to toggle simulator: ' + error.message, 'error');
  }
}

/**
 * Update vacation status display
 * @param {boolean} isActive - Whether vacation mode is active
 */
function updateVacationStatus(isActive) {
  const statusElement = document.getElementById('vacationStatus');
  statusElement.textContent = isActive ? 'ON' : 'OFF';
  statusElement.style.color = isActive ? '#4CAF50' : '#f44336';
}