const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { getAllRiskInsights, calculateRiskScore } = require('../services/risk.service');

const router = express.Router();

/**
 * GET /api/analytics/risk-insights
 * Fetches AI-generated risk scores and recommendations for all geofences.
 */
router.get('/risk-insights', requireAuth, async (req, res) => {
    try {
        const insights = await getAllRiskInsights();
        res.json(insights);
    } catch (err) {
        console.error('Analytics Fetch Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/analytics/risk-insights/:geofenceId
 * Fetches a real-time AI risk score and recommendation for a single geofence.
 */
router.get('/risk-insights/:geofenceId', requireAuth, async (req, res) => {
    try {
        const insight = await calculateRiskScore(req.params.geofenceId);
        if (!insight) return res.status(404).json({ error: 'Geofence not found' });
        res.json(insight);
    } catch (err) {
        console.error('Analytics Fetch Error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
