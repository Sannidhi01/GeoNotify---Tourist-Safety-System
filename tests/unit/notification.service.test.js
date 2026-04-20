jest.mock('../../server/models/User', () => ({
  find: jest.fn()
}));

jest.mock('../../server/models/NotificationLog', () => ({
  create: jest.fn()
}));

const User = require('../../server/models/User');
const NotificationLog = require('../../server/models/NotificationLog');
const { notifyRescueTeam } = require('../../server/services/notification.service');

describe('notification.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns false when there are no active rescue team members', async () => {
    User.find.mockResolvedValue([]);

    const result = await notifyRescueTeam(
      { _id: 'tourist1', name: 'Tourist' },
      { _id: 'f1', name: 'Danger Zone', dangerLevel: 'danger' },
      { lat: 12.34, lng: 56.78 }
    );

    expect(result).toBe(false);
    expect(NotificationLog.create).not.toHaveBeenCalled();
  });

  test('creates a rescue alert log when rescuers are available', async () => {
    User.find.mockResolvedValue([
      {
        _id: 'rescuer1',
        name: 'Rescuer',
        phone: '+911234567890'
      }
    ]);

    NotificationLog.create.mockResolvedValue({});

    const result = await notifyRescueTeam(
      {
        _id: 'tourist2',
        name: 'Tourist',
        phone: '+919999999999',
        email: 'tourist@example.com'
      },
      {
        _id: 'f2',
        name: 'Critical Zone',
        dangerLevel: 'critical'
      },
      { lat: 12.34, lng: 56.78 }
    );

    expect(result).toBe(true);
    expect(NotificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'tourist2',
        geofenceId: 'f2',
        notificationType: 'rescue_alert',
        dangerLevel: 'critical',
        rescueNotified: true
      })
    );
  });
});