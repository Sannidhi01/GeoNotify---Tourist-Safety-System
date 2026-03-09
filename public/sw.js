self.addEventListener("push", event => {
    console.log("Push notification received");

    let data = {};
    if (event.data) {
        data = event.data.json();
    }

    const title = data.title || "GeoNotify Alert";

    const options = {
        body: data.body || "Safety alert nearby",
        icon: "/icon.png",
        badge: "/icon.png",
        vibrate: [200,100,200],
        data: data.data || {}
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener("notificationclick", event => {
    event.notification.close();

    event.waitUntil(
        clients.openWindow("http://localhost:3000")
    );
});
