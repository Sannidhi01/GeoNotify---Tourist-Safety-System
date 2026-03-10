import { API } from './config.js';
import { getToken, getUserId, currentUser } from './auth.js';
import { getDangerColor, getDangerEmoji, showDangerLevelModal, closeModal, getTimeRules } from './ui.js';
import { escapeHtml } from './utils.js';

let drawMode = false;
let drawMarkers = [];
let currentCoords = [];
let drawnLayers = null;
let fences = [];
let riskMap = {}; // AI risk data

export const fenceLayers = {};

function renderAiRiskTag(aiRisk) {
    if (!aiRisk) {
        return `
            <div class="ai-risk-tag"
                style="background:#f3f4f6;padding:8px;border-radius:6px;margin-top:8px;
                font-size:0.85rem;border-left:4px solid #6366f1;">
                <strong style="color:#4f46e5;">AI PREDICTION:</strong><br>
                Area Risk Level:
                <span style="font-weight:bold;">Analyzing...</span>
            </div>
        `;
    }

    const riskColor =
        aiRisk.level === "HIGH" ? "#ef4444" :
        aiRisk.level === "MEDIUM" ? "#f59e0b" :
        "#10b981";

    const reasonsText = Array.isArray(aiRisk.reasons) ? aiRisk.reasons.join(', ') : '';
    const baseLevel = aiRisk.baseDangerLevel ? aiRisk.baseDangerLevel.toString().toUpperCase() : '';
    const effectiveLevel = aiRisk.effectiveDangerLevel ? aiRisk.effectiveDangerLevel.toString().toUpperCase() : '';
    const metaBits = [
        baseLevel ? `Base: ${baseLevel}` : '',
        effectiveLevel ? `Effective: ${effectiveLevel}` : '',
        aiRisk.weather ? `Weather: ${aiRisk.weather}` : '',
        (typeof aiRisk.hour === 'number') ? `Time: ${aiRisk.hour}:00` : ''
    ].filter(Boolean).join(' • ');

    return `
        <div class="ai-risk-tag"
            style="background:#f3f4f6;padding:10px;border-radius:8px;margin-top:10px;
            font-size:0.85rem;border-left:5px solid ${riskColor}; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">

            <strong style="color:#4f46e5; display:block; margin-bottom:4px;">AI SAFETY ENGINE</strong>
            ${metaBits ? `<div style="margin-bottom:8px; color:#64748b; font-size:0.78rem;">${metaBits}</div>` : ''}
            
            <div style="margin-bottom:8px; color:#475569;">
                <strong>Reasoning:</strong> ${aiRisk.reasoning || 'Analyzing factors...'}
            </div>

            <div style="background:white; padding:8px; border-radius:6px; border:1px solid ${riskColor}33;">
                <strong style="color:${riskColor};">Advice:</strong> ${aiRisk.recommendation || ''}
            </div>

            <div style="margin-top:8px; font-size:0.75rem; color:#94a3b8; display:flex; justify-content:space-between;">
                <span>Score: ${aiRisk.score}/100</span>
                <span>Factors: ${reasonsText}</span>
            </div>
        </div>
    `;
}

async function refreshAiRiskInsight(geofenceId) {
    const container = document.getElementById(`ai-risk-${geofenceId}`);
    if (!container) return;

    const token = getToken();
    if (!token) return;

    try {
        const r = await fetch(API + '/analytics/risk-insights/' + geofenceId, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!r.ok) return;

        const insight = await r.json();
        riskMap[geofenceId] = insight;
        container.innerHTML = renderAiRiskTag(insight);
    } catch (e) {
        // Keep existing UI if refresh fails
    }
}

export function initGeofence(mapInstance) {

    drawnLayers = L.featureGroup().addTo(mapInstance);

    mapInstance.on('click', e => {
        if (!drawMode) return;

        const m = L.circleMarker(e.latlng, { radius: 6, color: '#d00' }).addTo(mapInstance);
        drawMarkers.push(m);
        currentCoords.push([e.latlng.lng, e.latlng.lat]);
    });

    document.getElementById('draw-start').addEventListener('click', () => {

        if (!currentUser || currentUser.role !== 'admin') {
            return alert('Only admins can draw geofences');
        }

        drawMode = !drawMode;

        document.getElementById('draw-start').textContent =
            drawMode ? '⏹️ Stop Drawing' : '✏️ Start Drawing';

        if (!drawMode && currentCoords.length === 0) {
            drawMarkers.forEach(m => mapInstance.removeLayer(m));
            drawMarkers = [];
        }

    });

    document.getElementById('save').addEventListener('click', async () => {

        if (!currentUser || currentUser.role !== 'admin') {
            return alert('Only admins can save geofences');
        }

        const name = document.getElementById('name').value.trim();
        const description = document.getElementById('description').value.trim();

        if (!name) return alert('Enter geofence name');
        if (currentCoords.length < 3) return alert('Need at least 3 points');

        showDangerLevelModal(name, description, currentCoords);

    });

}

