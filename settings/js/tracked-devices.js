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
        '<p class="text-muted">No devices tracked yet</p>';
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
      const lastEventTime = lastEvent ? formatRelativeTime(lastEvent.timestamp) : 'never';

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
          <div class="device-stats">${eventCount} events • Last: ${lastEventTime}</div>
        </div>
        <div class="device-actions">
          <button class="icon-btn menu-btn" onclick="toggleDeviceMenu(event, '${deviceId}')">⋮</button>
          <div id="menu-${deviceId}" class="dropdown-menu">
            <div class="dropdown-item" onclick="generateTestDataForDevice('${deviceId}', '${escapeHtml(device.name)}')">
              🧪 Generate Test Data
            </div>
            <div class="dropdown-item" onclick="viewDeviceEvents('${deviceId}', '${escapeHtml(device.name)}')">
              📊 View All Events
            </div>
            <div class="dropdown-item" onclick="clearDeviceHistory('${deviceId}', '${escapeHtml(device.name)}')">
              🗑️ Clear History
            </div>
            <div class="dropdown-item danger" onclick="removeDeviceById('${deviceId}')">
              ❌ Remove Device
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
    return '<div class="no-events-message">No events recorded yet</div>';
  }

  // Group events by day of week
  const eventsByDay = {};
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  events.forEach(event => {
    const day = days[event.dayOfWeek];
    if (!eventsByDay[day]) eventsByDay[day] = [];
    eventsByDay[day].push(event);
  });

  let html = '<div class="timeline-section"><h3>📊 Weekly Pattern</h3>';
  
  // Render timeline for each day
  days.forEach(day => {
    const dayEvents = eventsByDay[day] || [];
    html += `<div class="timeline-day">
      <div class="timeline-label">${day}</div>
      <div class="timeline-bar">`;
    
    // Add event dots
    dayEvents.forEach(event => {
      const position = (event.timeMinutes / 1440) * 100; // 1440 = minutes in a day
      const eventClass = event.value ? 'on' : 'off';
      const time = formatTime(event.hourOfDay, event.minuteOfHour);
      const status = event.value ? 'ON' : 'OFF';
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

  let html = '<div class="event-list"><h3>📋 Recent Events</h3>';
  
  recentEvents.forEach(event => {
    const date = new Date(event.timestamp);
    const timeStr = formatDateTime(date);
    const iconClass = event.value ? 'on' : 'off';
    const statusText = event.value ? 'ON' : 'OFF';
    
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
    
    let html = `<p style="color: #666; margin-bottom: 15px;">Showing all ${deviceEvents.length} events for ${deviceName}</p>`;
    
    if (deviceEvents.length === 0) {
      html += '<p class="text-muted">No events recorded yet</p>';
    } else {
      html += '<table class="events-table">';
      html += `
        <thead>
          <tr>
            <th>Time</th>
            <th>Status</th>
            <th>Day</th>
          </tr>
        </thead>
        <tbody>
      `;
      
      deviceEvents.forEach(event => {
        const date = new Date(event.timestamp);
        const timeStr = formatDateTime(date);
        const statusColor = event.value ? '#4CAF50' : '#f44336';
        const statusText = event.value ? '🟢 ON' : '🔴 OFF';
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayName = days[event.dayOfWeek];
        
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
    
    document.getElementById('eventsModalTitle').textContent = `Events: ${deviceName}`;
    document.getElementById('eventsModalContent').innerHTML = html;
    document.getElementById('eventsModal').classList.add('active');
  } catch (error) {
    showStatus('Failed to load events: ' + error.message, 'error');
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
    'Clear History',
    `Delete all recorded events for "${deviceName}"?\n\nThis cannot be undone, but tracking will continue.`
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

    showStatus('History cleared for ' + deviceName, 'success');
    await loadTrackedDevices();
  } catch (error) {
    showStatus('Failed to clear history: ' + error.message, 'error');
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
      'Remove Device',
      `Remove "${deviceName}" from tracking?\n\nHistory will be preserved unless you clear it separately.`
    );

    if (!confirmed) return;

    await Homey.api('POST', '/untrack', { deviceId });
    showStatus('Device removed', 'success');
    
    // Reload both lists
    await loadDevices();
    await loadTrackedDevices();
  } catch (error) {
    showStatus('Failed to remove device: ' + error.message, 'error');
  }
}

/**
 * Generate test data for a single device
 */
async function generateTestDataForDevice(deviceId, deviceName) {
  const confirmed = await showConfirmModal(
    'Generate Test Data',
    `Generate realistic test data for "${deviceName}"?\n\nThis will create on/off events for the past 7 days.`
  );

  if (!confirmed) return;

  try {
    const result = await Homey.api('POST', '/generate-test-data', { deviceId });
    
    showStatus(
      `✓ Generated ${result.eventsGenerated} events for ${deviceName}`, 
      'success'
    );
    
    await loadTrackedDevices();
  } catch (error) {
    showStatus('Failed to generate test data: ' + error.message, 'error');
  }
}