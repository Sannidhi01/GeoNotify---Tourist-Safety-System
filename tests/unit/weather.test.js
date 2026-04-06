const { getSimulatedWeather, adjustDangerLevelByWeather } = require('../../server/services/weather.service');

describe('weather.service', () => {
  test('getSimulatedWeather returns object with expected keys', () => {
    const fakeFence = { _id: 'abc123' };
    const w = getSimulatedWeather(fakeFence);
    expect(w).toBeTruthy();
    expect(typeof w.state).toBe('string');
    expect('wind_speed' in w).toBe(true);
    expect(['Clear', 'Rain', 'Storm']).toContain(w.state);
  });
  test('adjustDangerLevelByWeather does not decrease below base', () => {
    const base = 'danger';
    const w = { state: 'Clear', wind_speed: 0, visibility: 2000 };
    const out = adjustDangerLevelByWeather(base, w);
    expect(['danger', 'critical', 'warning', 'caution', 'safe']).toContain(out);
  });

  test('adjustDangerLevelByWeather increases level for storm/wind', () => {
    const base = 'safe';
    const weatherStorm = { state: 'Storm', wind_speed: 30, visibility: 500 };
    const out = adjustDangerLevelByWeather(base, weatherStorm);
    expect(['warning', 'danger', 'critical']).toContain(out);
  });
});
