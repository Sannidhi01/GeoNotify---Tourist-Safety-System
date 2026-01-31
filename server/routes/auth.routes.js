// server/routes/auth.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// Generate JWT token
function generateToken(user) {
    const secret = process.env.JWT_SECRET || 'change_this_secret';
    return jwt.sign({
        id: user._id,
        role: user.role,
        email: user.email
    }, secret, { expiresIn: '7d' });
}

// Register new user
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, phone, emergencyContact } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                error: 'Name, email, and password are required'
            });
        }

        // Check if email already exists
        const existing = await User.findOne({ email });
        if (existing) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user (tourist by default)
        const user = await User.create({
            name,
            email,
            passwordHash,
            phone: phone || '',
            role: 'tourist',
            emergencyContact: emergencyContact || {}
        });

        const token = generateToken(user);

        res.json({
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role
            },
            token,
            message: 'Registration successful. Please login with your role.'
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Login with role selection
router.post('/login', async (req, res) => {
    try {
        const { email, password, role } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({
                error: 'Email, password, and role are required'
            });
        }

        if (!['tourist', 'admin', 'rescue'].includes(role)) {
            return res.status(400).json({
                error: 'Invalid role. Must be tourist, admin, or rescue'
            });
        }

        // Find user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password
        const passwordValid = await bcrypt.compare(password, user.passwordHash);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check role permissions
        if (role === 'admin' && user.role !== 'admin') {
            return res.status(403).json({
                error: 'You do not have admin permissions'
            });
        }

        if (role === 'rescue' && user.role !== 'rescue') {
            return res.status(403).json({
                error: 'You do not have rescue team permissions'
            });
        }

        const token = generateToken(user);

        res.json({
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                loginAs: role
            },
            token
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;