import { API } from './config.js';
import { getToken, currentUser } from './auth.js';

let insightInterval = null;

export async function initAIInsights() {
    if (!currentUser) return;

    // Admin requested: do not show AI safety insights in admin UI
    if (currentUser.role === 'admin') {
        const list = document.getElementById('ai-insights-list');
        if (list) list.innerHTML = '';
        return;
    }
    
    // Initial fetch
    await fetchRiskInsights();

    // Refresh every 60 seconds
    if (insightInterval) clearInterval(insightInterval);
    insightInterval = setInterval(fetchRiskInsights, 60000);
}

async function fetchRiskInsights() {
    try {
        const token = getToken();
        if (!token) return;

        const resp = await fetch(API + '/analytics/risk-insights', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!resp.ok) return;

        const insights = await resp.json();
        renderAIInsights(insights);
    } catch (err) {
        console.error('AI Insights fetch error:', err);
    }
}

function renderAIInsights(insights) {
    const list = document.getElementById('ai-insights-list');
    if (!list) return;

    if (insights.length === 0) {
        list.innerHTML = '<p class="empty-state">No real-time risk data available.</p>';
        return;
    }

    // Capture the top 3 highest risks
    const topRisks = insights.slice(0, 3);

    list.innerHTML = topRisks.map(ris => `
        <div class="ai-insight-item risk-${ris.level.toLowerCase()}">
            <div class="ai-header">
                <strong>${ris.name}</strong>
                <span class="ai-score-badge">${ris.score} / 100</span>
            </div>
            <div class="ai-body">
                <p class="ai-reasoning"><strong>Reason:</strong> ${ris.reasoning}</p>
                <div class="ai-recommendation-box" style="margin-top:8px; padding:8px; background:white; border-radius:4px; font-weight:500;">
                   💡 ${ris.recommendation}
                </div>
                <div class="ai-meta" style="margin-top:10px;">
                    <span>Logs (24h): ${ris.incidentCountLast24h}</span>
                    <span>Weather: ${formatWeather(ris.weather)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

function formatWeather(w) {
    if (!w) return 'Unknown';
    if (typeof w === 'string') return w;
    const parts = [];
    if (w.state) parts.push(w.state);
    if (w.temp != null) parts.push(`${w.temp}°C`);
    if (w.wind_speed != null) parts.push(`wind ${w.wind_speed} m/s`);
    return parts.join(', ') || JSON.stringify(w);
}

// Function to update individual geofence risk (called from geofence.js)
export function getRiskLevelColor(level) {
    switch (level) {
        case 'HIGH': return '#ef4444'; // Red
        case 'MEDIUM': return '#f59e0b'; // Amber
        case 'LOW': return '#10b981'; // Green
        default: return '#6b7280';
    }
}
