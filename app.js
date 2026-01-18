'use strict';

const Homey = require('homey');

// Development flags
const DEBUG = false;   // Enable debug mode features
const VERBOSE = false; // Enable verbose logging for troubleshooting

class VacationModeApp extends Homey.App {

  /**
   * Parse a tracking key into deviceId and capability
   * @param {string} trackingKey - The tracking key
   * @returns {{deviceId: string, capability: string}} Parsed components
   */
  parseTrackingKey(trackingKey) {
    const colonIndex = trackingKey.indexOf(':');
    if (colonIndex === -1) {
      // Legacy format without capability, assume 'onoff'
      return { deviceId: trackingKey, capability: 'onoff' };
    }
    return {
      deviceId: trackingKey.substring(0, colonIndex),
      capability: trackingKey.substring(colonIndex + 1)
    };
  }

  async onInit() {
    // Initialize log buffer
    this.recentLogs = [];
    this.maxLogs = 200;

    this.logInfo('Vacation Mode app starting...');

    // Initialize HomeyAPI - cache for reuse
    const { HomeyAPI } = require('homey-api');
    this.api = await HomeyAPI.createAppAPI({ homey: this.homey });
    this.logInfo('HomeyAPI instance created and cached');

    // Initialize state
    this.vacationModeActive = false;
    this.testMode = false;
    this.trackedDevices = new Map();
    this.deviceHistory = new Map();
    this.scheduledTimeouts = new Map();

    // Load saved state
    await this.loadState();

    // Register flow cards
    this.registerFlowCards();

    // Start cleanup timer
    this.startCleanupTimer();

    this.logInfo('Vacation Mode app initialized');
    this.logInfo(`Test mode: ${this.testMode ? 'ENABLED' : 'disabled'}`);
    this.logInfo(`Tracking ${this.trackedDevices.size} devices`);
    this.logInfo(`History contains ${this.deviceHistory.size} device histories`);
  }

  // Helper om huidige datum/tijd in juiste timezone te krijgen
  getCurrentDate() {
    return new Date();
  }

  // Format datum voor logging in gebruiker's timezone
  formatDate(date) {
    if (!date) date = this.getCurrentDate();
    // Use simpler ISO format for better performance
    // toLocaleString is relatively expensive and called frequently
    const isoString = date.toISOString();
    // Convert to readable format: 2026-01-16T14:30:45.123Z -> 2026-01-16 14:30:45
    return isoString.replace('T', ' ').substring(0, 19);
  }

  // Helper function to log and store
  logInfo(message) {
    // Trim logs array BEFORE adding to prevent temporary memory spikes during burst logging
    if (this.recentLogs.length >= this.maxLogs) {
      this.recentLogs.shift();
    }
    const timestamp = this.formatDate();
    this.recentLogs.push({
      timestamp,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      level: 'info'
    });
    this.log(message);
  }

  logError(message) {
    // Trim logs array BEFORE adding to prevent temporary memory spikes during burst logging
    if (this.recentLogs.length >= this.maxLogs) {
      this.recentLogs.shift();
    }
    const timestamp = this.formatDate();
    this.recentLogs.push({
      timestamp,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      level: 'error'
    });
    this.error(message);
  }

  // Verbose logging - only shown when VERBOSE flag is enabled
  // Used for detailed debugging during development/troubleshooting
  logVerbose(message) {
    if (VERBOSE) {
      this.logInfo(message);
    } else {
      // Still log to console for development, but not to UI
      this.log(message);
    }
  }

