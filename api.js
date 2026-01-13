'use strict';
const { HomeyAPI } = require('homey-api');

/**
 * Check if a device is a group
 * @param {object} device - The device object to check
 * @returns {boolean} True if the device is a group
 */
function isDeviceGroup(device) {
    // Check driver URI for group drivers
    const driverCheck = (device.driverUri && device.driverUri.includes('homey:virtualdrivergroup:driver')) ||
                       (device.driver && device.driver.includes('homey:virtualdrivergroup:driver')) ||
                       (device.driverUri && device.driverUri.includes('homey:app:com.sdn.group')) ||
                       (device.driver && device.driver.includes('homey:app:com.sdn.group'));

    // Check device class properties
    const classCheck = device.class === 'group' ||
                      device.virtualClass === 'group' ||
                      device.virtual === true;

    // Check settings for deviceIds array (group property)
    const settingsCheck = device.settings && device.settings.deviceIds && Array.isArray(device.settings.deviceIds);

    return driverCheck || classCheck || settingsCheck;
}

exports.getDevices = async function ({ homey }) {
    const app = homey.app;
    const api = await HomeyAPI.createAppAPI({ homey });
    const devices = await api.devices.getDevices();
    const zones = await api.zones.getZones();

    // Get tracked devices to check for groups
    const trackedDeviceIds = Array.from(app.trackedDevices.keys());
    const devicesInTrackedGroups = new Set();

    // Find all devices that are part of tracked groups
    for (const deviceId of trackedDeviceIds) {
        const device = devices[deviceId];
        if (device && isDeviceGroup(device)) {
            // This is a tracked group, add all its member devices to the exclusion set
            if (device.settings && device.settings.deviceIds && Array.isArray(device.settings.deviceIds)) {
                device.settings.deviceIds.forEach(id => devicesInTrackedGroups.add(id));
            }
        }
    }

    const devicesArray = Object.values(devices)
        .filter(device => {
            // Check of het een onoff capability heeft
            const hasOnOff = device.capabilitiesObj && device.capabilitiesObj.onoff;

            // Skip devices that are part of a tracked group
            const isPartOfTrackedGroup = devicesInTrackedGroups.has(device.id);

            // Filter op device class: alleen lights en sockets
            const isLightOrSocket = device.class === 'light' || device.class === 'socket';

            // Voor groepen: check of de member devices light of socket zijn
            const isGroup = isDeviceGroup(device);
            let isValidGroup = false;

            if (isGroup && device.settings && device.settings.deviceIds && Array.isArray(device.settings.deviceIds)) {
                // Check of ten minste één member device een light of socket is
                isValidGroup = device.settings.deviceIds.some(memberId => {
                    const memberDevice = devices[memberId];
                    return memberDevice && (memberDevice.class === 'light' || memberDevice.class === 'socket');
                });
            }

            // Accepteer devices die:
            // - onoff capability hebben
            // - NIET onderdeel zijn van een getracked groep
            // - light of socket zijn, OF een groep met light/socket members
            return hasOnOff && !isPartOfTrackedGroup && (isLightOrSocket || isValidGroup);
        })
        .map(device => {
            let zoneName = 'No zone';
            let zoneId = null;
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
            if (a.zoneName !== b.zoneName) {
                return a.zoneName.localeCompare(b.zoneName, 'nl', { sensitivity: 'base' });
            }
            return a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });
        });
    return devicesArray;
};

exports.getLogs = async function ({ homey }) {
    const app = homey.app;
    return { logs: app.recentLogs || [] };
};

