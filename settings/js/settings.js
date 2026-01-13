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
    showStatus(__('settings.' + (newState ? 'simulatorEnabled' : 'simulatorDisabled')), 'success');
  } catch (error) {
    // Revert checkbox on error
    checkbox.checked = !checkbox.checked;
    showStatus(__('settings.failedToToggle') + ': ' + error.message, 'error');
  }
}

/**
 * Update vacation status display
 * @param {boolean} isActive - Whether vacation mode is active
 */
function updateVacationStatus(isActive) {
  const statusElement = document.getElementById('vacationStatus');
  statusElement.textContent = __('settings.' + (isActive ? 'statusOn' : 'statusOff'));
  statusElement.style.color = isActive ? '#4CAF50' : '#f44336';
  
  // Update label text to ensure translation is applied
  const statusTextSpan = document.querySelector('.status-text');
  if (statusTextSpan) {
    statusTextSpan.innerHTML = `${__('settings.simulatorIs')} <span id="vacationStatus">${__('settings.' + (isActive ? 'statusOn' : 'statusOff'))}</span>`;
    // Reapply color after innerHTML update
    document.getElementById('vacationStatus').style.color = isActive ? '#4CAF50' : '#f44336';
  }
}