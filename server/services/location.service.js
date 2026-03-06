const turf = require('@turf/turf');
const Geofence = require('../models/Geofence');
const NotificationLog = require('../models/NotificationLog');
const { notifyRescueTeam, notifyUser } = require('./notification.service');
const { getSimulatedWeather, adjustDangerLevelByWeather } = require('./weather.service');

// Helper to get effective danger level based on time rules
function getEffectiveDangerLevel(f) {
    if (!f.timeRules || f.timeRules.length === 0) return f.dangerLevel;

    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' +
        now.getMinutes().toString().padStart(2, '0');

    for (const rule of f.timeRules) {
        if (rule.startTime <= rule.endTime) {
            // Normal range (e.g., 08:00 to 17:00)
            if (currentTime >= rule.startTime && currentTime <= rule.endTime) {
                return rule.dangerLevel;
            }
        } else {
            // Over-midnight range (e.g., 22:00 to 04:00)
            if (currentTime >= rule.startTime || currentTime <= rule.endTime) {
                return rule.dangerLevel;
            }
        }
    }

    return f.dangerLevel;
}

// Check location against all geofences
async function checkLocation(lat, lng, user) {
    const point = turf.point([lng, lat]);
    const fences = await Geofence.find().lean();

    const inside = [];
    const near = [];

    // Calculate user speed to dynamically adjust warning distance
    let speedMs = 0;
    if (user.currentLocation && user.currentLocation.timestamp) {
        const lastLat = user.currentLocation.lat;
        const lastLng = user.currentLocation.lng;
        const lastTime = user.currentLocation.timestamp.getTime();
        const nowTime = Date.now();
        
        const timeDiffSec = (nowTime - lastTime) / 1000;
        
        // Calculate speed if the last location was within the last 5 minutes
        if (timeDiffSec > 0 && timeDiffSec < 300) {
            const dist = turf.distance(
                turf.point([lastLng, lastLat]), 
                point, 
                { units: 'meters' }
            );
            speedMs = dist / timeDiffSec;
            console.log(`User speed: ${speedMs.toFixed(2)} m/s`);
        }
    }

    // Dynamic proximity threshold adjustment multiplier
    let speedMultiplier = 1;
    if (speedMs > 3) { 
        // If moving faster than ~10 km/h, increase nearMeters threshold. 
        // E.g., at 13 m/s (~45 km/h), multiplier becomes 3x. Max 5x.
        speedMultiplier = 1 + (speedMs - 3) * 0.2;
        if (speedMultiplier > 5) speedMultiplier = 5;
    }

    // Check each geofence
    for (const f of fences) {
        // Calculate effective danger level
        let baseLevel = getEffectiveDangerLevel(f);
        f.weather = getSimulatedWeather(f);
        f.effectiveDangerLevel = adjustDangerLevelByWeather(baseLevel, f.weather);

        let coords = f.coordinates.slice();
        const first = coords[0], last = coords[coords.length - 1];

        if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
            coords.push(first);
        }

        const poly = turf.polygon([coords]);
        const inPoly = turf.booleanPointInPolygon(point, poly);

        if (inPoly) {
            inside.push(f);
            continue;
        }

        // Check if near
        const line = turf.lineString(coords);
        const distMeters = turf.pointToLineDistance(point, line, { units: 'meters' });
        // Apply dynamic speed multiplier
        const thresholdMeters = (f.nearMeters || 100) * speedMultiplier;

        if (distMeters <= thresholdMeters) {
            near.push({ ...f, distanceMeters: distMeters });
        }
    }

    // Update user's current location
    user.currentLocation = { lat, lng, timestamp: new Date() };

    const subscribed = (user.subscribedGeofences || []).map(x => x.toString());
    const insideIds = inside.map(f => f._id.toString());
    const prevIds = (user.lastInside || []).map(x => x.toString());

    const subscribedInside = inside.filter(f => subscribed.includes(f._id.toString()));
    const subscribedNear = near.filter(f => subscribed.includes(f._id.toString()));

    const entered = subscribedInside.filter(f => !prevIds.includes(f._id.toString()));
    const exited = prevIds
        .filter(id => !insideIds.includes(id))
        .map(id => fences.find(f => f._id.toString() === id))
        .filter(f => f && subscribed.includes(f._id.toString()));

    return { inside, subscribedInside, subscribedNear, entered, exited, fences };
}