exports.trackDevice = async function ({ homey, body }) {
    const app = homey.app;
    const { deviceId } = body;

    // Check if this is a group and if any of its member devices are already tracked
    const { HomeyAPI } = require('homey-api');
    const api = await HomeyAPI.createAppAPI({ homey });
    const device = await api.devices.getDevice({ id: deviceId });

    const removedDevices = [];

    const isGroup = isDeviceGroup(device);
    app.logInfo(`trackDevice: ${device.name} (${deviceId}) - isGroup: ${isGroup}`);

    if (isGroup) {
        app.logInfo(`Device settings: ${JSON.stringify(device.settings)}`);
        app.logInfo(`Has deviceIds: ${device.settings && device.settings.deviceIds ? device.settings.deviceIds.length : 'NO'}`);

        // This is a group, check if any member devices are tracked
        if (device.settings && device.settings.deviceIds && Array.isArray(device.settings.deviceIds)) {
            app.logInfo(`Checking ${device.settings.deviceIds.length} member devices`);

            for (const memberDeviceId of device.settings.deviceIds) {
                app.logInfo(`Checking member device: ${memberDeviceId}, tracked: ${app.trackedDevices.has(memberDeviceId)}`);

                if (app.trackedDevices.has(memberDeviceId)) {
                    // This member device is tracked, remove it
                    const memberDevice = app.trackedDevices.get(memberDeviceId);
                    await app.stopTrackingDevice(memberDeviceId);
                    removedDevices.push({
                        id: memberDeviceId,
                        name: memberDevice.name
                    });
                    app.logInfo(`Auto-removed tracked device ${memberDevice.name} (${memberDeviceId}) because its group is now being tracked`);
                }
            }
        } else {
            app.logInfo(`Group has no deviceIds in settings`);
        }
    }

    await app.startTrackingDevice(deviceId);

    return {
        success: true,
        removedDevices: removedDevices
    };
};

exports.untrackDevice = async function ({ homey, body }) {
    const app = homey.app;
    const { deviceId } = body;
    await app.stopTrackingDevice(deviceId);
    return { success: true };
};

exports.clearHistory = async function ({ homey, body }) {
    const app = homey.app;
    const { deviceId } = body;

    if (!deviceId) {
        throw new Error('deviceId parameter is required');
    }

    // Clear history in app memory
    if (app.deviceHistory.has(deviceId)) {
        app.deviceHistory.delete(deviceId);
        app.log(`History cleared for device ${deviceId}`);
    }

    // Save state to persist the change
    await app.saveState();

    return { success: true };
};

