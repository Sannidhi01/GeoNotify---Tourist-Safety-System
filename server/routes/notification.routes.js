const express = require('express');
const User = require('../models/User');
const NotificationLog = require('../models/NotificationLog');
const { requireAdminOrRescue } = require('../middleware/auth.middleware');
const { calculateEffectiveLevel } = require('../services/location.service');
const { sendSms } = require('../services/notification.service');

const router = express.Router();

// Get notification logs (admin and rescue)
router.get('/', requireAdminOrRescue, async (req, res) => {
    try {
        const logs = await NotificationLog.find()
            .populate('userId', 'name email phone role emergencyContact')
            .populate('geofenceId', 'name dangerLevel')
            .sort({ timestamp: -1 })
            .limit(100)
            .lean();

        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/active-alerts', requireAdminOrRescue, async (req, res) => {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        // Find tourists who are either strictly INSIDE a zone (persistent)
        // OR have updated their location recently (for proximity check)
        const tourists = await User.find({ 
            role: 'tourist',
            $or: [
                { lastInside: { $not: { $size: 0 } } },
                { 'currentLocation.timestamp': { $gte: fiveMinutesAgo } }
            ]
        })
            .populate('lastInside')
            .populate('lastNear')
            .lean();

        console.log(`[RESCUE-QUERY] Found ${tourists.length} tourists. Query: role=tourist, (lastInside.length>0 OR currentLocation.timestamp >= ${fiveMinutesAgo.toISOString()})`);
        
        if (tourists.length === 0) {
            // Debug: check raw tourist counts
            const allTourists = await User.find({ role: 'tourist' }).lean();
            console.log(`[RESCUE-DEBUG] Total tourists in DB: ${allTourists.length}`);
            allTourists.forEach(t => {
                console.log(`  - ${t.name}: lastInside=${t.lastInside?.length || 0}, location timestamp=${t.currentLocation?.timestamp || 'none'}`);
            });
        }

        console.log(`[RESCUE] Scanning ${tourists.length} candidate tourists for active alerts...`);
        const activeAlerts = [];

        for (const tourist of tourists) {
            const processFences = (fences, status) => {
                for (const geofence of fences) {
                    if (geofence) {
                        const effectiveLevel = calculateEffectiveLevel(geofence);
                        if (['danger', 'critical'].includes(effectiveLevel)) {
                            activeAlerts.push({
                                tourist: {
                                    id: tourist._id,
                                    name: tourist.name,
                                    phone: tourist.phone,
                                    email: tourist.email,
                                    emergencyContact: tourist.emergencyContact,
                                    currentLocation: tourist.currentLocation,
                                    status: status // 'INSIDE' or 'APPROACHING'
                                },
                                geofence: {
                                    id: geofence._id,
                                    name: geofence.name,
                                    dangerLevel: effectiveLevel,
                                    description: geofence.description
                                },
                                timestamp: tourist.currentLocation?.timestamp || new Date()
                            });
                        }
                    }
                }
            };

            if (tourist.lastInside && tourist.lastInside.length > 0) {
                processFences(tourist.lastInside, 'INSIDE');
            }
            if (tourist.lastNear && tourist.lastNear.length > 0) {
                const insideIds = (tourist.lastInside || []).filter(Boolean).map(f => f._id.toString());
                const nearOnly = tourist.lastNear.filter(f => f && !insideIds.includes(f._id.toString()));
                
                // Only show "APPROACHING" if they moved recently (to avoid ghost alerts)
                if (tourist.currentLocation?.timestamp >= fiveMinutesAgo) {
                    processFences(nearOnly, 'APPROACHING');
                }
            }
        }

        // Fetch recent danger/critical zone entry logs for the dashboard "Logs" section
        const recentLogs = await NotificationLog.find({
            notificationType: { $in: ['entered', 'rescue_alert'] },
            dangerLevel: { $in: ['danger', 'critical'] }
        })
            .populate('userId', 'name email phone role emergencyContact')
            .populate('geofenceId', 'name dangerLevel')
            .sort({ timestamp: -1 })
            .limit(10)
            .lean();

        console.log(`[RESCUE] Active: ${activeAlerts.length}, Recent Logs: ${recentLogs.length}`);
        res.json({ activeAlerts, recentLogs });
    } catch (err) {
        console.error('Active alerts fetch error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Test SMS delivery for the logged-in user
router.post('/test-sms', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const phone = req.user.phone;
        if (!phone) {
            return res.status(400).json({ error: 'No phone number found on this account' });
        }

        const body = req.body?.message || 'GeoNotify test SMS: your Twilio setup is working.';
        const ok = await sendSms(phone, body);

        if (!ok) {
            return res.status(500).json({ error: 'SMS send failed. Check Twilio env vars and phone format.' });
        }

        res.json({ ok: true, sentTo: phone });
    } catch (err) {
        console.error('Test SMS error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
