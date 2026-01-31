// public/sw.js - Service Worker for Push Notifications
self.addEventListener('push', function (event) {
    console.log('Push notification received', event);

    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = { title: 'Notification', body: event.data.text() };
        }
    }

    const title = data.title || 'GeoNotify Alert';
    const options = {
        body: data.body || 'Location alert',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        tag: data.tag || 'geofence-alert',
        requireInteraction: data.requireInteraction || false,
        data: data.data || {},
        actions: [
            { action: 'view', title: 'View' },
            { action: 'dismiss', title: 'Dismiss' }
        ],
        vibrate: [200, 100, 200]
    };

    // Special handling for danger alerts
    if (data.data && ['danger', 'critical'].includes(data.data.dangerLevel)) {
        options.requireInteraction = true;
        options.vibrate = [300, 100, 300, 100, 300];
    }

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', function (event) {
    console.log('Notification clicked', event);

    event.notification.close();

    if (event.action === 'view') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

self.addEventListener('install', function (event) {
    console.log('Service Worker installing');
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    console.log('Service Worker activating');
    event.waitUntil(clients.claim());
});
