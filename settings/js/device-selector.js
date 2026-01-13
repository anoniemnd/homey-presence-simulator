/**
 * DEVICE SELECTOR FUNCTIONS
 * Handles multi-select device list with zones
 */

let selectedDeviceIds = new Set();

/**
 * Load available devices from Homey
 */
async function loadDevices() {
  try {
    const result = await Homey.api('GET', '/devices');
    const trackedIds = await Homey.get('trackedDevices') || [];

    // Filter to only show devices with onoff capability that aren't already tracked
    window.availableDevices = result.filter(device => {
      return device.capabilitiesObj && 
             device.capabilitiesObj.onoff && 
             !trackedIds.includes(device.id);
    });

    renderDeviceSelector();
  } catch (error) {
    console.error('Load devices error:', error);
    showStatus(__('settings.failedToLoad') + ': ' + error.message, 'error');
  }
}

/**
 * Render device selector with zones and checkboxes
 */
function renderDeviceSelector() {
  const container = document.getElementById('deviceSelectorList');

  // Group devices by zone
  const devicesByZone = {};
  window.availableDevices.forEach(device => {
    const zone = device.zoneName || 'No zone';
    if (!devicesByZone[zone]) devicesByZone[zone] = [];
    devicesByZone[zone].push(device);
  });

  const zones = Object.keys(devicesByZone).sort((a, b) => 
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  if (zones.length === 0) {
    container.innerHTML = `<p style="padding: 15px; color: #999;">${__('settings.allDevicesTracked')}</p>`;
    return;
  }

  let html = '';
  zones.forEach(zoneName => {
    const devices = devicesByZone[zoneName];
    const selectedCount = devices.filter(d => selectedDeviceIds.has(d.id)).length;

    html += `
      <div class="zone-group">
        <div class="zone-header">
          <span>${escapeHtml(zoneName)}</span>
          <span class="zone-count">${selectedCount > 0 ? selectedCount + ' / ' : ''}${devices.length}</span>
        </div>
        <div class="zone-devices">
    `;

    devices.forEach(device => {
      const isChecked = selectedDeviceIds.has(device.id);
      html += `
        <div class="device-checkbox-item">
          <input type="checkbox" 
                 id="dev-${device.id}" 
                 ${isChecked ? 'checked' : ''}
                 onchange="toggleDeviceSelection('${device.id}')">
          <label for="dev-${device.id}">
            ${escapeHtml(device.name)}
          </label>
        </div>
      `;
    });

    html += '</div></div>';
  });

  container.innerHTML = html;
  updateSelectedCount();
}

/**
 * Toggle device selection
 * @param {string} deviceId - Device ID
 */
function toggleDeviceSelection(deviceId) {
  if (selectedDeviceIds.has(deviceId)) {
    selectedDeviceIds.delete(deviceId);
  } else {
    selectedDeviceIds.add(deviceId);
  }
  updateSelectedCount();
}

/**
 * Update selected device counter
 */
function updateSelectedCount() {
  const btn = document.querySelector('button[onclick="addSelectedDevices()"]');
  if (btn) {
    btn.innerHTML = `<span data-i18n="settings.addSelectedDevices">${__('settings.addSelectedDevices')}</span> (<span id="selectedCount">${selectedDeviceIds.size}</span>)`;
  } else {
    const countSpan = document.getElementById('selectedCount');
    if (countSpan) {
      countSpan.textContent = selectedDeviceIds.size;
    }
  }
}

/**
 * Add selected devices to tracking
 */
async function addSelectedDevices() {
  if (selectedDeviceIds.size === 0) {
    showStatus(__('settings.selectAtLeastOne'), 'error');
    return;
  }

  try {
    for (const deviceId of selectedDeviceIds) {
      await Homey.api('POST', '/track', { deviceId });
    }

    showStatus(__('settings.deviceAdded', { count: selectedDeviceIds.size }), 'success');
    selectedDeviceIds.clear();
    await loadDevices();
    await loadTrackedDevices();
  } catch (error) {
    showStatus(__('settings.failedToAdd') + ': ' + error.message, 'error');
  }
}