export async function saveFence(name, description, coords) {

    const nearMeters = parseInt(document.getElementById('near-meters').value) || 100;
    const dangerLevel = document.querySelector('input[name="danger"]:checked').value;
    const autoNotifyRescue = document.getElementById('auto-notify').checked;
    const timeRules = getTimeRules();

    try {

        const token = getToken();

        const resp = await fetch(API + '/geofences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                name,
                description,
                coordinates: coords,
                nearMeters,
                dangerLevel,
                autoNotifyRescue,
                timeRules
            })
        });

        if (!resp.ok) throw new Error('Save failed');

        const saved = await resp.json();

        alert(`✓ Saved ${dangerLevel.toUpperCase()} zone: ${saved.name}`);

        drawMarkers.forEach(m => m.remove());
        drawMarkers = [];
        currentCoords = [];
        drawMode = false;

        document.getElementById('draw-start').textContent = '✏️ Start Drawing';
        document.getElementById('name').value = '';
        document.getElementById('description').value = '';

        closeModal();

        loadFences();

    } catch (err) {
        alert('Error: ' + err.message);
    }
}

export async function loadFences() {

    if (!drawnLayers) return;

    drawnLayers.clearLayers();

    try {

        const res = await fetch(API + '/geofences');
        fences = await res.json();

        /* ------------------ FETCH AI RISK INSIGHTS ------------------ */

        try {

            // Admin requested: do not load AI safety insights for admin views
            if (currentUser && currentUser.role === 'admin') {
                riskMap = {};
                throw new Error('Skip AI insights for admin');
            }

            const token = getToken();

            const r = await fetch(API + '/analytics/risk-insights', {
                headers: { 'Authorization': 'Bearer ' + token }
            });

            if (r.ok) {

                const insights = await r.json();

                riskMap = {};

                insights.forEach(zone => {
                    riskMap[zone.geofenceId] = zone;
                });

            }

        } catch (e) {
            console.warn("AI insights unavailable");
        }

        /* ------------------------------------------------------------- */

        const uid = getUserId();
        let user = null;

        console.log(`[Geofence] Found ${fences.length} fences to render.`);

        if (uid) {
            try {
                const token = getToken();
                const headers = { 'Authorization': 'Bearer ' + token };
                const ur = await fetch(API + '/users/' + uid, { headers });
                if (ur.ok) user = await ur.json();
            } catch (e) {
                console.warn("Failed to fetch user context for geofences");
            }
        }

        fences.forEach(f => {
            try {
                if (!f.coordinates || !Array.isArray(f.coordinates) || f.coordinates.length < 3) {
                    console.warn(`[Geofence] Skipping fence ${f.name} due to invalid coordinates:`, f.coordinates);
                    return;
                }

                const latlngs = f.coordinates.map(c => [c[1], c[0]]);
                const emoji = getDangerEmoji(f.dangerLevel);

                let color = getDangerColor(f.dangerLevel);

                const aiRisk = riskMap[f._id];

                if (aiRisk) {
                    if (aiRisk.level === "HIGH") color = "#ef4444";
                    if (aiRisk.level === "MEDIUM") color = "#f59e0b";
                    if (aiRisk.level === "LOW") color = "#10b981";
                }

                const poly = L.polygon(latlngs, {
                    color: color,
                    weight: 3,
                    fillOpacity: 0.3
                }).addTo(drawnLayers);

                fenceLayers[f._id] = poly;

                const deleteBtn =
                    (currentUser && currentUser.role === 'admin') ?
                        `<button id="btn-del-${f._id}" class="btn-delete"
                            style="margin-top:10px;background:#ff4444;color:white;
                            border:none;padding:5px 10px;border-radius:4px;cursor:pointer;">
                            🗑️ Delete
                        </button>` : '';

                const autoNotify = f.autoNotifyRescue ?
                    '<br><strong style="color:#e74c3c;">🚓 Auto-notify rescue team</strong>' : '';

                /* ------------------- AI BLOCK ------------------- */

                let aiBlock = `
                    <div class="ai-risk-tag"
                        style="background:#f3f4f6;padding:8px;border-radius:6px;margin-top:8px;
                        font-size:0.85rem;border-left:4px solid #6366f1;">
                        <strong style="color:#4f46e5;">🤖 AI PREDICTION:</strong><br>
                        Area Risk Level:
                        <span style="font-weight:bold;">Analyzing...</span>
                    </div>
                `;

                if (aiRisk) {
                    const riskColor =
                        aiRisk.level === "HIGH" ? "#ef4444" :
                        aiRisk.level === "MEDIUM" ? "#f59e0b" :
                        "#10b981";

                    aiBlock = `
                        <div class="ai-risk-tag"
                            style="background:#f3f4f6;padding:10px;border-radius:8px;margin-top:10px;
                            font-size:0.85rem;border-left:5px solid ${riskColor}; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">

                            <strong style="color:#4f46e5; display:block; margin-bottom:4px;">🤖 AI SAFETY ENGINE</strong>
                            
                            <div style="margin-bottom:8px; color:#475569;">
                                <strong>Reasoning:</strong> ${aiRisk.reasoning || 'Analyzing factors...'}
                            </div>

                            <div style="background:white; padding:8px; border-radius:6px; border:1px solid ${riskColor}33;">
                                <strong style="color:${riskColor};">Advice:</strong> ${aiRisk.recommendation}
                            </div>

                            <div style="margin-top:8px; font-size:0.75rem; color:#94a3b8; display:flex; justify-content:space-between;">
                                <span>Score: ${aiRisk.score}/100</span>
                                <span>Factors: ${aiRisk.reasons.join(', ')}</span>
                            </div>
                        </div>
                    `;
                }

                aiBlock = `<div id="ai-risk-${f._id}">${aiBlock}</div>`;

                // Admin requested: remove AI safety insights from admin view
                if (currentUser && currentUser.role === 'admin') {
                    aiBlock = '';
                }

                /* ----------------------------------------------- */

                let popupContent = `
                    <div class="geofence-popup" style="min-width:200px;">
                        <h5 style="margin:0 0 5px 0;">
                            ${emoji} ${f.name}
                        </h5>
                        <p style="margin:5px 0;">
                            <strong>Level:</strong>
                            ${f.dangerLevel.toUpperCase()}
                        </p>
                        <p style="margin:5px 0;">
                            ${f.description || 'No description'}
                        </p>
                        <p style="margin:5px 0;">
                            <small>Near threshold: ${f.nearMeters || 100}m</small>
                        </p>
                        ${autoNotify}
                        ${aiBlock}
                        ${deleteBtn}
                    </div>
                `;

                poly.bindPopup(popupContent);

                poly.on('popupopen', () => {
                    const btnDel = document.getElementById(`btn-del-${f._id}`);
                    if (btnDel) {
                        btnDel.onclick = (e) => {
                            e.stopPropagation();
                            deleteFence(f._id);
                        };
                    }

                    if (!(currentUser && currentUser.role === 'admin')) {
                        refreshAiRiskInsight(f._id);
                    }
                });

                poly.on('click', (e) => {
                    if (window.isSimulating) {
                        drawnLayers._map.fire('click', e);
                    }
                });

                console.log(`[Geofence] Rendered ${f.name} with color ${color}`);
            } catch (err) {
                console.error(`[Geofence] Error rendering ${f.name}:`, err);
            }
        });

    } catch (err) {
        console.error('Load fences error:', err);
    }
}

export async function deleteFence(id) {

    if (!currentUser || currentUser.role !== 'admin') {
        return alert('Only admins can delete geofences');
    }

    if (!confirm('Are you sure you want to delete this geofence?')) return;

    try {

        const token = getToken();

        const resp = await fetch(API + '/geofences/' + id, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!resp.ok) throw new Error('Delete failed');

        alert('✓ Geofence deleted');

        loadFences();

    } catch (err) {
        alert('Error: ' + err.message);
    }
}

/* -------- VISUAL EFFECTS -------- */

export function highlightFence(id, dangerLevel) {

    const poly = fenceLayers[id];

    if (!poly) return;

    const el = poly.getElement();

    if (el) {

        if (['danger', 'critical'].includes(dangerLevel)) {

            el.classList.add('polygon-pulse-danger');

        } else {

            poly.setStyle({
                fillOpacity: 0.6,
                weight: 5
            });

        }

    }
}

export function resetFence(id) {

    const poly = fenceLayers[id];

    if (!poly) return;

    const el = poly.getElement();

    if (el) {
        el.classList.remove('polygon-pulse-danger');
    }

    poly.setStyle({
        fillOpacity: 0.3,
        weight: 3
    });
}
