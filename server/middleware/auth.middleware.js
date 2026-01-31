const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Extract and verify JWT token
async function authFromHeader(req) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;

    const token = auth.split(' ')[1];
    try {
        const secret = process.env.JWT_SECRET || 'change_this_secret';
        const data = jwt.verify(token, secret);
        const user = await User.findById(data.id);
        return user;
    } catch (e) {
        return null;
    }
}

// Middleware to attach user to request
async function attachUser(req, res, next) {
    req.user = await authFromHeader(req);
    next();
}

// Require authentication
function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

// Require admin role
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

// Require admin or rescue role
function requireAdminOrRescue(req, res, next) {
    if (!req.user || !['admin', 'rescue'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Admin or Rescue access required' });
    }
    next();
}

module.exports = {
    attachUser,
    requireAuth,
    requireAdmin,
    requireAdminOrRescue
};