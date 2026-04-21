const { test, expect } = require('@playwright/test');
const turf = require('@turf/turf');
const zoneData = require('../../data/mysuru-zones.json');

const TEST_ADMIN_EMAIL = 'test_admin@gmail.com';
const TEST_ADMIN_PASSWORD = 'test_admin';

function mapRiskLevel(riskLevel) {
  const normalized = String(riskLevel || '').toLowerCase();

  if (normalized === 'high') return 'danger';
  if (normalized === 'medium') return 'warning';
  if (normalized === 'low') return 'caution';

  return 'safe';
}

function buildCoordinates(lat, lon, radiusMeters) {
  return turf.circle([lon, lat], Math.max(0.05, Number(radiusMeters) / 1000), {
    steps: 64,
    units: 'kilometers',
  }).geometry.coordinates[0];
}

test.describe('Admin create geofence from JSON (E2E smoke)', () => {
  test('admin can create a geofence from JSON data', async ({ page }) => {
    test.setTimeout(60000); // Increase timeout to 60s for complex E2E operations
    await page.goto('http://localhost:3000/login.html');
    await page.waitForLoadState('networkidle');

    // Authenticate through the current login page flow.
    await page.waitForSelector('#login-form', { visible: true, timeout: 5000 });
    await page.fill('#login-email', TEST_ADMIN_EMAIL);
    await page.fill('#login-password', TEST_ADMIN_PASSWORD);
    await page.click('#login-form .btn-submit');

    // Wait for admin controls to appear
    await page.waitForSelector('#admin-controls', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(500); // Allow page to settle after login

    const sourceZone = zoneData.zones[0];
    const fenceName = `E2E JSON ${sourceZone.name} ${Date.now()}`;
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const coordinates = buildCoordinates(sourceZone.lat, sourceZone.lon, sourceZone.radius_m);
    const payload = {
      name: fenceName,
      description: `${zoneData.city || 'Zone'} - ${sourceZone.type || 'imported'}`,
      coordinates,
      nearMeters: 100,
      dangerLevel: mapRiskLevel(sourceZone.risk_level),
      autoNotifyRescue: ['danger', 'critical'].includes(mapRiskLevel(sourceZone.risk_level)),
      timeRules: [],
    };

    const createResponse = await page.request.post('http://localhost:3000/api/geofences', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: payload,
    });

    expect(createResponse.ok()).toBeTruthy();
    const createdFence = await createResponse.json();

    const listResponse = await page.request.get('http://localhost:3000/api/geofences');
    expect(listResponse.ok()).toBeTruthy();

    const geofences = await listResponse.json();
    expect(geofences.some((fence) => fence.name === fenceName)).toBeTruthy();

    await page.reload();
    await page.waitForSelector('#admin-controls', { state: 'visible', timeout: 15000 });

    try {
      const fenceTokenResponse = await page.request.delete(
        `http://localhost:3000/api/geofences/${createdFence._id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      expect(fenceTokenResponse.ok()).toBeTruthy();
    } catch (error) {
      // Leave the created fence in place if cleanup fails.
    }
  });
});