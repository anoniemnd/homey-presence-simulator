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

    // Backend returns devices with onoff capability (including groups)
    // Filter out devices that are already being tracked
    window.availableDevices = result.filter(device => {
      return !trackedIds.includes(device.id);
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
  let html = '';

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
    container.innerHTML = html + `<p style="padding: 15px; color: #999;">${__('settings.allDevicesTracked')}</p>`;
    return;
  }

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
 * ✅ AANGEPAST: met optionele import
 */
async function addSelectedDevices() {
  if (selectedDeviceIds.size === 0) {
    showStatus(__('settings.selectAtLeastOne'), 'error');
    return;
  }

  try {
    // Check of we history moeten importeren
    const shouldImport = document.getElementById('importHistoryOnAdd').checked;

    let successCount = 0;
    let importResults = [];
    let allRemovedDevices = [];
    let addedDeviceNames = [];

    for (const deviceId of selectedDeviceIds) {
      // Bewaar device naam voor success bericht
      const device = window.availableDevices.find(d => d.id === deviceId);
      if (device) {
        addedDeviceNames.push(device.name);
      }

      // Voeg device toe
      const trackResult = await Homey.api('POST', '/track', { deviceId });
      successCount++;

      // Check of er devices automatisch zijn verwijderd (groep scenario)
      if (trackResult.removedDevices && trackResult.removedDevices.length > 0) {
        allRemovedDevices.push(...trackResult.removedDevices);
      }

      // Importeer history indien gewenst
      if (shouldImport) {
        try {
          const importResult = await Homey.api('GET', `/import-device-history?deviceId=${deviceId}`);
          if (importResult.success) {
            importResults.push({
              deviceId,
              imported: importResult.imported,
              timeSpan: importResult.timeSpanDays
            });
          }
        } catch (importError) {
          console.error(`Import failed for ${deviceId}:`, importError);
        }
      }
    }

    // Toon melding over automatisch verwijderde devices (indien van toepassing)
    if (allRemovedDevices.length > 0) {
      console.log('Auto-removed devices:', allRemovedDevices);
      const removedNames = allRemovedDevices.map(d => d.name).join(', ');
      console.log('Showing info modal for removed devices:', removedNames);
      await showInfoModal(
        __('settings.autoRemovedTitle'),
        __('settings.autoRemovedMessage', { count: allRemovedDevices.length, names: removedNames })
      );
      console.log('Info modal closed');
    }

    // Bouw success bericht
    let successMessage = __('settings.devicesAddedSuccess', { count: successCount });
    if (addedDeviceNames.length > 0) {
      successMessage += '\n\n' + addedDeviceNames.join('\n');
    }

    if (importResults.length > 0) {
      const totalImported = importResults.reduce((sum, r) => sum + r.imported, 0);
      successMessage += '\n\n' + __('settings.importedEventsCount', { count: totalImported });
    }

    successMessage += '\n\n' + __('settings.checkTrackedDevices');

    // Toon success modal
    await showInfoModal(
      __('settings.devicesAddedTitle'),
      successMessage
    );

    selectedDeviceIds.clear();
    await loadDevices();
    await loadTrackedDevices();
    
  } catch (error) {
    showStatus(__('settings.failedToAdd') + ': ' + error.message, 'error');
  }
}