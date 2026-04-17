import { API } from './config.js';
import { getToken, currentUser } from './auth.js';
import { getDangerEmoji } from './ui.js';
import { loadFences, highlightFence, resetFence } from './geofence.js';
import * as locService from './locationService.js';

let watchId = null;
let userMarker = null;
let userPathCoords = [];
let userPathLine = null;
let mapVignette = null;

export function initLocation(mapInstance) {
    // Inject map vignette for danger overlay
    const mapContainer = document.getElementById('map');
    if (mapContainer && !document.getElementById('map-vignette')) {
        mapVignette = document.createElement('div');
        mapVignette.id = 'map-vignette';
        mapContainer.appendChild(mapVignette);
    }

    document.getElementById('watch').addEventListener('click', async () => {
        if (!currentUser) {
            return alert('Please login first');
        }

        if (watchId) {
            locService.clearWatch(watchId);
            watchId = null;
            document.getElementById('watch').textContent = '▶️ Start Watch';
            document.getElementById('status').textContent = 'Stopped';
            return;
        }

        if (Notification && Notification.permission !== 'granted') {
            await Notification.requestPermission();
        }

        document.getElementById('watch').textContent = '⏹️ Stop Watch';
        document.getElementById('status').textContent = '🔍 Watching...';
        await loadFences();

        watchId = locService.watchPosition(
            (pos) => onPos(pos, mapInstance),
            err => {
                console.error(err);
                document.getElementById('status').textContent = 'Geolocation error';
            },
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
        );
    });

    document.getElementById('my-location').addEventListener('click', () => showMyLocation(mapInstance));
    const rescueLocBtn = document.querySelector('#rescue-controls #my-location');
    if (rescueLocBtn) {
        rescueLocBtn.addEventListener('click', () => showMyLocation(mapInstance));
    }

    let simulating = false;
    const handleSimulationClick = (e) => {
        const fakePos = { coords: { latitude: e.latlng.lat, longitude: e.latlng.lng } };
        onPos(fakePos, mapInstance);
    };

    document.getElementById('simulate-movement').addEventListener('click', () => {
        if (!currentUser) return alert('Please login first');
        
        const btn = document.getElementById('simulate-movement');
        simulating = !simulating;
        window.isSimulating = simulating; // Export for use in geofence.js clicks
        
        if (simulating) {
            alert('Simulation Mode ON: Click anywhere on the map (even inside zones) to instantly move your location there.');
            btn.textContent = '⏹️ Stop Simulation';
            mapInstance.on('click', handleSimulationClick);
            if (document.getElementById('status')) {
                document.getElementById('status').textContent = 'Simulating... Click map';
            }
        } else {
            btn.textContent = '🏃 Simulate Movement';
            mapInstance.off('click', handleSimulationClick);
            if (document.getElementById('status')) {
                document.getElementById('status').textContent = 'Simulation stopped';
            }
        }
    });
}

function showMyLocation(map) {
    locService.getCurrentPosition(pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        map.setView([lat, lng], 17);

        updateUserMarker(lat, lng, map);

        document.getElementById('status').textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }, err => {
        console.error(err);
        document.getElementById('status').textContent = 'Geolocation error';
    }, { enableHighAccuracy: true });
}


function updateUserMarker(lat, lng, map) {
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([lat, lng], {
        icon: L.icon({
            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        })
    }).addTo(map);
}

// Map Visual Enhancements
function updatePath(lat, lng, map) {
    userPathCoords.push({ lat, lng });
    if (userPathLine) {
        if (Array.isArray(userPathLine)) {
            userPathLine.forEach(segment => map.removeLayer(segment));
        } else {
            map.removeLayer(userPathLine);
        }
    }
    userPathLine = null;
    // No route rendering; keep coords only for potential future use
}

function updateVignette(inDanger) {
    if (!mapVignette) return;
    if (inDanger) {
        mapVignette.classList.add('map-vignette-danger');
    } else {
        mapVignette.classList.remove('map-vignette-danger');
    }
}

