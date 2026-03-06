const crypto = require('crypto');

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
    adjustDangerLevelByWeather
};
