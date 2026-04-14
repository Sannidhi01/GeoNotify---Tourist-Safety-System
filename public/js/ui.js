import { currentUser, logout, register, login } from './auth.js';
import { loadFences, saveFence, applyManualCoords } from './geofence.js';
import { stopRescueUpdates } from './rescue.js';

export function positionPanels() {
    const panels = ['admin-controls', 'tourist-controls', 'rescue-controls', 'ai-insights-panel'];
    let currentTop = 120; // Start below the header

    panels.forEach(panelId => {
        const panel = document.getElementById(panelId);
        if (panel && panel.style.display !== 'none') {
            panel.style.top = currentTop + 'px';
            // Add some spacing between panels
            const panelHeight = panel.offsetHeight || 200; // fallback height
            currentTop += panelHeight + 20; // 20px gap
        }
    });
}

export function updateUIForUser() {
  const userInfo = document.getElementById('user-info');
  const authButtons = document.getElementById('auth-buttons');

  if (currentUser) {
    const roleEmoji = {
      'admin': '👑',
      'rescue': '🚓',
      'tourist': '🧳'
    };

    const roleColor = {
      'admin': '#FF6B6B',
      'rescue': '#4ECDC4',
      'tourist': '#45B7D1'
    };

    const emoji = roleEmoji[currentUser.role] || '👤';
    const color = roleColor[currentUser.role] || '#4CAF50';

    userInfo.innerHTML = `
        <span style="background:${color}; padding:5px 10px; border-radius:5px; color:white;">
          ${emoji} ${currentUser.name} (${currentUser.role.toUpperCase()})
        </span>
      `;

    authButtons.innerHTML = '<button id="btn-logout" class="btn-logout">Logout</button>';
    document.getElementById('btn-logout').onclick = logout;

    // Show/hide controls based on role
    document.getElementById('admin-controls').style.display =
      currentUser.role === 'admin' ? 'block' : 'none';

    document.getElementById('rescue-controls').style.display =
      currentUser.role === 'rescue' ? 'block' : 'none';

    // Stop rescue updates if user is not a rescue user
    if (currentUser.role !== 'rescue') {
        stopRescueUpdates();
    }

    document.getElementById('tourist-controls').style.display =
      currentUser.role === 'tourist' ? 'block' : 'none';

    // Admin requested: remove AI safety insights panel
    document.getElementById('ai-insights-panel').style.display = 'none';
  } else {
    // User is not logged in - redirect to login page
    window.location.href = '/login.html';
  }

  // Position panels to avoid overlap
  setTimeout(positionPanels, 50);

  const sidebarApplyBtn = document.getElementById('btn-apply-coords-sidebar');
  if (sidebarApplyBtn) {
    sidebarApplyBtn.onclick = () => {
      const raw = document.getElementById('manual-coords-sidebar').value;
      const result = applyManualCoords(raw);
      if (!result.ok) {
        alert(result.error || 'Invalid coordinates');
      } else {
        alert(`Applied ${result.count} points`);
      }
    };
  }

}

export function showRegister() {
  const modal = document.getElementById('auth-modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');

  title.textContent = 'Register New Account';
  content.innerHTML = `
      <input type="text" id="reg-name" placeholder="user name" required>
      <input type="email" id="reg-email" placeholder="Email" required>
      <input type="password" id="reg-password" placeholder="Password" required>
      <input type="tel" id="reg-phone" placeholder="Phone Number (optional, E.164 e.g. +919876543210)">
      
      <h4>Emergency Contact (Optional)</h4>
      <input type="text" id="reg-em-name" placeholder="Emergency Contact Name">
      <input type="tel" id="reg-em-phone" placeholder="Emergency Contact Phone (E.164)">
      <input type="text" id="reg-em-relation" placeholder="Relationship">
      
      <div style="margin:15px 0; padding:10px; background:#f0f0f0; border-radius:5px;">
      <h4>Register As:</h4>
      <div class="role-selector">
        <label class="role-option">
          <input type="radio" name="reg-role" value="tourist" checked>
          <span>🧳 Tourist</span>
        </label>
        
        <label class="role-option">
          <input type="radio" name="reg-role" value="admin">
          <span>👑 Admin</span>
        </label>
        
        <label class="role-option">
          <input type="radio" name="reg-role" value="rescue">
          <span>🚓 Rescue Team</span>
        </label>
      </div>
      </div>
      
      <button id="btn-register-submit" class="btn-primary">Register</button>
      <button id="btn-register-cancel" class="btn-secondary">Cancel</button>
    `;

  document.getElementById('btn-register-submit').onclick = register;
  document.getElementById('btn-register-cancel').onclick = closeModal;

  modal.style.display = 'flex';
}

export function showLogin() {
  const modal = document.getElementById('auth-modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');

  title.textContent = 'Login to GeoNotify';
  content.innerHTML = `
      <input type="email" id="login-email" placeholder="Email" required>
      <input type="password" id="login-password" placeholder="Password" required>
      
      <h4>Login As:</h4>
      <div class="role-selector">
        <label class="role-option">
          <input type="radio" name="role" value="tourist" checked>
          <span>🧳 Tourist</span>
          <small>Receive safety alerts</small>
        </label>
        
        <label class="role-option">
          <input type="radio" name="role" value="admin">
          <span>👑 Admin</span>
          <small>Manage geofences & users</small>
        </label>
        
        <label class="role-option">
          <input type="radio" name="role" value="rescue">
          <span>🚓 Rescue Team</span>
          <small>Respond to emergencies</small>
        </label>
      </div>
      
      <button id="btn-login-submit" class="btn-primary">Login</button>
      <button id="btn-login-cancel" class="btn-secondary">Cancel</button>
    `;

  document.getElementById('btn-login-submit').onclick = login;
  document.getElementById('btn-login-cancel').onclick = closeModal;

  modal.style.display = 'flex';
}

