// public/js/ui.js
import { currentUser, logout, register, login } from './auth.js';
import { loadFences, saveFence } from './geofence.js';

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

        document.getElementById('tourist-controls').style.display =
            currentUser.role === 'tourist' ? 'block' : 'none';
    } else {
        userInfo.innerHTML = '<em>Not logged in</em>';
        authButtons.innerHTML = `
        <button id="btn-show-register" class="btn-primary">Register</button>
        <button id="btn-show-login" class="btn-secondary">Login</button>
      `;
        document.getElementById('btn-show-register').onclick = showRegister;
        document.getElementById('btn-show-login').onclick = showLogin;

        document.getElementById('admin-controls').style.display = 'none';
        document.getElementById('rescue-controls').style.display = 'none';
        document.getElementById('tourist-controls').style.display = 'none';
    }
}

export function showRegister() {
    const modal = document.getElementById('auth-modal');
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');

    title.textContent = 'Register New Account';
    content.innerHTML = `
      <input type="text" id="reg-name" placeholder="Full Name" required>
      <input type="email" id="reg-email" placeholder="Email" required>
      <input type="password" id="reg-password" placeholder="Password" required>
      <input type="tel" id="reg-phone" placeholder="Phone Number (optional)">
      
      <h4>Emergency Contact (Optional)</h4>
      <input type="text" id="reg-em-name" placeholder="Emergency Contact Name">
      <input type="tel" id="reg-em-phone" placeholder="Emergency Contact Phone">
      <input type="text" id="reg-em-relation" placeholder="Relationship">
      
      <div style="margin:15px 0; padding:10px; background:#f0f0f0; border-radius:5px;">
        <small><strong>Note:</strong> All new accounts are registered as <strong>Tourists</strong>. 
        Contact admin to upgrade to Admin or Rescue Team roles.</small>
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

export function closeModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'none';
}

export function showDangerLevelModal(name, description, reminder, currentCoords) {
    const modal = document.getElementById('auth-modal');
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');

    title.textContent = 'Configure Geofence';
    content.innerHTML = `
      <h4>⚙️ ${name}</h4>
      
      <label>Warning Distance (meters):</label>
      <input type="number" id="near-meters" value="100" min="10" max="1000">
      
      <h4>Danger Level:</h4>
      <div class="role-selector">
        <label class="role-option">
          <input type="radio" name="danger" value="safe" checked>
          <span style="color:#007bff;">✅ Safe</span>
          <small>General area</small>
        </label>
        
        <label class="role-option">
          <input type="radio" name="danger" value="caution">
          <span style="color:#FFD700;">⚡ Caution</span>
          <small>Be aware</small>
        </label>
        
        <label class="role-option">
          <input type="radio" name="danger" value="warning">
          <span style="color:#FFA500;">⚠️ Warning</span>
          <small>Stay alert</small>
        </label>
        
        <label class="role-option">
          <input type="radio" name="danger" value="danger">
          <span style="color:#FF0000;">⚠️ Danger</span>
          <small>High risk area</small>
        </label>
        
        <label class="role-option">
          <input type="radio" name="danger" value="critical">
          <span style="color:#8B0000;">🚨 Critical</span>
          <small>Extreme danger</small>
        </label>
      </div>
      
      <label style="display:flex; align-items:center; margin:15px 0;">
        <input type="checkbox" id="auto-notify" style="width:auto; margin-right:10px;">
        <span>🚓 Auto-notify rescue team for danger/critical zones</span>
      </label>
      
      <button id="btn-save-fence" class="btn-primary">
        💾 Save Geofence
      </button>
      <button id="btn-save-cancel" class="btn-secondary">Cancel</button>
    `;

    modal.style.display = 'flex';

    // Auto-check notify for danger/critical
    document.querySelectorAll('input[name="danger"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const autoNotify = document.getElementById('auto-notify');
            if (['danger', 'critical'].includes(e.target.value)) {
                autoNotify.checked = true;
            }
        });
    });

    document.getElementById('btn-save-fence').onclick = () => saveFence(name, description, reminder, currentCoords);
    document.getElementById('btn-save-cancel').onclick = closeModal;
}

export function getDangerColor(dangerLevel) {
    const colors = {
        'critical': '#8B0000',
        'danger': '#FF0000',
        'warning': '#FFA500',
        'caution': '#FFFF00',
        'safe': '#007bff'
    };
    return colors[dangerLevel] || '#007bff';
}

export function getDangerEmoji(dangerLevel) {
    const emojis = {
        'critical': '🚨',
        'danger': '⚠️',
        'warning': '⚠️',
        'caution': '⚡',
        'safe': '✅'
    };
    return emojis[dangerLevel] || '✅';
}