exports.reloadSettings = async function ({ homey }) {
    const app = homey.app;
    app.logInfo('=== reloadSettings called ===');
    const newTestMode = app.homey.settings.get('testMode');
    if (newTestMode !== app.testMode) {
        app.testMode = newTestMode;
        app.logInfo(`Test mode changed to: ${app.testMode ? 'ENABLED' : 'disabled'}`);
        if (app.vacationModeActive) {
            app.logInfo('Rescheduling actions with new test mode...');
            for (const [deviceId, history] of app.deviceHistory.entries()) {
                await app.scheduleNextAction(deviceId, history);
            }
        }
    }
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

exports.getEvents = async function ({ homey }) {
    const app = homey.app;
    const api = await HomeyAPI.createAppAPI({ homey });
    const allDevices = await api.devices.getDevices();
    const allEvents = [];
    for (const [deviceId, events] of app.deviceHistory.entries()) {
        const device = allDevices[deviceId];
        const deviceName = device ? device.name : deviceId;
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

exports.generateTestData = async function ({ homey, body }) {
    const app = homey.app;
    const { deviceId } = body;

    if (!deviceId) {
        throw new Error('No deviceId provided');
    }

    app.logInfo(`Generating test data for device: ${deviceId}`);

    let history = app.deviceHistory.get(deviceId) || [];
    const now = new Date();
    const eventsGenerated = [];

    const switchPatterns = [
        { minutesOffset: -5, value: false },
        { minutesOffset: 0, value: true },
        { minutesOffset: 2, value: false },
        { minutesOffset: 8, value: true },
        { minutesOffset: 15, value: false }
    ];

    switchPatterns.forEach(pattern => {
        const eventDate = new Date(now);
        eventDate.setDate(eventDate.getDate() - 7);
        eventDate.setMinutes(eventDate.getMinutes() + pattern.minutesOffset);
        const randomSeconds = Math.floor(Math.random() * 31);
        eventDate.setSeconds(randomSeconds);
        eventDate.setMilliseconds(0);

        const event = {
            timestamp: eventDate.getTime(),
            value: pattern.value,
            dayOfWeek: eventDate.getDay(),
            hourOfDay: eventDate.getHours(),
            minuteOfHour: eventDate.getMinutes(),
            timeMinutes: eventDate.getHours() * 60 + eventDate.getMinutes()
        };

        history.push(event);
        eventsGenerated.push(event);
    });

    history.sort((a, b) => a.timestamp - b.timestamp);
    app.deviceHistory.set(deviceId, history);
    await app.saveState();

    app.logInfo(`✓ Generated ${eventsGenerated.length} test events for ${deviceId}`);
    app.logInfo(`Events created around: ${new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toLocaleString('nl-NL')}`);
    app.logInfo(`Total history size: ${history.length} events`);

    return { 
        success: true, 
        eventsGenerated: eventsGenerated.length,
        totalEvents: history.length,
        baseTime: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    };
};

exports.getDeviceInsights = async function ({ homey, query }) {
    const app = homey.app;
    const { deviceId } = query;
    
    if (!deviceId) {
        throw new Error('deviceId parameter is required');
    }
    
    try {
        const { HomeyAPI } = require('homey-api');
        const api = await HomeyAPI.createAppAPI({ homey });
        
        const device = await api.devices.getDevice({ id: deviceId });

        // Check of het een groep is
        const isGroup = isDeviceGroup(device);

        app.logInfo(`Device ${deviceId} (${device.name}) is ${isGroup ? 'a GROUP' : 'NOT a group'}`);

        if (isGroup) {
            
            // Check of de groep devices heeft
            if (!device.settings || !device.settings.deviceIds || device.settings.deviceIds.length === 0) {
                return {
                    success: false,
                    error: 'Group has no devices',
                    isGroup: true
                };
            }
            
            // Gebruik het eerste device uit de groep
            const firstDeviceId = device.settings.deviceIds[0];
            app.logInfo(`Using first device from group: ${firstDeviceId}`);
            
            // Recursief aanroepen met het device uit de groep
            return await exports.getDeviceInsights({ homey, query: { deviceId: firstDeviceId } });
        }
        
        // Check of device de onoff capability heeft
        if (!device.capabilitiesObj || !device.capabilitiesObj.onoff) {
            return {
                success: false,
                error: 'Device does not have onoff capability',
                availableCapabilities: Object.keys(device.capabilitiesObj || {})
            };
        }
        
        app.logInfo(`Getting insights for device ${deviceId} (${device.name})`);
        
        const insights = await api.insights.getLogs();
        const insightLogs = Object.values(insights);
        
        app.logInfo(`Found ${insightLogs.length} total insight logs`);
        
        let onoffLog = null;
        for (const log of insightLogs) {
            if (log.ownerUri === device.uri && log.uri.includes(':onoff')) {
                onoffLog = log;
                app.logInfo(`Found matching onoff log: ${log.id}`);
                break;
            }
        }
        
        if (!onoffLog) {
            return {
                success: false,
                error: 'No onoff insights log found for this device',
                deviceUri: device.uri,
                availableLogs: insightLogs
                    .filter(log => log.ownerUri === device.uri)
                    .map(log => ({ id: log.id, uri: log.uri, title: log.title }))
            };
        }
        
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        const entries = await onoffLog.getEntries({
            from: sevenDaysAgo.toISOString(),
            to: now.toISOString(),
            resolution: 'native'
        });

        app.logInfo(`Retrieved ${entries.values ? entries.values.length : 0} insight entries`);
        
        return {
            success: true,
            entries: entries,
            logInfo: {
                id: onoffLog.id,
                uri: onoffLog.uri,
                title: onoffLog.title,
                type: onoffLog.type
            },
            deviceInfo: {
                id: device.id,
                name: device.name,
                uri: device.uri
            }
        };
        
    } catch (error) {
        app.logError(`Error getting insights for ${deviceId}: ${error.message}`);
        app.logError(error.stack);
        return { 
            success: false, 
            error: error.message,
            stack: error.stack
        };
    }
};

exports.importDeviceHistory = async function ({ homey, query }) {
    const app = homey.app;
    const { deviceId } = query;
    
    if (!deviceId) {
        throw new Error('deviceId parameter is required');
    }
    
    try {
        app.logInfo(`Starting import of Insights history for device ${deviceId}`);
        const api = await HomeyAPI.createAppAPI({ homey });
        const device = await api.devices.getDevice({ id: deviceId });
        
        // ✅ DEBUG: Log alle device properties
        app.logInfo(`Device properties: ${JSON.stringify({
            id: device.id,
            name: device.name,
            driverUri: device.driverUri,
            class: device.class,
            virtualClass: device.virtualClass,
            virtual: device.virtual,
            hasSettings: !!device.settings,
            settingsDevices: device.settings ? device.settings.devices : null
        })}`);
        
        // ✅ Check of het een groep is
        const isGroup = device.driverUri && device.driverUri.includes('homey:virtualdrivergroup:driver');
        
        if (isGroup) {
            app.logInfo(`Device ${deviceId} (${device.name}) is a GROUP, getting history from first device`);
            
            // Check of de groep devices heeft
            if (!device.settings || !device.settings.deviceIds || device.settings.deviceIds.length === 0) {
                return {
                    success: false,
                    error: 'Group has no devices to import from',
                    imported: 0
                };
            }
            
            // Gebruik het eerste device uit de groep
            const firstDeviceId = device.settings.deviceIds[0];
            app.logInfo(`Using first device from group: ${firstDeviceId}`);
            
            // Recursief aanroepen met het device uit de groep
            const result = await exports.importDeviceHistory({ homey, query: { deviceId: firstDeviceId } });
            
            // Als succesvol, kopieer de history ook naar de groep zelf
            if (result.success && result.imported > 0) {
                const firstDeviceHistory = app.deviceHistory.get(firstDeviceId);
                if (firstDeviceHistory) {
                    app.deviceHistory.set(deviceId, [...firstDeviceHistory]);
                    await app.saveState();
                    app.logInfo(`Copied ${firstDeviceHistory.length} events to group ${deviceId}`);
                }
            }
            
            return result;
        }
        
        // Haal Insights data op (max 50 entries)
        const insightsResult = await exports.getDeviceInsights({ homey, query: { deviceId } });
        
        if (!insightsResult.success) {
            return {
                success: false,
                error: insightsResult.error,
                imported: 0
            };
        }
        
        if (!insightsResult.entries || !insightsResult.entries.values || insightsResult.entries.values.length === 0) {
            return {
                success: true,
                imported: 0,
                message: 'No entries found in Insights'
            };
        }
        
        // Converteer Insights entries naar lokale event formaat
        const importedEvents = insightsResult.entries.values.map(entry => {
            const date = new Date(entry.t);
            return {
                timestamp: date.getTime(),
                value: entry.v === true || entry.v === 1,
                dayOfWeek: date.getDay(),
                hourOfDay: date.getHours(),
                minuteOfHour: date.getMinutes(),
                timeMinutes: date.getHours() * 60 + date.getMinutes(),
                source: 'insights-import'
            };
        });
        
        // Sorteer op timestamp (oudste eerst)
        importedEvents.sort((a, b) => a.timestamp - b.timestamp);
        
        // Haal bestaande history op
        let history = app.deviceHistory.get(deviceId) || [];
        
        // Check welke events al bestaan
        const existingTimestamps = new Set(history.map(e => e.timestamp));
        
        // Filter alleen nieuwe events
        const newEvents = importedEvents.filter(e => !existingTimestamps.has(e.timestamp));
        
        // Voeg nieuwe events toe
        history.push(...newEvents);
        
        // Sorteer de volledige array
        history.sort((a, b) => a.timestamp - b.timestamp);
        
        // Limiteer totale history size (max 10000 events)
        const MAX_EVENTS = 10000;
        if (history.length > MAX_EVENTS) {
            history = history.slice(-MAX_EVENTS);
        }
        
        // Update de Map
        app.deviceHistory.set(deviceId, history);
        
        // Sla op
        await app.saveState();
        
        const oldestEvent = importedEvents[0];
        const newestEvent = importedEvents[importedEvents.length - 1];
        const timeSpanDays = (newestEvent.timestamp - oldestEvent.timestamp) / (1000 * 60 * 60 * 24);
        
        app.logInfo(`Imported ${newEvents.length} new events (${importedEvents.length - newEvents.length} duplicates skipped)`);
        
        return {
            success: true,
            imported: newEvents.length,
            duplicatesSkipped: importedEvents.length - newEvents.length,
            totalEvents: importedEvents.length,
            timeSpanDays: Math.round(timeSpanDays * 10) / 10,
            oldestDate: new Date(oldestEvent.timestamp).toISOString(),
            newestDate: new Date(newestEvent.timestamp).toISOString()
        };
        
    } catch (error) {
        app.logError(`Error importing Insights history: ${error.message}`);
        return {
            success: false,
            error: error.message,
            imported: 0
        };
    }
};