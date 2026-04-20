jest.mock('../../server/models/Geofence', () => ({
  findById: jest.fn(),
  find: jest.fn()
}));

jest.mock('../../server/models/NotificationLog', () => ({
  find: jest.fn()
}));

jest.mock('../../server/services/location.service', () => ({
  getEffectiveDangerLevel: jest.fn((fence) => {
    if (!fence?.timeRules || fence.timeRules.length === 0) {
      return fence?.dangerLevel;
    }

    const rule = fence.timeRules[0];
    return rule?.dangerLevel || fence.dangerLevel;
  }),
  calculateEffectiveLevel: jest.fn()
}));

jest.mock('../../server/services/weather.service', () => {
  const actual = jest.requireActual('../../server/services/weather.service');
  return {
    ...actual,
    getWeatherForGeofence: jest.fn()
  };
});

jest.mock('../../server/services/openrouter.service', () => ({
  generateSafetyAdvice: jest.fn()
}));

const Geofence = require('../../server/models/Geofence');
const NotificationLog = require('../../server/models/NotificationLog');
const weatherService = require('../../server/services/weather.service');
const openrouterService = require('../../server/services/openrouter.service');
const { calculateRiskScore } = require('../../server/services/risk.service');

describe('risk.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('applies time-rule override and weather bump before final advice', async () => {
    Geofence.findById.mockResolvedValue({
      _id: 'g1',
      name: 'Old Fort',
      dangerLevel: 'caution',
      timeRules: [
        {
          startTime: '00:00',
          endTime: '23:59',
          dangerLevel: 'danger'
        }
      ],
      coordinates: [
        [0, 0],
        [0, 1],
        [1, 1],
        [0, 0]
      ]
    });

    NotificationLog.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([])
    });

    weatherService.getWeatherForGeofence.mockResolvedValue({
      state: 'Rain',
      wind_speed: 0,
      visibility: 2000
    });

    openrouterService.generateSafetyAdvice.mockResolvedValue({});

    const result = await calculateRiskScore('g1');

    expect(result.baseDangerLevel).toBe('caution');
    expect(result.effectiveDangerLevel).toBe('critical');
    expect(result.score).toBe(100);
    expect(result.level).toBe('HIGH');
    expect(result.recommendation).toContain('Do not enter');
  });

  test('adds hotspot and density bonuses to the score calculation', async () => {
    Geofence.findById.mockResolvedValue({
      _id: 'g2',
      name: 'Bridge Zone',
      dangerLevel: 'warning',
      timeRules: [],
      coordinates: [
        [0, 0],
        [0, 1],
        [1, 1],
        [0, 0]
      ]
    });

    NotificationLog.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { location: { lat: 12.0, lng: 77.0 } },
        { location: { lat: 12.0001, lng: 77.0 } }
      ])
    });

    weatherService.getWeatherForGeofence.mockResolvedValue({
      state: 'Clear',
      wind_speed: 0,
      visibility: 2000
    });

    openrouterService.generateSafetyAdvice.mockResolvedValue({
      reasoning: 'AI reasoning',
      recommendation: 'Stay alert'
    });

    const RealDate = Date;
    const fixedNow = new RealDate('2026-04-20T12:00:00.000Z');
    function MockDate(...args) {
      const instance = args.length ? new RealDate(...args) : new RealDate(fixedNow);
      instance.getHours = () => 12;
      return instance;
    }
    MockDate.now = () => fixedNow.getTime();
    MockDate.parse = RealDate.parse;
    MockDate.UTC = RealDate.UTC;
    MockDate.prototype = RealDate.prototype;

    global.Date = MockDate;

    const result = await calculateRiskScore('g2');

    global.Date = RealDate;

    expect(result.incidentCountLast24h).toBe(2);
    expect(result.reasons).toContain('⚠️ Hazard Hotspots');
    expect(result.score).toBe(80);
    expect(result.level).toBe('HIGH');
    expect(result.recommendation).toBe('Stay alert');
  });
});