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

        const data = await resp.json();
        const { activeAlerts, recentLogs } = data;

        const dashboard = document.getElementById('rescue-dashboard');
        
        let html = '';

        // SECTION 1: ACTIVE ALERTS
        html += `<div class="dashboard-section">
            <h4 style="margin-bottom:10px;">⚠️ ACTIVE DASHBOARD (${activeAlerts.length})</h4>
            ${activeAlerts.length === 0 ? '<p>No active alerts (real-time)</p>' : activeAlerts.map(alert => `
                <div class="alert-card ${alert.tourist.status === 'APPROACHING' ? 'alert-approaching' : 'alert-danger'}">
                  <h5>${alert.tourist.name} <span class="status-badge">${alert.tourist.status}</span></h5>
                  <p><strong>Zone:</strong> ${alert.geofence.name} (${alert.geofence.dangerLevel.toUpperCase()})</p>
                  <p><strong>Location:</strong> ${alert.tourist.currentLocation?.lat.toFixed(5)}, ${alert.tourist.currentLocation?.lng.toFixed(5)}</p>
                  ${alert.tourist.emergencyContact?.name ? `
                    <div class="emergency-box" style="margin-top:8px; padding:8px; border:2px solid #e74c3c; border-radius:4px; background:#fff5f5; font-size:0.85rem;">
                        <strong style="color:#c0392b;">🆘 EMERGENCY CONTACT:</strong><br>
                        ${alert.tourist.emergencyContact.name} (${alert.tourist.emergencyContact.phone})
                    </div>
                  ` : ''}
                </div>
            `).join('')}
        </div>`;

        // SECTION 2: RECENT LOGS
        html += `<div class="dashboard-section" style="margin-top:20px; border-top: 1px solid #ddd; padding-top:10px;">
            <h4 style="margin-bottom:10px;">📋 RECENT DANGER ENTRIES</h4>
            <div class="recent-logs-list" style="max-height:300px; overflow-y:auto; border:1px solid #eee; padding:10px; border-radius:8px; background:#fdfdfd;">
                ${recentLogs.length === 0 ? '<p>No recent danger entries</p>' : recentLogs.map(log => `
                    <div class="log-entry" style="border-bottom: 1px solid #eee; padding:8px 0; font-size:0.9rem;">
                        <span style="color:#666; font-size:0.75rem;">${new Date(log.timestamp).toLocaleTimeString()}</span> - 
                        <strong>${log.userId?.name || 'Unknown'}</strong> entered 
                        <span style="color:#e74c3c; font-weight:bold;">${log.geofenceId?.name || 'Unknown'}</span>
                        ${log.userId?.emergencyContact?.name ? `
                            <div style="margin-top:4px; color:#c0392b; font-size:0.8rem;">
                                <strong>🆘 Contact:</strong> ${log.userId.emergencyContact.name} (${log.userId.emergencyContact.phone})
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        </div>`;

        dashboard.innerHTML = html;
    } catch (err) {
        console.error('Load rescue dashboard error:', err);
    }
}
export function stopRescueUpdates() {
    if (rescueInterval) {
        clearInterval(rescueInterval);
        rescueInterval = null;
    }
}

export function startRescueUpdates() {
    // Refresh rescue dashboard every 10 seconds
    if (rescueInterval) clearInterval(rescueInterval);
    rescueInterval = setInterval(() => {
        if (currentUser && currentUser.role === 'rescue') {
            loadRescueDashboard();
        }
    }, 2000);

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
                ${log.userId?.emergencyContact?.name ? `
                    <div style="margin-top:5px; padding:5px; background:#fff5f5; border:1px solid #e74c3c; border-radius:4px; font-size:0.85rem;">
                        <strong>🆘 CONTACT:</strong> ${log.userId.emergencyContact.name} (${log.userId.emergencyContact.phone})
                    </div>
                ` : ''}
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load alert history:', err);
        content.innerHTML = '<p>Error loading history.</p>';
    }
}
