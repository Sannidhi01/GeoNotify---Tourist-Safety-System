const webpush = require('web-push');
const https = require('https');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const User = require('../models/User');
const NotificationLog = require('../models/NotificationLog');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '../../serviceAccountKey.json');
let firebaseMessagingReady = false;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails(
        'mailto:admin@geonotify.com',
        VAPID_PUBLIC,
        VAPID_PRIVATE
    );
} else {
    console.warn('VAPID keys not configured. Web Push notifications disabled.');
}

function initFirebaseAdmin() {
    if (firebaseMessagingReady) return true;

    if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
        console.warn('Firebase serviceAccountKey.json not found at project root. FCM disabled.');
        return false;
    }

    if (!admin.apps.length) {
        const serviceAccount = require(SERVICE_ACCOUNT_PATH);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }

    firebaseMessagingReady = true;
    return true;
}

function normalizeList(values) {
    return [...new Set((values || []).filter(Boolean))];
}

function buildSmsMessage(title, body) {
    const text = `${title}\n${body}`.trim();
    return text.length > 1500 ? `${text.slice(0, 1497)}...` : text;
}

function buildEmergencyContactSmsMessage(user, payload) {
    const data = payload?.data || {};
    const touristName = user?.name || 'The tourist';
    const geofenceName = data.geofenceName || 'this zone';
    const description = data.geofenceDescription || '';
    const dangerLevel = data.dangerLevel ? String(data.dangerLevel).toUpperCase() : '';
    const distance = typeof data.distance === 'number' ? ` (${Math.round(data.distance)}m away)` : '';
    const eventType = String(data.type || 'alert').toLowerCase();

    let lead = `${touristName} has a GeoNotify alert for ${geofenceName}.`;
    if (eventType === 'entered') {
        lead = `${touristName} has entered ${geofenceName}${distance}.`;
    } else if (eventType === 'near') {
        lead = `${touristName} is near ${geofenceName}${distance}.`;
    } else if (eventType === 'exited') {
        lead = `${touristName} has exited ${geofenceName}.`;
    }

    const parts = [lead];
    if (dangerLevel) {
        parts.push(`Risk level: ${dangerLevel}.`);
    }
    if (description) {
        parts.push(description);
    }

    return buildSmsMessage('GeoNotify Alert', parts.join(' '));
}

function normalizeSmsRecipients(smsRecipients) {
    if (!Array.isArray(smsRecipients)) {
        return null;
    }

    return smsRecipients
        .map((recipient) => {
            if (!recipient) return null;
            if (typeof recipient === 'string') {
                return { to: recipient, body: null };
            }
            if (typeof recipient === 'object' && recipient.to) {
                return { to: recipient.to, body: recipient.body || null };
            }
            return null;
        })
        .filter(Boolean);
}

function postJson(urlString, headers, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const req = https.request(
            {
                method: 'POST',
                hostname: url.hostname,
                path: `${url.pathname}${url.search}`,
                headers
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => {
                    raw += chunk;
                });
                res.on('end', () => {
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: raw });
                });
            }
        );

        req.on('error', reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

function getUserSmsRecipients(user) {
    const recipients = [];

    if (user?.phone) {
        recipients.push(user.phone);
    }

    if (user?.emergencyContact?.phone) {
        recipients.push(user.emergencyContact.phone);
    }

    return normalizeList(recipients);
}

async function sendPush(subscription, payload) {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;

    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        return true;
    } catch (err) {
        console.warn('Push send failed:', err.statusCode, err.body);

        if (err.statusCode === 410 || err.statusCode === 404) {
            console.log('Removing expired subscription');
        }

        return false;
    }
}

async function sendSms(to, body) {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
        return false;
    }

    if (!to) return false;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const payload = new URLSearchParams({
        To: to,
        From: TWILIO_FROM_NUMBER,
        Body: body
    });

    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

    const resp = await postJson(url, {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
    }, payload.toString());

    if (!resp.ok) {
        console.warn('SMS send failed:', resp.status, resp.text);
        return false;
    }

    return true;
}

async function sendFcm(token, payload) {
    if (!token) return false;
    if (!initFirebaseAdmin()) return false;

    const message = {
        token,
        notification: {
            title: payload.title,
            body: payload.body
        },
        android: {
            priority: 'high',
            notification: {
                channelId: 'geonotify-alerts',
                sound: 'default'
            }
        },
        data: Object.entries(payload.data || {}).reduce((acc, [key, value]) => {
            acc[key] = typeof value === 'string' ? value : JSON.stringify(value);
            return acc;
        }, {})
    };

    if (payload.icon) {
        message.android.notification.imageUrl = payload.icon;
    }

    try {
        await admin.messaging().send(message);
        return true;
    } catch (err) {
        console.warn('FCM send failed:', err.message || err);
        return false;
    }
}

