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
      // Events are sorted oldest-first, so get the last element for the most recent event
      const lastEvent = deviceEvents.length > 0 ? deviceEvents[deviceEvents.length - 1] : null;
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
            <div class="dropdown-item" onclick="viewDeviceHistoryRaw('${deviceId}', '${escapeHtml(device.name)}')">
              ${__('settings.viewHistoryRaw')}
            </div>
                            `
      : ''
    }
            <div class="dropdown-item" onclick="importDeviceHistoryFromInsights('${deviceId}', '${escapeHtml(device.name)}')">
              ${__('settings.importFromInsights')}
            </div>
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
 * Group events that are close together in time
 * @param {Array} events - Array of events for a single day
 * @param {number} thresholdPercent - Percentage of day (0-100) within which to group events
 * @returns {Array} Array of groups, each with {position, events}
 */
function groupCloseEvents(events, thresholdPercent) {
  if (events.length === 0) return [];

  // Sort events by time
  const sortedEvents = [...events].sort((a, b) => a.timeMinutes - b.timeMinutes);

  const groups = [];
  const thresholdMinutes = (thresholdPercent / 100) * 1440; // 1440 minutes in a day

  let currentGroup = {
    events: [sortedEvents[0]],
    position: sortedEvents[0].timeMinutes
  };

  for (let i = 1; i < sortedEvents.length; i++) {
    const event = sortedEvents[i];
    const timeDiff = event.timeMinutes - currentGroup.position;

    if (timeDiff <= thresholdMinutes) {
      // Add to current group
      currentGroup.events.push(event);
      // Update position to middle of group
      currentGroup.position = Math.round(
        currentGroup.events.reduce((sum, e) => sum + e.timeMinutes, 0) / currentGroup.events.length
      );
    } else {
      // Start new group
      groups.push(currentGroup);
      currentGroup = {
        events: [event],
        position: event.timeMinutes
      };
    }
  }

  // Add last group
  groups.push(currentGroup);

  return groups;
}

/**
 * Render timeline visualization
 */
function renderDeviceTimeline(events) {
  if (events.length === 0) {
    return `<div class="no-events-message">${__('settings.noEventsRecorded')}</div>`;
  }

  // Filter events to only show last 7 days (not 8)
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const filteredEvents = events.filter(e => e.timestamp > sevenDaysAgo);

  // Group events by day of week
  const eventsByDay = {};
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  filteredEvents.forEach(event => {
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

    // Group events that are close together (within 5% of day = ~72 minutes)
    const groupedEvents = groupCloseEvents(dayEvents, 5);

    // Add event dots or groups
    groupedEvents.forEach(group => {
      const position = (group.position / 1440) * 100; // 1440 = minutes in a day

      if (group.events.length === 1) {
        // Single event - show as normal dot
        const event = group.events[0];
        const eventClass = event.value ? 'on' : 'off';
        const time = formatTime(event.hourOfDay, event.minuteOfHour);
        const status = event.value ? __('settings.statusOn') : __('settings.statusOff');
        html += `<div class="timeline-event ${eventClass}"
                      style="left: ${position}%"
                      title="${time} - ${status}"></div>`;
      } else {
        // Multiple events - show as grouped badge
        const tooltipData = group.events.map(e => ({
          time: formatTime(e.hourOfDay, e.minuteOfHour),
          status: e.value ? __('settings.statusOn') : __('settings.statusOff'),
          value: e.value
        }));

        const tooltipDataJson = JSON.stringify(tooltipData).replace(/'/g, '&apos;').replace(/"/g, '&quot;');

        html += `<div class="timeline-event-group"
                      style="left: ${position}%"
                      data-events='${tooltipDataJson}'
                      onmouseenter="showEventTooltip(event)"
                      onmouseleave="hideEventTooltip()"
                      onclick="showEventGroupModal(event)">
                   <span class="event-count">${group.events.length}</span>
                 </div>`;
      }
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
    // Call backend API to clear history (this updates app memory and saves state)
    await Homey.api('POST', '/clear-history', { deviceId });

    showStatus(__('settings.historyCleared', { name: deviceName }), 'success');

    // Reload tracked devices to reflect the change immediately
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

/**
 * View raw device history (debug)
 */
async function viewDeviceHistoryRaw(deviceId) {
  try {
    const result = await Homey.api('GET', `/device-insights?deviceId=${deviceId}`);

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';

    let content = '<h3>Raw Device Insights Data</h3>';

    if (result.success) {
      // ✅ NIEUW: Toon debug info bovenaan
      content += `<div style="margin-bottom: 20px; padding: 15px; background: #e3f2fd; border-radius: 5px;">
        <h4 style="margin-top: 0;">📊 Data Statistics:</h4>
        <strong>Log Info:</strong><br>
        • ID: ${result.logInfo.id}<br>
        • URI: ${result.logInfo.uri}<br>
        • Title: ${result.logInfo.title}<br>
        <br>
        <strong>Entries Info:</strong><br>
        • Total Entries Retrieved: <strong>${result.entries.values ? result.entries.values.length : 0}</strong><br>
        • Available Keys: ${Object.keys(result.entries).join(', ')}<br>
      `;

      // Toon eerste en laatste entry timestamps
      if (result.entries.values && result.entries.values.length > 0) {
        const firstEntry = result.entries.values[0];
        const lastEntry = result.entries.values[result.entries.values.length - 1];
        const firstDate = new Date(firstEntry.t);
        const lastDate = new Date(lastEntry.t);

        content += `<br><strong>Time Range:</strong><br>
        • Oldest: ${firstDate.toLocaleString('nl-NL')} (${firstEntry.v ? 'ON' : 'OFF'})<br>
        • Newest: ${lastDate.toLocaleString('nl-NL')} (${lastEntry.v ? 'ON' : 'OFF'})<br>
        • Time Span: ${Math.round((lastDate - firstDate) / (1000 * 60 * 60 * 24) * 10) / 10} dagen
        `;
      }

      content += `</div>`;

      content += '<h4>Raw JSON:</h4>';
      content += `<pre style="background: #f5f5f5; padding: 15px; border-radius: 5px; overflow: auto; max-height: 400px; font-size: 12px;">${JSON.stringify(result, null, 2)}</pre>`;

      if (result.entries.values && result.entries.values.length > 0) {
        content += '<h4>Formatted Entries (laatste 20):</h4>';
        content += '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">';
        content += '<thead><tr style="background: #007bff; color: white;"><th style="padding: 8px; border: 1px solid #ddd;">Timestamp</th><th style="padding: 8px; border: 1px solid #ddd;">Date/Time</th><th style="padding: 8px; border: 1px solid #ddd;">Value (on/off)</th></tr></thead>';
        content += '<tbody>';

        const entriesToShow = result.entries.values.slice(0, 20);
        entriesToShow.forEach(entry => {
          const date = new Date(entry.t);  // ✅ Direct, geen * 1000
          const dateStr = date.toLocaleString('nl-NL');
          const valueStr = entry.v === true || entry.v === 1 ? '🟢 ON' : '🔴 OFF';
          content += `<tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${entry.t}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${dateStr}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${valueStr}</td>
          </tr>`;
        });

        content += '</tbody></table>';

        if (result.entries.values.length > 20) {
          content += `<p style="margin-top: 10px; font-style: italic;">... en nog ${result.entries.values.length - 20} entries meer</p>`;
        }
      }
    } else {
      content += `<div style="color: red; padding: 15px; background: #fee; border-radius: 5px;">
        <strong>Error:</strong> ${result.error || 'Unknown error'}<br><br>
        ${result.availableLogs ? `<strong>Available logs:</strong> ${result.availableLogs.join(', ')}` : ''}
      </div>`;

      content += '<h4>Full Response:</h4>';
      content += `<pre style="background: #f5f5f5; padding: 15px; border-radius: 5px; overflow: auto; max-height: 400px;">${JSON.stringify(result, null, 2)}</pre>`;
    }

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
        <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
        ${content}
        <div style="margin-top: 20px; text-align: right;">
          <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Sluiten</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });

  } catch (error) {
    console.error('Error viewing device history:', error);
    alert(`Error: ${error.message}`);
  }
}

/**
 * Import device history from Homey Insights
 */
async function importDeviceHistoryFromInsights(deviceId, deviceName) {
  try {
    showStatus('Data wordt geïmporteerd...', 'info');

    const result = await Homey.api('GET', `/import-device-history?deviceId=${deviceId}`);

    if (result.success) {
      let message = `✅ Import succesvol!\n\n`;
      message += `Geïmporteerd: ${result.imported} nieuwe events\n`;
      
      if (result.duplicatesSkipped > 0) {
        message += `Duplicaten overgeslagen: ${result.duplicatesSkipped}\n`;
      }
      
      message += `Totaal beschikbaar: ${result.totalEvents} events (max 50 van Insights)\n`;
      message += `Tijdspanne: ${result.timeSpanDays} dagen\n\n`;
      message += `Van: ${new Date(result.oldestDate).toLocaleString('nl-NL')}\n`;
      message += `Tot: ${new Date(result.newestDate).toLocaleString('nl-NL')}\n\n`;
      message += `ℹ️ Let op: Homey Insights API geeft maximaal 50 entries. Voor betere pattern detection blijft de app nieuwe events real-time loggen.`;

      await showConfirmModal('Import Succesvol', message);
      
      // Reload tracked devices om nieuwe data te tonen
      await loadTrackedDevices();
      
    } else {
      showStatus(`❌ Import mislukt: ${result.error}`, 'error');
    }

  } catch (error) {
    console.error('Error importing history:', error);
    showStatus(`Error: ${error.message}`, 'error');
  }
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showStatus(__('settings.copiedToClipboard'), 'success');
  } catch (error) {
    showStatus(__('settings.copyFailed'), 'error');
  }
}

/**
 * Show tooltip for grouped events
 */
function showEventTooltip(event) {
  // Remove existing tooltip
  hideEventTooltip();

  // Get the event group element (could be the span or the div)
  const target = event.target.closest('.timeline-event-group');
  if (!target) return;

  // Get events data from data attribute
  const eventsDataJson = target.getAttribute('data-events');
  if (!eventsDataJson) return;

  let eventsData;
  try {
    eventsData = JSON.parse(eventsDataJson);
  } catch (e) {
    console.error('Failed to parse events data:', e);
    return;
  }

  // Build tooltip content (limit to first 10 events if there are many)
  const MAX_TOOLTIP_EVENTS = 10;
  const showCount = Math.min(eventsData.length, MAX_TOOLTIP_EVENTS);
  const hiddenCount = eventsData.length - showCount;

  const content = eventsData.slice(0, showCount).map(e => {
    const icon = e.value ? '🟢' : '🔴';
    return `<div class="tooltip-event-line">${icon} ${e.time} - ${e.status}</div>`;
  }).join('');

  const moreIndicator = hiddenCount > 0
    ? `<div class="tooltip-more-indicator">... en ${hiddenCount} meer</div>`
    : '';

  // Create tooltip element
  const tooltip = document.createElement('div');
  tooltip.id = 'event-tooltip';
  tooltip.className = 'event-tooltip';
  tooltip.innerHTML = content + moreIndicator;

  document.body.appendChild(tooltip);

  // Position tooltip with smart positioning
  const rect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const margin = 10;

  let left, top;
  let position = 'above'; // Track which position we use

  // Try 1: Above the element (preferred)
  top = rect.top - tooltipRect.height - margin;
  left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

  // Check if fits above
  if (top < margin) {
    // Try 2: Below the element
    top = rect.bottom + margin;
    position = 'below';

    // Check if fits below
    if (top + tooltipRect.height > viewportHeight - margin) {
      // Try 3: To the right
      left = rect.right + margin;
      top = rect.top + (rect.height / 2) - (tooltipRect.height / 2);
      position = 'right';

      // Check if fits to the right
      if (left + tooltipRect.width > viewportWidth - margin) {
        // Try 4: To the left
        left = rect.left - tooltipRect.width - margin;
        position = 'left';

        // Final fallback: center on screen (shouldn't happen often)
        if (left < margin) {
          left = (viewportWidth - tooltipRect.width) / 2;
          top = (viewportHeight - tooltipRect.height) / 2;
          position = 'center';
        }
      }
    }
  }

  // Keep horizontal position within viewport for above/below
  if (position === 'above' || position === 'below') {
    if (left < margin) left = margin;
    if (left + tooltipRect.width > viewportWidth - margin) {
      left = viewportWidth - tooltipRect.width - margin;
    }
  }

  // Keep vertical position within viewport for left/right
  if (position === 'left' || position === 'right') {
    if (top < margin) top = margin;
    if (top + tooltipRect.height > viewportHeight - margin) {
      top = viewportHeight - tooltipRect.height - margin;
    }
  }

  tooltip.className = `event-tooltip ${position}`;
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';

  // Fade in
  setTimeout(() => tooltip.classList.add('visible'), 10);
}

/**
 * Hide event tooltip
 */
function hideEventTooltip() {
  const tooltip = document.getElementById('event-tooltip');
  if (tooltip) {
    tooltip.remove();
  }
}

/**
 * Show modal with all events in a group
 */
function showEventGroupModal(event) {
  event.stopPropagation();

  // Hide tooltip first
  hideEventTooltip();

  // Get the event group element
  const target = event.currentTarget;
  const eventsDataJson = target.getAttribute('data-events');

  if (!eventsDataJson) return;

  let eventsData;
  try {
    eventsData = JSON.parse(eventsDataJson);
  } catch (e) {
    console.error('Failed to parse events data:', e);
    return;
  }

  // Build modal content
  let html = `<p style="color: #666; margin-bottom: 15px;">
    ${__('settings.showingGroupedEvents', { count: eventsData.length })}
  </p>`;

  html += '<table class="events-table">';
  html += `
    <thead>
      <tr>
        <th>${__('settings.time')}</th>
        <th>${__('settings.status')}</th>
      </tr>
    </thead>
    <tbody>
  `;

  eventsData.forEach(e => {
    const statusColor = e.value ? '#4CAF50' : '#f44336';
    const statusIcon = e.value ? '🟢' : '🔴';
    const statusText = statusIcon + ' ' + e.status;

    html += `
      <tr>
        <td style="font-weight: 500;">${e.time}</td>
        <td style="color: ${statusColor}; font-weight: bold;">${statusText}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';

  document.getElementById('eventsModalTitle').textContent = __('settings.groupedEventsTitle');
  document.getElementById('eventsModalContent').innerHTML = html;
  document.getElementById('eventsModal').classList.add('active');
}