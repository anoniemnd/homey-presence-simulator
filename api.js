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
    await app.startTrackingDevice(deviceId);
    return { success: true };
};

exports.untrackDevice = async function ({ homey, body }) {
    const app = homey.app;
    const { deviceId } = body;
    await app.stopTrackingDevice(deviceId);
    return { success: true };
};

exports.clearHistory = async function ({ homey }) {
    const app = homey.app;
    app.deviceHistory.clear();
    await app.saveState();
    app.log('History cleared via settings');
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

exports.testLog = async function ({ homey }) {
    const app = homey.app;
    app.logInfo('🔥 TEST LOG MESSAGE 🔥');
    app.logInfo('This is a test to see if logging works');
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

// NIEUW: Genereer testdata voor een specifiek device
exports.generateTestData = async function ({ homey, body }) {
    const app = homey.app;
    const { deviceId } = body;

    if (!deviceId) {
        throw new Error('No deviceId provided');
    }

    app.logInfo(`Generating test data for device: ${deviceId}`);

    // Haal huidige history op (of maak nieuwe aan)
    let history = app.deviceHistory.get(deviceId) || [];

    // Gebruik het HUIDIGE tijdstip als basis
    const now = new Date();
    const eventsGenerated = [];

    // Genereer een realistisch schakelpatroon (3-5 schakelmomenten)
    // Bijvoorbeeld: lamp gaat aan, kort later uit, later weer aan, en uiteindelijk uit
    const switchPatterns = [
        { minutesOffset: -5, value: false },  // 5 min geleden: lamp was uit
        { minutesOffset: 0, value: true },    // Nu: lamp gaat aan
        { minutesOffset: 2, value: false },   // 2 min later: lamp gaat uit
        { minutesOffset: 8, value: true },    // 8 min later: lamp gaat weer aan
        { minutesOffset: 15, value: false }   // 15 min later: lamp gaat uit
    ];

    // Genereer events voor exact EEN WEEK GELEDEN
    switchPatterns.forEach(pattern => {
        const eventDate = new Date(now);
        
        // Ga 7 dagen terug
        eventDate.setDate(eventDate.getDate() - 7);
        
        // Voeg de minuten offset toe
        eventDate.setMinutes(eventDate.getMinutes() + pattern.minutesOffset);
        
        // Voeg een kleine random variatie toe (0-30 seconden)
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

    // Sorteer op timestamp
    history.sort((a, b) => a.timestamp - b.timestamp);

    // Bewaar in deviceHistory
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

// // NIEUW: Genereer testdata voor een specifiek device
// exports.generateTestData = async function ({ homey, body }) {
//     const app = homey.app;
//     const { deviceId } = body;
    
//     if (!deviceId) {
//         throw new Error('No deviceId provided');
//     }
    
//     app.logInfo(`Generating test data for device: ${deviceId}`);
    
//     // Haal huidige history op (of maak nieuwe aan)
//     let history = app.deviceHistory.get(deviceId) || [];
    
//     // Genereer data voor de afgelopen 7 dagen
//     const now = new Date();
//     const eventsGenerated = [];
    
//     // Patronen per dag (realistische lamp timings)
//     const patterns = [
//         // Ochtend (7:00-9:00)
//         { hour: 7, minute: 15, value: true },
//         { hour: 8, minute: 45, value: false },
        
//         // Middag/avond (17:00-23:00)
//         { hour: 17, minute: 30, value: true },
//         { hour: 19, minute: 15, value: false },
//         { hour: 20, minute: 0, value: true },
//         { hour: 22, minute: 30, value: false },
//         { hour: 23, minute: 15, value: false }, // Extra off voor zekerheid
//     ];
    
//     // Genereer voor elke dag van de afgelopen week
//     for (let daysAgo = 7; daysAgo >= 0; daysAgo--) {
//         const date = new Date(now);
//         date.setDate(date.getDate() - daysAgo);
        
//         // Voor elke dag, genereer events volgens pattern
//         patterns.forEach(pattern => {
//             const eventDate = new Date(date);
//             eventDate.setHours(pattern.hour, pattern.minute, 0, 0);
            
//             const event = {
//                 timestamp: eventDate.getTime(),
//                 value: pattern.value,
//                 dayOfWeek: eventDate.getDay(),
//                 hourOfDay: eventDate.getHours(),
//                 minuteOfHour: eventDate.getMinutes(),
//                 timeMinutes: eventDate.getHours() * 60 + eventDate.getMinutes()
//             };
            
//             history.push(event);
//             eventsGenerated.push(event);
//         });
//     }
    
//     // Sorteer op timestamp
//     history.sort((a, b) => a.timestamp - b.timestamp);
    
//     // Bewaar in deviceHistory
//     app.deviceHistory.set(deviceId, history);
//     await app.saveState();
    
//     app.logInfo(`✓ Generated ${eventsGenerated.length} test events for ${deviceId}`);
//     app.logInfo(`Total history size: ${history.length} events`);
    
//     return { 
//         success: true, 
//         eventsGenerated: eventsGenerated.length,
//         totalEvents: history.length
//     };
// };