async function deliverToUser(user, payload, options = {}) {
    const smsMessage = buildSmsMessage(payload.title, payload.body);
    const defaultSmsRecipients = getUserSmsRecipients(user).map((to) => ({ to, body: smsMessage }));
    const smsRecipients = normalizeSmsRecipients(options.smsRecipients) || defaultSmsRecipients;
    const webSubscriptions = normalizeList(user.pushSubscriptions);
    const fcmTokens = normalizeList(user.fcmTokens);

    const results = {
        webPush: 0,
        sms: 0,
        fcm: 0
    };

    for (const sub of webSubscriptions) {
        if (await sendPush(sub, payload)) {
            results.webPush += 1;
        }
    }

    for (const recipient of smsRecipients) {
        if (await sendSms(recipient.to, recipient.body || smsMessage)) {
            results.sms += 1;
        }
    }

    for (const token of fcmTokens) {
        if (await sendFcm(token, payload)) {
            results.fcm += 1;
        }
    }

    return results;
}

async function notifyRescueTeam(tourist, geofence, location) {
    try {
        console.log(
            `RESCUE ALERT: ${tourist.name} in ${geofence.dangerLevel.toUpperCase()} zone: ${geofence.name}`
        );

        const rescueTeam = await User.find({ role: 'rescue', isActive: true });

        if (rescueTeam.length === 0) {
            console.warn('No rescue team members available');
            return false;
        }

        const isNear = !!geofence.isNear;
        const alertType = isNear ? 'NEARBY' : geofence.dangerLevel.toUpperCase();
        const distanceText = isNear ? ` (approx. ${geofence.distance}m away)` : '';

        const alertPayload = {
            title: `RESCUE ALERT - ${alertType}`,
            body: `Tourist ${tourist.name} ${isNear ? 'is near' : 'entered'} ${geofence.name}${distanceText}`,
            data: {
                type: 'rescue_alert',
                isNear,
                distance: geofence.distance,
                touristName: tourist.name,
                touristPhone: tourist.phone || 'N/A',
                touristEmail: tourist.email,
                emergencyContact: tourist.emergencyContact,
                geofenceId: geofence._id,
                geofenceName: geofence.name,
                dangerLevel: geofence.dangerLevel,
                location,
                timestamp: new Date().toISOString()
            },
            tag: `rescue-${tourist._id}-${geofence._id}`,
            requireInteraction: true,
            vibrate: [300, 100, 300, 100, 300]
        };

        let notificationsSent = 0;
        let smsSent = 0;
        let fcmSent = 0;

        for (const rescuer of rescueTeam) {
            const results = await deliverToUser(rescuer, alertPayload, {
                smsRecipients: rescuer.phone ? [rescuer.phone] : []
            });
            notificationsSent += results.webPush;
            smsSent += results.sms;
            fcmSent += results.fcm;
        }

        await NotificationLog.create({
            userId: tourist._id,
            geofenceId: geofence._id,
            notificationType: 'rescue_alert',
            dangerLevel: geofence.dangerLevel,
            location,
            rescueNotified: true,
            message: `Rescue team notified (${notificationsSent} web, ${smsSent} sms, ${fcmSent} fcm)`
        });

        console.log(
            `Rescue team notified: ${rescueTeam.length} members, ` +
            `${notificationsSent} web, ${smsSent} sms, ${fcmSent} fcm`
        );
        return true;
    } catch (err) {
        console.error('Failed to notify rescue team:', err);
        return false;
    }
}

const userNotificationCooldown = new Map();

async function notifyUser(user, title, body, data = {}) {
    const cooldownTime = 45 * 1000;
    const key = `${user._id}-${data.tag || 'notification'}`;
    const now = Date.now();

    const lastSent = userNotificationCooldown.get(key);
    if (lastSent && now - lastSent < cooldownTime) {
        return;
    }

    userNotificationCooldown.set(key, now);

    const payload = {
        title,
        body,
        icon: '/icon.png',
        badge: '/icon.png',
        data,
        tag: data.tag || 'notification',
        requireInteraction: data.requireInteraction || false
    };

    const touristSmsBody = buildSmsMessage(title, body);
    const emergencySmsRecipients = [];

    if (user?.phone) {
        emergencySmsRecipients.push({ to: user.phone, body: touristSmsBody });
    }

    if (user?.emergencyContact?.phone) {
        emergencySmsRecipients.push({
            to: user.emergencyContact.phone,
            body: buildEmergencyContactSmsMessage(user, payload)
        });
    }

    await deliverToUser(user, payload, { smsRecipients: emergencySmsRecipients });
}

module.exports = {
    sendPush,
    sendSms,
    sendFcm,
    notifyRescueTeam,
    notifyUser
};
