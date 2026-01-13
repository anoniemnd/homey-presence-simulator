/**
 * TEST DATA FUNCTIONS
 * Handles generation of test data for devices
 */

/**
 * Generate test data for selected devices
 */
async function generateTestDataForSelected() {
  if (selectedDeviceIds.size === 0) {
    showStatus(__('settings.selectAtLeastOne'), 'error');
    return;
  }

  const confirmed = await showConfirmModal(
    __('settings.generateTestDataTitle'),
    __('settings.generateTestDataMessage', { count: selectedDeviceIds.size })
  );

  if (!confirmed) return;

  try {
    let totalEvents = 0;
    
    for (const deviceId of selectedDeviceIds) {
      const result = await Homey.api('POST', '/generate-test-data', { deviceId });
      totalEvents += result.eventsGenerated;
    }

    showStatus(__('settings.testDataGenerated', { events: totalEvents, count: selectedDeviceIds.size }), 'success');
    
    await loadTrackedDevices();
  } catch (error) {
    showStatus(__('settings.failedToGenerate') + ': ' + error.message, 'error');
  }
}