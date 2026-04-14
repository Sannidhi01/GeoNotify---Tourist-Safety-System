import { API } from './config.js';
import { getToken, getUserId, currentUser } from './auth.js';
import { getDangerColor, getDangerEmoji, showDangerLevelModal, closeModal, getTimeRules } from './ui.js';
import { escapeHtml } from './utils.js';

let drawMode = false;
let drawMarkers = [];
let currentCoords = [];
let drawnLayers = null;
let mapRef = null;
let fences = [];
let riskMap = {}; // AI risk data
let editMarkers = {}; // per-fence vertex markers when editing
let editingFenceId = null;

export const fenceLayers = {};

function formatWeather(weather) {
    if (!weather) return 'Unknown';
    if (typeof weather === 'string') return weather;

    const parts = [];
    if (weather.state) parts.push(weather.state);
    if (weather.temp != null) parts.push(`${weather.temp} C`);
    if (weather.wind_speed != null) parts.push(`wind ${weather.wind_speed} m/s`);
    if (weather.visibility != null) parts.push(`visibility ${weather.visibility} m`);

    return parts.join(', ') || 'Unknown';
}

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
    const combinedAdvice = [aiRisk.reasoning, aiRisk.recommendation].filter(Boolean).join(' ');
    const weatherText = formatWeather(aiRisk.weather);

    return `
        <div class="ai-risk-tag"
            style="background:#f3f4f6;padding:10px;border-radius:8px;margin-top:10px;
            font-size:0.85rem;border-left:5px solid ${riskColor}; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">

            <strong style="color:#4f46e5; display:block; margin-bottom:4px;">AI Safety Engine Advice</strong>
            <div style="margin-bottom:8px; color:#475569;">
                ${combinedAdvice || 'Analyzing factors...'}
            </div>

            <div style="margin-top:8px; font-size:0.75rem; color:#94a3b8;">
                <span>Factors: ${reasonsText}</span>
            </div>
            <div style="margin-top:4px; font-size:0.75rem; color:#94a3b8;">
                <span>Weather: ${weatherText}</span>
            </div>
        </div>
    `;
}

function formatLatLng(ll) {
    if (!ll) return '';
    return `${Number(ll.lat).toFixed(6)}, ${Number(ll.lng).toFixed(6)}`;
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

    mapRef = mapInstance;
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

        if (!drawMode) {
            if (currentCoords.length === 0) {
                drawMarkers.forEach(m => mapInstance.removeLayer(m));
                drawMarkers = [];
                return;
            }

            if (currentCoords.length < 3) {
                return alert('Need at least 3 points to save a geofence');
            }

            const name = document.getElementById('name').value.trim();
            const description = document.getElementById('description').value.trim();

            if (!name) {
                return alert('Enter geofence name before saving');
            }

            showDangerLevelModal(name, description, currentCoords);
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

        await saveFenceDirect(name, description, currentCoords);

    });

}

export function applyManualCoords(rawText) {
    if (!mapRef) {
        return { ok: false, error: 'Map not ready' };
    }

    const lines = (rawText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) {
        return { ok: false, error: 'Need at least 3 points' };
    }

    const coords = [];

    for (const line of lines) {
        const parts = line.split(/[,\s]+/).filter(Boolean);
        if (parts.length < 2) {
            return { ok: false, error: `Invalid point: "${line}"` };
        }
        let a = Number(parts[0]);
        let b = Number(parts[1]);

        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            return { ok: false, error: `Invalid numbers: "${line}"` };
        }

        let lat = a;
        let lng = b;
        if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
            lat = b;
            lng = a;
        }

        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            return { ok: false, error: `Out of range lat/lng: "${line}"` };
        }

        coords.push([lng, lat]);
    }

    drawMarkers.forEach(m => {
        try { mapRef.removeLayer(m); } catch (e) {}
        try { m.remove(); } catch (e) {}
    });
    drawMarkers = [];
    currentCoords.length = 0;

    coords.forEach(c => {
        const marker = L.circleMarker([c[1], c[0]], { radius: 6, color: '#d00' }).addTo(mapRef);
        drawMarkers.push(marker);
        currentCoords.push([c[0], c[1]]);
    });

    return { ok: true, count: coords.length };
}