// Handle entered geofence notifications
async function handleEntered(user, entered, location) {
    for (const f of entered) {
        const dLevel = f.effectiveDangerLevel || f.dangerLevel;
        const weatherText = f.weather && f.weather !== 'Clear' ? ` (Weather: ${f.weather})` : '';
        // Notify user
        await notifyUser(user,
            `Entered ${dLevel.toUpperCase()} Zone${weatherText}`,
            `${f.name}: ${f.reminder || 'Stay alert!'}`,
            {
                type: 'entered',
                dangerLevel: dLevel,
                weather: f.weather || 'Clear',
                geofenceId: f._id,
                tag: `enter-${f._id}`,
                requireInteraction: ['danger', 'critical'].includes(dLevel)
            }
        );

        // Log notification
        await NotificationLog.create({
            userId: user._id,
            geofenceId: f._id,
            notificationType: 'entered',
            dangerLevel: dLevel,
            location: location,
            userNotified: true,
            message: `User entered ${f.name} (Effective Level: ${dLevel}, Weather: ${f.weather || 'Clear'})`
        });

        // Notify rescue team if danger/critical zone
        if (['danger', 'critical'].includes(dLevel)) {
            await notifyRescueTeam(user, f, location);
        }
    }
}

// Handle near geofence notifications
async function handleNear(user, subscribedNear, location) {
    for (const f of subscribedNear) {
        const dLevel = f.effectiveDangerLevel || f.dangerLevel;
        const weatherText = f.weather && f.weather !== 'Clear' ? ` (Weather: ${f.weather})` : '';
        await notifyUser(user,
            `⚠️ Approaching ${dLevel.toUpperCase()} Zone${weatherText}`,
            `${f.name} is ${Math.round(f.distanceMeters)} meters away`,
            {
                type: 'near',
                dangerLevel: dLevel,
                distance: f.distanceMeters,
                weather: f.weather || 'Clear',
                tag: `near-${f._id}`
            }
        );

        await NotificationLog.create({
            userId: user._id,
            geofenceId: f._id,
            notificationType: 'near',
            dangerLevel: dLevel,
            location: location,
            userNotified: true,
            message: `User near ${f.name} (${Math.round(f.distanceMeters)}m, Effective Level: ${dLevel}, Weather: ${f.weather || 'Clear'})`
        });
    }
}

// Handle exited geofence notifications
async function handleExited(user, exited, location) {
    for (const f of exited) {
        await notifyUser(user,
            `✅ Exited ${f.name}`,
            f.reminder || 'You have left the area',
            { type: 'exited', tag: `exit-${f._id}` }
        );

        await NotificationLog.create({
            userId: user._id,
            geofenceId: f._id,
            notificationType: 'exited',
            location: location,
            userNotified: true,
            message: `User exited ${f.name}`
        });
    }
}

// Check for periodic alerts for users in danger zones
async function checkPeriodicAlerts(user, subscribedInside, location) {
    for (const f of subscribedInside) {
        const dLevel = f.effectiveDangerLevel || f.dangerLevel;
        if (['danger', 'critical'].includes(dLevel)) {
            // Check if we haven't sent alert recently (5 min cooldown)
            const recentAlert = await NotificationLog.findOne({
                userId: user._id,
                geofenceId: f._id,
                notificationType: 'rescue_alert',
                timestamp: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
            });

            if (!recentAlert) {
                await notifyRescueTeam(user, { ...f, dangerLevel: dLevel }, location);
            }
        }
    }
}

module.exports = {
    checkLocation,
    handleEntered,
    handleNear,
    handleExited,
    checkPeriodicAlerts
};
