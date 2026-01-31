// public/js/geofence.js
import { API } from './config.js';
import { getToken, getUserId, currentUser } from './auth.js';
import { getDangerColor, getDangerEmoji, showDangerLevelModal, closeModal } from './ui.js';
import { escapeHtml } from './utils.js';

let drawMode = false;
let drawMarkers = [];
let currentCoords = [];
let drawnLayers = null;
let fences = [];

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
        document.getElementById('draw-start').textContent = drawMode ? '⏹️ Stop Drawing' : '✏️ Start Drawing';

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
        const reminder = document.getElementById('reminder').value.trim();

        if (!name) return alert('Enter geofence name');
        if (currentCoords.length < 3) return alert('Need at least 3 points');

        showDangerLevelModal(name, description, reminder, currentCoords);
    });

    document.getElementById('load').addEventListener('click', loadFences);
    // Rescue panel reload button
    const rescueLoadBtn = document.querySelector('#rescue-controls #load');
    if (rescueLoadBtn) {
        rescueLoadBtn.addEventListener('click', loadFences);
    }
}

export async function saveFence(name, description, reminder, coords) {
    const nearMeters = parseInt(document.getElementById('near-meters').value) || 100;
    const dangerLevel = document.querySelector('input[name="danger"]:checked').value;
    const autoNotifyRescue = document.getElementById('auto-notify').checked;

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
                reminder,
                coordinates: coords,
                nearMeters,
                dangerLevel,
                autoNotifyRescue
            })
        });

        if (!resp.ok) throw new Error('Save failed');

        const saved = await resp.json();
        alert(`✓ Saved ${dangerLevel.toUpperCase()} zone: ${saved.name}`);

        // Reset drawing state (assuming mapInstance is available globally or we handle it differently if needed, 
        // but here we might need to access the map to clear markers. 
        // A cleaner way is to keep drawMarkers managed within this module, but we need map reference)
        // Since we attached markers to map in init, we might need to rely on clearing them here if we kept reference or just reload
        drawMarkers.forEach(m => m.remove()); // remove() works on layer
        drawMarkers = [];
        currentCoords = [];
        drawMode = false;
        document.getElementById('draw-start').textContent = '✏️ Start Drawing';
        document.getElementById('name').value = '';
        document.getElementById('description').value = '';
        document.getElementById('reminder').value = '';

        closeModal();
        loadFences();
    } catch (err) {
        alert(' Error: ' + err.message);
    }
}

export async function loadFences() {
    if (!drawnLayers) return; // Not initialized yet
    drawnLayers.clearLayers();

    try {
        const res = await fetch(API + '/geofences');
        fences = await res.json();

        const uid = getUserId();
        let user = null;

        if (uid) {
            const token = getToken();
            const headers = { 'Authorization': 'Bearer ' + token };
            const ur = await fetch(API + '/users/' + uid, { headers });
            if (ur.ok) user = await ur.json();
        }

        fences.forEach(f => {
            const latlngs = f.coordinates.map(c => [c[1], c[0]]);
            const color = getDangerColor(f.dangerLevel);
            const emoji = getDangerEmoji(f.dangerLevel);

            const poly = L.polygon(latlngs, {
                color: color,
                weight: 3,
                fillOpacity: 0.3
            }).addTo(drawnLayers);

            const subscribed = user && Array.isArray(user.subscribedGeofences) &&
                user.subscribedGeofences.map(String).includes(String(f._id));

            const subBtn = uid ?
                `<button id="btn-sub-${f._id}" class="btn-small">
            ${subscribed ? '🔕 Unsubscribe' : '🔔 Subscribe'}
          </button>` :
                '<em>Login to subscribe</em>';

            const deleteBtn = (currentUser && currentUser.role === 'admin') ?
                `<button id="btn-del-${f._id}" class="btn-delete">🗑️ Delete</button>` : '';

            const autoNotify = f.autoNotifyRescue ?
                '<br><strong style="color:#e74c3c;">🚓 Auto-notify rescue team</strong>' : '';

            const popupContent = `
          <div style="min-width:200px;">
            <h3 style="margin:0 0 10px 0;">${emoji} ${escapeHtml(f.name)}</h3>
            <p style="margin:5px 0;"><strong>Level:</strong> ${f.dangerLevel.toUpperCase()}</p>
            <p style="margin:5px 0;">${escapeHtml(f.description || f.reminder)}</p>
            <p style="margin:5px 0;"><small>Near threshold: ${f.nearMeters || 100}m</small></p>
            ${autoNotify}
            <div style="margin-top:10px;">
              ${subBtn}
              ${deleteBtn}
            </div>
          </div>
        `;

            poly.bindPopup(popupContent);

            poly.on('popupopen', () => {
                const btnSub = document.getElementById(`btn-sub-${f._id}`);
                if (btnSub) {
                    btnSub.onclick = () => {
                        if (subscribed) unsubscribeFence(f._id);
                        else subscribeFence(f._id);
                    };
                }

                const btnDel = document.getElementById(`btn-del-${f._id}`);
                if (btnDel) {
                    btnDel.onclick = () => deleteFence(f._id);
                }
            });
        });
    } catch (err) {
        console.error('Load fences error:', err);
    }
}

export async function subscribeFence(fenceId) {
    const uid = getUserId();
    if (!uid) return alert('Please login first');

    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    };

    try {
        const resp = await fetch(API + `/users/${uid}/subscribe`, {
            method: 'POST', headers, body: JSON.stringify({ fenceId })
        });

        if (!resp.ok) throw new Error('Subscribe failed');
        alert('✓ Subscribed to alerts for this area');
        loadFences();
    } catch (err) {
        alert(err.message);
    }
}

export async function unsubscribeFence(fenceId) {
    const uid = getUserId();
    if (!uid) return alert('Please login first');

    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    };

    try {
        const resp = await fetch(API + `/users/${uid}/unsubscribe`, {
            method: 'POST', headers, body: JSON.stringify({ fenceId })
        });

        if (!resp.ok) throw new Error('Unsubscribe failed');
        alert('✓ Unsubscribed');
        loadFences();
    } catch (err) {
        alert(err.message);
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
        alert(' Error: ' + err.message);
    }
}
