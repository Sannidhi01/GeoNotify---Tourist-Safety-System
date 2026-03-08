const NotificationLog = require('../models/NotificationLog');
const Geofence = require('../models/Geofence');
const { getSimulatedWeather, adjustDangerLevelByWeather } = require('./weather.service');

/**
 * Calculates a dynamic AI Risk Score (0-100) for a geofence.
 */
async function calculateRiskScore(geofenceId) {
    const f = await Geofence.findById(geofenceId);
    if (!f) return null;

    // 1. BASE RISK (30%)
    const dangerWeights = { 'safe': 10, 'caution': 30, 'warning': 50, 'danger': 80, 'critical': 100 };
    let score = dangerWeights[f.dangerLevel] || 10;

    // 2. HISTORICAL INCIDENT FREQUENCY (40%)
    // Check "entered" alerts in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const incidentCount = await NotificationLog.countDocuments({
        geofenceId: f._id,
        notificationType: { $in: ['entered', 'rescue_alert'] },
        timestamp: { $gte: oneDayAgo }
    });

    // Add up to 40 points based on incident count (capped at 10 incidents)
    const frequencyBoost = Math.min(incidentCount * 4, 40);
    score += frequencyBoost;

    // 3. ENVIRONMENTAL FACTORS (20%)
    const weather = getSimulatedWeather(f);
    if (weather === 'Rain') score += 10;
    if (weather === 'Storm') score += 20;

    // 4. TEMPORAL RISK (10%)
    const hour = new Date().getHours();
    if (hour >= 22 || hour <= 5) {
        // Night time risk boost
        score += 10;
    }

    // Final normalization (0-100)
    score = Math.min(Math.round(score), 100);

    // Determine Risk Label
    let level = 'LOW';
    if (score > 40) level = 'MEDIUM';
    if (score > 75) level = 'HIGH';

    // Generate AI Advice
    let recommendation = "Safe to travel. Stay on marked paths.";
    if (incidentCount > 5) recommendation = "⚠️ Abnormally high incident rate detected here. Travel in groups.";
    if (weather === 'Storm') recommendation = "🚨 Significant risk due to severe weather. Postpone travel if possible.";
    if (level === 'HIGH' && hour > 20) recommendation = "🚫 High risk after dark. Immediate extraction recommended.";

    return {
        geofenceId: f._id,
        name: f.name,
        score,
        level,
        incidentCountLast24h: incidentCount,
        weather,
        recommendation
    };
}

/**
 * Gets safety insights for all active zones.
 */
async function getAllRiskInsights() {
    const fences = await Geofence.find();
    const insights = [];
    for (const f of fences) {
        const insight = await calculateRiskScore(f._id);
        if (insight) insights.push(insight);
    }
    
    // Sort by score descending to show top risks first
    return insights.sort((a, b) => b.score - a.score);
}

module.exports = {
    calculateRiskScore,
    getAllRiskInsights
};
