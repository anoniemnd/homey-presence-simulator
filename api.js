'use strict';

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

/**
 * Get all onoff capabilities from a device
 * @param {object} device - The device object to check
 * @returns {Array<string>} Array of onoff capability names (e.g., ['onoff'], ['onoff.output1', 'onoff.output2'])
 */
function getOnOffCapabilities(device) {
    if (!device.capabilitiesObj) {
        return [];
    }

    const onoffCapabilities = [];

    // Check for standard onoff capability
    if (device.capabilitiesObj.onoff) {
        onoffCapabilities.push('onoff');
    }

    // Check for onoff.* sub-capabilities (e.g., onoff.output1, onoff.output2)
    for (const capabilityName in device.capabilitiesObj) {
        if (capabilityName.startsWith('onoff.')) {
            onoffCapabilities.push(capabilityName);
        }
    }

    return onoffCapabilities;
}

/**
 * Create a tracking key for a device and capability
 * @param {string} deviceId - The device ID
 * @param {string} capability - The capability name (e.g., 'onoff', 'onoff.output1')
 * @returns {string} Tracking key (e.g., 'deviceId:onoff.output1')
 */
function createTrackingKey(deviceId, capability) {
    return `${deviceId}:${capability}`;
}

/**
 * Parse a tracking key into deviceId and capability
 * @param {string} trackingKey - The tracking key
 * @returns {{deviceId: string, capability: string}} Parsed components
 */
