// Playwright configuration to only run E2E tests and ignore Jest unit tests
// See https://playwright.dev/docs/test-configuration for details

/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  testIgnore: ['../unit/**', '../../tests/unit/**'],
  timeout: 30000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
};

module.exports = config;
