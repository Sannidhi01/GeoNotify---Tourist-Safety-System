const crypto = require('crypto');

const WEATHER_CACHE = new Map();
const WEATHER_TTL_MS = Math.max(5 * 60 * 1000, Number(process.env.WEATHER_CACHE_MS || 10 * 60 * 1000));

function getSimulatedWeather(geofence) {
    // Generate a deterministic weather state based on geofence ID and current hour
    const hour = new Date().getHours();
    const hash = crypto.createHash('md5').update(geofence._id.toString() + hour).digest('hex');
    const val = parseInt(hash.substring(0, 2), 16); // 0-255

    // 0-150: Clear
    // 151-200: Rain
    // 201-255: Storm
    if (val <= 150) return 'Clear';
    if (val <= 200) return 'Rain';
    return 'Storm';
}

function getGeofenceCenter(geofence) {
    if (!geofence || !Array.isArray(geofence.coordinates) || geofence.coordinates.length === 0) {
        return null;
    }
    let sumLat = 0;
    let sumLng = 0;
    let count = 0;
    for (const c of geofence.coordinates) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const lng = Number(c[0]);
        const lat = Number(c[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        sumLat += lat;
        sumLng += lng;
        count += 1;
    }
    if (!count) return null;
    return { lat: sumLat / count, lng: sumLng / count };
}

function mapOpenWeatherToState(data) {
    const main = data?.weather?.[0]?.main || '';
    const id = Number(data?.weather?.[0]?.id);

    if (main === 'Thunderstorm' || (id >= 200 && id < 300)) return 'Storm';
    if (main === 'Rain' || main === 'Drizzle' || (id >= 300 && id < 600)) return 'Rain';
    if (main === 'Snow' || (id >= 600 && id < 700)) return 'Storm';
    if (main === 'Clouds') return 'Clear';
    return 'Clear';
}

async function getRealWeather(geofence) {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) return null;

    const center = getGeofenceCenter(geofence);
    if (!center) return null;

    const cacheKey = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
    const cached = WEATHER_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < WEATHER_TTL_MS) {
        return cached.state;
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${center.lat}&lon=${center.lng}&appid=${apiKey}&units=metric`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        const state = mapOpenWeatherToState(data);
        WEATHER_CACHE.set(cacheKey, { state, ts: Date.now() });
        return state;
    } catch (err) {
        return null;
    }
}

async function getWeatherForGeofence(geofence) {
    const real = await getRealWeather(geofence);
    if (real) return real;
    return getSimulatedWeather(geofence);
}

function adjustDangerLevelByWeather(baseLevel, weather) {
    const levels = ['safe', 'caution', 'warning', 'danger', 'critical'];
    let idx = levels.indexOf(baseLevel);
    if (idx === -1) idx = 0;

    if (weather === 'Rain') {
        idx = Math.min(levels.length - 1, idx + 1); // bump by 1 level
    } else if (weather === 'Storm') {
        idx = Math.min(levels.length - 1, idx + 2); // bump by 2 levels
    }
    
    return levels[idx];
}

module.exports = {
    getSimulatedWeather,
    getWeatherForGeofence,
    adjustDangerLevelByWeather
};
