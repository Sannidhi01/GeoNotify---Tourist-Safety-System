import { initGeofence, loadFences } from './geofence.js';
import { initLocation } from './location.js';
import { getUserId, getToken, setCurrentUser } from './auth.js';
import { updateUIForUser } from './ui.js';
import { API } from './config.js';
import { startRescueUpdates } from './rescue.js';
import { initAIInsights } from './ai-insights.js';

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

initGeofence(map);
initLocation(map);

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
            } else {
                localStorage.clear();
            }
        } catch (err) {
            console.error('Init error:', err);
        }
    }

    updateUIForUser();

    // After user is set, apply role-based logic
    if (currentUser) {
        if (currentUser.role === 'admin') {
            document.getElementById('admin-controls').style.display = 'block';
        } else if (currentUser.role === 'rescue') {
            document.getElementById('rescue-controls').style.display = 'block';
            startRescueUpdates();
        } else {
            document.getElementById('ai-insights-panel').style.display = 'block';
            initAIInsights();
        }
    }

    loadFences();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(req => console.log('SW Registered'))
            .catch(err => console.log('SW Error', err));
    }
})();