  async loadState() {
    try {
      const savedVacationMode = this.homey.settings.get('vacationModeActive');
      if (savedVacationMode !== null) {
        this.vacationModeActive = savedVacationMode;
      }

      const savedTestMode = this.homey.settings.get('testMode');
      if (savedTestMode !== null) {
        this.testMode = savedTestMode;
      }

      // Load tracked devices list first
      const savedTrackedDevices = this.homey.settings.get('trackedDevices');
      const trackedDeviceIds = savedTrackedDevices && Array.isArray(savedTrackedDevices) ? savedTrackedDevices : [];

      // Load each device's history from Settings
      this.deviceHistory = new Map();
      for (const trackingKey of trackedDeviceIds) {
        const storageKey = trackingKey.replace(/:/g, '_');
        const historyJson = this.homey.settings.get(`device_history_${storageKey}`);
        if (historyJson) {
          try {
            const history = JSON.parse(historyJson);
            this.deviceHistory.set(trackingKey, history);
          } catch (err) {
            this.logError(`Failed to parse history for ${trackingKey}: ${err.message}`);
          }
        }
      }

      // Restore tracking for devices
      if (trackedDeviceIds.length > 0) {
        this.logInfo(`Found ${trackedDeviceIds.length} devices to restore tracking for`);

        for (const trackingKey of trackedDeviceIds) {
          try {
            // The capability is embedded in the tracking key, startTrackingDevice will parse it
            await this.startTrackingDevice(trackingKey);
            this.logInfo(`✓ Successfully restored tracking for ${trackingKey}`);
          } catch (err) {
            this.logError(`✗ Failed to restore tracking for ${trackingKey}: ${err.message}`);
          }
        }
      }

      this.logInfo('State loaded successfully');
      this.logInfo(`Currently tracking ${this.trackedDevices.size} devices`);

      if (this.vacationModeActive) {
        this.logInfo('Vacation mode was active, syncing initial states and rescheduling actions after restart...');

        await this.homey.setTimeout(async () => {
          // First sync initial states
          await this.syncInitialStates();

          // Then reschedule future actions
          for (const [deviceId, history] of this.deviceHistory.entries()) {
            if (this.trackedDevices.has(deviceId)) {
              this.logInfo(`Rescheduling for device: ${deviceId}`);
              await this.scheduleNextAction(deviceId, history);
            } else {
              this.logInfo(`⚠ Cannot reschedule for ${deviceId} - device not tracked`);
            }
          }
          this.logInfo('Actions rescheduled after restart');
          await this.logScheduledOverview();
        }, 2000);
      }

    } catch (error) {
      this.logError(`Error loading state: ${error.message}`);
      this.logError(error.stack);
    }
  }


  // Save only a single device's history
  async saveDeviceHistory(trackingKey) {
    try {
      const history = this.deviceHistory.get(trackingKey);
      if (history) {
        // Replace colons with underscores for storage key (colons not allowed in some storage systems)
        const storageKey = trackingKey.replace(/:/g, '_');
        this.homey.settings.set(`device_history_${storageKey}`, JSON.stringify(history));
      }
    } catch (error) {
      this.logError(`Error saving history for ${trackingKey}:`, error);
    }
  }

  // Save vacation mode setting only
  async saveVacationMode() {
    try {
      this.homey.settings.set('vacationModeActive', this.vacationModeActive);
    } catch (error) {
      this.logError('Error saving vacation mode:', error);
    }
  }

  // Save tracked devices list only
  async saveTrackedDevices() {
    try {
      const trackedDeviceIds = Array.from(this.trackedDevices.keys());
      this.homey.settings.set('trackedDevices', trackedDeviceIds);
    } catch (error) {
      this.logError('Error saving tracked devices:', error);
    }
  }

  // Remove a device's history from storage
  async removeDeviceHistory(trackingKey) {
    try {
      // Replace colons with underscores for storage key
      const storageKey = trackingKey.replace(/:/g, '_');
      this.homey.settings.unset(`device_history_${storageKey}`);
    } catch (error) {
      this.logError(`Error removing history for ${trackingKey}:`, error);
    }
  }

