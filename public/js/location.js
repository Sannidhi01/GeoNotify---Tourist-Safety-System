import { API } from './config.js';
import { getToken, currentUser } from './auth.js';
import { getDangerEmoji } from './ui.js';
import { loadFences } from './geofence.js';
import * as locService from './locationService.js';

let watchId = null;
let userMarker = null;

export function initLocation(mapInstance) {
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

    // Simulation logic
    let simulating = false;
    const handleSimulationClick = (e) => {
        const fakePos = { coords: { latitude: e.latlng.lat, longitude: e.latlng.lng } };
        onPos(fakePos, mapInstance);
    };

    document.getElementById('simulate-movement').addEventListener('click', () => {
        if (!currentUser) return alert('Please login first');
        
        const btn = document.getElementById('simulate-movement');
        simulating = !simulating;
        
        if (simulating) {
            alert('Simulation Mode ON: Click anywhere on the map to instantly move your location there.');
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

async function onPos(pos, map) {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    document.getElementById('status').textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    // Optional: Auto-pan to user if tracking? 
    // map.setView([lat, lng], map.getZoom()); 
    updateUserMarker(lat, lng, map);

    try {
        const token = getToken();
        const resp = await fetch(
            API + '/users/check?' + new URLSearchParams({ lat: String(lat), lng: String(lng) }),
            { headers: { 'Authorization': 'Bearer ' + token } }
        );

        if (!resp.ok) return;

        const data = await resp.json();

        // Handle notifications
        if (data.entered) {
            data.entered.forEach(f => {
                const emoji = getDangerEmoji(f.dangerLevel);
                notifyUser(`${emoji} Entered: ${f.name}`, f.reminder || 'Stay alert!');
            });
        }

        if (data.exited) {
            data.exited.forEach(f => {
                notifyUser(`Exited: ${f.name}`, 'You left the area');
            });
        }

        if (data.near) {
            data.near.forEach(f => {
                const emoji = getDangerEmoji(f.dangerLevel);
                notifyUser(
                    `${emoji} Nearby: ${f.name}`,
                    `${Math.round(f.distanceMeters)}m away - ${f.reminder || 'Be careful'}`
                );
            });
        }
    } catch (err) {
        console.error('Check error:', err);
    }
}

function notifyUser(title, body) {
    if (Notification && Notification.permission === 'granted') {
        new Notification(title, { body, requireInteraction: true });
    } else {
        console.log(title, body);
    }
}
