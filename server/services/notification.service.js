const webpush = require('web-push');
const User = require('../models/User');
const NotificationLog = require('../models/NotificationLog');

// Configure VAPID
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails(
        'mailto:admin@geonotify.com',
        VAPID_PUBLIC,
        VAPID_PRIVATE
    );
} else {
    console.warn('⚠️  VAPID keys not configured. Push notifications disabled.');
}

// Send push notification
function sendPush(subscription, payload) {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return Promise.resolve();

    return webpush.sendNotification(subscription, JSON.stringify(payload))
        .catch(err => console.warn('Push send failed:', err.message));
}

// Notify rescue team about tourist in danger
async function notifyRescueTeam(tourist, geofence, location) {
    try {
        console.log(`🚨 RESCUE ALERT: ${tourist.name} in ${geofence.dangerLevel.toUpperCase()} zone: ${geofence.name}`);

        // Find all active rescue team members
        const rescueTeam = await User.find({ role: 'rescue', isActive: true });

        if (rescueTeam.length === 0) {
            console.warn('⚠️  No rescue team members available');
            return false;
        }

        const alertPayload = {
            title: `🚨 RESCUE ALERT - ${geofence.dangerLevel.toUpperCase()}`,
            body: `Tourist ${tourist.name} detected in ${geofence.name}`,
            data: {
                type: 'rescue_alert',
                touristId: tourist._id,
                touristName: tourist.name,
                touristPhone: tourist.phone || 'N/A',
                touristEmail: tourist.email,
                emergencyContact: tourist.emergencyContact,
                geofenceId: geofence._id,
                geofenceName: geofence.name,
                dangerLevel: geofence.dangerLevel,
                location: location,
                timestamp: new Date().toISOString()
            },
            tag: `rescue-${tourist._id}-${geofence._id}`,
            requireInteraction: true,
            vibrate: [300, 100, 300, 100, 300]
        };

        let notificationsSent = 0;
        for (const rescuer of rescueTeam) {
            const subs = rescuer.pushSubscriptions || [];
            for (const sub of subs) {
                await sendPush(sub, alertPayload);
                notificationsSent++;
            }
        }

        // Log the notification
        await NotificationLog.create({
            userId: tourist._id,
            geofenceId: geofence._id,
            notificationType: 'rescue_alert',
            dangerLevel: geofence.dangerLevel,
            location: location,
            rescueNotified: true,
            message: `Rescue team notified (${notificationsSent} notifications sent)`
        });

        console.log(`✓ Rescue team notified: ${rescueTeam.length} members, ${notificationsSent} notifications sent`);
        return true;
    } catch (err) {
        console.error(' Failed to notify rescue team:', err);
        return false;
    }
}

// Send notification to user
async function notifyUser(user, title, body, data = {}) {
    const payload = {
        title,
        body,
        data,
        tag: data.tag || 'notification',
        requireInteraction: data.requireInteraction || false
    };

    const subs = user.pushSubscriptions || [];
    for (const sub of subs) {
        await sendPush(sub, payload);
    }
}

module.exports = {
    sendPush,
    notifyRescueTeam,
    notifyUser
};