  registerFlowCards() {
    try {
      this.homey.flow.getActionCard('enable_presence_simulator')
        .registerRunListener(async () => {
          await this.enableVacationMode();
        });

      this.homey.flow.getActionCard('disable_presence_simulator')
        .registerRunListener(async () => {
          await this.disableVacationMode();
        });

      this.homey.flow.getConditionCard('presence_simulator_is_enabled')
        .registerRunListener(async () => {
          return this.vacationModeActive;
        });

      this.logInfo('Flow cards registered successfully');
    } catch (error) {
      this.logError('Error registering flow cards:', error);
      throw error;
    }
  }

  async startTrackingDevice(trackingKey, capability) {
    if (this.trackedDevices.has(trackingKey)) {
      this.logInfo(`Device ${trackingKey} is already being tracked`);
      return;
    }

    try {
      // Parse the tracking key to get deviceId and capability
      const { deviceId } = this.parseTrackingKey(trackingKey);
      const device = await this.api.devices.getDevice({ id: deviceId });

      // Use the capability passed in, or parse from tracking key
      if (!capability) {
        capability = this.parseTrackingKey(trackingKey).capability;
      }

      if (!device.capabilitiesObj || !device.capabilitiesObj[capability]) {
        throw new Error(`Device does not have ${capability} capability`);
      }

      const capabilityObj = device.capabilitiesObj[capability];
      const capabilityTitle = capabilityObj.title || capability;

      this.logInfo(`Setting up listener for: ${device.name} (${capabilityTitle})`);
      this.logInfo(`Current ${capability} state: ${capabilityObj.value}`);

      const listener = async (value) => {
        this.logInfo(`!!! LISTENER TRIGGERED !!! ${device.name} (${capabilityTitle}) -> ${value}`);
        await this.recordDeviceEvent(trackingKey, value);
      };

      // Try to register listener using makeCapabilityInstance (works for HomeyAPI devices)
      try {
        await device.makeCapabilityInstance(capability, listener);
        this.logInfo(`Registered listener for ${device.name} (${capabilityTitle})`);
      } catch (err) {
        // Listener failed, fall back to polling
        this.logInfo(`Listener registration failed for ${device.name} (${capabilityTitle}): ${err.message}`);
        this.logInfo(`Falling back to polling method (5 minute interval)`);

        const pollInterval = this.homey.setInterval(async () => {
          try {
            // Only fetch the device to read capability
            // This is more efficient than storing the full device object
            const freshDevice = await this.api.devices.getDevice({ id: deviceId });
            const currentValue = freshDevice.capabilitiesObj[capability].value;
            const tracked = this.trackedDevices.get(trackingKey);

            if (tracked && tracked.lastValue !== currentValue) {
              this.logInfo(`!!! POLL DETECTED CHANGE !!! ${tracked.name} -> ${currentValue}`);
              tracked.lastValue = currentValue;
              await this.recordDeviceEvent(trackingKey, currentValue);
            }
          } catch (pollErr) {
            const tracked = this.trackedDevices.get(trackingKey);
            const deviceName = tracked ? tracked.name : trackingKey;
            this.logError(`Poll error for ${deviceName}:`, pollErr);
          }
        }, 300000); // 5 minutes

        // Store minimal info: name for logging, lastValue for polling comparison, pollInterval for cleanup
        // Device object NOT stored to save memory
        this.trackedDevices.set(trackingKey, {
          name: `${device.name} - ${capabilityTitle}`,
          capability: capability,
          lastValue: capabilityObj.value,
          pollInterval: pollInterval,
          deviceObject: device // Keep device object for listener cleanup
        });

        await this.saveTrackedDevices();
        this.logInfo(`Started tracking device with POLLING: ${device.name} (${capabilityTitle}) [${trackingKey}]`);
        return;
      }

      // Store minimal info: name for logging, listener reference and device object for cleanup
      this.trackedDevices.set(trackingKey, {
        name: `${device.name} - ${capabilityTitle}`,
        capability: capability,
        lastValue: capabilityObj.value,
        listener: listener, // Keep listener reference for proper cleanup
        deviceObject: device // Keep device object for listener cleanup
      });

      if (!this.deviceHistory.has(trackingKey)) {
        this.deviceHistory.set(trackingKey, []);
      }

      await this.saveTrackedDevices();

      this.logInfo(`Started tracking device: ${device.name} (${capabilityTitle}) [${trackingKey}]`);
    } catch (error) {
      this.logError(`Failed to start tracking device ${trackingKey}:`, error);
      throw error;
    }
  }

