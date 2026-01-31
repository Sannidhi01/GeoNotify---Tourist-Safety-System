// public/js/app.js
import { initGeofence, loadFences } from './geofence.js';
import { initLocation } from './location.js';
import { getUserId, getToken, setCurrentUser } from './auth.js';
import { updateUIForUser } from './ui.js';
import { API } from './config.js';
import { startRescueUpdates } from './rescue.js';

// Initialize Map
const map = L.map('map').setView([12.9716, 77.5946], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

if (typeof L.Control.Geocoder !== 'undefined') {
    L.Control.geocoder({
        placeholder: "Search location...",
        defaultMarkGeocode: true,
        geocoder: L.Control.Geocoder.photon()
    })
        .on('markgeocode', function (e) {
            map.setView(e.geocode.center, 17);
            L.marker(e.geocode.center).addTo(map)
                .bindPopup(e.geocode.name).openPopup();
        })
        .addTo(map);
}

// Initialize Modules
initGeofence(map);
initLocation(map);
startRescueUpdates();

// Check Login State
(async function init() {
    const storedUserId = getUserId();
    const storedToken = getToken();

    if (storedUserId && storedToken) {
        try {
            const resp = await fetch(API + '/users/' + storedUserId, {
                headers: { 'Authorization': 'Bearer ' + storedToken }
            });

            if (resp.ok) {
                const user = await resp.json();
                setCurrentUser(user);
                loadFences();
            } else {
                // Invalid token or user
                localStorage.clear();
                updateUIForUser();
            }
        } catch (err) {
            console.error('Init error:', err);
            updateUIForUser();
        }
    } else {
        updateUIForUser();
    }

    // Always load fences initially (public read)
    loadFences();

    // Register Service Worker if supported
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(req => console.log('SW Registered'))
            .catch(err => console.log('SW Error', err));
    }
})();
