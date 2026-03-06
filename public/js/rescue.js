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

    // Set up Alerts History Modal Listeners
    const btnViewAlerts = document.getElementById('view-all-alerts');
    const modalAlerts = document.getElementById('alerts-history-modal');
    const closeAlerts = document.querySelector('.close-alerts-modal');

    if (btnViewAlerts && modalAlerts && closeAlerts) {
        btnViewAlerts.onclick = () => {
            modalAlerts.style.display = 'block';
            loadAllAlertsHistory();
        };

        closeAlerts.onclick = () => {
            modalAlerts.style.display = 'none';
        };

        // Close on outside click
        window.addEventListener('click', (event) => {
            if (event.target == modalAlerts) {
                modalAlerts.style.display = 'none';
            }
        });
    }
}

async function loadAllAlertsHistory() {
    if (!currentUser || currentUser.role !== 'rescue') return;
    const content = document.getElementById('alerts-history-content');
    content.innerHTML = '<p>Loading history...</p>';

    try {
        const token = getToken();
        const resp = await fetch(API + '/rescue', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!resp.ok) {
            content.innerHTML = '<p>Failed to load alerts.</p>';
            return;
        }

        const logs = await resp.json();
        
        if (logs.length === 0) {
            content.innerHTML = '<p>No alerts found in history.</p>';
            return;
        }

        content.innerHTML = logs.map(log => `
            <div style="border-bottom: 1px solid #ccc; padding: 10px 0;">
                <p style="margin:0;"><strong>Time:</strong> ${new Date(log.timestamp).toLocaleString()}</p>
                <p style="margin:0;"><strong>User:</strong> ${log.userId ? (log.userId.name + ' (' + log.userId.email + ')') : 'Unknown'}</p>
                <p style="margin:0;"><strong>Zone:</strong> ${log.geofenceId ? (log.geofenceId.name + ' [' + log.geofenceId.dangerLevel + ']') : 'Unknown'}</p>
                <p style="margin:0;"><strong>Type:</strong> ${log.notificationType}</p>
                <p style="margin:0;"><strong>Message:</strong> ${log.message}</p>
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load alert history:', err);
        content.innerHTML = '<p>Error loading history.</p>';
    }
}