  async stopTrackingDevice(trackingKey) {
    if (!this.trackedDevices.has(trackingKey)) {
      this.logInfo(`Device ${trackingKey} is not being tracked`);
      return;
    }

    try {
      const tracked = this.trackedDevices.get(trackingKey);

      if (tracked.pollInterval) {
        this.homey.clearInterval(tracked.pollInterval);
        this.logInfo(`Stopped polling for ${tracked.name}`);
      }

      if (tracked.listener && tracked.deviceObject && tracked.capability) {
        try {
          tracked.deviceObject.capabilitiesObj[tracked.capability].removeListener('value', tracked.listener);
          this.logInfo(`Removed listener for ${tracked.name}`);
        } catch (err) {
          this.logInfo(`Could not remove listener: ${err.message}`);
        }
      }

      this.trackedDevices.delete(trackingKey);

      if (this.scheduledTimeouts.has(trackingKey)) {
        this.homey.clearTimeout(this.scheduledTimeouts.get(trackingKey));
        this.scheduledTimeouts.delete(trackingKey);
      }

      await this.saveTrackedDevices();

      this.logInfo(`Stopped tracking device: ${tracked.name} [${trackingKey}]`);
    } catch (error) {
      this.logError(`Failed to stop tracking device ${trackingKey}:`, error);
    }
  }

  async recordDeviceEvent(trackingKey, value) {
    const now = this.getCurrentDate();

    // Get existing history
    let history = this.deviceHistory.get(trackingKey) || [];

    // Check if the last event has the same value (duplicate detection)
    // This prevents duplicate events from listener bugs (listeners can fire 4-6x)
    if (history.length > 0) {
      const lastEvent = history[history.length - 1];
      if (lastEvent.value === value) {
        this.logInfo(`Duplicate event ignored: ${trackingKey} -> ${value} (same as last event)`);
        return; // Skip recording duplicate
      }
    }

    const event = {
      timestamp: now.getTime(),
      value: value,
      dayOfWeek: now.getDay(),
      hourOfDay: now.getHours(),
      minuteOfHour: now.getMinutes(),
      timeMinutes: now.getHours() * 60 + now.getMinutes()
    };

    history.push(event);

    // Keep 8 days of history to ensure we always have the previous week's event
    const keepDuration = 8 * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - keepDuration;
    history = history.filter(e => e.timestamp > cutoffTime);

    // Also limit maximum number of events to prevent uncontrolled growth
    const MAX_EVENTS = 10000;
    if (history.length > MAX_EVENTS) {
      history = history.slice(-MAX_EVENTS);
    }

    this.deviceHistory.set(trackingKey, history);
    // Only save this device's history, not the entire state
    await this.saveDeviceHistory(trackingKey);

    const timeStr = this.formatDate(now);

    if (this.testMode) {
      this.logInfo(`Recorded: ${trackingKey} -> ${value} at ${timeStr} (minute ${event.minuteOfHour})`);
    } else {
      this.logInfo(`Recorded: ${trackingKey} -> ${value} at ${timeStr} (day ${event.dayOfWeek})`);
    }
  }

