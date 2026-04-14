// public/js/login-handler.js
import { API } from './config.js';

// Initialize login page
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is already logged in
    if (localStorage.getItem('token')) {
        redirectToApp();
    }

    // Attach event listeners
    document.getElementById('login-toggle').addEventListener('click', function() {
        showLoginForm();
    });

    document.getElementById('register-toggle').addEventListener('click', function() {
        showRegisterForm();
    });

    // Enter key to submit forms
    document.getElementById('login-form').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            handleLogin();
        }
    });

    document.getElementById('register-form').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            handleRegister();
        }
    });

    // Initialize emergency contact visibility
    toggleEmergencyContact();
});

// Toggle emergency contact section visibility based on role selection
function toggleEmergencyContact() {
    const selectedRole = document.querySelector('input[name="reg-role"]:checked').value;
    const emergencyContactSection = document.getElementById('emergency-contact-section');
    const phoneInput = document.getElementById('reg-phone');
    const phoneLabel = document.querySelector('label[for="reg-phone"]');
    
    if (selectedRole === 'tourist') {
        emergencyContactSection.style.display = 'block';
        emergencyContactSection.style.animation = 'fadeInUp 0.4s ease';
        phoneInput.required = true;
        if (phoneLabel) phoneLabel.innerHTML = '<i class="fas fa-phone"></i> Phone Number <span id="reg-phone-required" style="color: #e74c3c;">*</span>';
        phoneInput.placeholder = '+1 (555) 000-0000';
    } else {
        emergencyContactSection.style.display = 'none';
        phoneInput.required = false;
        if (phoneLabel) phoneLabel.innerHTML = '<i class="fas fa-phone"></i> Phone Number (Optional)';
        phoneInput.placeholder = '+1 (555) 000-0000';
    }
}

// Make it available globally for onchange events
window.toggleEmergencyContact = toggleEmergencyContact;

// Toggle between forms
function toggleForms(e) {
    e.preventDefault();
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    if (loginForm.classList.contains('active')) {
        showRegisterForm();
    } else {
        showLoginForm();
    }
}

window.toggleForms = toggleForms;

function showLoginForm() {
    document.getElementById('login-form').classList.add('active');
    document.getElementById('register-form').classList.remove('active');
    document.getElementById('login-toggle').classList.add('active');
    document.getElementById('register-toggle').classList.remove('active');
}

function showRegisterForm() {
    document.getElementById('register-form').classList.add('active');
    document.getElementById('login-form').classList.remove('active');
    document.getElementById('register-toggle').classList.add('active');
    document.getElementById('login-toggle').classList.remove('active');
}

// Handle Login
async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const submitBtn = document.querySelector('#login-form .btn-submit');

    // Validation
    if (!email || !password) {
        showMessage('Please fill in all fields', 'error');
        return;
    }

    if (!email.includes('@')) {
        showMessage('Please enter a valid email', 'error');
        return;
    }

    try {
        // Add loading state
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        const response = await fetch(API + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            showMessage(data.message || 'Login failed. Please try again', 'error');
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
            return;
        }

        // Store credentials
        localStorage.setItem('token', data.token);
        localStorage.setItem('userId', data.userId);
        localStorage.setItem('userRole', data.role);
        localStorage.setItem('userName', data.name);

        showMessage('✓ Login successful! Redirecting...', 'success');

        // Redirect after short delay
        setTimeout(() => {
            redirectToApp();
        }, 800);

    } catch (error) {
        console.error('Login error:', error);
        showMessage('Network error. Please try again', 'error');
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
    }
}

// Handle Registration
async function handleRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const phone = document.getElementById('reg-phone').value.trim();
    const role = document.querySelector('input[name="reg-role"]:checked').value;

    // Emergency Contact
    const emName = document.getElementById('reg-em-name').value.trim();
    const emPhone = document.getElementById('reg-em-phone').value.trim();
    const emRelation = document.getElementById('reg-em-relation').value.trim();

    // Validation
    if (!name || !email || !password) {
        showMessage('Please fill in all required fields', 'error');
        return;
    }

    if (role === 'tourist' && !phone) {
        showMessage('Phone number is required for tourist accounts', 'error');
        return;
    }

    if (!email.includes('@')) {
        showMessage('Please enter a valid email', 'error');
        return;
    }

    if (password.length < 6) {
        showMessage('Password must be at least 6 characters', 'error');
        return;
    }

    try {
        const submitBtn = document.querySelector('#register-form .btn-submit');
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        const emergencyContact = (emName || emPhone) ? {
            name: emName,
            phone: emPhone,
            relationship: emRelation
        } : undefined;

        const response = await fetch(API + '/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                email,
                password,
                phone: phone || undefined,
                role,
                emergencyContact
            })
        });

        const data = await response.json();

        if (!response.ok) {
            showMessage(data.message || 'Registration failed. Please try again', 'error');
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
            return;
        }

        document.getElementById('login-email').value = email;
        document.getElementById('login-password').value = '';
        showLoginForm();
        showMessage('Account created successfully. Please sign in.', 'success');
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');

    } catch (error) {
        console.error('Registration error:', error);
        showMessage('Network error. Please try again', 'error');
        const submitBtn = document.querySelector('#register-form .btn-submit');
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
    }
}

// Show messages
function showMessage(message, type) {
    // Remove existing messages
    const existingMessage = document.querySelector('.message');
    if (existingMessage) {
        existingMessage.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;

    const authForm = document.querySelector('.auth-form.active');
    authForm.insertBefore(messageDiv, authForm.firstChild);

    // Auto-remove error messages after 4 seconds
    if (type === 'error') {
        setTimeout(() => {
            messageDiv.remove();
        }, 4000);
    }
}

// Redirect to main app
function redirectToApp() {
    window.location.href = '/index.html';
}

// Make functions globally available for onclick handlers
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.showLoginForm = showLoginForm;
window.showRegisterForm = showRegisterForm;
