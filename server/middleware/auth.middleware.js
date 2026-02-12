const jwt = require('jsonwebtoken');
const User = require('../models/User');

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

async function attachUser(req, res, next) {
    req.user = await authFromHeader(req);
    next();
}

function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

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