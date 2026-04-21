const { test, expect } = require('@playwright/test');
const turf = require('@turf/turf');
const zoneData = require('../../data/mysuru-zones.json');

function uniqueEmail(prefix) {
  return `${prefix}.${Date.now()}@example.com`;
}

function buildCoordinates(lat, lon, radiusMeters) {
  return turf.circle([lon, lat], Math.max(0.05, Number(radiusMeters) / 1000), {
    steps: 64,
    units: 'kilometers',
  }).geometry.coordinates[0];
}

function toDangerLevel(riskLevel) {
  const normalized = String(riskLevel || '').toLowerCase();

  if (normalized === 'high') return 'danger';
  if (normalized === 'medium') return 'warning';
  if (normalized === 'low') return 'caution';

  return 'safe';
}

async function registerUser(request, user) {
  const response = await request.post('http://localhost:3000/api/auth/register', {
    data: user,
  });

  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.describe('Tourist and rescue alert flow', () => {
  test('tourist entering a danger zone shows up on rescue dashboard', async ({ page, request }) => {
    test.setTimeout(60000);

    const sourceZone = zoneData.zones.find((zone) => String(zone.risk_level).toLowerCase() === 'high')
      || zoneData.zones[0];

    const admin = await registerUser(request, {
      name: `E2E Admin ${Date.now()}`,
      email: uniqueEmail('e2e-admin'),
      password: 'test_admin',
      role: 'admin',
    });

    const tourist = await registerUser(request, {
      name: `E2E Tourist ${Date.now()}`,
      email: uniqueEmail('e2e-tourist'),
      password: 'test_tourist',
      phone: '+15550001111',
      role: 'tourist',
    });

    const rescue = await registerUser(request, {
      name: `E2E Rescue ${Date.now()}`,
      email: uniqueEmail('e2e-rescue'),
      password: 'test_rescue',
      role: 'rescue',
    });

    const fenceName = `E2E Alert ${sourceZone.name} ${Date.now()}`;
    const coordinates = buildCoordinates(sourceZone.lat, sourceZone.lon, sourceZone.radius_m);
    const dangerLevel = toDangerLevel(sourceZone.risk_level);

    const createFenceResponse = await request.post('http://localhost:3000/api/geofences', {
      headers: {
        Authorization: `Bearer ${admin.token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: fenceName,
        description: `${zoneData.city || 'Zone'} - ${sourceZone.type || 'imported'}`,
        coordinates,
        nearMeters: 100,
        dangerLevel,
        autoNotifyRescue: ['danger', 'critical'].includes(dangerLevel),
        timeRules: [],
      },
    });

    expect(createFenceResponse.ok()).toBeTruthy();
    const createdFence = await createFenceResponse.json();

    try {
      const locationResponse = await request.get(
        `http://localhost:3000/api/users/check?lat=${sourceZone.lat}&lng=${sourceZone.lon}&sim=1`,
        {
          headers: {
            Authorization: `Bearer ${tourist.token}`,
          },
        }
      );

      expect(locationResponse.ok()).toBeTruthy();
      const locationData = await locationResponse.json();
      expect(Array.isArray(locationData.allEntered) || Array.isArray(locationData.entered)).toBeTruthy();
      expect((locationData.allEntered || locationData.entered || []).length).toBeGreaterThan(0);

      await expect.poll(async () => {
        const rescueAlertsResponse = await request.get('http://localhost:3000/api/rescue/active-alerts', {
          headers: {
            Authorization: `Bearer ${rescue.token}`,
          },
        });

        expect(rescueAlertsResponse.ok()).toBeTruthy();
        const rescueAlerts = await rescueAlertsResponse.json();
        return Array.isArray(rescueAlerts.recentLogs) ? rescueAlerts.recentLogs.length : 0;
      }, { timeout: 15000 }).toBeGreaterThan(0);

      const rescueAlertsResponse = await request.get('http://localhost:3000/api/rescue/active-alerts', {
        headers: {
          Authorization: `Bearer ${rescue.token}`,
        },
      });

      expect(rescueAlertsResponse.ok()).toBeTruthy();
      const rescueAlerts = await rescueAlertsResponse.json();
      const recentLogText = JSON.stringify(rescueAlerts.recentLogs || []);

      expect(recentLogText).toContain(tourist.user.name);
      expect(recentLogText).toContain(fenceName);

      await page.addInitScript((state) => {
        localStorage.clear();
        Object.entries(state).forEach(([key, value]) => localStorage.setItem(key, value));
      }, {
        token: rescue.token,
        userId: rescue.user.id,
        userRole: rescue.user.role,
        userName: rescue.user.name,
      });

      await page.goto('http://localhost:3000/index.html');
      await page.waitForSelector('#rescue-controls', { state: 'visible', timeout: 15000 });
      await expect(page.locator('#rescue-dashboard')).toContainText(tourist.user.name, { timeout: 15000 });
      await expect(page.locator('#rescue-dashboard')).toContainText(fenceName, { timeout: 15000 });
    } finally {
      const cleanupResponse = await request.delete(`http://localhost:3000/api/geofences/${createdFence._id}`, {
        headers: {
          Authorization: `Bearer ${admin.token}`,
        },
      });

      expect(cleanupResponse.ok()).toBeTruthy();
    }
  });
});