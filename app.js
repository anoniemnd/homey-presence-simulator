'use strict';

const Homey = require('homey');

class VacationModeApp extends Homey.App {

// Belangrijke regel
// Als je functie await gebruikt, moet deze async zijn. JavaScript staat niet toe dat je await gebruikt in een niet-async functie.
// Samengevat: async functies kunnen "pauzes" inbouwen met await voor langzame operaties, terwijl reguliere functies alles direct uitvoeren. Dit voorkomt dat je hele app vastloopt tijdens tijdrovende taken.
// Heb je nog vragen over specifieke functies in je code, of wil je weten waarom bepaalde functies wel/niet async zijn gemaakt?

  async onInit() {

    // Initialize log buffer
    this.recentLogs = [];
    this.maxLogs = 200;

    this.logInfo('Vacation Mode app starting...');

    // Initialize state
    this.vacationModeActive = false;
    this.testMode = false;
    this.trackedDevices = new Map(); // deviceId -> { listener, device }
    this.deviceHistory = new Map(); // deviceId -> array of events
    this.scheduledTimeouts = new Map(); // deviceId -> timeout reference

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

  // Helper function to log and store
  logInfo(message) {
    const timestamp = new Date().toLocaleString('nl-NL', { 
      timeZone: 'Europe/Amsterdam' 
    });
    //const timestamp = new Date().toLocaleString('nl-NL');
    this.recentLogs.push({
      timestamp,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      level: 'info'
    });
    if (this.recentLogs.length > this.maxLogs) {
      this.recentLogs.shift();
    }
    this.log(message);  // <- GEEN this.logInfo!
  }

  logError(message) {
    const timestamp = new Date().toLocaleString('nl-NL', { 
      timeZone: 'Europe/Amsterdam' 
    });
    //const timestamp = new Date().toLocaleString('nl-NL');
    this.recentLogs.push({
      timestamp,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      level: 'error'
    });
    if (this.recentLogs.length > this.maxLogs) {
      this.recentLogs.shift();
    }
    this.error(message);  // <- GEEN this.logError!
  }

  async loadState() {
    try {
      // Load vacation mode state
      const savedVacationMode = this.homey.settings.get('vacationModeActive');
      if (savedVacationMode !== null) {
        this.vacationModeActive = savedVacationMode;
      }

      // Load test mode
      const savedTestMode = this.homey.settings.get('testMode');
      if (savedTestMode !== null) {
        this.testMode = savedTestMode;
      }

      // Load device history
      const savedHistory = this.homey.settings.get('deviceHistory');
      if (savedHistory) {
        this.deviceHistory = new Map(Object.entries(savedHistory));
      }

      // Load tracked devices and restart tracking
      const savedTrackedDevices = this.homey.settings.get('trackedDevices');
      if (savedTrackedDevices && Array.isArray(savedTrackedDevices)) {
        this.logInfo(`Found ${savedTrackedDevices.length} devices to restore tracking for`);

        for (const deviceId of savedTrackedDevices) {
          try {
            await this.startTrackingDevice(deviceId);
            this.logInfo(`✓ Successfully restored tracking for ${deviceId}`);
          } catch (err) {
            this.logError(`✗ Failed to restore tracking for ${deviceId}: ${err.message}`);
          }
        }
      }

      this.logInfo('State loaded successfully');
      this.logInfo(`Currently tracking ${this.trackedDevices.size} devices`);

      // If vacation mode was active, reschedule all actions
      if (this.vacationModeActive) {
        this.logInfo('Vacation mode was active, rescheduling actions after restart...');

        // Wait a bit to ensure all devices are ready
        await this.homey.setTimeout(async () => {
          for (const [deviceId, history] of this.deviceHistory.entries()) {
            if (this.trackedDevices.has(deviceId)) {
              this.logInfo(`Rescheduling for device: ${deviceId}`);
              await this.scheduleNextAction(deviceId, history);
            } else {
              this.logInfo(`⚠ Cannot reschedule for ${deviceId} - device not tracked`);
            }
          }
          this.logInfo('Actions rescheduled after restart');
        }, 2000); // Wait 2 seconds
      }

    } catch (error) {
      this.logError(`Error loading state: ${error.message}`);
      this.logError(error.stack);
    }
  }

  async loadState() {
    try {
      // Load vacation mode state
      const savedVacationMode = this.homey.settings.get('vacationModeActive');
      if (savedVacationMode !== null) {
        this.vacationModeActive = savedVacationMode;
      }

      // Load test mode
      const savedTestMode = this.homey.settings.get('testMode');
      if (savedTestMode !== null) {
        this.testMode = savedTestMode;
      }

      // Load device history
      const savedHistory = this.homey.settings.get('deviceHistory');
      if (savedHistory) {
        this.deviceHistory = new Map(Object.entries(savedHistory));
      }

      // Load tracked devices and restart tracking
      const savedTrackedDevices = this.homey.settings.get('trackedDevices');
      if (savedTrackedDevices && Array.isArray(savedTrackedDevices)) {
        for (const deviceId of savedTrackedDevices) {
          await this.startTrackingDevice(deviceId);
        }
      }

      this.logInfo('State loaded successfully');

      // NIEUW: If vacation mode was active, reschedule all actions
      if (this.vacationModeActive) {
        this.logInfo('Vacation mode was active, rescheduling actions after restart...');
        for (const [deviceId, history] of this.deviceHistory.entries()) {
          await this.scheduleNextAction(deviceId, history);
        }
        this.logInfo('Actions rescheduled after restart');
      }

    } catch (error) {
      this.logError('Error loading state:', error);
    }
  }

  async saveState() {
    try {
      this.homey.settings.set('vacationModeActive', this.vacationModeActive);
      this.homey.settings.set('testMode', this.testMode);

      const historyObj = Object.fromEntries(this.deviceHistory);
      this.homey.settings.set('deviceHistory', historyObj);

      const trackedDeviceIds = Array.from(this.trackedDevices.keys());
      this.homey.settings.set('trackedDevices', trackedDeviceIds);

    } catch (error) {
      this.logError('Error saving state:', error);
    }
  }

  registerFlowCards() {
    try {
      this.homey.flow.getActionCard('enable_vacation_mode')
        .registerRunListener(async () => {
          await this.enableVacationMode();
        });

      this.homey.flow.getActionCard('disable_vacation_mode')
        .registerRunListener(async () => {
          await this.disableVacationMode();
        });

      this.homey.flow.getConditionCard('vacation_mode_is_enabled')
        .registerRunListener(async () => {
          return this.vacationModeActive;
        });

      this.logInfo('Flow cards registered successfully');
    } catch (error) {
      this.logError('Error registering flow cards:', error);
      throw error;
    }
  }

  async startTrackingDevice(deviceId) {
    if (this.trackedDevices.has(deviceId)) {
      this.logInfo(`Device ${deviceId} is already being tracked`);
      return;
    }

    try {
      // Get device via Homey API
      const { HomeyAPI } = require('homey-api');
      const api = await HomeyAPI.createAppAPI({ homey: this.homey });
      const device = await api.devices.getDevice({ id: deviceId });

      if (!device.capabilitiesObj || !device.capabilitiesObj.onoff) {
        throw new Error('Device does not have onoff capability');
      }

      this.logInfo(`Setting up listener for: ${device.name}`);
      this.logInfo(`Current onoff state: ${device.capabilitiesObj.onoff.value}`);

      // Create capability listener with extra logging
      const listener = async (value) => {
        this.logInfo(`!!! LISTENER TRIGGERED !!! ${device.name} -> ${value}`);
        await this.recordDeviceEvent(deviceId, value);
      };

      // Try multiple listener approaches
      try {
        // Method 1: Direct capability listener
        device.capabilitiesObj.onoff.on('value', listener);
        this.logInfo(`Registered capabilitiesObj listener for ${device.name}`);
      } catch (err1) {
        this.logInfo(`Method 1 failed: ${err1.message}`);

        try {
          // Method 2: makeCapabilityInstance
          await device.makeCapabilityInstance('onoff', listener);
          this.logInfo(`Registered makeCapabilityInstance listener for ${device.name}`);
        } catch (err2) {
          this.logInfo(`Method 2 failed: ${err2.message}`);

          // Method 3: Poll the device periodically
          this.logInfo(`Falling back to polling method for ${device.name}`);
          const pollInterval = this.homey.setInterval(async () => {
            try {
              const freshDevice = await api.devices.getDevice({ id: deviceId });
              const currentValue = freshDevice.capabilitiesObj.onoff.value;
              const tracked = this.trackedDevices.get(deviceId);

              if (tracked && tracked.lastValue !== currentValue) {
                this.logInfo(`!!! POLL DETECTED CHANGE !!! ${device.name} -> ${currentValue}`);
                tracked.lastValue = currentValue;
                await this.recordDeviceEvent(deviceId, currentValue);
              }
            } catch (pollErr) {
              this.logError(`Poll error for ${device.name}:`, pollErr);
            }
          }, 5000); // Check every 5 seconds

          // Store the poll interval so we can clear it later
          this.trackedDevices.set(deviceId, {
            device,
            listener,
            name: device.name,
            lastValue: device.capabilitiesObj.onoff.value,
            pollInterval: pollInterval
          });

          await this.saveState();
          this.logInfo(`Started tracking device with POLLING: ${device.name} (${deviceId})`);
          return;
        }
      }

      // Store device and listener
      this.trackedDevices.set(deviceId, {
        device,
        listener,
        name: device.name,
        lastValue: device.capabilitiesObj.onoff.value
      });

      // Initialize history if not exists
      if (!this.deviceHistory.has(deviceId)) {
        this.deviceHistory.set(deviceId, []);
      }

      await this.saveState();

      this.logInfo(`Started tracking device: ${device.name} (${deviceId})`);
    } catch (error) {
      this.logError(`Failed to start tracking device ${deviceId}:`, error);
      throw error;
    }
  }

  async stopTrackingDevice(deviceId) {
    if (!this.trackedDevices.has(deviceId)) {
      this.logInfo(`Device ${deviceId} is not being tracked`);
      return;
    }

    try {
      const tracked = this.trackedDevices.get(deviceId);

      // Stop polling if it exists
      if (tracked.pollInterval) {
        this.homey.clearInterval(tracked.pollInterval);
        this.logInfo(`Stopped polling for ${tracked.name}`);
      }

      // Try to unregister listener
      if (tracked.device && tracked.listener) {
        try {
          tracked.device.capabilitiesObj.onoff.removeListener('value', tracked.listener);
        } catch (err) {
          this.logInfo(`Could not remove listener: ${err.message}`);
        }
      }

      this.trackedDevices.delete(deviceId);

      if (this.scheduledTimeouts.has(deviceId)) {
        this.homey.clearTimeout(this.scheduledTimeouts.get(deviceId));
        this.scheduledTimeouts.delete(deviceId);
      }

      await this.saveState();

      this.logInfo(`Stopped tracking device: ${tracked.name} (${deviceId})`);
    } catch (error) {
      this.logError(`Failed to stop tracking device ${deviceId}:`, error);
    }
  }

  async recordDeviceEvent(deviceId, value) {
    const now = new Date();

    const event = {
      timestamp: now.getTime(), // Unix timestamp (ms) - makkelijker voor vergelijken
      value: value,
      dayOfWeek: now.getDay(),
      hourOfDay: now.getHours(),
      minuteOfHour: now.getMinutes(),
      timeMinutes: now.getHours() * 60 + now.getMinutes()
    };

    let history = this.deviceHistory.get(deviceId) || [];
    history.push(event);

    // Keep last 7 days
    const keepDuration = 7 * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - keepDuration;
    history = history.filter(e => e.timestamp > cutoffTime);

    this.deviceHistory.set(deviceId, history);
    await this.saveState();

    const timeStr = now.toLocaleString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (this.testMode) {
      this.logInfo(`Recorded: ${deviceId} -> ${value} at ${timeStr} (minute ${event.minuteOfHour})`);
    } else {
      this.logInfo(`Recorded: ${deviceId} -> ${value} at ${timeStr} (day ${event.dayOfWeek})`);
    }
  }

  async enableVacationMode() {
    if (this.vacationModeActive) {
      this.logInfo('Vacation mode already enabled');
      return;
    }

    this.vacationModeActive = true;
    await this.saveState();

    this.logInfo('======================================');
    this.logInfo('Vacation mode ENABLED');
    this.logInfo(`Mode: ${this.testMode ? 'TEST (hourly replay)' : 'NORMAL (daily replay)'}`);
    this.logInfo(`Tracked devices: ${this.trackedDevices.size}`);
    this.logInfo(`Device history entries: ${this.deviceHistory.size}`);
    this.logInfo('======================================');

    // Log each device's history
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

    // Try to trigger flow card (might not exist)
    try {
      await this.homey.flow.getTriggerCard('vacation_mode_enabled').trigger();
    } catch (err) {
      this.logInfo('No vacation_mode_enabled trigger card');
    }

    // Schedule actions for each device
    for (const [deviceId, history] of this.deviceHistory.entries()) {
      this.logInfo(`Scheduling actions for device: ${deviceId}`);
      await this.scheduleNextAction(deviceId, history);
    }

    this.logInfo('======================================');
  }

  async disableVacationMode() {
    if (!this.vacationModeActive) {
      this.logInfo('Vacation mode already disabled');
      return;
    }

    this.vacationModeActive = false;
    await this.saveState();

    this.logInfo('Vacation mode DISABLED');

    for (const [deviceId, timeout] of this.scheduledTimeouts.entries()) {
      this.homey.clearTimeout(timeout);
    }
    this.scheduledTimeouts.clear();

    await this.homey.flow.getTriggerCard('vacation_mode_disabled').trigger();
  }

  async scheduleNextAction(deviceId, history) {
    this.logInfo(`--- scheduleNextAction called for ${deviceId} ---`);
    this.logInfo(`Vacation mode active: ${this.vacationModeActive}`);
    this.logInfo(`Test mode: ${this.testMode}`);
    this.logInfo(`History length: ${history ? history.length : 0}`);

    if (!this.vacationModeActive) {
      this.logInfo('Vacation mode not active, skipping schedule');
      return;
    }

    if (!history || history.length === 0) {
      this.logInfo(`No history for device ${deviceId}`);
      return;
    }

    const now = new Date();
    this.logInfo(`Current time: ${now.toLocaleString('nl-NL')}`);
    this.logInfo(`Current minute: ${now.getMinutes()}`);

    let nextEvent = null;
    let minDelay = Infinity;

    if (this.testMode) {
      // TEST MODE: Replay based on MINUTE of the hour
      const currentMinute = now.getMinutes();
      this.logInfo(`TEST MODE - Looking for events to replay (current minute: ${currentMinute})`);

      // Log all events in history for debugging
      history.forEach((event, index) => {
        this.logInfo(`  Event ${index}: minute=${event.minuteOfHour}, value=${event.value}`);
      });

      // Find events with matching minute
      for (const event of history) {
        let delayMinutes;

        if (event.minuteOfHour > currentMinute) {
          // Event is later this hour
          delayMinutes = event.minuteOfHour - currentMinute;
        } else {
          // Event is next hour
          delayMinutes = (60 - currentMinute) + event.minuteOfHour;
        }

        this.logInfo(`  Checking event at minute ${event.minuteOfHour}: delay would be ${delayMinutes} min`);

        if (delayMinutes < minDelay && delayMinutes > 0) {
          minDelay = delayMinutes;
          nextEvent = event;
          this.logInfo(`    -> This is the closest event so far!`);
        }
      }

    } else {
      // NORMAL MODE: Replay based on DAY of week
      const currentDayOfWeek = now.getDay();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

      this.logInfo(`NORMAL MODE - Current day: ${currentDayOfWeek}, time: ${currentTimeMinutes} mins`);

      // Log all events
      history.forEach((event, index) => {
        this.logInfo(`  Event ${index}: day=${event.dayOfWeek}, time=${event.timeMinutes} mins, value=${event.value}`);
      });

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

        this.logInfo(`  Checking event on day ${event.dayOfWeek} at ${event.timeMinutes} mins: delay would be ${delayMinutes} min`);

        if (delayMinutes < minDelay && delayMinutes > 0) {
          minDelay = delayMinutes;
          nextEvent = event;
          this.logInfo(`    -> This is the closest event so far!`);
        }
      }
    }

    if (nextEvent && minDelay < Infinity) {
      const delayMs = minDelay * 60 * 1000;
      const executeTime = new Date(Date.now() + delayMs);

      if (this.testMode) {
        this.logInfo(`✓ SCHEDULED: ${deviceId} -> ${nextEvent.value} in ${Math.round(minDelay)} min (at minute ${nextEvent.minuteOfHour})`);
        this.logInfo(`  Will execute at: ${executeTime.toLocaleString('nl-NL')}`);
      } else {
        this.logInfo(`✓ SCHEDULED: ${deviceId} -> ${nextEvent.value} in ${Math.round(minDelay)} min (day ${nextEvent.dayOfWeek})`);
        this.logInfo(`  Will execute at: ${executeTime.toLocaleString('nl-NL')}`);
      }

      if (this.scheduledTimeouts.has(deviceId)) {
        this.homey.clearTimeout(this.scheduledTimeouts.get(deviceId));
      }

      const timeout = this.homey.setTimeout(async () => {
        this.logInfo(`⏰ TIMEOUT TRIGGERED for ${deviceId}`);
        await this.executeAction(deviceId, nextEvent.value);
        await this.scheduleNextAction(deviceId, history);
      }, delayMs);

      this.scheduledTimeouts.set(deviceId, timeout);
    } else {
      this.logInfo(`❌ No suitable event found for ${deviceId}`);
    }

    this.logInfo(`--- end scheduleNextAction ---`);
  }

  async executeAction(deviceId, value) {
    if (!this.vacationModeActive) {
      return;
    }

    try {
      const tracked = this.trackedDevices.get(deviceId);
      if (!tracked) {
        this.logInfo(`Device ${deviceId} no longer tracked`);
        return;
      }

      const { device } = tracked;
      await device.setCapabilityValue('onoff', value);

      this.logInfo(`✓ Executed: ${device.name} -> ${value}`);
    } catch (error) {
      this.logError(`Failed to execute action for ${deviceId}:`, error);
    }
  }

  startCleanupTimer() {
    this.homey.setInterval(async () => {
      this.logInfo('Running daily cleanup...');

      const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000);

      for (const [deviceId, history] of this.deviceHistory.entries()) {
        const filtered = history.filter(e => {
          return new Date(e.timestamp).getTime() > cutoffTime;
        });
        this.deviceHistory.set(deviceId, filtered);
      }

      await this.saveState();
      this.logInfo('Cleanup completed');
    }, 24 * 60 * 60 * 1000);
  }
}

module.exports = VacationModeApp;