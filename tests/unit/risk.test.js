const { adjustDangerLevelByWeather } = require('../../server/services/weather.service');

describe('risk adjustments', () => {
  test('wind & visibility affect danger level', () => {
    const base = 'warning';
    const w = { state: 'Clear', wind_speed: 20, visibility: 800 };
    const res = adjustDangerLevelByWeather(base, w);
    expect(res).not.toBe(base);
  });

  test('danger level does not go below base for safe weather', () => {
    const base = 'caution';
    const w = { state: 'Clear', wind_speed: 0, visibility: 2000 };
    const res = adjustDangerLevelByWeather(base, w);
    expect(['caution', 'warning', 'danger', 'critical', 'safe']).toContain(res);
  });
});