  async enableVacationMode() {
    if (this.vacationModeActive) {
      this.logInfo('Vacation mode already enabled');
      return;
    }

    this.vacationModeActive = true;
    await this.saveVacationMode();

    this.logInfo('======================================');
    this.logInfo('Vacation mode ENABLED');
    this.logInfo(`Mode: ${this.testMode ? 'TEST (hourly replay)' : 'NORMAL (daily replay)'}`);
    this.logInfo(`Tracked devices: ${this.trackedDevices.size}`);
    this.logInfo(`Device history entries: ${this.deviceHistory.size}`);
    this.logInfo('======================================');

    for (const [deviceId, history] of this.deviceHistory.entries()) {
      const tracked = this.trackedDevices.get(deviceId);
      const deviceName = tracked ? tracked.name : deviceId;
      this.logInfo(`Device: ${deviceName}`);
      this.logInfo(`  - Events in history: ${history.length}`);
      if (history.length > 0) {
        this.logInfo(`  - First event: ${JSON.stringify(history[0])}`);
        this.logInfo(`  - Last event: ${JSON.stringify(history[history.length - 1])}`);
      }
    }

    try {
      await this.homey.flow.getTriggerCard('vacation_mode_enabled').trigger();
    } catch (err) {
      this.logInfo('No vacation_mode_enabled trigger card');
    }

    // Sync initial states before scheduling future actions
    await this.syncInitialStates();

    for (const [deviceId, history] of this.deviceHistory.entries()) {
      this.logInfo(`Scheduling actions for device: ${deviceId}`);
      await this.scheduleNextAction(deviceId, history);
    }

    this.logInfo('======================================');

    await this.logScheduledOverview();
  }

  async disableVacationMode() {
    if (!this.vacationModeActive) {
      this.logInfo('Vacation mode already disabled');
      return;
    }

    this.vacationModeActive = false;
    await this.saveVacationMode();

    this.logInfo('Vacation mode DISABLED');

    for (const [deviceId, timeout] of this.scheduledTimeouts.entries()) {
      this.homey.clearTimeout(timeout);
    }
    this.scheduledTimeouts.clear();

    try {
      await this.homey.flow.getTriggerCard('vacation_mode_disabled').trigger();
    } catch (err) {
      this.logInfo('No vacation_mode_disabled trigger card');
    }
  }

  /**
   * Calculate the next scheduled event from history
   * @param {Array} history - Array of historical events
   * @param {boolean} testMode - Whether in test mode (hourly) or normal mode (weekly)
   * @returns {object} Object with nextEvent and minDelay, or null if no event found
   */
  calculateNextEvent(history, testMode) {
    const now = new Date();
    let nextEvent = null;
    let minDelay = Infinity;

    if (testMode) {
      // TEST MODE: Hourly replay within the hour
      const currentMinute = now.getMinutes();

      for (const event of history) {
        let delayMinutes;

        if (event.minuteOfHour > currentMinute) {
          delayMinutes = event.minuteOfHour - currentMinute;
        } else {
          delayMinutes = (60 - currentMinute) + event.minuteOfHour;
        }

        if (delayMinutes < minDelay && delayMinutes > 0) {
          minDelay = delayMinutes;
          nextEvent = event;
        }
      }
    } else {
      // NORMAL MODE: Weekly replay based on day and time
      const currentDayOfWeek = now.getDay();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

      for (const event of history) {
        let delayMinutes;

        if (event.dayOfWeek === currentDayOfWeek) {
          if (event.timeMinutes > currentTimeMinutes) {
            delayMinutes = event.timeMinutes - currentTimeMinutes;
          } else {
            delayMinutes = (7 * 24 * 60) - currentTimeMinutes + event.timeMinutes;
          }
        } else {
          let daysUntil = event.dayOfWeek - currentDayOfWeek;
          if (daysUntil < 0) daysUntil += 7;

          delayMinutes = (daysUntil * 24 * 60) - currentTimeMinutes + event.timeMinutes;
        }

        if (delayMinutes < minDelay && delayMinutes > 0) {
          minDelay = delayMinutes;
          nextEvent = event;
        }
      }
    }

    if (nextEvent && minDelay < Infinity) {
      return { nextEvent, minDelay };
    }

    return null;
  }

