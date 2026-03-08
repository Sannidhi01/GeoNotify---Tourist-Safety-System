const NotificationLog = require('../models/NotificationLog');
const Geofence = require('../models/Geofence');
const { getSimulatedWeather } = require('./weather.service');
const { generateSafetyAdvice } = require('./openrouter.service');

// Import from location service (using require to avoid circularity if any, or just direct path)
// Note: location service might require risk service later, but let's check.
// Actually, let's just copy the logic or use it if safe.
const { getEffectiveDangerLevel, calculateEffectiveLevel } = require('./location.service');

/**
 * Calculates a dynamic AI Risk Score (0-100) and gets LLM reasoning.
 */
async function calculateRiskScore(geofenceId) {
    const f = await Geofence.findById(geofenceId);
    if (!f) return null;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const logs = await NotificationLog.find({
        geofenceId: f._id,
        notificationType: { $in: ['entered', 'rescue_alert'] },
        timestamp: { $gte: oneDayAgo }
    }).lean();

    // Calculate currently active danger level (Time + Weather aware)
    const effectiveLevel = calculateEffectiveLevel(f);

    // 1. SPATIAL CLUSTERING (HOTSPOTS)
    // Identify if incidents are happening in the same 30m radius
    let hotspotsOccurred = false;
    if (logs.length >= 2) {
        for (let i = 0; i < logs.length; i++) {
            for (let j = i + 1; j < logs.length; j++) {
                const p1 = logs[i].location;
                const p2 = logs[j].location;
                if (p1 && p2) {
                    const dist = calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);
                    if (dist < 30) { // 30 meters cluster
                        hotspotsOccurred = true;
                        break;
                    }
                }
            }
            if (hotspotsOccurred) break;
        }
    }

    // 2. SCORING ENGINE (More precise)
    const dangerWeights = { 'safe': 10, 'caution': 30, 'warning': 50, 'danger': 80, 'critical': 100 };
    let score = dangerWeights[effectiveLevel] || 10;

    // Boost based on incident density
    const frequencyScore = Math.min(logs.length * 5, 30); // Max 30% from frequency
    score += frequencyScore;

    if (hotspotsOccurred) score += 20; // +20 for detected hotspots

    const weather = getSimulatedWeather(f);
    // (Note: calculateEffectiveLevel already considers weather, but we add direct score boosts here for AI logic)
    if (weather === 'Rain') score += 10;
    if (weather === 'Storm') score += 20;

    const hour = new Date().getHours();
    if (hour >= 21 || hour <= 5) score += 15; // Night risk

    score = Math.min(Math.round(score), 100);

    // 3. AI REASONING (OpenRouter)
    let aiLevel = 'LOW';
    if (score > 40) aiLevel = 'MEDIUM';
    if (score > 75) aiLevel = 'HIGH';

    const context = {
        geofenceName: f.name,
        baseDangerLevel: f.dangerLevel.toUpperCase(),
        effectiveDangerLevel: effectiveLevel.toUpperCase(),
        weather: weather,
        hour: hour,
        incidentCount: logs.length,
        hotspotsOccurred: hotspotsOccurred,
        recentTrends: logs.length > 5 ? "Escalating" : "Stable",
        timeRules: (f.timeRules || []).map(r => `${r.startTime}-${r.endTime}: ${r.dangerLevel}`).join(', ')
    };

    let aiResult = await generateSafetyAdvice(context);
    
    // Fallback if LLM fails or returns incomplete data
    if (!aiResult || !aiResult.recommendation) {
        const fallbackText = (f.dangerLevel === 'critical' || f.dangerLevel === 'danger') 
            ? "🚨 EXTREME DANGER. Do not enter this zone. High-risk environment."
            : "Caution advised. Stay aware of surroundings.";
        
        aiResult = {
            reasoning: "Automated analysis based on historical patterns and environment.",
            recommendation: fallbackText
        };
    }

    // Reasoning factors for the UI
    const reasons = [];
    reasons.push(`${f.dangerLevel.toUpperCase()} Zone`);
    if (logs.length > 0) reasons.push(`${logs.length} incidents`);
    if (hotspotsOccurred) reasons.push("⚠️ Hazard Hotspots");
    if (weather !== 'Clear') reasons.push(`Weather: ${weather}`);

    return {
        geofenceId: f._id,
        name: f.name,
        score,
        level: score > 75 ? 'HIGH' : (score > 40 ? 'MEDIUM' : 'LOW'),
        aiAnalysis: aiLevel,
        reasons,
        incidentCountLast24h: logs.length,
        weather,
        reasoning: aiResult.reasoning,
        recommendation: aiResult.recommendation
    };
}

/**
 * Basic Haversine distance formula
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

async function getAllRiskInsights() {
    const fences = await Geofence.find();
    const insights = [];
    for (const f of fences) {
        const insight = await calculateRiskScore(f._id);
        if (insight) insights.push(insight);
    }
    return insights.sort((a, b) => b.score - a.score);
}

module.exports = { calculateRiskScore, getAllRiskInsights };
