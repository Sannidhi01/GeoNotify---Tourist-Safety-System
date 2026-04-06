const express = require('express');
const User = require('../models/User');
const {
    requireAuth,
    requireAdmin
} = require('../middleware/auth.middleware');
const {
    checkLocation,
    handleEntered,
    handleNear,
    handleExited,
    checkPeriodicAlerts
} = require('../services/location.service');

const router = express.Router();

router.get('/push/vapidPublicKey', (req, res) => {
    const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
    if (!VAPID_PUBLIC) {
        return res.status(500).json({ error: 'VAPID keys not configured' });
    }
    res.json({ publicKey: VAPID_PUBLIC });
});

router.get('/check', requireAuth, async (req, res) => {
    try {

        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);

        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return res.status(400).json({ error: "Valid lat & lng required" });
        }

        // ALWAYS fetch fresh user from MongoDB
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // IMPORTANT: only tourists send GPS
        if (user.role !== "tourist") {
            return res.status(403).json({ error: "Only tourists can send location updates" });
        }

        const location = { lat, lng };

        console.log(`[LOCATION CHECK] ${user.name} (${user.role}) at ${lat}, ${lng}`);

        const prevInsideIds = (user.lastInside || []).map(x => x.toString());
        const prevNearIds = (user.lastNear || []).map(x => x.toString());
        const now = new Date();

        // check geofences
        const {
            inside,
            near,
            entered,
            exited,
            enteredNear,
            fences,
            ignoredUpdate,
            anomalyDetails
        } = await checkLocation(lat, lng, user);

        if (ignoredUpdate) {
            return res.status(202).json({
                ignoredUpdate: true,
                reason: anomalyDetails?.reason || 'implausible_jump',
                speedMs: anomalyDetails?.speedMs,
                distanceMeters: anomalyDetails?.distanceMeters,
                timeDiffSec: anomalyDetails?.timeDiffSec,
                inside,
                near,
                entered: [],
                exited: [],
                allEntered: [],
                allExited: []
            });
        }

        // handle alerts
        await handleEntered(user, entered, location);
        await handleNear(user, enteredNear, location);
        await handleExited(user, exited, location);
        await checkPeriodicAlerts(user, inside, location);

        const insideIds = inside.map(f => f._id.toString());
        const nearIds = near.map(f => f._id.toString());

        const allEntered = inside.filter(
            f => !prevInsideIds.includes(f._id.toString())
        );

        const allExited = prevInsideIds
            .filter(id => !insideIds.includes(id))
            .map(id => fences.find(f => f._id.toString() === id))
            .filter(Boolean);

        // Persist first "time of entry" into near/inside sessions per zone
        const nearEntryTimes = user.nearEntryTimes instanceof Map
            ? user.nearEntryTimes
            : new Map(Object.entries(user.nearEntryTimes || {}));
        const insideEntryTimes = user.insideEntryTimes instanceof Map
            ? user.insideEntryTimes
            : new Map(Object.entries(user.insideEntryTimes || {}));

        const enteredNearIds = (enteredNear || []).map(f => f._id.toString());
        const enteredInsideIds = entered.map(f => f._id.toString());
        const exitedInsideIds = allExited.map(f => f._id.toString());

        const setOps = {
            lastInside: insideIds,
            lastNear: nearIds,
            currentLocation: { lat, lng, timestamp: now }
        };
        const unsetOps = {};

        enteredNearIds.forEach(id => {
            if (!nearEntryTimes.get(id)) {
                nearEntryTimes.set(id, now);
                setOps[`nearEntryTimes.${id}`] = now;
            }
        });

        prevNearIds
            .filter(id => !nearIds.includes(id))
            .forEach(id => {
                if (nearEntryTimes.get(id)) {
                    nearEntryTimes.delete(id);
                    unsetOps[`nearEntryTimes.${id}`] = 1;
                }
            });

        enteredInsideIds.forEach(id => {
            if (!insideEntryTimes.get(id)) {
                insideEntryTimes.set(id, now);
                setOps[`insideEntryTimes.${id}`] = now;
            }
        });

        exitedInsideIds.forEach(id => {
            if (insideEntryTimes.get(id)) {
                insideEntryTimes.delete(id);
                unsetOps[`insideEntryTimes.${id}`] = 1;
            }
        });

        const update = { $set: setOps };
        if (Object.keys(unsetOps).length) update.$unset = unsetOps;

        await User.updateOne({ _id: user._id }, update);

        console.log(`[LOCATION SAVED] ${user.name} -> ${lat}, ${lng}`);

        const withEnteredAt = (f) => {
            const id = f && f._id ? f._id.toString() : '';
            const ts = (id && user.insideEntryTimes && user.insideEntryTimes.get(id)) ? user.insideEntryTimes.get(id) : now;
            return { ...f, enteredAt: ts instanceof Date ? ts.toISOString() : new Date(ts).toISOString() };
        };

        res.json({
            inside,
            near,
            entered: (entered || []).map(withEnteredAt),
            exited,
            allEntered: (allEntered || []).map(withEnteredAt),
            allExited
        });

    } catch (err) {
        console.error("Location check error:", err);
        res.status(500).json({ error: err.message });
    }
});
// Subscribe to push notifications
router.post('/:id/push-subscribe', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Authorization check
        if (user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const sub = req.body.subscription;
        if (!sub) {
            return res.status(400).json({ error: 'Subscription required' });
        }

        user.pushSubscriptions = user.pushSubscriptions || [];
        user.pushSubscriptions.push(sub);
        await user.save();

        res.json({ ok: true });
    } catch (err) {
        console.error('Push subscribe error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Save an Android/Firebase device token for push notifications
router.post('/:id/fcm-token', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const { token } = req.body;
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ error: 'FCM token required' });
        }

        user.fcmTokens = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
        if (!user.fcmTokens.includes(token)) {
            user.fcmTokens.push(token);
            await user.save();
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('FCM token save error:', err);
        res.status(500).json({ error: err.message });
    }
});


router.get('/:id', requireAuth, async (req, res) => {
    try {
        if (req.params.id !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const user = await User.findById(req.params.id)
            .select('-passwordHash -pushSubscriptions -fcmTokens')
            .lean();

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Track all tourists (admin only)
router.get('/admin/users', requireAdmin, async (req, res) => {
    try {
        const users = await User.find({ role: 'tourist' })
            .select('-passwordHash -pushSubscriptions -fcmTokens')
            .sort({ createdAt: -1 })
            .lean();

        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get user location (admin only)
router.get('/admin/user/:id/location', requireAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('name email currentLocation');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