  async scheduleNextAction(deviceId, history) {
    this.logVerbose(`--- scheduleNextAction called for ${deviceId} ---`);
    this.logVerbose(`Vacation mode active: ${this.vacationModeActive}`);
    this.logVerbose(`Test mode: ${this.testMode}`);
    this.logVerbose(`History length: ${history ? history.length : 0}`);

    if (!this.vacationModeActive) {
      this.logVerbose('Vacation mode not active, skipping schedule');
      return;
    }

    if (!history || history.length === 0) {
      this.logVerbose(`No history for device ${deviceId}`);
      return;
    }

    const now = this.getCurrentDate();
    this.logVerbose(`Current time: ${this.formatDate(now)}`);
    this.logVerbose(`Current minute: ${now.getMinutes()}`);

    // Log history for debugging
    if (this.testMode) {
      this.logVerbose(`TEST MODE - Looking for events to replay (current minute: ${now.getMinutes()})`);
      history.forEach((event, index) => {
        this.logVerbose(`  Event ${index}: minute=${event.minuteOfHour}, value=${event.value}`);
      });
    } else {
      const currentDayOfWeek = now.getDay();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
      this.logVerbose(`NORMAL MODE - Current day: ${currentDayOfWeek}, time: ${currentTimeMinutes} mins`);
      history.forEach((event, index) => {
        this.logVerbose(`  Event ${index}: day=${event.dayOfWeek}, time=${event.timeMinutes} mins, value=${event.value}`);
      });
    }

    // Calculate next event using helper method
    const result = this.calculateNextEvent(history, this.testMode);

    if (result) {
      const { nextEvent, minDelay } = result;
      const delayMs = minDelay * 60 * 1000;
      const executeTime = new Date(Date.now() + delayMs);

      if (this.testMode) {
        this.logVerbose(`✓ SCHEDULED: ${deviceId} -> ${nextEvent.value} in ${Math.round(minDelay)} min (at minute ${nextEvent.minuteOfHour})`);
        this.logVerbose(`  Will execute at: ${this.formatDate(executeTime)}`);
      } else {
        this.logVerbose(`✓ SCHEDULED: ${deviceId} -> ${nextEvent.value} in ${Math.round(minDelay)} min (day ${nextEvent.dayOfWeek})`);
        this.logVerbose(`  Will execute at: ${this.formatDate(executeTime)}`);
      }

      if (this.scheduledTimeouts.has(deviceId)) {
        this.homey.clearTimeout(this.scheduledTimeouts.get(deviceId));
      }

      const timeout = this.homey.setTimeout(async () => {
        this.logVerbose(`⏰ TIMEOUT TRIGGERED for ${deviceId}`);
        await this.executeAction(deviceId, nextEvent.value);
        await this.scheduleNextAction(deviceId, history);
      }, delayMs);

      this.scheduledTimeouts.set(deviceId, timeout);
    } else {
      this.logVerbose(`❌ No suitable event found for ${deviceId}`);
    }

    this.logVerbose(`--- end scheduleNextAction ---`);
  }


