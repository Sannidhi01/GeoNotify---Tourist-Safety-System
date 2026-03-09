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

        // check geofences
        const {
            inside,
            near,
            entered,
            exited,
            fences
        } = await checkLocation(lat, lng, user);

        // handle alerts
        await handleEntered(user, entered, location);
        await handleNear(user, near, location);
        await handleExited(user, exited, location);
        await checkPeriodicAlerts(user, inside, location);

        const prevIds = (user.lastInside || []).map(x => x.toString());
        const insideIds = inside.map(f => f._id.toString());
        const nearIds = near.map(f => f._id.toString());

        const allEntered = inside.filter(
            f => !prevIds.includes(f._id.toString())
        );

        const allExited = prevIds
            .filter(id => !insideIds.includes(id))
            .map(id => fences.find(f => f._id.toString() === id))
            .filter(Boolean);

        // update user state
        user.lastInside = insideIds;
        user.lastNear = nearIds;

        // update live location
        user.currentLocation = {
            lat,
            lng,
            timestamp: new Date()
        };

        await user.save();

        console.log(`[LOCATION SAVED] ${user.name} -> ${lat}, ${lng}`);

        res.json({
            inside,
            near,
            entered,
            exited,
            allEntered,
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


router.get('/:id', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('-passwordHash')
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
            .select('-passwordHash -pushSubscriptions')
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