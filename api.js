'use strict';
const { HomeyAPI } = require('homey-api');

exports.getDevices = async function ({ homey }) {
    const api = await HomeyAPI.createAppAPI({ homey });
    const devices = await api.devices.getDevices();
    const zones = await api.zones.getZones();
    const devicesArray = Object.values(devices)
        .filter(device => device.capabilitiesObj && device.capabilitiesObj.onoff)
        .map(device => {
            let zoneName = 'No zone';
            let zoneId = null;
            // Look up zone by ID
            if (device.zone && zones[device.zone]) {
                zoneName = zones[device.zone].name;
                zoneId = device.zone;
            } else if (device.zoneName) {
                zoneName = device.zoneName;
            }
            return {
                id: device.id,
                name: device.name,
                zoneName: zoneName,
                zoneId: zoneId,
                capabilitiesObj: device.capabilitiesObj
            };
        })
        .sort((a, b) => {
            // First sort by zone, then by device name
            if (a.zoneName !== b.zoneName) {
                return a.zoneName.localeCompare(b.zoneName, 'nl', { sensitivity: 'base' });
            }
            return a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });
        });
    return devicesArray;
};
// Get recent logs
exports.getLogs = async function ({ homey }) {
    const app = homey.app;
    return { logs: app.recentLogs || [] };
};
// Start tracking a device
exports.trackDevice = async function ({ homey, body }) {
    const app = homey.app;
    const { deviceId } = body;
    await app.startTrackingDevice(deviceId);
    return { success: true };
};
// Stop tracking a device
exports.untrackDevice = async function ({ homey, body }) {
    const app = homey.app;
    const { deviceId } = body;
    await app.stopTrackingDevice(deviceId);
    return { success: true };
};
// Clear all history
exports.clearHistory = async function ({ homey }) {
    const app = homey.app;
    app.deviceHistory.clear();
    await app.saveState();
    app.log('History cleared via settings');
    return { success: true };
};
// Reload settings (e.g., test mode changed)
exports.reloadSettings = async function ({ homey }) {
    const app = homey.app;
    app.logInfo('=== reloadSettings called ===');
    const newTestMode = app.homey.settings.get('testMode');
    if (newTestMode !== app.testMode) {
        app.testMode = newTestMode;
        app.logInfo(`Test mode changed to: ${app.testMode ? 'ENABLED' : 'disabled'}`);
        // If vacation mode is active, reschedule with new mode
        if (app.vacationModeActive) {
            app.logInfo('Rescheduling actions with new test mode...');
            for (const [deviceId, history] of app.deviceHistory.entries()) {
                await app.scheduleNextAction(deviceId, history);
            }
        }
    }
    // Check vacation mode status
    const newVacationMode = app.homey.settings.get('vacationModeActive');
    app.logInfo(`Current vacation mode in settings: ${newVacationMode}`);
    app.logInfo(`Current vacation mode in app: ${app.vacationModeActive}`);
    if (newVacationMode !== app.vacationModeActive) {
        if (newVacationMode) {
            app.logInfo('Vacation mode toggled ON via settings, calling enableVacationMode');
            await app.enableVacationMode();
        } else {
            app.logInfo('Vacation mode toggled OFF via settings, calling disableVacationMode');
            await app.disableVacationMode();
        }
    }
    return { success: true };
};
exports.testLog = async function ({ homey }) {
    const app = homey.app;
    app.logInfo('🔥 TEST LOG MESSAGE 🔥');
    app.logInfo('This is a test to see if logging works');
    return { success: true };
};
// Get all events from history
exports.getEvents = async function ({ homey }) {
    const app = homey.app;
    const api = await HomeyAPI.createAppAPI({ homey });
    const allDevices = await api.devices.getDevices();
    const allEvents = [];
    // Loop through all devices in history
    for (const [deviceId, events] of app.deviceHistory.entries()) {
        // Get device name from API
        const device = allDevices[deviceId];
        const deviceName = device ? device.name : deviceId;
        // Add each event with device info
        events.forEach(event => {
            allEvents.push({
                ...event,
                deviceId: deviceId,
                deviceName: deviceName
            });
        });
    }
    return { events: allEvents };
};