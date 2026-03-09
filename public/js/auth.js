import { API } from './config.js';
import { updateUIForUser, closeModal } from './ui.js';
import { loadFences } from './geofence.js';
import { loadRescueDashboard, stopRescueUpdates } from './rescue.js';
import { urlBase64ToUint8Array } from './utils.js';

export let currentUser = null;

export function getUserId() { return localStorage.getItem('userId'); }
export function getToken() { return localStorage.getItem('token'); }

export function setCurrentUser(user) {
    currentUser = user;
    updateUIForUser();
}

export function logout() {
    localStorage.clear();
    currentUser = null;
    stopRescueUpdates();
    updateUIForUser();
    alert('✓ Logged out successfully');
    location.reload();
}

export async function register() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const phone = document.getElementById('reg-phone').value.trim();

    const emName = document.getElementById('reg-em-name').value.trim();
    const emPhone = document.getElementById('reg-em-phone').value.trim();
    const emRelation = document.getElementById('reg-em-relation').value.trim();

    if (!name || !email || !password) {
        return alert('Please fill in all required fields');
    }

    try {
        const role = document.querySelector('input[name="reg-role"]:checked').value;

        const emergencyContact = (emName || emPhone) ? {
            name: emName,
            phone: emPhone,
            relationship: emRelation
        } : undefined;

        const resp = await fetch(API + '/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, phone, role, emergencyContact })
        });

        if (!resp.ok) {
            const error = await resp.json();
            throw new Error(error.error || 'Registration failed');
        }

        await resp.json();
        alert('✓ Registration successful! Please login to continue.');
        closeModal();
    } catch (err) {
        alert('Registration failed: ' + err.message);
    }
}

export async function login() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const role = document.querySelector('input[name="role"]:checked').value;

    if (!email || !password) {
        return alert('Please enter email and password');
    }

    try {
        const resp = await fetch(API + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, role })
        });

        if (!resp.ok) {
            const error = await resp.json();
            throw new Error(error.error || 'Login failed');
        }

        const data = await resp.json();
        localStorage.setItem('token', data.token);
        localStorage.setItem('userId', data.user.id);
        setCurrentUser(data.user);

        closeModal();

        // Enable push notifications (quietly)
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            try {
                await registerForPush();
            } catch (e) {
                console.warn('Push registration failed:', e);
            }
        }

        loadFences();

        // Load dashboard based on actual user role from server
        if (data.user.role === 'rescue') {
            loadRescueDashboard();
        }
    } catch (err) {
        alert(' Login failed: ' + err.message);
    }
}

export async function registerForPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Push not supported');
    }

    // Check if sw.js is registered, if not register it
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js');
    }
    await navigator.serviceWorker.ready;

    const vap = await fetch(API + '/users/push/vapidPublicKey');
    if (!vap.ok) throw new Error('No VAPID key');

    const { publicKey } = await vap.json();
    const existing = await reg.pushManager.getSubscription();
    if (existing) return existing;

    const converted = urlBase64ToUint8Array(publicKey);
    const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: converted
    });

    const uid = getUserId();
    const token = getToken();
    await fetch(API + `/users/${uid}/push-subscribe`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ subscription: sub })
    });

    return sub;
}
