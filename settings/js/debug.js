/**
 * DEBUG FUNCTIONS
 * Development and troubleshooting tools
 */

/**
 * View all events in debug format
 */
async function viewAllEventsDebug() {
  try {
    const response = await Homey.api('GET', '/events');
    const events = response.events || [];
    
    let html = `<h3>${__('settings.allEventsTitle')} (Debug)</h3>`;
    html += `<p>${__('settings.totalEvents')}: ${events.length}</p>`;
    
    if (events.length === 0) {
      html += `<p class="text-muted">${__('settings.noEventsRecordedDebug')}</p>`;
    } else {
      html += '<table style="width:100%; font-size:11px; border-collapse:collapse;">';
      html += `
        <tr style="background:#f0f0f0;">
          <th style="padding:5px; text-align:left;">${__('settings.time')}</th>
          <th style="padding:5px; text-align:left;">${__('settings.device')}</th>
          <th style="padding:5px; text-align:left;">${__('settings.status')}</th>
          <th style="padding:5px; text-align:left;">${__('settings.day')}</th>
        </tr>
      `;
      
      events.slice(0, 100).forEach(event => {
        const date = new Date(event.timestamp);
        const status = event.value ? '🟢 ' + __('settings.statusOn') : '🔴 ' + __('settings.statusOff');
        const dayName = getDayAbbr(event.dayOfWeek);
        html += `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:5px;">${formatDateTime(date)}</td>
            <td style="padding:5px;">${escapeHtml(event.deviceName)}</td>
            <td style="padding:5px;">${status}</td>
            <td style="padding:5px;">${dayName}</td>
          </tr>
        `;
      });
      
      html += '</table>';
      
      if (events.length > 100) {
        html += `<p style="margin-top:10px; color:#999;">${__('settings.showingFirst', { shown: 100, total: events.length })}</p>`;
      }
    }
    
    document.getElementById('debugOutput').innerHTML = html;
  } catch (error) {
    document.getElementById('debugOutput').innerHTML = 
      `<p style="color:red;">Error loading events: ${error.message}</p>`;
  }
}

/**
 * Export all data as JSON
 */
async function exportData() {
  try {
    const events = await Homey.api('GET', '/events');
    const devices = await Homey.get('trackedDevices');
    const history = await Homey.get('deviceHistory');
    const vacationMode = await Homey.get('vacationModeActive');
    
    const data = {
      exportDate: new Date().toISOString(),
      vacationModeActive: vacationMode,
      trackedDevices: devices,
      deviceHistory: history,
      events: events.events
    };
    
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `presence-simulator-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showStatus(__('settings.dataExported'), 'success');
  } catch (error) {
    showStatus(__('settings.failedToExport') + ': ' + error.message, 'error');
  }
}

/**
 * View application logs
 */
async function viewLogs() {
  const logViewer = document.getElementById('logViewer');

  try {
    const response = await Homey.api('GET', '/logs');
    const logs = response.logs || [];

    if (logs.length === 0) {
      logViewer.innerHTML = `<div style="color: #999;">${__('settings.noLogsAvailable')}</div>`;
    } else {
      let html = '';
      // Show newest logs first
      logs.slice().reverse().forEach(log => {
        const levelClass = log.level === 'error' ? 'color: #f48771;' : 'color: #d4d4d4;';
        html += `<div style="margin-bottom: 5px; line-height: 1.4;">`;
        html += `<span style="color: #858585; margin-right: 10px;">${log.timestamp}</span>`;
        html += `<span style="${levelClass}">${escapeHtml(log.message)}</span>`;
        html += `</div>`;
      });
      logViewer.innerHTML = html;
    }

    logViewer.style.display = 'block';
    logViewer.scrollTop = 0;

  } catch (error) {
    showStatus(__('settings.failedToLoadLogs') + ': ' + error.message, 'error');
  }
}

/**
 * Toggle auto-refresh for logs
 */
let autoRefreshInterval = null;
let autoRefreshEnabled = false;

function toggleAutoRefresh() {
  autoRefreshEnabled = !autoRefreshEnabled;
  const btn = document.getElementById('autoRefreshBtn');

  if (autoRefreshEnabled) {
    btn.textContent = __('settings.disableAutoRefresh');
    btn.classList.remove('secondary');
    viewLogs();
    autoRefreshInterval = setInterval(viewLogs, 3000);
  } else {
    btn.textContent = __('settings.enableAutoRefresh');
    btn.classList.add('secondary');
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }
}

/**
 * Clear log display
 */
function clearLogDisplay() {
  const logViewer = document.getElementById('logViewer');
  logViewer.innerHTML = `<div style="color: #999;">${__('settings.logDisplayCleared')}</div>`;
}

/**
 * Copy logs to clipboard
 */
async function copyLogs() {
  try {
    const response = await Homey.api('GET', '/logs');
    const logs = response.logs || [];

    let text = logs.slice().reverse().map(log => {
      return `${log.timestamp} ${log.message}`;
    }).join('\n');

    await navigator.clipboard.writeText(text);
    showStatus(__('settings.logsCopied'), 'success');
  } catch (error) {
    showStatus(__('settings.failedToCopyLogs') + ': ' + error.message, 'error');
  }
}