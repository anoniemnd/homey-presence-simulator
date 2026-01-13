'use strict';

const Homey = require('homey');

class VacationModeApp extends Homey.App {

  async onInit() {
    // Initialize log buffer
    this.recentLogs = [];
    this.maxLogs = 200;

    // Detecteer timezone van Homey systeem
    this.timezone = this.homey.clock.getTimezone();

    this.logInfo('Vacation Mode app starting...');
    this.logInfo(`Detected timezone: ${this.timezone}`);

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
    return date.toLocaleString('nl-NL', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  // Helper function to log and store
  logInfo(message) {
    const timestamp = this.formatDate();
    this.recentLogs.push({
      timestamp,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      level: 'info'
    });
    if (this.recentLogs.length > this.maxLogs) {
      this.recentLogs.shift();
    }
    this.log(message);
  }

  logError(message) {
    const timestamp = this.formatDate();
    this.recentLogs.push({
      timestamp,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      level: 'error'
    });
    if (this.recentLogs.length > this.maxLogs) {
      this.recentLogs.shift();
    }
    this.error(message);
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

      const savedHistory = this.homey.settings.get('deviceHistory');
      if (savedHistory) {
        this.deviceHistory = new Map(Object.entries(savedHistory));
      }

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

      if (this.vacationModeActive) {
        this.logInfo('Vacation mode was active, rescheduling actions after restart...');

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
          await this.logScheduledOverview();
        }, 2000);
      }

    } catch (error) {
      this.logError(`Error loading state: ${error.message}`);
      this.logError(error.stack);
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
      this.homey.flow.getActionCard('enable_precense_simulator')
        .registerRunListener(async () => {
          await this.enableVacationMode();
        });

      this.homey.flow.getActionCard('disable_precense_simulator')
        .registerRunListener(async () => {
          await this.disableVacationMode();
        });

      this.homey.flow.getConditionCard('precense_simulator_is_enabled')
        .registerRunListener(async () => {
          return this.vacationModeActive;
        });

      // this.homey.flow.getConditionCard('precense_simulator_is_enabled')
      //   .registerRunListener(async (args, state) => {
      //     this.log('Condition args:', JSON.stringify(args));
      //     this.log('Vacation mode active:', this.vacationModeActive);
      //     return this.vacationModeActive;
      //   });

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
      const { HomeyAPI } = require('homey-api');
      const api = await HomeyAPI.createAppAPI({ homey: this.homey });
      const device = await api.devices.getDevice({ id: deviceId });

      if (!device.capabilitiesObj || !device.capabilitiesObj.onoff) {
        throw new Error('Device does not have onoff capability');
      }

      this.logInfo(`Setting up listener for: ${device.name}`);
      this.logInfo(`Current onoff state: ${device.capabilitiesObj.onoff.value}`);

      const listener = async (value) => {
        this.logInfo(`!!! LISTENER TRIGGERED !!! ${device.name} -> ${value}`);
        await this.recordDeviceEvent(deviceId, value);
      };

      try {
        device.capabilitiesObj.onoff.on('value', listener);
        this.logInfo(`Registered capabilitiesObj listener for ${device.name}`);
      } catch (err1) {
        this.logInfo(`Method 1 failed: ${err1.message}`);

        try {
          await device.makeCapabilityInstance('onoff', listener);
          this.logInfo(`Registered makeCapabilityInstance listener for ${device.name}`);
        } catch (err2) {
          this.logInfo(`Method 2 failed: ${err2.message}`);

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
          }, 5000);

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

      this.trackedDevices.set(deviceId, {
        device,
        listener,
        name: device.name,
        lastValue: device.capabilitiesObj.onoff.value
      });

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

      if (tracked.pollInterval) {
        this.homey.clearInterval(tracked.pollInterval);
        this.logInfo(`Stopped polling for ${tracked.name}`);
      }

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
    const now = this.getCurrentDate();

    const event = {
      timestamp: now.getTime(),
      value: value,
      dayOfWeek: now.getDay(),
      hourOfDay: now.getHours(),
      minuteOfHour: now.getMinutes(),
      timeMinutes: now.getHours() * 60 + now.getMinutes()
    };

    let history = this.deviceHistory.get(deviceId) || [];
    history.push(event);

    const keepDuration = 7 * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - keepDuration;
    history = history.filter(e => e.timestamp > cutoffTime);

    this.deviceHistory.set(deviceId, history);
    await this.saveState();

    const timeStr = this.formatDate(now);

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
    this.logInfo(`Timezone: ${this.timezone}`);
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
    await this.saveState();

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

    const now = this.getCurrentDate();
    this.logInfo(`Current time: ${this.formatDate(now)}`);
    this.logInfo(`Current minute: ${now.getMinutes()}`);

    let nextEvent = null;
    let minDelay = Infinity;

    if (this.testMode) {
      const currentMinute = now.getMinutes();
      this.logInfo(`TEST MODE - Looking for events to replay (current minute: ${currentMinute})`);

      history.forEach((event, index) => {
        this.logInfo(`  Event ${index}: minute=${event.minuteOfHour}, value=${event.value}`);
      });

      for (const event of history) {
        let delayMinutes;

        if (event.minuteOfHour > currentMinute) {
          delayMinutes = event.minuteOfHour - currentMinute;
        } else {
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
      const currentDayOfWeek = now.getDay();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

      this.logInfo(`NORMAL MODE - Current day: ${currentDayOfWeek}, time: ${currentTimeMinutes} mins`);

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
        this.logInfo(`  Will execute at: ${this.formatDate(executeTime)}`);
      } else {
        this.logInfo(`✓ SCHEDULED: ${deviceId} -> ${nextEvent.value} in ${Math.round(minDelay)} min (day ${nextEvent.dayOfWeek})`);
        this.logInfo(`  Will execute at: ${this.formatDate(executeTime)}`);
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

      const now = this.getCurrentDate();
      const currentDayOfWeek = now.getDay();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

      let nextEvent = null;
      let minDelay = Infinity;

      if (this.testMode) {
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
