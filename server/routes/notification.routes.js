const express = require('express');
const User = require('../models/User');
const NotificationLog = require('../models/NotificationLog');
const { requireAdminOrRescue } = require('../middleware/auth.middleware');

const router = express.Router();

// Get notification logs (admin and rescue)
router.get('/', requireAdminOrRescue, async (req, res) => {
    try {
        const logs = await NotificationLog.find()
            .populate('userId', 'name email phone role')
            .populate('geofenceId', 'name dangerLevel')
            .sort({ timestamp: -1 })
            .limit(100)
            .lean();

        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get active alerts (rescue team dashboard)
router.get('/active-alerts', requireAdminOrRescue, async (req, res) => {
    try {
        // Find tourists currently in danger zones
        const tourists = await User.find({ role: 'tourist' })
            .populate('lastInside')
            .lean();

        const activeAlerts = [];

        for (const tourist of tourists) {
            if (tourist.lastInside && tourist.lastInside.length > 0) {
                for (const geofence of tourist.lastInside) {
                    if (geofence && ['danger', 'critical'].includes(geofence.dangerLevel)) {
                        activeAlerts.push({
                            tourist: {
                                id: tourist._id,
                                name: tourist.name,
                                phone: tourist.phone,
                                email: tourist.email,
                                emergencyContact: tourist.emergencyContact,
                                currentLocation: tourist.currentLocation
                            },
                            geofence: {
                                id: geofence._id,
                                name: geofence.name,
                                dangerLevel: geofence.dangerLevel,
                                description: geofence.description
                            },
                            timestamp: tourist.currentLocation?.timestamp || new Date()
                        });
                    }
                }
            }
        }

        res.json(activeAlerts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;