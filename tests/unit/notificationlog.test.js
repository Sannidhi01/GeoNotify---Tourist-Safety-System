const NotificationLog = require('../../server/models/NotificationLog');

describe('NotificationLog model', () => {
  test('creates a log with required fields', () => {
    const log = new NotificationLog({
      userId: '507f1f77bcf86cd799439011',
      geofenceId: '507f1f77bcf86cd799439012',
      notificationType: 'entered',
      dangerLevel: 'danger',
      location: { lat: 12.34, lng: 56.78 },
      message: 'Test message'
    });
    expect(log.userId.toString()).toBe('507f1f77bcf86cd799439011');
    expect(log.geofenceId.toString()).toBe('507f1f77bcf86cd799439012');
    expect(log.notificationType).toBe('entered');
    expect(log.location.lat).toBe(12.34);
    expect(log.location.lng).toBe(56.78);
    expect(log.message).toBe('Test message');
    expect(log.timestamp).toBeInstanceOf(Date);
  });

  test('defaults rescueNotified and userNotified to false', () => {
    const log = new NotificationLog({
      userId: '507f1f77bcf86cd799439011',
      geofenceId: '507f1f77bcf86cd799439012',
      notificationType: 'danger_alert',
      dangerLevel: 'danger',
      location: { lat: 0, lng: 0 }
    });
    expect(log.rescueNotified).toBe(false);
    expect(log.userNotified).toBe(false);
  });
});