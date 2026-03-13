const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const Geofence = require('../models/Geofence');

const RISK_LEVEL_MAP = {
    low: 'caution',
    medium: 'warning',
    high: 'danger'
};

let watchHandle = null;
let debounceTimer = null;

function mapRiskLevel(risk) {
    if (!risk) return 'warning';
    const key = String(risk).toLowerCase();
    return RISK_LEVEL_MAP[key] || 'warning';
}

function buildCirclePolygon(lat, lon, radiusMeters) {
    const radiusKm = Math.max(0.05, Number(radiusMeters) / 1000);
    const circle = turf.circle([lon, lat], radiusKm, { steps: 64, units: 'kilometers' });
    return circle.geometry.coordinates[0];
}

function resolveImportFilePath() {
    return process.env.ZONE_IMPORT_FILE || path.join(__dirname, '../../data/mysuru-zones.json');
}

async function importZonesFromFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const zones = Array.isArray(data.zones) ? data.zones : [];

    let created = 0;
    let updated = 0;

    for (const z of zones) {
        if (!z || !z.name || typeof z.lat !== 'number' || typeof z.lon !== 'number' || !z.radius_m) {
            continue;
        }

        const coordinates = buildCirclePolygon(z.lat, z.lon, z.radius_m);
        const dangerLevel = mapRiskLevel(z.risk_level);

        const payload = {
            name: z.name,
            description: `${data.city || 'Zone'} - ${z.type || 'imported'}`,
            reminder: '',
            coordinates,
            nearMeters: 100,
            dangerLevel,
            autoNotifyRescue: ['danger', 'critical'].includes(dangerLevel),
            timeRules: []
        };

        const existing = await Geofence.findOne({ name: z.name });
        if (existing) {
            await Geofence.updateOne({ _id: existing._id }, { $set: payload });
            updated++;
        } else {
            await Geofence.create(payload);
            created++;
        }
    }

    return { created, updated, total: zones.length };
}

async function importZonesIfEnabled() {
    const flag = String(process.env.AUTO_IMPORT_ZONES || '').toLowerCase();
    if (flag !== 'true' && flag !== '1' && flag !== 'yes') {
        return null;
    }

    const filePath = resolveImportFilePath();
    if (!fs.existsSync(filePath)) {
        console.warn(`Zone import file not found: ${filePath}`);
        return null;
    }

    try {
        const result = await importZonesFromFile(filePath);
        console.log(`Zone import completed. Created: ${result.created}, Updated: ${result.updated}, Total: ${result.total}`);
        return result;
    } catch (err) {
        console.error('Zone import failed:', err.message);
        return null;
    }
}

function startZoneImportWatcher() {
    const flag = String(process.env.AUTO_IMPORT_ZONES || '').toLowerCase();
    if (flag !== 'true' && flag !== '1' && flag !== 'yes') {
        return null;
    }

    const filePath = resolveImportFilePath();
    if (!fs.existsSync(filePath)) {
        console.warn(`Zone import file not found: ${filePath}`);
        return null;
    }

    if (watchHandle) return watchHandle;

    watchHandle = fs.watch(filePath, { persistent: true }, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            try {
                const result = await importZonesFromFile(filePath);
                console.log(`Zone import updated. Created: ${result.created}, Updated: ${result.updated}, Total: ${result.total}`);
            } catch (err) {
                console.error('Zone import update failed:', err.message);
            }
        }, 500);
    });

    console.log(`Zone import watcher enabled: ${filePath}`);
    return watchHandle;
}

module.exports = { importZonesIfEnabled, importZonesFromFile, resolveImportFilePath, startZoneImportWatcher };
