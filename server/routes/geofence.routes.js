// server/routes/geofence.routes.js
const express = require('express');
const Geofence = require('../models/Geofence');
const { requireAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

// Get all geofences (public)
router.get('/', async (req, res) => {
    try {
        const geofences = await Geofence.find()
            .sort({ createdAt: -1 })
            .lean();
        res.json(geofences);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create geofence (admin only)
router.post('/', requireAdmin, async (req, res) => {
    try {
        const {
            name,
            description,
            reminder,
            coordinates,
            nearMeters,
            dangerLevel,
            autoNotifyRescue
        } = req.body;

        if (!name || !Array.isArray(coordinates) || coordinates.length < 3) {
            return res.status(400).json({
                error: 'Invalid input. Name and ≥3 coordinates required.'
            });
        }

        const geofence = await Geofence.create({
            name,
            description: description || '',
            reminder: reminder || '',
            coordinates,
            nearMeters: nearMeters || 100,
            dangerLevel: dangerLevel || 'safe',
            autoNotifyRescue: autoNotifyRescue || false,
            createdBy: req.user._id
        });

        res.json(geofence);
    } catch (err) {
        console.error('Create geofence error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update geofence (admin only)
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const {
            name,
            description,
            reminder,
            coordinates,
            nearMeters,
            dangerLevel,
            autoNotifyRescue
        } = req.body;

        const updated = await Geofence.findByIdAndUpdate(
            req.params.id,
            {
                name,
                description,
                reminder,
                coordinates,
                nearMeters,
                dangerLevel,
                autoNotifyRescue
            },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ error: 'Geofence not found' });
        }

        res.json(updated);
    } catch (err) {
        console.error('Update geofence error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete geofence (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const deleted = await Geofence.findByIdAndDelete(req.params.id);

        if (!deleted) {
            return res.status(404).json({ error: 'Geofence not found' });
        }

        res.json({ message: 'Geofence deleted successfully' });
    } catch (err) {
        console.error('Delete geofence error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;