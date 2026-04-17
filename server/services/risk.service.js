const NotificationLog = require('../models/NotificationLog');
const Geofence = require('../models/Geofence');
const { getWeatherForGeofence, adjustDangerLevelByWeather } = require('./weather.service');
const { generateSafetyAdvice } = require('./openrouter.service');

// Import from location service (using require to avoid circularity if any, or just direct path)
// Note: location service might require risk service later, but let's check.
// Actually, let's just copy the logic or use it if safe.
const { getEffectiveDangerLevel, calculateEffectiveLevel } = require('./location.service');

function formatWeatherSummary(weather) {
    if (!weather) return 'Clear';
    if (typeof weather === 'string') return weather;
    if (Array.isArray(weather)) {
        return weather.map(formatWeatherSummary).filter(Boolean).join(', ') || 'Clear';
    }

    const parts = [];
    if (typeof weather.state === 'string' && weather.state.trim()) parts.push(weather.state.trim());
    if (typeof weather.main === 'string' && weather.main.trim() && weather.main !== weather.state) parts.push(weather.main.trim());
    if (typeof weather.description === 'string' && weather.description.trim() && weather.description !== weather.state) parts.push(weather.description.trim());
    if (weather.temp != null && Number.isFinite(Number(weather.temp))) parts.push(`${Number(weather.temp)} C`);
    if (weather.wind_speed != null && Number.isFinite(Number(weather.wind_speed))) parts.push(`wind ${Number(weather.wind_speed)} m/s`);
    if (weather.visibility != null && Number.isFinite(Number(weather.visibility))) parts.push(`visibility ${Number(weather.visibility)} m`);

    return parts.join(', ') || 'Clear';
}

function buildFallbackSafetyAdvice({ geofenceName, baseDangerLevel, effectiveDangerLevel, weather, hour, incidentCount, hotspotsOccurred }) {
    const base = (baseDangerLevel || '').toString().toLowerCase();
    const effective = (effectiveDangerLevel || base || 'safe').toString().toLowerCase();

    const isNight = typeof hour === 'number' ? (hour >= 21 || hour <= 5) : false;
    const hasIncidents = (incidentCount || 0) > 0;

    const reasoningParts = [];
    if (geofenceName) reasoningParts.push(`${geofenceName}`);
    if (base) reasoningParts.push(`base level ${base.toUpperCase()}`);
    if (effective && effective !== base) reasoningParts.push(`effective level ${effective.toUpperCase()}`);
    const weatherLabel = (weather && (weather.state || weather.main)) ?
        `${weather.state || weather.main}${weather.temp != null ? `, ${weather.temp}°C` : ''}` :
        (weather || 'Clear');
    if (weatherLabel && weatherLabel !== 'Clear') reasoningParts.push(`weather ${weatherLabel}`);
    if (isNight) reasoningParts.push('night hours');
    if (hotspotsOccurred) reasoningParts.push('hotspots detected');
    if (hasIncidents) reasoningParts.push(`${incidentCount} recent incidents`);

    const reasoning = reasoningParts.length
        ? `Risk assessment based on ${reasoningParts.join(', ')}.`
        : 'Risk assessment based on current zone conditions.';

    const advice = [];

    switch (effective) {
        case 'critical':
            advice.push('Do not enter; leave the area immediately.');
            break;
        case 'danger':
            advice.push('Avoid entering; turn back and stay in populated areas.');
            break;
        case 'warning':
            advice.push('Proceed only if necessary; remain highly alert.');
            break;
        case 'caution':
            advice.push('Stay cautious and aware of your surroundings.');
            break;
        default:
            advice.push('Low risk, but stay aware of your surroundings.');
            break;
    }

    if (isNight) advice.push('Avoid isolated routes; prefer well-lit main roads.');
    const weatherState = (weather && (weather.state || weather)) || 'Clear';
    if (weatherState === 'Storm') advice.push('Seek shelter; avoid low-lying or flooded areas.');
    if (weatherState === 'Rain') advice.push('Use caution on slippery paths; keep visibility high.');
    if (hotspotsOccurred) advice.push('Move away from the hotspot cluster and regroup.');
    if (hasIncidents && (effective === 'danger' || effective === 'critical')) {
        advice.push('Share your live location with a trusted contact.');
    }

    return {
        reasoning,
        recommendation: advice.join(' ')
    };
}

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

    // Calculate currently active danger level (Time + Weather aware) with a single weather sample
    const baseLevel = getEffectiveDangerLevel(f);
    const weather = await getWeatherForGeofence(f); // now a detailed object
    const effectiveLevel = adjustDangerLevelByWeather(baseLevel, weather);

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

    // (Note: calculateEffectiveLevel already considers weather, but we add direct score boosts here for AI logic)
    const weatherState = (weather && weather.state) || weather;
    if (weatherState === 'Rain') score += 10;
    if (weatherState === 'Storm') score += 20;

    // Additional score adjustments from detailed weather metrics
    const wind = Number(weather?.wind_speed ?? 0);
    const vis = Number(weather?.visibility ?? Infinity);
    if (!Number.isNaN(wind)) {
        if (wind >= 25) score += 20;
        else if (wind >= 15) score += 10;
    }
    if (!Number.isNaN(vis) && vis < 1000) score += 10;

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
        weather: weather || { state: 'Clear' },
        hour: hour,
        incidentCount: logs.length,
        hotspotsOccurred: hotspotsOccurred,
        recentTrends: logs.length > 5 ? "Escalating" : "Stable",
        timeRules: (f.timeRules || []).map(r => `${r.startTime}-${r.endTime}: ${r.dangerLevel}`).join(', '
        )
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

    // Ensure fallback advice is dynamic (danger level + entry time + weather + activity)
    if (
        !aiResult ||
        !aiResult.recommendation ||
        aiResult.reasoning === "Automated analysis based on historical patterns and environment."
    ) {
        aiResult = buildFallbackSafetyAdvice({
            geofenceName: f.name,
            baseDangerLevel: f.dangerLevel,
            effectiveDangerLevel: effectiveLevel,
            weather,
            hour,
            incidentCount: logs.length,
            hotspotsOccurred
        });
    }

    // Reasoning factors for the UI
    const reasons = [];
    reasons.push(`${f.dangerLevel.toUpperCase()} Zone`);
    if (logs.length > 0) reasons.push(`${logs.length} incidents`);
    if (hotspotsOccurred) reasons.push("⚠️ Hazard Hotspots");
    const weatherSummary = formatWeatherSummary(weather);
    if (weatherSummary !== 'Clear') reasons.push(`Weather: ${weatherSummary}`);

    return {
        geofenceId: f._id,
        name: f.name,
        score,
        level: score > 75 ? 'HIGH' : (score > 40 ? 'MEDIUM' : 'LOW'),
        baseDangerLevel: f.dangerLevel,
        effectiveDangerLevel: effectiveLevel,
        hour,
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