let tempTimeRules = [];

function renderTimeRules() {
  const list = document.getElementById('time-rules-list');
  if (!list) return;

  if (tempTimeRules.length === 0) {
    list.innerHTML = '<p style="font-size:0.8rem; color:#999; font-style:italic;">No time-based rules set.</p>';
    return;
  }

  list.innerHTML = tempTimeRules.map((rule, index) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:8px 12px; border-radius:6px; margin-bottom:5px; border:1px solid #eee; font-size:0.85rem;">
      <span><strong>${rule.startTime} - ${rule.endTime}</strong>: <span style="color:${getDangerColor(rule.dangerLevel)}">${rule.dangerLevel.toUpperCase()}</span></span>
      <button onclick="window.removeTimeRule(${index})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1rem; padding:0 5px;">&times;</button>
    </div>
  `).join('');
}

window.removeTimeRule = (index) => {
  tempTimeRules.splice(index, 1);
  renderTimeRules();
};

export function showDangerLevelModal(name, description, currentCoords) {
  const modal = document.getElementById('auth-modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');

  tempTimeRules = []; // Reset for new/edit

  title.textContent = 'Configure Geofence';
  content.innerHTML = `
      <h4>⚙️ ${name}</h4>
      
      <label>Warning Distance (meters):</label>
      <input type="number" id="near-meters" value="100" min="10" max="1000">
      
      <h4>Zone Safety Level:</h4>
      <div class="role-selector">
        <label class="role-option">
          <input type="radio" name="danger" value="safe" checked>
          <span style="color:#4CAF50;">✅ Safe Zone</span>
          <small>General tourist area</small>
        </label>
      </div>
      
      <div style="margin-top:20px; border-top:1px solid #ddd; padding-top:15px;">
        <h4 style="margin-bottom:10px;">Manual Coordinates</h4>
        <p style="font-size:0.8rem; color:#666; margin-bottom:10px;">
          Enter one point per line as "lat, lng" (example: 12.9716, 77.5946).
        </p>
        <textarea id="manual-coords" rows="5" style="width:100%; resize:vertical;" placeholder="lat, lng&#10;lat, lng&#10;lat, lng"></textarea>
        <button type="button" id="btn-apply-coords"
          style="margin-top:8px; padding:6px 12px; background:#1976d2; color:white; border:none; border-radius:4px; cursor:pointer;">
          Apply Points
        </button>
      </div>

      <div style="margin-top:20px; border-top:1px solid #ddd; padding-top:15px;">
        <h4 style="margin-bottom:10px;">🕒 Time-Based Rules</h4>
        <p style="font-size:0.8rem; color:#666; margin-bottom:10px;">Set different safety levels for specific times of day.</p>
        
        <div id="time-rules-list" style="margin-bottom:15px;">
           <!-- Rules populated here -->
        </div>

        <div style="background:#f8f9fa; padding:10px; border-radius:6px; border:1px dashed #ccc;">
            <div style="display:flex; gap:10px; margin-bottom:10px; align-items:center;">
                <input type="time" id="rule-start" style="margin:0;">
                <span>to</span>
                <input type="time" id="rule-end" style="margin:0;">
                <select id="rule-level" style="margin:0; padding:5px;">
                    <option value="safe">Safe</option>
                </select>
                <button type="button" id="btn-add-timerule" 
                    style="padding:5px 12px; background:#4f46e5; color:white; border:none; border-radius:4px; cursor:pointer;">
                    + Add
                </button>
            </div>
        </div>
      </div>
      
      <button id="btn-save-fence" class="btn-primary" style="margin-top:20px;">
        💾 Save Geofence
      </button>
      <button id="btn-save-cancel" class="btn-secondary">Cancel</button>
    `;

  modal.style.display = 'flex';

  document.getElementById('btn-save-fence').onclick = () => saveFence(name, description, currentCoords);
  document.getElementById('btn-save-cancel').onclick = closeModal;

  document.getElementById('btn-apply-coords').onclick = () => {
    const raw = document.getElementById('manual-coords').value;
    const result = applyManualCoords(raw);
    if (!result.ok) {
      alert(result.error || 'Invalid coordinates');
    } else {
      alert(`Applied ${result.count} points`);
    }
  };

  // Time Rule Listener
  document.getElementById('btn-add-timerule').onclick = () => {
    const start = document.getElementById('rule-start').value;
    const end = document.getElementById('rule-end').value;
    const level = document.getElementById('rule-level').value;

    if (!start || !end) return alert('Please set both start and end times');

    tempTimeRules.push({
      startTime: start,
      endTime: end,
      dangerLevel: level
    });

    renderTimeRules();
    
    // Reset inputs
    document.getElementById('rule-start').value = '';
    document.getElementById('rule-end').value = '';
  };

  renderTimeRules();
}

export function closeModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
}

export function getTimeRules() {
  return tempTimeRules;
}
export function getDangerColor(dangerLevel) {
  const colors = {
    'safe': '#4CAF50'
  };
  return colors[dangerLevel] || '#4CAF50';
}

export function getDangerEmoji(dangerLevel) {
  const emojis = {
    'safe': '✅'
  };
  return emojis[dangerLevel] || '✅';
}