async function persistFence(payload, { resetForm = true, closeConfigModal = false } = {}) {
    try {
        const token = getToken();

        const resp = await fetch(API + '/geofences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) throw new Error('Save failed');

        const saved = await resp.json();
        alert(`✓ Saved ${(payload.dangerLevel || 'safe').toUpperCase()} zone: ${saved.name}`);

        if (resetForm) {
            drawMarkers.forEach(m => m.remove());
            drawMarkers = [];
            currentCoords = [];
            drawMode = false;

            document.getElementById('draw-start').textContent = '✏️ Start Drawing';
            document.getElementById('name').value = '';
            document.getElementById('description').value = '';
        }

        if (closeConfigModal) {
            closeModal();
        }

        loadFences();
        return saved;
    } catch (err) {
        alert('Error: ' + err.message);
        throw err;
    }
}

export async function saveFence(name, description, coords) {

    const nearMeters = parseInt(document.getElementById('near-meters').value) || 100;
    const dangerLevel = document.querySelector('input[name="danger"]:checked').value;
    const autoNotifyCheckbox = document.getElementById('auto-notify');
    const autoNotifyRescue = autoNotifyCheckbox ? autoNotifyCheckbox.checked : false;
    const timeRules = getTimeRules();

    await persistFence({
        name,
        description,
        coordinates: coords,
        nearMeters,
        dangerLevel,
        autoNotifyRescue,
        timeRules
    }, {
        resetForm: true,
        closeConfigModal: true
    });
}

export async function saveFenceDirect(name, description, coords) {
    await persistFence({
        name,
        description,
        coordinates: coords,
        nearMeters: 100,
        dangerLevel: 'safe',
        autoNotifyRescue: false,
        timeRules: []
    }, {
        resetForm: true,
        closeConfigModal: false
    });
}

export async function loadFences() {

    if (!drawnLayers) return;

    drawnLayers.clearLayers();

    try {

        const res = await fetch(API + '/geofences');
        fences = await res.json();

        /* ------------------ FETCH AI RISK INSIGHTS ------------------ */

        try {
            // Skip bulk AI insights for admin and tourists to speed up map load.
            if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'tourist')) {
                riskMap = {};
                throw new Error('Skip AI insights for this role');
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

                const editBtns = (currentUser && currentUser.role === 'admin') ?
                    `
                        <div style="margin-top:8px;">
                            <button id="btn-edit-${f._id}" class="btn-edit" style="margin-right:6px;padding:6px 8px;">✏️ Edit</button>
                            <button id="btn-save-${f._id}" class="btn-save" style="display:none;margin-right:6px;padding:6px 8px;background:#1976d2;color:white;">💾 Save</button>
                            <button id="btn-cancel-${f._id}" class="btn-cancel" style="display:none;padding:6px 8px;">✖️ Cancel</button>
                        </div>
                    ` : '';

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
                    const combinedAdvice = [aiRisk.reasoning, aiRisk.recommendation].filter(Boolean).join(' ');
                    const factorsText = Array.isArray(aiRisk.reasons) ? aiRisk.reasons.join(', ') : '';
                    const weatherText = formatWeather(aiRisk.weather);

                    aiBlock = `
                        <div class="ai-risk-tag"
                            style="background:#f3f4f6;padding:10px;border-radius:8px;margin-top:10px;
                            font-size:0.85rem;border-left:5px solid ${riskColor}; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">

                            <strong style="color:#4f46e5; display:block; margin-bottom:4px;">AI Safety Engine Advice</strong>
                            
                            <div style="margin-bottom:8px; color:#475569;">
                                ${combinedAdvice || 'Analyzing factors...'}
                            </div>

                            <div style="margin-top:8px; font-size:0.75rem; color:#94a3b8;">
                                <span>Factors: ${factorsText}</span>
                            </div>
                            <div style="margin-top:4px; font-size:0.75rem; color:#94a3b8;">
                                <span>Weather: ${weatherText}</span>
                            </div>
                        </div>
                    `;
                }

                aiBlock = `<div id="ai-risk-${f._id}">${aiBlock}</div>`;

                // Admin requested: remove AI safety insights from admin view (case-insensitive)
                const isAdmin = currentUser && String(currentUser.role || '').toLowerCase() === 'admin';
                if (isAdmin) {
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
                        ${editBtns}
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

                    const btnEdit = document.getElementById(`btn-edit-${f._id}`);
                    const btnSave = document.getElementById(`btn-save-${f._id}`);
                    const btnCancel = document.getElementById(`btn-cancel-${f._id}`);

                    if (btnEdit) {
                        btnEdit.onclick = (e) => {
                            e.stopPropagation();
                            startEditingFence(f._id, poly);
                            btnEdit.style.display = 'none';
                            if (btnSave) btnSave.style.display = 'inline-block';
                            if (btnCancel) btnCancel.style.display = 'inline-block';
                        };
                    }

                    if (btnCancel) {
                        btnCancel.onclick = (e) => {
                            e.stopPropagation();
                            stopEditingFence(f._id, poly, false);
                            if (btnEdit) btnEdit.style.display = 'inline-block';
                            btnCancel.style.display = 'none';
                            if (btnSave) btnSave.style.display = 'none';
                        };
                    }

                    if (btnSave) {
                        btnSave.onclick = async (e) => {
                            e.stopPropagation();
                            await saveEditedFence(f._id);
                            stopEditingFence(f._id, poly, false);
                            if (btnEdit) btnEdit.style.display = 'inline-block';
                            btnSave.style.display = 'none';
                            if (btnCancel) btnCancel.style.display = 'none';
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

/* -------- EDITING HELPERS -------- */

function startEditingFence(id, poly) {
    if (!mapRef) return;

    // Stop any other edit session
    if (editingFenceId && editingFenceId !== id) {
        const prev = fenceLayers[editingFenceId];
        if (prev) stopEditingFence(editingFenceId, prev, false);
    }

    editingFenceId = id;

    const latlngs = (poly.getLatLngs && poly.getLatLngs()[0]) ? poly.getLatLngs()[0].slice() : [];
    if (!Array.isArray(latlngs) || latlngs.length < 3) return;

    editMarkers[id] = [];

    latlngs.forEach((ll, idx) => {
        const icon = L.divIcon({
            className: 'vertex-divicon',
            html: `<div style="width:12px;height:12px;border-radius:7px;background:#1976d2;border:2px solid white;box-shadow:0 1px 2px rgba(0,0,0,0.3);"></div>`,
            iconSize: [12, 12]
        });

        const m = L.marker([ll.lat, ll.lng], { draggable: true, icon }).addTo(drawnLayers);
        m._vertexIndex = idx;

        m.bindTooltip(formatLatLng(m.getLatLng()), { permanent: true, direction: 'right', className: 'vertex-tooltip' });

        m.on('drag', () => {
            try {
                const arr = poly.getLatLngs()[0];
                arr[m._vertexIndex] = m.getLatLng();
                poly.setLatLngs([arr]);
                m.setTooltipContent(formatLatLng(m.getLatLng()));
            } catch (e) { console.warn('drag update failed', e); }
        });

        m.on('click', () => {
            const cur = m.getLatLng();
            const val = prompt('Edit vertex (lat, lng):', `${cur.lat.toFixed(6)}, ${cur.lng.toFixed(6)}`);
            if (!val) return;
            const parts = val.split(/[;,\s]+/).map(s => s.trim()).filter(Boolean);
            if (parts.length < 2) return alert('Enter lat and lng');
            const nlat = Number(parts[0]);
            const nlng = Number(parts[1]);
            if (!Number.isFinite(nlat) || !Number.isFinite(nlng)) return alert('Invalid numbers');
            m.setLatLng([nlat, nlng]);
            const arr = poly.getLatLngs()[0];
            arr[m._vertexIndex] = m.getLatLng();
            poly.setLatLngs([arr]);
            m.setTooltipContent(formatLatLng(m.getLatLng()));
        });

        m.on('dblclick', () => {
            // remove vertex if >3
            const arr = poly.getLatLngs()[0];
            if (arr.length <= 3) return alert('Polygon needs at least 3 points');
            arr.splice(m._vertexIndex, 1);
            // remove marker and rebuild indices
            m.remove();
            editMarkers[id] = editMarkers[id].filter(x => x !== m);
            // update remaining markers' indices
            editMarkers[id].forEach((mk, i) => mk._vertexIndex = i);
            poly.setLatLngs([arr]);
        });

        editMarkers[id].push(m);
    });

    // allow adding a new vertex by clicking polygon while editing
    const addHandler = (e) => {
        const pt = e.latlng;
        const arr = poly.getLatLngs()[0];
        // find insertion index: nearest edge
        let best = { idx: 0, dist: Infinity };
        for (let i = 0; i < arr.length; i++) {
            const a = arr[i];
            const b = arr[(i + 1) % arr.length];
            const d = L.LineUtil.pointToSegmentDistance(mapRef.latLngToContainerPoint(pt), mapRef.latLngToContainerPoint(a), mapRef.latLngToContainerPoint(b));
            if (d < best.dist) { best = { idx: i + 1, dist: d }; }
        }
        arr.splice(best.idx, 0, pt);
        poly.setLatLngs([arr]);

        // rebuild markers
        editMarkers[id].forEach(mk => mk.remove());
        editMarkers[id] = [];
            poly.getLatLngs()[0].forEach((ll, idx) => {
            const mkIcon = L.divIcon({
                className: 'vertex-divicon',
                html: `<div style="width:12px;height:12px;border-radius:7px;background:#1976d2;border:2px solid white;box-shadow:0 1px 2px rgba(0,0,0,0.3);"></div>`,
                iconSize: [12, 12]
            });

            const mk = L.marker([ll.lat, ll.lng], { draggable: true, icon: mkIcon }).addTo(drawnLayers);
            mk._vertexIndex = idx;
            mk.bindTooltip(formatLatLng(mk.getLatLng()), { permanent: true, direction: 'right', className: 'vertex-tooltip' });
            mk.on('drag', () => {
                const a = poly.getLatLngs()[0];
                a[mk._vertexIndex] = mk.getLatLng();
                poly.setLatLngs([a]);
                mk.setTooltipContent(formatLatLng(mk.getLatLng()));
            });
            mk.on('click', () => {
                const cur = mk.getLatLng();
                const val = prompt('Edit vertex (lat, lng):', `${cur.lat.toFixed(6)}, ${cur.lng.toFixed(6)}`);
                if (!val) return;
                const parts = val.split(/[;,\s]+/).map(s => s.trim()).filter(Boolean);
                if (parts.length < 2) return alert('Enter lat and lng');
                const nlat = Number(parts[0]);
                const nlng = Number(parts[1]);
                if (!Number.isFinite(nlat) || !Number.isFinite(nlng)) return alert('Invalid numbers');
                mk.setLatLng([nlat, nlng]);
                const a = poly.getLatLngs()[0];
                a[mk._vertexIndex] = mk.getLatLng();
                poly.setLatLngs([a]);
                mk.setTooltipContent(formatLatLng(mk.getLatLng()));
            });
            mk.on('dblclick', () => {
                const a = poly.getLatLngs()[0];
                if (a.length <= 3) return alert('Polygon needs at least 3 points');
                a.splice(mk._vertexIndex, 1);
                mk.remove();
                editMarkers[id] = editMarkers[id].filter(x => x !== mk);
                editMarkers[id].forEach((pmk, i) => pmk._vertexIndex = i);
                poly.setLatLngs([a]);
            });
            editMarkers[id].push(mk);
        });
    };

    poly._addVertexHandler = addHandler;
    poly.on('click', addHandler);
}

function stopEditingFence(id, poly, removeMarkers = true) {
    if (!poly) return;
    try { poly.off('click', poly._addVertexHandler); } catch (e) {}
    poly._addVertexHandler = null;

    if (editMarkers[id]) {
        if (removeMarkers) {
            editMarkers[id].forEach(m => { try { m.remove(); } catch (e) {} });
            editMarkers[id] = null;
            delete editMarkers[id];
        }
    }

    if (editingFenceId === id) editingFenceId = null;
}

async function saveEditedFence(id) {
    if (!currentUser || currentUser.role !== 'admin') return alert('Only admins can edit geofences');
    const poly = fenceLayers[id];
    if (!poly) return alert('Polygon not found');

    const latlngs = (poly.getLatLngs && poly.getLatLngs()[0]) ? poly.getLatLngs()[0] : [];
    if (!Array.isArray(latlngs) || latlngs.length < 3) return alert('Need at least 3 points');

    const coords = latlngs.map(ll => [ll.lng, ll.lat]);

    // find original fence data to keep other fields
    const original = fences.find(x => x._id === id) || {};

    const payload = {
        name: original.name || 'Unnamed',
        description: original.description || '',
        coordinates: coords,
        nearMeters: original.nearMeters || 100,
        dangerLevel: original.dangerLevel || 'safe',
        autoNotifyRescue: original.autoNotifyRescue || false,
        timeRules: original.timeRules || []
    };

    try {
        const token = getToken();
        const resp = await fetch(API + '/geofences/' + id, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(txt || 'Save failed');
        }

        alert('✓ Geofence updated');
        loadFences();
    } catch (err) {
        alert('Error saving geofence: ' + err.message);
    }
}
