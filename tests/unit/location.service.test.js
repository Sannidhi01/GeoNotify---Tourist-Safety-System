jest.mock('@turf/turf', () => ({
  point: jest.fn((coords) => ({ coords })),
  distance: jest.fn(),
  polygon: jest.fn((coords) => ({ coords })),
  lineString: jest.fn((coords) => ({ coords })),
  booleanPointInPolygon: jest.fn(),
  pointToLineDistance: jest.fn()
}));

jest.mock('../../server/models/Geofence', () => ({
  find: jest.fn()
}));

jest.mock('../../server/models/NotificationLog', () => ({
  findOne: jest.fn()
}));

jest.mock('../../server/services/weather.service', () => ({
  getWeatherForGeofence: jest.fn(),
  adjustDangerLevelByWeather: jest.fn((baseLevel, weather) => {
    const levels = ['safe', 'caution', 'warning', 'danger', 'critical'];
    let idx = levels.indexOf(baseLevel);
    if (idx === -1) idx = 0;

    const state = typeof weather === 'string' ? weather : (weather && weather.state) || 'Clear';
    if (state === 'Rain') idx = Math.min(levels.length - 1, idx + 1);
    else if (state === 'Storm') idx = Math.min(levels.length - 1, idx + 2);

    const wind = Number(weather?.wind_speed ?? 0);
    const visibility = Number(weather?.visibility ?? Infinity);

    if (!Number.isNaN(wind)) {
      if (wind >= 25) idx = Math.min(levels.length - 1, idx + 2);
      else if (wind >= 15) idx = Math.min(levels.length - 1, idx + 1);
    }

    if (!Number.isNaN(visibility) && visibility < 1000) {
      idx = Math.min(levels.length - 1, idx + 1);
    }

    return levels[idx];
  })
}));

jest.mock('../../server/services/notification.service', () => ({
  notifyRescueTeam: jest.fn(),
  notifyUser: jest.fn()
}));

const turf = require('@turf/turf');
const Geofence = require('../../server/models/Geofence');
const NotificationLog = require('../../server/models/NotificationLog');
const weatherService = require('../../server/services/weather.service');
const notificationService = require('../../server/services/notification.service');
const {
  checkLocation,
  checkPeriodicAlerts
} = require('../../server/services/location.service');

describe('location.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Geofence.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([])
    });

    NotificationLog.findOne.mockResolvedValue(null);
    weatherService.getWeatherForGeofence.mockResolvedValue({
      state: 'Clear',
      wind_speed: 0,
      visibility: 2000
    });

    turf.booleanPointInPolygon.mockReturnValue(false);
    turf.pointToLineDistance.mockReturnValue(0);
    turf.distance.mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('ignores implausible GPS jumps and records anomaly details', async () => {
    const geofence = {
      _id: 'g1',
      name: 'Test Zone',
      dangerLevel: 'warning',
      nearMeters: 25,
      coordinates: [
        [0, 0],
        [0, 1],
        [1, 1],
        [0, 0]
      ]
    };

    Geofence.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([geofence])
    });

    turf.distance.mockReturnValue(2400);
    turf.pointToLineDistance.mockReturnValue(15);

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(10_000);
    const user = {
      _id: 'user1',
      name: 'Tourist',
      currentLocation: {
        lat: 0,
        lng: 0,
        timestamp: new Date(0)
      },
      lastInside: [],
      lastNear: [],
      lastCloseDangerNear: []
    };

    const result = await checkLocation(0.02, 0, user);

    expect(result.ignoredUpdate).toBe(true);
    expect(result.anomalyDetails.reason).toBe('implausible_jump');
    expect(result.anomalyDetails.speedMs).toBeGreaterThan(120);
    expect(result.anomalyDetails.distanceMeters).toBe(2400);
    nowSpy.mockRestore();
  });

  test('expands the near-zone threshold when the user is moving quickly', async () => {
    const geofence = {
      _id: 'g2',
      name: 'Near Zone',
      dangerLevel: 'warning',
      nearMeters: 10,
      coordinates: [
        [0, 0],
        [0, 1],
        [1, 1],
        [0, 0]
      ]
    };

    Geofence.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([geofence])
    });

    turf.distance.mockReturnValue(10);
    turf.pointToLineDistance.mockReturnValue(20);

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);

    const user = {
      _id: 'user2',
      currentLocation: {
        lat: 0,
        lng: 0,
        timestamp: new Date(0)
      },
      lastInside: [],
      lastNear: [],
      lastCloseDangerNear: []
    };

    const result = await checkLocation(0.0001, 0.0001, user);

    expect(result.ignoredUpdate).toBe(false);
    expect(result.near).toHaveLength(1);
    expect(result.near[0].distanceMeters).toBe(20);
    expect(result.enteredNear).toHaveLength(1);
    nowSpy.mockRestore();
  });

  test('skips rescue escalation during the 5 minute cooldown window', async () => {
    const geofence = {
      _id: 'g3',
      name: 'Danger Zone',
      dangerLevel: 'danger'
    };

    NotificationLog.findOne.mockResolvedValue({
      _id: 'recent-alert'
    });

    await checkPeriodicAlerts({ _id: 'user3' }, [geofence], { lat: 1, lng: 1 });

    expect(notificationService.notifyRescueTeam).not.toHaveBeenCalled();
  });

  test('sends rescue escalation when there is no recent cooldown alert', async () => {
    const geofence = {
      _id: 'g4',
      name: 'Danger Zone',
      dangerLevel: 'critical'
    };

    NotificationLog.findOne.mockResolvedValue(null);

    await checkPeriodicAlerts({ _id: 'user4' }, [geofence], { lat: 1, lng: 1 });

    expect(notificationService.notifyRescueTeam).toHaveBeenCalledTimes(1);
    expect(notificationService.notifyRescueTeam).toHaveBeenCalledWith(
      { _id: 'user4' },
      expect.objectContaining({
        name: 'Danger Zone',
        dangerLevel: 'critical'
      }),
      { lat: 1, lng: 1 }
    );
  });
});