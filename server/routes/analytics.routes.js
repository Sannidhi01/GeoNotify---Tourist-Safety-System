const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { getAllRiskInsights } = require('../services/risk.service');

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

module.exports = router;
