const turf = require('@turf/turf');
const Geofence = require('../models/Geofence');
const NotificationLog = require('../models/NotificationLog');
const { notifyRescueTeam, notifyUser } = require('./notification.service');

// Check location against all geofences
async function checkLocation(lat, lng, user) {
    const point = turf.point([lng, lat]);
    const fences = await Geofence.find().lean();

    const inside = [];
    const near = [];

    // Check each geofence
    for (const f of fences) {
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
        const thresholdMeters = f.nearMeters || 100;

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
        // Notify user
        await notifyUser(user,
            `🚨 Entered ${f.dangerLevel.toUpperCase()} Zone`,
            `${f.name}: ${f.reminder || 'Stay alert!'}`,
            {
                type: 'entered',
                dangerLevel: f.dangerLevel,
                geofenceId: f._id,
                tag: `enter-${f._id}`,
                requireInteraction: ['danger', 'critical'].includes(f.dangerLevel)
            }
        );

        // Log notification
        await NotificationLog.create({
            userId: user._id,
            geofenceId: f._id,
            notificationType: 'entered',
            dangerLevel: f.dangerLevel,
            location: location,
            userNotified: true,
            message: `User entered ${f.name}`
        });

        // Notify rescue team if danger/critical zone
        if (f.autoNotifyRescue && ['danger', 'critical'].includes(f.dangerLevel)) {
            await notifyRescueTeam(user, f, location);
        }
    }
}

// Handle near geofence notifications
async function handleNear(user, subscribedNear, location) {
    for (const f of subscribedNear) {
        await notifyUser(user,
            `⚠️ Approaching ${f.dangerLevel.toUpperCase()} Zone`,
            `${f.name} is ${Math.round(f.distanceMeters)} meters away`,
            {
                type: 'near',
                dangerLevel: f.dangerLevel,
                distance: f.distanceMeters,
                tag: `near-${f._id}`
            }
        );

        await NotificationLog.create({
            userId: user._id,
            geofenceId: f._id,
            notificationType: 'near',
            dangerLevel: f.dangerLevel,
            location: location,
            userNotified: true,
            message: `User near ${f.name} (${Math.round(f.distanceMeters)}m)`
        });
    }
}

// Handle exited geofence notifications
async function handleExited(user, exited, location) {
    for (const f of exited) {
        await notifyUser(user,
            ` Exited ${f.name}`,
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
        if (f.autoNotifyRescue && ['danger', 'critical'].includes(f.dangerLevel)) {
            // Check if we haven't sent alert recently (5 min cooldown)
            const recentAlert = await NotificationLog.findOne({
                userId: user._id,
                geofenceId: f._id,
                notificationType: 'rescue_alert',
                timestamp: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
            });

            if (!recentAlert) {
                await notifyRescueTeam(user, f, location);
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
