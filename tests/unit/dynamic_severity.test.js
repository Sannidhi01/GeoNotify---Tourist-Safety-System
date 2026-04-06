// Moved from server/tests/dynamic_severity.test.js
// This test should be run with Jest, not Playwright.

const { getDynamicSeverity } = require('../../server/services/risk.service');

describe('getDynamicSeverity', () => {
  it('returns correct severity for low risk', () => {
    expect(getDynamicSeverity(0.1)).toBe('Low');
  });

  it('returns correct severity for medium risk', () => {
    expect(getDynamicSeverity(0.5)).toBe('Medium');
  });

  it('returns correct severity for high risk', () => {
    expect(getDynamicSeverity(0.9)).toBe('High');
  });
});
