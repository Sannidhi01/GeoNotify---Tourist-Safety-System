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

// Get VAPID public key
router.get('/push/vapidPublicKey', (req, res) => {
    const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
    if (!VAPID_PUBLIC) {
        return res.status(500).json({ error: 'VAPID keys not configured' });
    }
    res.json({ publicKey: VAPID_PUBLIC });
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

// Get user by ID
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

// Subscribe to geofence
router.post('/:id/subscribe', requireAuth, async (req, res) => {
    try {
        const { fenceId } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!user.subscribedGeofences.includes(fenceId)) {
            user.subscribedGeofences.push(fenceId);
            await user.save();
        }

        res.json({ message: 'Subscribed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Unsubscribe from geofence
router.post('/:id/unsubscribe', requireAuth, async (req, res) => {
    try {
        const { fenceId } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.subscribedGeofences = user.subscribedGeofences.filter(
            f => f.toString() !== fenceId
        );
        user.lastInside = user.lastInside.filter(
            f => f.toString() !== fenceId
        );
        await user.save();

        res.json({ message: 'Unsubscribed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Check location against geofences
router.get('/check', requireAuth, async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);

        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return res.status(400).json({ error: 'Valid lat & lng required' });
        }

        const user = req.user;
        const location = { lat, lng };

        // Check location against all geofences
        const {
            inside,
            subscribedInside,
            subscribedNear,
            entered,
            exited
        } = await checkLocation(lat, lng, user);

        // Handle notifications
        await handleEntered(user, entered, location);
        await handleNear(user, subscribedNear, location);
        await handleExited(user, exited, location);
        await checkPeriodicAlerts(user, subscribedInside, location);

        // Update user state
        user.lastInside = inside.map(f => f._id);
        await user.save();

        res.json({
            inside: subscribedInside,
            near: subscribedNear,
            entered,
            exited
        });
    } catch (err) {
        console.error('Location check error:', err);
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