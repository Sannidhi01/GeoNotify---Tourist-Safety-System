const API = 'http://127.0.0.1:3000/api';

let userMarker;
let currentUser = null;

 //AUTH HELPERS 

function getUserId() { return localStorage.getItem('userId'); }
function getToken() { return localStorage.getItem('token'); }

function setCurrentUser(user) {
  currentUser = user;
  updateUIForUser();
}

function updateUIForUser() {
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
    
    authButtons.innerHTML = '<button onclick="logout()" class="btn-logout">Logout</button>';
    
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
      <button onclick="showRegister()" class="btn-primary">Register</button>
      <button onclick="showLogin()" class="btn-secondary">Login</button>
    `;
    document.getElementById('admin-controls').style.display = 'none';
    document.getElementById('rescue-controls').style.display = 'none';
    document.getElementById('tourist-controls').style.display = 'none';
  }
}

function logout() {
  localStorage.clear();
  currentUser = null;
  updateUIForUser();
  alert('✓ Logged out successfully');
  location.reload();
}

// REGISTRATION 

function showRegister() {
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
    
    <button onclick="register()" class="btn-primary">Register</button>
    <button onclick="closeModal()" class="btn-secondary">Cancel</button>
  `;
  
  modal.style.display = 'flex';
}

async function register() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const phone = document.getElementById('reg-phone').value.trim();
  
  const emName = document.getElementById('reg-em-name').value.trim();
  const emPhone = document.getElementById('reg-em-phone').value.trim();
  const emRelation = document.getElementById('reg-em-relation').value.trim();
  
  if (!name || !email || !password) {
    return alert('Please fill in all required fields');
  }
  
  try {
    const emergencyContact = (emName || emPhone) ? {
      name: emName,
      phone: emPhone,
      relationship: emRelation
    } : undefined;
    
    const resp = await fetch(API + '/auth/register', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, email, password, phone, emergencyContact })
    });
    
    if (!resp.ok) {
      const error = await resp.json();
      throw new Error(error.error || 'Registration failed');
    }
    
    const data = await resp.json();
    alert('✓ Registration successful! Please login to continue.');
    closeModal();
  } catch (err) {
    alert('Registration failed: ' + err.message);
  }
}

// LOGIN 

