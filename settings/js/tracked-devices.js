/**
 * TRACKED DEVICES FUNCTIONS
 * Handles the list of tracked devices with expandable cards and timeline
 */

let expandedDevices = new Set();

/**
 * Load and display tracked devices
 */
async function loadTrackedDevices() {
  try {
    const deviceIds = await Homey.get('trackedDevices');
    if (!deviceIds || deviceIds.length === 0) {
      document.getElementById('trackedDevices').innerHTML =
        `<p class="text-muted">${__('settings.noDevicesTracked')}</p>`;
      return;
    }

    const allDevices = await Homey.api('GET', '/devices');
    const eventsData = await Homey.api('GET', '/events');
    const container = document.getElementById('trackedDevices');
    container.innerHTML = '';

    for (const deviceId of deviceIds) {
      const device = allDevices.find(d => d.id === deviceId);
      if (!device) continue;

      const deviceEvents = eventsData.events.filter(e => e.deviceId === deviceId);
      const eventCount = deviceEvents.length;
      const lastEvent = deviceEvents.length > 0 ? deviceEvents[0] : null;
      const lastEventTime = lastEvent ? formatRelativeTime(lastEvent.timestamp) : __('settings.never');

      const cardHtml = renderDeviceCard(device, deviceId, eventCount, lastEventTime, deviceEvents);
      container.insertAdjacentHTML('beforeend', cardHtml);
    }

  } catch (error) {
    console.error('Error loading tracked devices:', error);
  }
}

/**
 * Render device card with header and expandable details
 */
function renderDeviceCard(device, deviceId, eventCount, lastEventTime, events) {
  const isExpanded = expandedDevices.has(deviceId);

  return `
    <div class="device-card ${isExpanded ? 'expanded' : ''}" id="card-${deviceId}">
      <div class="device-header" onclick="toggleDeviceCard('${deviceId}', event)">
        <div class="device-info-left">
          <div class="device-name">${escapeHtml(device.name)}</div>
          <div class="device-stats">${eventCount} ${__('settings.events')} • ${__('settings.last')}: ${lastEventTime}</div>
        </div>
        <div class="device-actions">
          <button class="icon-btn menu-btn" onclick="toggleDeviceMenu(event, '${deviceId}')">⋮</button>
          <div id="menu-${deviceId}" class="dropdown-menu">
          ${DEBUG
      ? `
            <div class="dropdown-item" onclick="generateTestDataForDevice('${deviceId}', '${escapeHtml(device.name)}')">
              ${__('settings.generateTestData')}
            </div>
                `
      : ''
    }
            <div class="dropdown-item" onclick="viewDeviceEvents('${deviceId}', '${escapeHtml(device.name)}')">
              ${__('settings.viewAllEventsMenu')}
            </div>
            <div class="dropdown-item" onclick="clearDeviceHistory('${deviceId}', '${escapeHtml(device.name)}')">
              ${__('settings.clearHistory')}
            </div>
            <div class="dropdown-item danger" onclick="removeDeviceById('${deviceId}')">
              ${__('settings.removeDevice')}
            </div>
          </div>
        </div>
      </div>
      <div class="device-details ${isExpanded ? 'show' : ''}" id="details-${deviceId}">
        ${renderDeviceTimeline(events)}
        ${renderRecentEvents(events)}
      </div>
    </div>
  `;
}

/**
 * Render timeline visualization
 */
function renderDeviceTimeline(events) {
  if (events.length === 0) {
    return `<div class="no-events-message">${__('settings.noEventsRecorded')}</div>`;
  }

  // Group events by day of week
  const eventsByDay = {};
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  events.forEach(event => {
    const dayKey = days[event.dayOfWeek];
    if (!eventsByDay[dayKey]) eventsByDay[dayKey] = [];
    eventsByDay[dayKey].push(event);
  });

  let html = `<div class="events-section"><h3 class="events-subtitle">${__('settings.weeklyPattern')}</h3>`;

  // Render timeline for each day
  days.forEach(dayKey => {
    const dayEvents = eventsByDay[dayKey] || [];
    const dayLabel = __('settings.' + dayKey);

    html += `<div class="timeline-day">
      <div class="timeline-label">${dayLabel}</div>
      <div class="timeline-bar">`;

    // Add event dots
    dayEvents.forEach(event => {
      const position = (event.timeMinutes / 1440) * 100; // 1440 = minutes in a day
      const eventClass = event.value ? 'on' : 'off';
      const time = formatTime(event.hourOfDay, event.minuteOfHour);
      const status = event.value ? __('settings.statusOn') : __('settings.statusOff');
      html += `<div class="timeline-event ${eventClass}" 
                    style="left: ${position}%"
                    title="${time} - ${status}"></div>`;
    });

    html += `</div></div>`;
  });

  // Add time labels
  html += `
    <div class="timeline-times">
      <span>00:00</span>
      <span>06:00</span>
      <span>12:00</span>
      <span>18:00</span>
      <span>24:00</span>
    </div>
  `;
  html += '</div>';

  return html;
}

/**
 * Render recent events list
 */
