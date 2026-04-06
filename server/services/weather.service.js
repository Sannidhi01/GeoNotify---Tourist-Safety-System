const crypto = require('crypto');

const WEATHER_CACHE = new Map();
const WEATHER_TTL_MS = Math.max(5 * 60 * 1000, Number(process.env.WEATHER_CACHE_MS || 10 * 60 * 1000));

function getSimulatedWeather(geofence) {
    // Generate a deterministic weather object based on geofence ID and current hour
    const hour = new Date().getHours();
    const hash = crypto.createHash('md5').update(geofence._id.toString() + hour).digest('hex');
    const val = parseInt(hash.substring(0, 2), 16); // 0-255

    // Map value to coarse state
    let state = 'Clear';
    if (val <= 150) state = 'Clear';
    else if (val <= 200) state = 'Rain';
    else state = 'Storm';

    return {
        state,
        main: state,
        description: state,
        temp: null,
        feels_like: null,
        wind_speed: null,
        visibility: null,
        // precipitation_mm removed
    };
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

async function getRealWeather(geofence) {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) return null;

    const center = getGeofenceCenter(geofence);
    if (!center) return null;

    // Use 4 decimal precision (~11m) to reduce accidental cache collisions for nearby zones
    const cacheKey = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
    const cached = WEATHER_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < WEATHER_TTL_MS) {
        return cached.data;
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${center.lat}&lon=${center.lng}&appid=${apiKey}&units=metric`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();

        const main = data?.weather?.[0]?.main || '';
        const id = Number(data?.weather?.[0]?.id || 0);
        const description = data?.weather?.[0]?.description || '';
        const temp = data?.main?.temp ?? null;
        const feels_like = data?.main?.feels_like ?? null;
        const wind_speed = data?.wind?.speed ?? null;
        const visibility = data?.visibility ?? null; // meters
        // precipitation_mm removed from output; we may still read rain/snow if needed elsewhere

        // Determine coarse state
        let state = 'Clear';
        if (main === 'Thunderstorm' || (id >= 200 && id < 300)) state = 'Storm';
        else if (main === 'Rain' || main === 'Drizzle' || (id >= 300 && id < 600)) state = 'Rain';
        else if (main === 'Snow' || (id >= 600 && id < 700)) state = 'Storm';
        else if (main === 'Clouds') state = 'Clear';

        const result = {
            state,
            main,
            id,
            description,
            temp,
            feels_like,
            wind_speed,
            visibility,
            // precipitation_mm removed
        };

        WEATHER_CACHE.set(cacheKey, { data: result, ts: Date.now() });
        return result;
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

    const state = typeof weather === 'string' ? weather : (weather && weather.state) || 'Clear';

    // Base bumps for coarse states
    if (state === 'Rain') idx = Math.min(levels.length - 1, idx + 1);
    else if (state === 'Storm') idx = Math.min(levels.length - 1, idx + 2);

    // Additional adjustments from detailed parameters (if provided)
    const wind = Number(weather?.wind_speed ?? 0);
    const vis = Number(weather?.visibility ?? Infinity);

    if (!Number.isNaN(wind)) {
        if (wind >= 25) idx = Math.min(levels.length - 1, idx + 2);
        else if (wind >= 15) idx = Math.min(levels.length - 1, idx + 1);
    }

    if (!Number.isNaN(vis) && vis < 1000) {
        idx = Math.min(levels.length - 1, idx + 1);
    }

    return levels[idx];
}

module.exports = {
    getSimulatedWeather,
    getWeatherForGeofence,
    adjustDangerLevelByWeather
};
