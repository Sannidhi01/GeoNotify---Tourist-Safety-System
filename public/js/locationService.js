// public/js/locationService.js

export const LocationProvider = {
    BROWSER: 'browser',
    MOCK: 'mock'
};

let currentProvider = LocationProvider.BROWSER;
let mockPosition = { coords: { latitude: 12.9716, longitude: 77.5946 } };

export function setProvider(provider) {
    currentProvider = provider;
}

export function setMockPosition(lat, lng) {
    mockPosition = { coords: { latitude: lat, longitude: lng } };
}

export function getCurrentPosition(success, error, options) {
    if (currentProvider === LocationProvider.MOCK) {
        setTimeout(() => success(mockPosition), 100);
        return;
    }

    if (!navigator.geolocation) {
        return error({ message: 'Geolocation not supported' });
    }

    navigator.geolocation.getCurrentPosition(success, error, options);
}

export function watchPosition(success, error, options) {
    if (currentProvider === LocationProvider.MOCK) {
        const id = setInterval(() => success(mockPosition), 5000);
        return id;
    }

    if (!navigator.geolocation) {
        error({ message: 'Geolocation not supported' });
        return null;
    }

    return navigator.geolocation.watchPosition(success, error, options);
}

export function clearWatch(watchId) {
    if (currentProvider === LocationProvider.MOCK) {
        clearInterval(watchId);
        return;
    }

    navigator.geolocation.clearWatch(watchId);
}
