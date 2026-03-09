const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function authFromHeader(req) {
    const auth = req.headers.authorization || '';
    console.log('[AUTH] authFromHeader - auth header present:', !!auth);

    if (!auth.startsWith('Bearer ')) {
        console.log('[AUTH] No Bearer token found');
        return null;
    }

    const token = auth.split(' ')[1];
    console.log('[AUTH] Token extracted, length:', token.length);

    try {
        const secret = process.env.JWT_SECRET || 'change_this_secret';
        const data = jwt.verify(token, secret);
        console.log('[AUTH] JWT verified, user ID:', data.id);

        const user = await User.findById(data.id);
        console.log('[AUTH] User found in DB:', user ? { id: user._id, name: user.name, role: user.role } : 'null');

        return user;
    } catch (e) {
        console.log('[AUTH] JWT verification failed:', e.message);
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
    console.log('[AUTH] requireAdminOrRescue - req.user:', req.user ? { id: req.user._id, name: req.user.name, role: req.user.role } : 'null');
    console.log('[AUTH] requireAdminOrRescue - headers:', req.headers.authorization ? 'Bearer token present' : 'No auth header');

    if (!req.user || !['admin', 'rescue'].includes(req.user.role)) {
        console.log('[AUTH] Access denied - user role:', req.user?.role || 'no user');
        return res.status(403).json({ error: 'Admin or Rescue access required' });
    }

    console.log('[AUTH] Access granted for user:', req.user.name, 'role:', req.user.role);
    next();
}

module.exports = {
    attachUser,
    requireAuth,
    requireAdmin,
    requireAdminOrRescue
};