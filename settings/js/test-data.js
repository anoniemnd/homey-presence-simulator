/**
 * TEST DATA FUNCTIONS
 * Handles generation of test data for devices
 */

/**
 * Generate test data for selected devices
 */
async function generateTestDataForSelected() {
  if (selectedDeviceIds.size === 0) {
    showStatus('Please select at least one device', 'error');
    return;
  }

  const confirmed = await showConfirmModal(
    'Generate Test Data',
    `Generate realistic test data for ${selectedDeviceIds.size} device(s)?\n\nThis will create on/off events for the past 7 days.`
  );

  if (!confirmed) return;

  try {
    let totalEvents = 0;
    
    for (const deviceId of selectedDeviceIds) {
      const result = await Homey.api('POST', '/generate-test-data', { deviceId });
      totalEvents += result.eventsGenerated;
    }

    showStatus(
      `✓ Generated ${totalEvents} events for ${selectedDeviceIds.size} device(s)`, 
      'success'
    );
    
    await loadTrackedDevices();
  } catch (error) {
    showStatus('Failed to generate test data: ' + error.message, 'error');
  }
}