  async logScheduledOverview() {
    if (!this.vacationModeActive) {
      this.logInfo('Vacation mode not active - no scheduled actions');
      return;
    }

    const scheduledActions = [];

    for (const [deviceId, timeout] of this.scheduledTimeouts.entries()) {
      const tracked = this.trackedDevices.get(deviceId);
      const deviceName = tracked ? tracked.name : deviceId;
      const history = this.deviceHistory.get(deviceId);

      if (!history || history.length === 0) continue;

      // Calculate next event using helper method
      const result = this.calculateNextEvent(history, this.testMode);

      if (result) {
        const { nextEvent, minDelay } = result;
        const executeTime = new Date(Date.now() + minDelay * 60 * 1000);
        scheduledActions.push({
          deviceName: deviceName,
          value: nextEvent.value,
          delayMinutes: Math.round(minDelay),
          executeTime: this.formatDate(executeTime)
        });
      }
    }

    this.logInfo('════════════════════════════════════════════════════════════');

    if (scheduledActions.length === 0) {
      this.logInfo('⚠️  No actions scheduled - check device history');
    } else {
      scheduledActions.sort((a, b) => b.delayMinutes - a.delayMinutes);

      scheduledActions.forEach((action, index) => {
        const hours = Math.floor(action.delayMinutes / 60);
        const minutes = action.delayMinutes % 60;
        const timeStr = hours > 0 ? `${hours}u ${minutes}m` : `${minutes}m`;

        this.logInfo('');
        this.logInfo(`   → Over ${timeStr} (${action.delayMinutes} minuten)`);
        this.logInfo(`   → ${action.value ? 'AAN' : 'UIT'} om ${action.executeTime}`);
        this.logInfo(`${scheduledActions.length - index}. 💡 ${action.deviceName}`);
      });

      this.logInfo('');
    }

    this.logInfo('╚════════════════════════════════════════════════════════════╝');
    this.logInfo('║           📅 SCHEDULED ACTIONS OVERVIEW                    ║');
    this.logInfo('╔════════════════════════════════════════════════════════════╗');
    this.logInfo('');
  }

  async executeAction(trackingKey, value) {
    if (!this.vacationModeActive) {
      return;
    }

    try {
      const tracked = this.trackedDevices.get(trackingKey);
      if (!tracked) {
        this.logInfo(`Device ${trackingKey} no longer tracked`);
        return;
      }

      // Parse tracking key to get actual device ID
      const { deviceId } = this.parseTrackingKey(trackingKey);
      const capability = tracked.capability || 'onoff';

      // Fetch device on-demand to get current state (ensures device still exists and is online)
      const device = await this.api.devices.getDevice({ id: deviceId });
      const currentValue = device.capabilitiesObj[capability].value;

      // Skip if device is already in desired state (avoids unnecessary API calls)
      if (currentValue === value) {
        this.logInfo(`✓ Skipped: ${tracked.name} already ${value ? 'ON' : 'OFF'}`);
        return;
      }

      await device.setCapabilityValue(capability, value);
      this.logInfo(`✓ Executed: ${tracked.name} -> ${value ? 'ON' : 'OFF'}`);
    } catch (error) {
      this.logError(`Failed to execute action for ${trackingKey}:`, error);
    }
  }