async function onPos(pos, map) {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    const isSim = !!window.isSimulating;
    
    console.log(`[SIM:${isSim}] New location: ${lat}, ${lng}`);
    document.getElementById('status').textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    updateUserMarker(lat, lng, map);

    try {
        const token = getToken();
        if (!token) {
            console.warn('No auth token found, skipping check');
            return;
        }

        const params = new URLSearchParams({
            lat: String(lat),
            lng: String(lng)
        });

        if (isSim) {
            params.set('sim', '1');
        }

        const resp = await fetch(
            API + '/users/check?' + params.toString(),
            { headers: { 'Authorization': 'Bearer ' + token } }
        );

        if (!resp.ok) {
            console.error('Location check failed:', resp.status);
            return;
        }

        const data = await resp.json();
        console.log('Location check success:', data);

        // Interpret current danger status.
        // Keep the red vignette only while inside a danger/critical zone
        // or while inside the near-threshold buffer for those zones.
        const inDangerZone = Array.isArray(data.inside)
            && data.inside.some(f => ['danger', 'critical'].includes(f.effectiveDangerLevel || f.dangerLevel));

        const inDangerBuffer = Array.isArray(data.near)
            && data.near.some(f => ['danger', 'critical'].includes(f.effectiveDangerLevel || f.dangerLevel));

        const inDanger = inDangerZone || inDangerBuffer;

        updatePath(lat, lng, map);
        updateVignette(inDanger);

        // Handle visual highlights (independent of subscription)
        if (data.allEntered) {
            data.allEntered.forEach(f => {
                const dLevel = f.effectiveDangerLevel || f.dangerLevel;
                highlightFence(f._id, dLevel);
            });
        }

        if (data.allExited) {
            data.allExited.forEach(f => {
                resetFence(f._id);
            });
        }
        if (false && data.near) {
    data.near.forEach(f => {

        notifyUser(
            "⚠️ Approaching Risk Zone",
            `${f.name} within ${Math.round(f.distanceMeters)}m`
        );

    });
}

        // Handle notifications (requires subscription)
        if (data.entered) {
            data.entered.forEach(f => {
                const dLevel = f.effectiveDangerLevel || f.dangerLevel;
                const emoji = getDangerEmoji(dLevel);
                const enteredDate = f.enteredAt ? new Date(f.enteredAt) : new Date();
                const enteredTime = enteredDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const enteredBody = `${f.description || 'Stay alert!'} (Entered at: ${enteredTime})`;
                notifyUser(`${emoji} Entered: ${f.name}`, enteredBody, `enter-${f._id}`);
            });
        }

        if (data.exited) {
            data.exited.forEach(f => {
                notifyUser(`Exited: ${f.name}`, 'You left the area', `exit-${f._id}`);
            });
        }

        if (data.near) {
            data.near.forEach(f => {
                const emoji = getDangerEmoji(f.effectiveDangerLevel || f.dangerLevel);
                notifyUser(
                    `${emoji} Approaching Danger Zone`,
                    `${Math.round(f.distanceMeters)}m away from ${f.name} - ${f.description || 'Be careful'}`,
                    `near-${f._id}`
                );
            });
        }
    } catch (err) {
        console.error('Check error:', err);
    }
}

const localNotificationCooldown = new Map();
const LOCAL_NOTIFICATION_COOLDOWN_MS = 45 * 1000; // 45 seconds

function notifyUser(title, body, tag = 'notification') {
    const now = Date.now();
    const key = tag || `${title}|${body}`;
    const lastSent = localNotificationCooldown.get(key);
    if (lastSent && now - lastSent < LOCAL_NOTIFICATION_COOLDOWN_MS) return;
    localNotificationCooldown.set(key, now);

    if (Notification && Notification.permission === 'granted') {
        new Notification(title, { body, requireInteraction: true });
    } else {
        console.log(title, body);
    }
}