function renderRecentEvents(events) {
  if (events.length === 0) return '';

  // Take last 10 events (already sorted newest first from API)
  const recentEvents = events.slice(0, 10);

  let html = `<div class="events-section"><h3 class="events-subtitle">${__('settings.recentEvents')}</h3>`;

  recentEvents.forEach(event => {
    const date = new Date(event.timestamp);
    const timeStr = formatDateTime(date);
    const iconClass = event.value ? 'on' : 'off';
    const statusText = event.value ? __('settings.statusOn') : __('settings.statusOff');

    html += `
      <div class="event-item">
        <div class="event-icon ${iconClass}">${event.value ? '●' : '○'}</div>
        <div class="event-text">${statusText}</div>
        <div class="event-time">${timeStr}</div>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

/**
 * Toggle device card expanded/collapsed
 */
function toggleDeviceCard(deviceId, event) {
  // Don't toggle if clicking on menu button
  if (event && event.target.closest('.menu-btn')) {
    return;
  }

  const card = document.getElementById('card-' + deviceId);
  const details = document.getElementById('details-' + deviceId);

  if (expandedDevices.has(deviceId)) {
    expandedDevices.delete(deviceId);
    card.classList.remove('expanded');
    details.classList.remove('show');
  } else {
    expandedDevices.add(deviceId);
    card.classList.add('expanded');
    details.classList.add('show');
  }
}

/**
 * Toggle device menu dropdown
 */
function toggleDeviceMenu(event, deviceId) {
  event.stopPropagation();

  const menu = document.getElementById('menu-' + deviceId);
  const isVisible = menu.classList.contains('show');

  // Close all other menus
  document.querySelectorAll('.dropdown-menu').forEach(m => {
    m.classList.remove('show');
  });

  // Toggle this menu
  if (!isVisible) {
    menu.classList.add('show');
  }
}

// Close menus when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-btn')) {
    document.querySelectorAll('.dropdown-menu').forEach(m => {
      m.classList.remove('show');
    });
  }
});

/**
 * View all events for a device in modal
 */
async function viewDeviceEvents(deviceId, deviceName) {
  try {
    const eventsData = await Homey.api('GET', '/events');
    const deviceEvents = eventsData.events.filter(e => e.deviceId === deviceId);

    let html = `<p style="color: #666; margin-bottom: 15px;">${__('settings.showingAllEvents', { count: deviceEvents.length, name: deviceName })}</p>`;

    if (deviceEvents.length === 0) {
      html += `<p class="text-muted">${__('settings.noEventsRecorded')}</p>`;
    } else {
      html += '<table class="events-table">';
      html += `
        <thead>
          <tr>
            <th>${__('settings.time')}</th>
            <th>${__('settings.status')}</th>
            <th>${__('settings.day')}</th>
          </tr>
        </thead>
        <tbody>
      `;

      deviceEvents.forEach(event => {
        const date = new Date(event.timestamp);
        const timeStr = formatDateTime(date);
        const statusColor = event.value ? '#4CAF50' : '#f44336';
        const statusText = event.value ? '🟢 ' + __('settings.statusOn') : '🔴 ' + __('settings.statusOff');
        const dayName = getDayAbbr(event.dayOfWeek);

        html += `
          <tr>
            <td>${timeStr}</td>
            <td style="color: ${statusColor}; font-weight: bold;">${statusText}</td>
            <td>${dayName}</td>
          </tr>
        `;
      });

      html += '</tbody></table>';
    }

    document.getElementById('eventsModalTitle').textContent = `${__('settings.allEventsTitle')}: ${deviceName}`;
    document.getElementById('eventsModalContent').innerHTML = html;
    document.getElementById('eventsModal').classList.add('active');
  } catch (error) {
    showStatus(__('settings.failedToLoadEvents') + ': ' + error.message, 'error');
  }
}

/**
 * Close events modal
 */
function closeEventsModal() {
  document.getElementById('eventsModal').classList.remove('active');
}

/**
 * Clear history for a specific device
 */
async function clearDeviceHistory(deviceId, deviceName) {
  const confirmed = await showConfirmModal(
    __('settings.clearHistoryTitle'),
    __('settings.clearHistoryMessage', { name: deviceName })
  );

  if (!confirmed) return;

  try {
    // Get current history
    const history = await Homey.get('deviceHistory');

    // Remove this device's history
    if (history && history[deviceId]) {
      delete history[deviceId];
      await Homey.set('deviceHistory', history);
    }

    showStatus(__('settings.historyCleared', { name: deviceName }), 'success');
    await loadTrackedDevices();
  } catch (error) {
    showStatus(__('settings.failedToClear') + ': ' + error.message, 'error');
  }
}

/**
 * Remove device from tracking
 */
async function removeDeviceById(deviceId) {
  try {
    const allDevices = await Homey.api('GET', '/devices');
    const device = allDevices.find(d => d.id === deviceId);
    const deviceName = device ? device.name : deviceId;

    const confirmed = await showConfirmModal(
      __('settings.removeDeviceTitle'),
      __('settings.removeDeviceMessage', { name: deviceName })
    );

    if (!confirmed) return;

    await Homey.api('POST', '/untrack', { deviceId });
    showStatus(__('settings.deviceRemoved'), 'success');

    // Reload both lists
    await loadDevices();
    await loadTrackedDevices();
  } catch (error) {
    showStatus(__('settings.failedToRemove') + ': ' + error.message, 'error');
  }
}

/**
 * Generate test data for a single device
 */
async function generateTestDataForDevice(deviceId, deviceName) {
  const confirmed = await showConfirmModal(
    __('settings.generateTestDataTitle'),
    __('settings.generateTestDataSingleMessage', { name: deviceName })
  );

  if (!confirmed) return;

  try {
    const result = await Homey.api('POST', '/generate-test-data', { deviceId });

    showStatus(__('settings.testDataGeneratedSingle', { events: result.eventsGenerated, name: deviceName }), 'success');

    await loadTrackedDevices();
  } catch (error) {
    showStatus(__('settings.failedToGenerate') + ': ' + error.message, 'error');
  }
}