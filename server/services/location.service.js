const turf = require('@turf/turf');
const Geofence = require('../models/Geofence');
const NotificationLog = require('../models/NotificationLog');
const { notifyRescueTeam, notifyUser } = require('./notification.service');
const { getWeatherForGeofence, adjustDangerLevelByWeather } = require('./weather.service');

// Movement sanity limits to reduce false alerts from GPS glitches.
const MAX_REALISTIC_SPEED_MS = 120; // ~432 km/h
const MIN_JUMP_DISTANCE_METERS = 300;
const SPEED_FOR_THRESHOLD_CAP_MS = 30;
const parsedAiAdviceTriggerMeters = Number(process.env.AI_ADVICE_TRIGGER_METERS);
const AI_ADVICE_TRIGGER_METERS = Number.isFinite(parsedAiAdviceTriggerMeters) && parsedAiAdviceTriggerMeters > 0
    ? parsedAiAdviceTriggerMeters
    : 50;

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

async function calculateEffectiveLevel(f) {
    let baseLevel = getEffectiveDangerLevel(f);
    let weather = await getWeatherForGeofence(f);
    return adjustDangerLevelByWeather(baseLevel, weather);
}

// Check location against all geofences

async function checkLocation(lat, lng, user, options = {}) {
    const point = turf.point([lng, lat]);
    const fences = await Geofence.find().lean();
    const isSimulation = !!options.simulation;

    const inside = [];
    const near = [];
    let ignoredUpdate = false;
    let anomalyDetails = null;
    let evalPoint = point;

    // Calculate user speed to dynamically adjust warning distance
    let speedMs = 0;
    if (!isSimulation && user.currentLocation && user.currentLocation.timestamp) {
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

            if (speedMs > MAX_REALISTIC_SPEED_MS && dist >= MIN_JUMP_DISTANCE_METERS) {
                ignoredUpdate = true;
                evalPoint = turf.point([lastLng, lastLat]);
                anomalyDetails = {
                    reason: 'implausible_jump',
                    speedMs,
                    distanceMeters: dist,
                    timeDiffSec
                };
                console.warn(
                    `[LOCATION] Ignoring implausible jump for ${user.name || user._id}: ` +
                    `${(dist / 1000).toFixed(2)} km in ${timeDiffSec.toFixed(1)} s ` +
                    `(${speedMs.toFixed(2)} m/s)`
                );
            }
        }
    }

    // Dynamic proximity threshold adjustment multiplier
    let speedMultiplier = 1;
    if (!isSimulation && !ignoredUpdate && speedMs > 3) { 
        // If moving faster than ~10 km/h, increase nearMeters threshold. 
        // E.g., at 13 m/s (~45 km/h), multiplier becomes 3x. Max 5x.
        const speedForThreshold = Math.min(speedMs, SPEED_FOR_THRESHOLD_CAP_MS);
        speedMultiplier = 1 + (speedForThreshold - 3) * 0.2;
        if (speedMultiplier > 5) speedMultiplier = 5;
    }

    // Check each geofence
    for (const f of fences) {
        // Calculate effective danger level
        let baseLevel = getEffectiveDangerLevel(f);
        const weatherObj = await getWeatherForGeofence(f);
        // preserve backwards-compatible `f.weather` as a short state string
        f.weather = (weatherObj && weatherObj.state) || weatherObj || 'Clear';
        // attach full details for downstream consumers
        f.weatherDetails = weatherObj || null;
        f.effectiveDangerLevel = adjustDangerLevelByWeather(baseLevel, weatherObj || f.weather);

        let coords = f.coordinates.slice();
        const first = coords[0], last = coords[coords.length - 1];

        if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
            coords.push(first);
        }

        const poly = turf.polygon([coords]);
        const inPoly = turf.booleanPointInPolygon(evalPoint, poly);

        if (inPoly) {
            inside.push(f);
            continue;
        }

        // Check if near
        const line = turf.lineString(coords);
        const distMeters = turf.pointToLineDistance(evalPoint, line, { units: 'meters' });
        // Apply dynamic speed multiplier
        const thresholdMeters = (f.nearMeters || 100) * speedMultiplier;

        if (distMeters <= thresholdMeters) {
            near.push({ ...f, distanceMeters: distMeters });
        }
    }

    const insideIds = inside.map(f => f._id.toString());
    const nearIds = near.map(f => f._id.toString());
    const prevInsideIds = (user.lastInside || []).map(x => x.toString());
    const prevNearIds = (user.lastNear || []).map(x => x.toString());

    const entered = inside.filter(f => !prevInsideIds.includes(f._id.toString()));
    const exited = prevInsideIds
        .filter(id => !insideIds.includes(id))
        .map(id => fences.find(f => f._id.toString() === id))
        .filter(Boolean);

    // Track when user enters near threshold
    const enteredNear = near.filter(f => !prevNearIds.includes(f._id.toString()));

    // Track when user crosses into "very close" danger range for AI advice.
    const prevCloseDangerNearIds = (user.lastCloseDangerNear || []).map(x => x.toString());
    const closeDangerNear = near.filter((f) => {
        const dangerLevel = (f.effectiveDangerLevel || f.dangerLevel || '').toLowerCase();
        return ['danger', 'critical'].includes(dangerLevel) &&
            typeof f.distanceMeters === 'number' &&
            f.distanceMeters < AI_ADVICE_TRIGGER_METERS;
    });
    const closeDangerNearIds = closeDangerNear.map(f => f._id.toString());
    const enteredCloseDangerNear = closeDangerNear
        .filter(f => !prevCloseDangerNearIds.includes(f._id.toString()));

    return {
        inside,
        near,
        entered,
        exited,
        enteredNear,
        enteredCloseDangerNear,
        closeDangerNearIds,
        fences,
        ignoredUpdate,
        anomalyDetails
    };
}