  /**
   * Sync initial device states based on history from 1 week (or 1 hour in test mode) ago
   * This ensures devices are in the correct state immediately when the simulator starts
   */
  async syncInitialStates() {
    const now = this.getCurrentDate();
    let targetTime;

    if (this.testMode) {
      // In test mode, look back 1 hour
      targetTime = new Date(now.getTime() - (60 * 60 * 1000));
    } else {
      // In normal mode, look back exactly 7 days
      targetTime = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    }

    const syncActions = [];

    for (const [deviceId, history] of this.deviceHistory.entries()) {
      if (!this.trackedDevices.has(deviceId)) {
        continue;
      }

      const tracked = this.trackedDevices.get(deviceId);

      if (!history || history.length === 0) {
        syncActions.push({
          deviceName: tracked.name,
          status: 'no_history',
          message: 'No history available'
        });
        continue;
      }

      // Find the last event before or at the target time
      let lastEventBeforeTarget = null;

      for (const event of history) {
        if (event.timestamp <= targetTime.getTime()) {
          lastEventBeforeTarget = event;
        } else {
          break; // Events are sorted by time, so we can stop here
        }
      }

      if (lastEventBeforeTarget) {
        const eventDate = new Date(lastEventBeforeTarget.timestamp);

        try {
          const { deviceId: actualDeviceId } = this.parseTrackingKey(deviceId);
          const capability = tracked.capability || 'onoff';
          const device = await this.api.devices.getDevice({ id: actualDeviceId });
          const currentState = device.capabilitiesObj[capability].value;

          if (currentState !== lastEventBeforeTarget.value) {
            await device.setCapabilityValue(capability, lastEventBeforeTarget.value);
            syncActions.push({
              deviceName: tracked.name,
              status: 'synced',
              oldValue: currentState,
              newValue: lastEventBeforeTarget.value,
              eventTime: this.formatDate(eventDate)
            });
          } else {
            syncActions.push({
              deviceName: tracked.name,
              status: 'already_correct',
              value: currentState,
              eventTime: this.formatDate(eventDate)
            });
          }
        } catch (error) {
          syncActions.push({
            deviceName: tracked.name,
            status: 'error',
            error: error.message
          });
        }
      } else {
        syncActions.push({
          deviceName: tracked.name,
          status: 'no_historical_state',
          message: 'No historical state at target time'
        });
      }
    }

    // Log summary
    this.logInfo('');
    this.logInfo('╔════════════════════════════════════════════════════════════╗');
    this.logInfo('║           🔄 INITIAL STATE SYNC SUMMARY                    ║');
    this.logInfo('╚════════════════════════════════════════════════════════════╝');
    this.logInfo('');

    const targetTimeStr = this.formatDate(targetTime);
    this.logInfo(`   Target time: ${targetTimeStr}`);
    this.logInfo(`   Mode: ${this.testMode ? 'TEST (1 hour ago)' : 'NORMAL (7 days ago)'}`);
    this.logInfo('');

    if (syncActions.length === 0) {
      this.logInfo('   ⚠️  No devices to sync');
    } else {
      // Group actions by status
      const synced = syncActions.filter(a => a.status === 'synced');
      const alreadyCorrect = syncActions.filter(a => a.status === 'already_correct');
      const errors = syncActions.filter(a => a.status === 'error');
      const noData = syncActions.filter(a => a.status === 'no_history' || a.status === 'no_historical_state');

      // Show synced devices (changed state)
      if (synced.length > 0) {
        synced.forEach((action, index) => {
          this.logInfo(`${synced.length - index}. 💡 ${action.deviceName}`);
          this.logInfo(`   → Changed: ${action.oldValue ? 'AAN' : 'UIT'} → ${action.newValue ? 'AAN' : 'UIT'}`);
          this.logInfo(`   → Based on event at ${action.eventTime}`);
          this.logInfo('');
        });
      }

      // Show already correct devices
      if (alreadyCorrect.length > 0) {
        alreadyCorrect.forEach((action, index) => {
          this.logInfo(`${alreadyCorrect.length - index}. ✓ ${action.deviceName}`);
          this.logInfo(`   → Already correct: ${action.value ? 'AAN' : 'UIT'}`);
          this.logInfo(`   → Based on event at ${action.eventTime}`);
          this.logInfo('');
        });
      }

      // Show devices with no data
      if (noData.length > 0) {
        noData.forEach((action, index) => {
          this.logInfo(`${noData.length - index}. ⚠️  ${action.deviceName}`);
          this.logInfo(`   → ${action.message}`);
          this.logInfo('');
        });
      }

      // Show errors
      if (errors.length > 0) {
        errors.forEach((action, index) => {
          this.logInfo(`${errors.length - index}. ❌ ${action.deviceName}`);
          this.logInfo(`   → Error: ${action.error}`);
          this.logInfo('');
        });
      }
    }

    this.logInfo('════════════════════════════════════════════════════════════');
  }

  startCleanupTimer() {
    this.homey.setInterval(async () => {
      this.logInfo('Running daily cleanup...');

      // Keep 8 days of history
      const cutoffTime = Date.now() - (8 * 24 * 60 * 60 * 1000);

      for (const [deviceId, history] of this.deviceHistory.entries()) {
        const filtered = history.filter(e => {
          return new Date(e.timestamp).getTime() > cutoffTime;
        });
        this.deviceHistory.set(deviceId, filtered);
        // Save each device's history individually
        await this.saveDeviceHistory(deviceId);
      }

      this.logInfo('Cleanup completed');
    }, 24 * 60 * 60 * 1000);
  }
}

module.exports = VacationModeApp;
