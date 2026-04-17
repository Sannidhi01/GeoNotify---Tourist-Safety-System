const { test, expect } = require('@playwright/test');

const TEST_ADMIN_EMAIL = 'test_admin@gmail.com';
const TEST_ADMIN_PASSWORD = 'test_admin';

test.describe('Admin edit geofence (E2E smoke)', () => {
  test('admin can create and edit a geofence', async ({ page }) => {
    test.setTimeout(60000); // Increase timeout to 60s for complex E2E operations
    await page.goto('http://localhost:3000');

    // Open login modal
    await page.click('text=Login');
    
    // Wait for auth modal to be visible and fully rendered
    await page.waitForSelector('#auth-modal', { visible: true, timeout: 5000 });
    await page.waitForSelector('#modal-content', { visible: true, timeout: 5000 });
    
    // Wait a moment for modal animation to complete
    await page.waitForTimeout(500);
    
    // Fill login form
    await page.fill('input[type="email"]', TEST_ADMIN_EMAIL);
    await page.fill('input[type="password"]', TEST_ADMIN_PASSWORD);
    
    // Select admin role radio
    await page.check('input[type="radio"][value="admin"]');
    
    // Wait for the login button to be clickable (within modal)
    await page.waitForSelector('#auth-modal button:has-text("Login")', { visible: true, timeout: 5000 });
    await page.click('#auth-modal button:has-text("Login")');

    // Wait for admin controls to appear
    await page.waitForSelector('#admin-controls', { timeout: 5000 });
    await page.waitForTimeout(500); // Allow page to settle after login

    // Create a new geofence
    const fenceName = `E2E Fence ${Date.now()}`;
    
    // Wait for form fields to be visible
    await page.waitForSelector('#name', { timeout: 5000 });
    await page.waitForSelector('#description', { timeout: 5000 });
    
    await page.fill('#name', fenceName);
    await page.fill('#description', 'E2E test fence');
    
    // Wait for draw button and map to be ready
    await page.waitForSelector('#draw-start', { timeout: 5000 });
    await page.waitForSelector('#map', { timeout: 5000 });
    
    await page.click('#draw-start');
    // Click 3 points on the map (simulate)
    const map = await page.$('#map');
    const box = await map.boundingBox();
    // Click 3 points in a triangle
    await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
    await page.waitForTimeout(200);
    await page.mouse.click(box.x + box.width/2 + 40, box.y + box.height/2);
    await page.waitForTimeout(200);
    await page.mouse.click(box.x + box.width/2, box.y + box.height/2 + 40);
    await page.waitForTimeout(200);
    
    await page.click('#draw-start'); // Stop drawing
    await page.waitForTimeout(300);
    
    // Wait for save button to be visible
    await page.waitForSelector('#save', { timeout: 5000 });
    await page.click('#save');

    // Modal: select danger level and save
    await page.waitForSelector('#btn-save-fence', { timeout: 3000 });
    await page.waitForTimeout(300); // Wait for modal animation
    
    // Verify the full danger-level selector is available again
    await page.waitForSelector('input[type="radio"][name="danger"][value="safe"]', { timeout: 3000 });
    await page.waitForSelector('input[type="radio"][name="danger"][value="caution"]', { timeout: 3000 });
    await page.waitForSelector('input[type="radio"][name="danger"][value="warning"]', { timeout: 3000 });
    await page.waitForSelector('input[type="radio"][name="danger"][value="danger"]', { timeout: 3000 });
    await page.waitForSelector('input[type="radio"][name="danger"][value="critical"]', { timeout: 3000 });

    // Pick a non-safe level and save
    await page.waitForSelector('input[type="radio"][name="danger"][value="caution"]', { timeout: 3000 });
    await page.click('input[type="radio"][name="danger"][value="caution"]');
    await page.waitForTimeout(200);
    
    await page.click('#btn-save-fence');

    // Wait for fence to appear on map
    await page.waitForTimeout(1500);
    
    // Click fence name to open fence details/edit options
    await page.waitForSelector(`text=${fenceName}`, { timeout: 5000 });
    await page.click(`text=${fenceName}`);
    await page.waitForTimeout(300);

    // Edit the geofence
    await page.waitForSelector('button.btn-edit', { timeout: 3000 });
    await page.click('button.btn-edit');
    await page.waitForTimeout(500); // Wait for edit mode to activate
    
    // Drag first vertex marker (simulate small move)
    const marker = await page.$('.vertex-divicon');
    if (marker) {
      const markerBox = await marker.boundingBox();
      await page.mouse.move(markerBox.x + 6, markerBox.y + 6);
      await page.waitForTimeout(100);
      await page.mouse.down();
      await page.mouse.move(markerBox.x + 16, markerBox.y + 16);
      await page.waitForTimeout(100);
      await page.mouse.up();
    }
    
    // Save edit
    await page.waitForSelector('button.btn-save', { timeout: 3000 });
    await page.click('button.btn-save');

    // Verify success alert or UI update
    await page.waitForTimeout(1000);
    // Optionally, check for alert or updated polygon
    expect(await page.isVisible('text=' + fenceName)).toBeTruthy();
  });
});