// Handle entered geofence notifications
async function handleEntered(user, entered, location) {
    for (const f of entered) {
        const dLevel = f.effectiveDangerLevel || f.dangerLevel;
        const weatherText = f.weather && f.weather !== 'Clear' ? ` (Weather: ${f.weather})` : '';
        // Notify user
        await notifyUser(user,
            `Entered ${dLevel.toUpperCase()} Zone${weatherText}`,
            `${f.name}: ${f.description || 'Stay alert!'}`,
            {
                type: 'entered',
                dangerLevel: dLevel,
                weather: f.weather || 'Clear',
                geofenceId: f._id,
                geofenceName: f.name,
                geofenceDescription: f.description || '',
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
async function handleNear(user, near, location) {

    for (const f of near) {

        const dLevel = f.effectiveDangerLevel || f.dangerLevel;
        const weatherText = f.weather && f.weather !== 'Clear'
            ? ` (Weather: ${f.weather})`
            : '';
        const { generateSafetyAdvice } = require('./openrouter.service');

        const normalizedDangerLevel = (dLevel || '').toLowerCase();
        const shouldGenerateAiAdvice = ['danger', 'critical'].includes(normalizedDangerLevel) &&
            typeof f.distanceMeters === 'number' &&
            f.distanceMeters < AI_ADVICE_TRIGGER_METERS;

        // AI CONTEXT
        const aiContext = {
            geofenceName: f.name,
            baseDangerLevel: f.dangerLevel,
            effectiveDangerLevel: dLevel,
            weather: f.weatherDetails || { state: f.weather || 'Clear' },
            hour: new Date().getHours(),
            incidentCount: 0,
            hotspotsOccurred: false,
            touristDistance: Math.round(f.distanceMeters),
            threshold: f.nearMeters || 100,
            touristEnteredTime: user.nearEntryTimes?.get?.(f._id?.toString?.() || String(f._id)) || user.currentLocation?.timestamp,
            timeRules: f.timeRules || []
        };

        // CALL AI
        let aiAdvice = null;

        if (shouldGenerateAiAdvice) {
            try {
                aiAdvice = await generateSafetyAdvice(aiContext);
            } catch (err) {
                console.log("AI failed, using fallback");
            }
        }

        const adviceText =
            aiAdvice?.recommendation ||
            f.description ||
            "Be careful.";

        // SEND USER NOTIFICATION
        await notifyUser(
            user,
            `⚠️ Approaching ${dLevel.toUpperCase()} Zone${weatherText}`,
            `${f.name} is ${Math.round(f.distanceMeters)}m away. ${adviceText}`,
            {
                type: 'near',
                dangerLevel: dLevel,
                distance: f.distanceMeters,
                weather: f.weather || 'Clear',
                geofenceId: f._id,
                geofenceName: f.name,
                geofenceDescription: f.description || '',
                tag: `near-${f._id}`
            }
        );

        // SAVE LOG
        await NotificationLog.create({
            userId: user._id,
            geofenceId: f._id,
            notificationType: 'near',
            dangerLevel: dLevel,
            location: location,
            userNotified: true,
            message: `User near ${f.name} is ${Math.round(f.distanceMeters)}m away. ${adviceText}`
        });

        // Notify rescue if danger
        if (['danger', 'critical'].includes(normalizedDangerLevel)) {
            await notifyRescueTeam(
                user,
                { ...f, isNear: true, distance: Math.round(f.distanceMeters) },
                location
            );
        }
    }
}

        

// Handle exited geofence notifications
async function handleExited(user, exited, location) {
    for (const f of exited) {
        await notifyUser(user,
            `✅ Exited ${f.name}`,
            f.description || 'You have left the area',
            {
                type: 'exited',
                geofenceId: f._id,
                geofenceName: f.name,
                geofenceDescription: f.description || '',
                tag: `exit-${f._id}`
            }
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
async function checkPeriodicAlerts(user, inside, location) {
    for (const f of inside) {
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
    checkPeriodicAlerts,
    calculateEffectiveLevel,
    getEffectiveDangerLevel
};
