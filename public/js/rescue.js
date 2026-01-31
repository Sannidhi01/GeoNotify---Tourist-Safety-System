// public/js/rescue.js
import { API } from './config.js';
import { getToken, currentUser } from './auth.js';

let rescueInterval = null;

export async function loadRescueDashboard() {
    if (!currentUser || currentUser.role !== 'rescue') return;

    try {
        const token = getToken();
        const resp = await fetch(API + '/rescue/active-alerts', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!resp.ok) return;

        const alerts = await resp.json();

        const dashboard = document.getElementById('rescue-dashboard');
        if (alerts.length === 0) {
            dashboard.innerHTML = '<p>No active alerts</p>';
            return;
        }

        dashboard.innerHTML = `
      <h4>🚨 Active Danger Alerts (${alerts.length})</h4>
      ${alerts.map(alert => `
        <div class="alert-card">
          <h5>${alert.tourist.name}</h5>
          <p><strong>Zone:</strong> ${alert.geofence.name} (${alert.geofence.dangerLevel.toUpperCase()})</p>
          <p><strong>Phone:</strong> ${alert.tourist.phone || 'N/A'}</p>
          <p><strong>Location:</strong> ${alert.tourist.currentLocation?.lat.toFixed(5)}, ${alert.tourist.currentLocation?.lng.toFixed(5)}</p>
          ${alert.tourist.emergencyContact?.name ? `<p><strong>Emergency Contact:</strong> ${alert.tourist.emergencyContact.name} (${alert.tourist.emergencyContact.phone})</p>` : ''}
        </div>
      `).join('')}
    `;
    } catch (err) {
        console.error('Load rescue dashboard error:', err);
    }
}

export function startRescueUpdates() {
    // Refresh rescue dashboard every 10 seconds
    if (rescueInterval) clearInterval(rescueInterval);
    rescueInterval = setInterval(() => {
        if (currentUser && currentUser.role === 'rescue') {
            loadRescueDashboard();
        }
    }, 10000);
}
