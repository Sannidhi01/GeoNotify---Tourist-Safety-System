const API = 'http://127.0.0.1:3000/api';

let userMarker;
//load openstreet map
const map = L.map('map').setView([12.9716, 77.5946], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

//load leaflet plugin and add photon geaocoder
if (typeof L.Control.Geocoder !== 'undefined') {
  const geocoder = L.Control.Geocoder.photon({
    url: 'https://photon.komoot.io/api/',
  });

  const searchControl = L.Control.geocoder({
    placeholder: "Search for buildings, streets, areas...",
    defaultMarkGeocode: true,
    geocoder: geocoder,
    showResultIcons: true
  })
    .on('markgeocode', function (e) {
      const latlng = e.geocode.center;
      map.setView(latlng, 17);
      L.marker(latlng)
        .addTo(map)
        .bindPopup(e.geocode.name || e.geocode.properties.name)
        .openPopup();
    })
    .addTo(map);
} else {
  alert("Leaflet Control Geocoder failed to load");
}

// Drawing geofences
let drawMode = false;
let drawMarkers = [];
let currentCoords = [];
let drawnLayers = L.featureGroup().addTo(map);
let fences = [];

// map clicks to add points of geofence
map.on('click', e => {
  if (!drawMode) return;
  const m = L.circleMarker(e.latlng, { radius: 6, color: '#d00' }).addTo(map);
  drawMarkers.push(m);
  currentCoords.push([e.latlng.lng, e.latlng.lat]);
});
// strt/stop drawing
document.getElementById('draw-start').addEventListener('click', () => {
  drawMode = !drawMode;
  document.getElementById('draw-start').textContent = drawMode ? 'Stop drawing' : 'Start drawing';
  if (!drawMode && currentCoords.length === 0) drawMarkers.forEach(m => map.removeLayer(m));
});
 
// Save geofence to server
document.getElementById('save').addEventListener('click', async () => {
  const name = document.getElementById('name').value.trim();
  const reminder = document.getElementById('reminder').value.trim();
  if (!name) return alert('Enter name');
  if (currentCoords.length < 3) return alert('Need at least 3 points');
  try {
    const resp = await fetch(API + '/geofences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, reminder, coordinates: currentCoords })
    });
    const saved = await resp.json();
    alert('Saved fence: ' + saved._id);
    drawMarkers.forEach(m => map.removeLayer(m));
    drawMarkers = [];
    currentCoords = [];
    drawMode = false;
    document.getElementById('draw-start').textContent = 'Start drawing';
    loadFences();
  } catch (err) { alert('Error: ' + err.message); }
});


// load and show
async function loadFences() {
  drawnLayers.clearLayers();
  const res = await fetch(API + '/geofences');
  fences = await res.json();
  fences.forEach(f => {
    const latlngs = f.coordinates.map(c => [c[1], c[0]]);
    const poly = L.polygon(latlngs, { color: '#007bff', weight: 2 }).addTo(drawnLayers);
    poly.bindPopup(`<b>${escapeHtml(f.name)}</b><br>${escapeHtml(f.reminder)}<br><button onclick="deleteFence('${f._id}')">Delete</button>`);
  });
}
document.getElementById('load').addEventListener('click', loadFences);
loadFences();

let watchId = null;
let insideSet = new Set();

document.getElementById('watch').addEventListener('click', async () => {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    document.getElementById('watch').textContent = 'Start watch';
    document.getElementById('status').textContent = 'Stopped';
    insideSet.clear();
    return;
  }
  if (Notification && Notification.permission !== 'granted') await Notification.requestPermission();
  if (!navigator.geolocation) return alert('Geolocation not supported');
  document.getElementById('watch').textContent = 'Stop watch';
  document.getElementById('status').textContent = 'Watching...';
  await loadFences();
  watchId = navigator.geolocation.watchPosition(onPos, err => {
    console.error(err);
    document.getElementById('status').textContent = 'Geolocation error';
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
});

document.getElementById('my-location').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Geolocation not supported');
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    map.setView([lat, lng], 17);
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([lat, lng], { icon: L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }) }).addTo(map);
    document.getElementById('status').textContent = `Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }, err => {
    console.error(err);
    document.getElementById('status').textContent = 'Geolocation error';
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
});

async function onPos(pos) {
  const lat = pos.coords.latitude, lng = pos.coords.longitude;
  document.getElementById('status').textContent = `You: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const pt = turf.point([lng, lat]);
  for (const f of fences) {
    let coords = f.coordinates.slice();
    const first = coords[0], last = coords[coords.length - 1];
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
    const poly = turf.polygon([coords]);
    const key = f._id;
    if (turf.booleanPointInPolygon(pt, poly) && !insideSet.has(key)) {
      insideSet.add(key);
      notifyUser(`Entered: ${f.name}`, f.reminder || 'Reminder');
    } else if (!turf.booleanPointInPolygon(pt, poly) && insideSet.has(key)) {
      insideSet.delete(key);
    }
  }
}

function notifyUser(title, body) {
  if (Notification && Notification.permission === 'granted') {
    new Notification(title, { body });
  } else { alert(title + '\n' + body); }
}

function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[m])); }

async function deleteFence(id) {
  if (!confirm('Are you sure you want to delete this geofence?')) return;
  console.log('Attempting to delete fence with ID:', id);
  try {
    const resp = await fetch(API + '/geofences/' + id, { method: 'DELETE' });
    console.log('Delete response status:', resp.status, resp.statusText);
    if (resp.ok) {
      alert('Geofence deleted');
      loadFences();
    } else {
      const errorText = await resp.text();
      console.error('Delete error response:', errorText);
      alert('Error deleting geofence: ' + resp.status + ' ' + resp.statusText + ' - ' + errorText);
    }
  } catch (err) {
    console.error('Delete fetch error:', err);
    alert('Error: ' + err.message);
  }
}