function parseTrackingKey(trackingKey) {
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

exports.getDevices = async function ({ homey }) {
    const app = homey.app;
    const devices = await app.api.devices.getDevices();
    const zones = await app.api.zones.getZones();

    // Get tracked devices to check for groups
    const trackedDeviceIds = Array.from(app.trackedDevices.keys());
    const devicesInTrackedGroups = new Set();

    // Find all devices that are part of tracked groups
    for (const trackingKey of trackedDeviceIds) {
        const { deviceId } = parseTrackingKey(trackingKey);
        const device = devices[deviceId];
        if (device && isDeviceGroup(device)) {
            // This is a tracked group, add all its member devices to the exclusion set
            if (device.settings && device.settings.deviceIds && Array.isArray(device.settings.deviceIds)) {
                device.settings.deviceIds.forEach(id => devicesInTrackedGroups.add(id));
            }
        }
    }

    const devicesArray = [];

    for (const device of Object.values(devices)) {
        // Skip devices that are part of a tracked group
        const isPartOfTrackedGroup = devicesInTrackedGroups.has(device.id);
        if (isPartOfTrackedGroup) {
            continue;
        }

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

        // Skip devices that are not light/socket and not valid groups
        if (!isLightOrSocket && !isValidGroup) {
            continue;
        }

        // Get all onoff capabilities
        const onoffCapabilities = getOnOffCapabilities(device);

        if (onoffCapabilities.length === 0) {
            continue;
        }

        // Get zone info
        let zoneName = 'No zone';
        let zoneId = null;
        if (device.zone && zones[device.zone]) {
            zoneName = zones[device.zone].name;
            zoneId = device.zone;
        } else if (device.zoneName) {
            zoneName = device.zoneName;
        }

        // Create an entry for each onoff capability
        for (const capability of onoffCapabilities) {
            const trackingKey = createTrackingKey(device.id, capability);

            // Create a display name
            let displayName = device.name;
            if (onoffCapabilities.length > 1) {
                // Multi-channel device, add suffix
                const capabilityTitle = device.capabilitiesObj[capability].title || capability;
                displayName = `${device.name} - ${capabilityTitle}`;
            }

            devicesArray.push({
                id: trackingKey,  // Use tracking key as ID
                deviceId: device.id,  // Original device ID
                capability: capability,  // The specific capability
                name: displayName,
                zoneName: zoneName,
                zoneId: zoneId,
                capabilitiesObj: device.capabilitiesObj
            });
        }
    }

    // Sort by zone and name
    devicesArray.sort((a, b) => {
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
    const { deviceId: trackingKey } = body;  // This is actually a tracking key now

    // Parse the tracking key
    const { deviceId, capability } = parseTrackingKey(trackingKey);

    // Check if this is a group and if any of its member devices are already tracked
    const device = await app.api.devices.getDevice({ id: deviceId });

    const removedDevices = [];

    const isGroup = isDeviceGroup(device);
    app.logInfo(`trackDevice: ${device.name} (${trackingKey}) - isGroup: ${isGroup}`);

    if (isGroup) {
        app.logInfo(`Device settings: ${JSON.stringify(device.settings)}`);
        app.logInfo(`Has deviceIds: ${device.settings && device.settings.deviceIds ? device.settings.deviceIds.length : 'NO'}`);

        // This is a group, check if any member devices are tracked
        if (device.settings && device.settings.deviceIds && Array.isArray(device.settings.deviceIds)) {
            app.logInfo(`Checking ${device.settings.deviceIds.length} member devices`);

            for (const memberDeviceId of device.settings.deviceIds) {
                // Check if any tracking key for this member device exists
                const trackedKeys = Array.from(app.trackedDevices.keys()).filter(key => {
                    const parsed = parseTrackingKey(key);
                    return parsed.deviceId === memberDeviceId;
                });

                for (const memberTrackingKey of trackedKeys) {
                    const memberDevice = app.trackedDevices.get(memberTrackingKey);
                    await app.stopTrackingDevice(memberTrackingKey);
                    removedDevices.push({
                        id: memberTrackingKey,
                        name: memberDevice.name
                    });
                    app.logInfo(`Auto-removed tracked device ${memberDevice.name} (${memberTrackingKey}) because its group is now being tracked`);
                }
            }
        } else {
            app.logInfo(`Group has no deviceIds in settings`);
        }
    }

    await app.startTrackingDevice(trackingKey, capability);

    return {
        success: true,
        removedDevices: removedDevices
    };
};

exports.untrackDevice = async function ({ homey, body }) {
    const app = homey.app;
    const { deviceId: trackingKey } = body;  // This is actually a tracking key now
    await app.stopTrackingDevice(trackingKey);
    return { success: true };
};

exports.clearHistory = async function ({ homey, body }) {
    const app = homey.app;
    const { deviceId: trackingKey } = body;  // This is actually a tracking key now

    if (!trackingKey) {
        throw new Error('deviceId parameter is required');
    }

    // Clear history in app memory
    if (app.deviceHistory.has(trackingKey)) {
        app.deviceHistory.delete(trackingKey);
        app.log(`History cleared for device ${trackingKey}`);
    }

    // Remove device history from storage
    await app.removeDeviceHistory(trackingKey);

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
    const allDevices = await app.api.devices.getDevices();
    const allEvents = [];
    for (const [trackingKey, events] of app.deviceHistory.entries()) {
        const { deviceId, capability } = parseTrackingKey(trackingKey);
        const device = allDevices[deviceId];

        // Create display name
        let deviceName = trackingKey;  // Fallback
        if (device) {
            deviceName = device.name;
            // If this is a multi-channel device, add capability title
            const onoffCapabilities = getOnOffCapabilities(device);
            if (onoffCapabilities.length > 1) {
                const capabilityTitle = device.capabilitiesObj[capability]?.title || capability;
                deviceName = `${device.name} - ${capabilityTitle}`;
            }
        }

        events.forEach(event => {
            allEvents.push({
                ...event,
                deviceId: trackingKey,
                deviceName: deviceName
            });
        });
    }
    return { events: allEvents };
};

exports.generateTestData = async function ({ homey, body }) {
    const app = homey.app;
    const { deviceId: trackingKey } = body;  // This is actually a tracking key now

    if (!trackingKey) {
        throw new Error('No deviceId provided');
    }

    app.logInfo(`Generating test data for device: ${trackingKey}`);

    let history = app.deviceHistory.get(trackingKey) || [];
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
    app.deviceHistory.set(trackingKey, history);
    await app.saveDeviceHistory(trackingKey);

    app.logInfo(`✓ Generated ${eventsGenerated.length} test events for ${trackingKey}`);
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
    const { deviceId: trackingKey } = query;  // This is actually a tracking key now

    if (!trackingKey) {
        throw new Error('deviceId parameter is required');
    }

    try {
        const { deviceId, capability } = parseTrackingKey(trackingKey);
        const device = await app.api.devices.getDevice({ id: deviceId });

        // Check of het een groep is
        const isGroup = isDeviceGroup(device);

        app.logInfo(`Device ${trackingKey} (${device.name}) is ${isGroup ? 'a GROUP' : 'NOT a group'}`);

        if (isGroup) {

            // Check of de groep devices heeft
            if (!device.settings || !device.settings.deviceIds || device.settings.deviceIds.length === 0) {
                return {
                    success: false,
                    error: 'Group has no devices',
                    isGroup: true
                };
            }

            // Gebruik het eerste device uit de groep met de capability
            const firstDeviceId = device.settings.deviceIds[0];
            const firstDeviceTrackingKey = createTrackingKey(firstDeviceId, capability);
            app.logInfo(`Using first device from group: ${firstDeviceTrackingKey}`);

            // Recursief aanroepen met het device uit de groep
            return await exports.getDeviceInsights({ homey, query: { deviceId: firstDeviceTrackingKey } });
        }

        // Check of device de capability heeft
        if (!device.capabilitiesObj || !device.capabilitiesObj[capability]) {
            return {
                success: false,
                error: `Device does not have ${capability} capability`,
                availableCapabilities: Object.keys(device.capabilitiesObj || {})
            };
        }

        app.logInfo(`Getting insights for device ${trackingKey} (${device.name}) capability ${capability}`);

        const insights = await app.api.insights.getLogs();
        const insightLogs = Object.values(insights);

        app.logInfo(`Found ${insightLogs.length} total insight logs`);

        let onoffLog = null;
        for (const log of insightLogs) {
            // Match the specific capability (e.g., :onoff.output1)
            if (log.ownerUri === device.uri && log.uri.includes(`:${capability}`)) {
                onoffLog = log;
                app.logInfo(`Found matching log for ${capability}: ${log.id}`);
                break;
            }
        }
        
        if (!onoffLog) {
            return {
                success: false,
                error: `No ${capability} insights log found for this device`,
                deviceUri: device.uri,
                capability: capability,
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
    const { deviceId: trackingKey } = query;  // This is actually a tracking key now

    if (!trackingKey) {
        throw new Error('deviceId parameter is required');
    }

    try {
        app.logInfo(`Starting import of Insights history for device ${trackingKey}`);
        const { deviceId, capability } = parseTrackingKey(trackingKey);
        const device = await app.api.devices.getDevice({ id: deviceId });

        // ✅ DEBUG: Log alle device properties
        app.logInfo(`Device properties: ${JSON.stringify({
            id: device.id,
            name: device.name,
            capability: capability,
            driverUri: device.driverUri,
            class: device.class,
            virtualClass: device.virtualClass,
            virtual: device.virtual,
            hasSettings: !!device.settings,
            settingsDevices: device.settings ? device.settings.devices : null
        })}`);

        // ✅ Check of het een groep is
        const isGroup = isDeviceGroup(device);

        if (isGroup) {
            app.logInfo(`Device ${trackingKey} (${device.name}) is a GROUP, getting history from first device`);

            // Check of de groep devices heeft
            if (!device.settings || !device.settings.deviceIds || device.settings.deviceIds.length === 0) {
                return {
                    success: false,
                    error: 'Group has no devices to import from',
                    imported: 0
                };
            }

            // Gebruik het eerste device uit de groep met de capability
            const firstDeviceId = device.settings.deviceIds[0];
            const firstDeviceTrackingKey = createTrackingKey(firstDeviceId, capability);
            app.logInfo(`Using first device from group: ${firstDeviceTrackingKey}`);

            // Recursief aanroepen met het device uit de groep
            const result = await exports.importDeviceHistory({ homey, query: { deviceId: firstDeviceTrackingKey } });

            // Als succesvol, kopieer de history ook naar de groep zelf
            if (result.success && result.imported > 0) {
                const firstDeviceHistory = app.deviceHistory.get(firstDeviceTrackingKey);
                if (firstDeviceHistory) {
                    app.deviceHistory.set(trackingKey, [...firstDeviceHistory]);
                    app.logInfo(`Copied ${firstDeviceHistory.length} events to group ${trackingKey}`);
                    // Save will happen below, no need to save twice
                }
            }

            // Save the group's history once (either copied or empty)
            await app.saveDeviceHistory(trackingKey);

            return result;
        }

        // Haal Insights data op (max 50 entries)
        const insightsResult = await exports.getDeviceInsights({ homey, query: { deviceId: trackingKey } });
        
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
        let history = app.deviceHistory.get(trackingKey) || [];

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
        app.deviceHistory.set(trackingKey, history);

        // Save only this device's history
        await app.saveDeviceHistory(trackingKey);
        
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