function showLogin() {
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
    
    <button onclick="login()" class="btn-primary">Login</button>
    <button onclick="closeModal()" class="btn-secondary">Cancel</button>
  `;
  
  modal.style.display = 'flex';
}

async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const role = document.querySelector('input[name="role"]:checked').value;
  
  if (!email || !password) {
    return alert('Please enter email and password');
  }
  
  try {
    const resp = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ email, password, role })
    });
    
    if (!resp.ok) {
      const error = await resp.json();
      throw new Error(error.error || 'Login failed');
    }
    
    const data = await resp.json();
    localStorage.setItem('token', data.token);
    localStorage.setItem('userId', data.user.id);
    setCurrentUser(data.user);
    
    closeModal();
    alert(`✓ Welcome ${data.user.name}! Logged in as ${role.toUpperCase()}`);
    
    // Enable push notifications
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      if (confirm('Enable push notifications for alerts?')) {
        try {
          await registerForPush();
          alert('✓ Push notifications enabled');
        } catch (e) {
          console.warn('Push registration failed:', e);
        }
      }
    }
    
    loadFences();
    
    // Load dashboard based on role
    if (role === 'rescue') {
      loadRescueDashboard();
    }
  } catch (err) {
    alert(' Login failed: ' + err.message);
  }
}

function closeModal() {
  document.getElementById('auth-modal').style.display = 'none';
}

// GEOFENCE MANAGEMENT 

async function subscribeFence(fenceId) {
  const uid = getUserId();
  if (!uid) return alert('Please login first');
  
  const token = getToken();
  const headers = { 
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token
  };
  
  try {
    const resp = await fetch(API + `/users/${uid}/subscribe`, { 
      method: 'POST', headers, body: JSON.stringify({ fenceId }) 
    });
    
    if (!resp.ok) throw new Error('Subscribe failed');
    alert('✓ Subscribed to alerts for this area');
    loadFences();
  } catch (err) {
    alert(err.message);
  }
}

async function unsubscribeFence(fenceId) {
  const uid = getUserId();
  if (!uid) return alert('Please login first');
  
  const token = getToken();
  const headers = { 
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token
  };
  
  try {
    const resp = await fetch(API + `/users/${uid}/unsubscribe`, { 
      method: 'POST', headers, body: JSON.stringify({ fenceId }) 
    });
    
    if (!resp.ok) throw new Error('Unsubscribe failed');
    alert('✓ Unsubscribed');
    loadFences();
  } catch (err) {
    alert(err.message);
  }
}

//  MAP SETUP 

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
  .on('markgeocode', function(e) {
    map.setView(e.geocode.center, 17);
    L.marker(e.geocode.center).addTo(map)
      .bindPopup(e.geocode.name).openPopup();
  })
  .addTo(map);
}

// Drawing geofences
let drawMode = false;
let drawMarkers = [];
let currentCoords = [];
let drawnLayers = L.featureGroup().addTo(map);
let fences = [];

map.on('click', e => {
  if (!drawMode) return;
  const m = L.circleMarker(e.latlng, {radius: 6, color: '#d00'}).addTo(map);
  drawMarkers.push(m);
  currentCoords.push([e.latlng.lng, e.latlng.lat]);
});

document.getElementById('draw-start').addEventListener('click', () => {
  if (!currentUser || currentUser.role !== 'admin') {
    return alert('Only admins can draw geofences');
  }
  
  drawMode = !drawMode;
  document.getElementById('draw-start').textContent = drawMode ? '⏹️ Stop Drawing' : '✏️ Start Drawing';
  
  if (!drawMode && currentCoords.length === 0) {
    drawMarkers.forEach(m => map.removeLayer(m));
  }
});

document.getElementById('save').addEventListener('click', async () => {
  if (!currentUser || currentUser.role !== 'admin') {
    return alert('Only admins can save geofences');
  }
  
  const name = document.getElementById('name').value.trim();
  const description = document.getElementById('description').value.trim();
  const reminder = document.getElementById('reminder').value.trim();
  
  if (!name) return alert('Enter geofence name');
  if (currentCoords.length < 3) return alert('Need at least 3 points');
  
  // Show danger level selection modal
  showDangerLevelModal(name, description, reminder);
});

function showDangerLevelModal(name, description, reminder) {
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
    
    <button onclick="saveFence('${name}', '${description}', '${reminder}')" class="btn-primary">
      💾 Save Geofence
    </button>
    <button onclick="closeModal()" class="btn-secondary">Cancel</button>
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
}

async function saveFence(name, description, reminder) {
  const nearMeters = parseInt(document.getElementById('near-meters').value) || 100;
  const dangerLevel = document.querySelector('input[name="danger"]:checked').value;
  const autoNotifyRescue = document.getElementById('auto-notify').checked;
  
  try {
    const token = getToken();
    const resp = await fetch(API + '/geofences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ 
        name, 
        description,
        reminder, 
        coordinates: currentCoords, 
        nearMeters,
        dangerLevel,
        autoNotifyRescue
      })
    });
    
    if (!resp.ok) throw new Error('Save failed');
    
    const saved = await resp.json();
    alert(`✓ Saved ${dangerLevel.toUpperCase()} zone: ${saved.name}`);
    
    drawMarkers.forEach(m => map.removeLayer(m));
    drawMarkers = [];
    currentCoords = [];
    drawMode = false;
    document.getElementById('draw-start').textContent = '✏️ Start Drawing';
    document.getElementById('name').value = '';
    document.getElementById('description').value = '';
    document.getElementById('reminder').value = '';
    
    closeModal();
    loadFences();
  } catch (err) {
    alert(' Error: ' + err.message);
  }
}

function getDangerColor(dangerLevel) {
  const colors = {
    'critical': '#8B0000',
    'danger': '#FF0000',
    'warning': '#FFA500',
    'caution': '#FFFF00',
    'safe': '#007bff'
  };
  return colors[dangerLevel] || '#007bff';
}

function getDangerEmoji(dangerLevel) {
  const emojis = {
    'critical': '🚨',
    'danger': '⚠️',
    'warning': '⚠️',
    'caution': '⚡',
    'safe': '✅'
  };
  return emojis[dangerLevel] || '✅';
}

async function loadFences() {
  drawnLayers.clearLayers();
  
  try {
    const res = await fetch(API + '/geofences');
    fences = await res.json();
    
    const uid = getUserId();
    let user = null;
    
    if (uid) {
      const token = getToken();
      const headers = { 'Authorization': 'Bearer ' + token };
      const ur = await fetch(API + '/users/' + uid, { headers });
      if (ur.ok) user = await ur.json();
    }
    
    fences.forEach(f => {
      const latlngs = f.coordinates.map(c => [c[1], c[0]]);
      const color = getDangerColor(f.dangerLevel);
      const emoji = getDangerEmoji(f.dangerLevel);
      
      const poly = L.polygon(latlngs, { 
        color: color, 
        weight: 3,
        fillOpacity: 0.3
      }).addTo(drawnLayers);
      
      const subscribed = user && Array.isArray(user.subscribedGeofences) && 
        user.subscribedGeofences.map(String).includes(String(f._id));
      
      const subBtn = uid ? 
        `<button onclick="${subscribed ? 'unsubscribeFence' : 'subscribeFence'}('${f._id}')" class="btn-small">
          ${subscribed ? '🔕 Unsubscribe' : '🔔 Subscribe'}
        </button>` : 
        '<em>Login to subscribe</em>';
      
      const deleteBtn = (currentUser && currentUser.role === 'admin') ? 
        `<button onclick="deleteFence('${f._id}')" class="btn-delete">🗑️ Delete</button>` : '';
      
      const autoNotify = f.autoNotifyRescue ? 
        '<br><strong style="color:#e74c3c;">🚓 Auto-notify rescue team</strong>' : '';
      
      poly.bindPopup(`
        <div style="min-width:200px;">
          <h3 style="margin:0 0 10px 0;">${emoji} ${escapeHtml(f.name)}</h3>
          <p style="margin:5px 0;"><strong>Level:</strong> ${f.dangerLevel.toUpperCase()}</p>
          <p style="margin:5px 0;">${escapeHtml(f.description || f.reminder)}</p>
          <p style="margin:5px 0;"><small>Near threshold: ${f.nearMeters || 100}m</small></p>
          ${autoNotify}
          <div style="margin-top:10px;">
            ${subBtn}
            ${deleteBtn}
          </div>
        </div>
      `);
    });
  } catch (err) {
    console.error('Load fences error:', err);
  }
}

async function deleteFence(id) {
  if (!currentUser || currentUser.role !== 'admin') {
    return alert('Only admins can delete geofences');
  }
  
  if (!confirm('Are you sure you want to delete this geofence?')) return;
  
  try {
    const token = getToken();
    const resp = await fetch(API + '/geofences/' + id, { 
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    
    if (!resp.ok) throw new Error('Delete failed');
    
    alert('✓ Geofence deleted');
    loadFences();
  } catch (err) {
    alert(' Error: ' + err.message);
  }
}

//  LOCATION TRACKING 

let watchId = null;

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
  
  watchId = navigator.geolocation.watchPosition(onPos, err => {
    console.error(err);
    document.getElementById('status').textContent = '❌ Geolocation error';
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
});

document.getElementById('my-location').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Geolocation not supported');
  
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    map.setView([lat, lng], 17);
    
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
    
    document.getElementById('status').textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }, err => {
    console.error(err);
    document.getElementById('status').textContent = 'Geolocation error';
  }, { enableHighAccuracy: true });
});

async function onPos(pos) {
  const lat = pos.coords.latitude, lng = pos.coords.longitude;
  document.getElementById('status').textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  
  try {
    const token = getToken();
    const resp = await fetch(
      API + '/check?' + new URLSearchParams({ lat: String(lat), lng: String(lng) }), 
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

// ============ RESCUE DASHBOARD ============

async function loadRescueDashboard() {
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

// Refresh rescue dashboard every 10 seconds
setInterval(() => {
  if (currentUser && currentUser.role === 'rescue') {
    loadRescueDashboard();
  }
}, 10000);

//  PUSH NOTIFICATIONS 

async function registerForPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push not supported');
  }
  
  const sw = await navigator.serviceWorker.register('/sw.js');
  const reg = await navigator.serviceWorker.ready;
  const vap = await fetch(API + '/push/vapidPublicKey');
  if (!vap.ok) throw new Error('No VAPID key');
  
  const { publicKey } = await vap.json();
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  
  const converted = urlBase64ToUint8Array(publicKey);
  const sub = await reg.pushManager.subscribe({ 
    userVisibleOnly: true, 
    applicationServerKey: converted 
  });
  
  const uid = getUserId();
  const token = getToken();
  await fetch(API + `/users/${uid}/push-subscribe`, { 
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ subscription: sub })
  });
  
  return sub;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function escapeHtml(s) { 
  return (s || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m])); 
}

//  INITIALIZATION 

document.getElementById('load').addEventListener('click', loadFences);

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
        
        if (user.role === 'rescue') {
          loadRescueDashboard();
        }
        return;
      }
    } catch (e) {
      console.warn('Session restore failed:', e);
      localStorage.clear();
    }
  }
  
  updateUIForUser();
  loadFences();
})();
