// public/js/location.js
import { API } from './config.js';
import { getToken, currentUser } from './auth.js';
import { getDangerEmoji } from './ui.js';
import { loadFences } from './geofence.js';

let watchId = null;
let userMarker = null;

export function initLocation(mapInstance) {
    document.getElementById('watch').addEventListener('click', async () => {
        if (!currentUser) {
            return alert('Please login first');
        }

        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
            document.getElementById('watch').textContent = '▶️ Start Watch';
            document.getElementById('status').textContent = 'Stopped';
            return;
        }

        if (Notification && Notification.permission !== 'granted') {
            await Notification.requestPermission();
        }

        if (!navigator.geolocation) return alert('Geolocation not supported');

        document.getElementById('watch').textContent = '⏹️ Stop Watch';
        document.getElementById('status').textContent = '🔍 Watching...';
        await loadFences();

        watchId = navigator.geolocation.watchPosition(
            (pos) => onPos(pos, mapInstance),
            err => {
                console.error(err);
                document.getElementById('status').textContent = '❌ Geolocation error';
            },
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
        );
    });

    document.getElementById('my-location').addEventListener('click', () => showMyLocation(mapInstance));
    // Duplicate ID fix: rescue panel also has my-location button
    const rescueLocBtn = document.querySelector('#rescue-controls #my-location');
    if (rescueLocBtn) {
        rescueLocBtn.addEventListener('click', () => showMyLocation(mapInstance));
    }
}

function showMyLocation(map) {
    if (!navigator.geolocation) return alert('Geolocation not supported');

    navigator.geolocation.getCurrentPosition(pos => {
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
