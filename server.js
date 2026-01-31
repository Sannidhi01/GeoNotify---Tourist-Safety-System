// server.js - Role-based Tourist Safety System
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const turf = require('@turf/turf');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set in .env');
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('✓ MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Enhanced Geofence Schema
const geofenceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  reminder: { type: String, default: '' },
  coordinates: { type: [[Number]], required: true },
  nearMeters: { type: Number, default: 100 },
  dangerLevel: {
    type: String,
    enum: ['safe', 'caution', 'warning', 'danger', 'critical'],
    default: 'safe'
  },
  autoNotifyRescue: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});
const Geofence = mongoose.model('Geofence', geofenceSchema);

// User Schema with roles
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  phone: { type: String },
  role: {
    type: String,
    enum: ['tourist', 'admin', 'rescue'],
    default: 'tourist'
  },
  subscribedGeofences: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Geofence' }],
  lastInside: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Geofence' }],
  pushSubscriptions: { type: Array, default: [] },
  emergencyContact: {
    name: String,
    phone: String,
    relationship: String
  },
  currentLocation: {
    lat: Number,
    lng: Number,
    timestamp: Date
  },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Alert/Notification Log Schema
const notificationLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  geofenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Geofence', required: true },
  notificationType: {
    type: String,
    enum: ['entered', 'exited', 'near', 'danger_alert', 'rescue_alert'],
    required: true
  },
  dangerLevel: String,
  location: {
    lat: Number,
    lng: Number
  },
  rescueNotified: { type: Boolean, default: false },
  userNotified: { type: Boolean, default: false },
  message: String,
  timestamp: { type: Date, default: Date.now }
});
const NotificationLog = mongoose.model('NotificationLog', notificationLogSchema);

// Configure web-push
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(
    'mailto:admin@geonotify.com',
    VAPID_PUBLIC,
    VAPID_PRIVATE
  );
} else {
  console.warn('⚠️  VAPID keys not configured. Push notifications disabled.');
}

// Helper Functions
function sendPush(subscription, payload) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return Promise.resolve();
  return webpush.sendNotification(subscription, JSON.stringify(payload))
    .catch(err => console.warn('Push send failed:', err.message));
}

function generateToken(user) {
  const secret = process.env.JWT_SECRET || 'change_this_secret';
  return jwt.sign({
    id: user._id,
    role: user.role,
    email: user.email
  }, secret, { expiresIn: '7d' });
}

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

// Middleware
async function attachUser(req, res, next) {
  req.user = await authFromHeader(req);
  next();
}
app.use(attachUser);

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
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

// Notify rescue team when tourist enters danger zone
async function notifyRescueTeam(tourist, geofence, location) {
  try {
    console.log(`🚨 RESCUE ALERT: ${tourist.name} in ${geofence.dangerLevel.toUpperCase()} zone: ${geofence.name}`);

    // Find all rescue team members
    const rescueTeam = await User.find({ role: 'rescue', isActive: true });

    if (rescueTeam.length === 0) {
      console.warn('⚠️  No rescue team members available');
      return false;
    }

    const alertPayload = {
      title: `🚨 RESCUE ALERT - ${geofence.dangerLevel.toUpperCase()}`,
      body: `Tourist ${tourist.name} detected in ${geofence.name}`,
      data: {
        type: 'rescue_alert',
        touristId: tourist._id,
        touristName: tourist.name,
        touristPhone: tourist.phone || 'N/A',
        touristEmail: tourist.email,
        emergencyContact: tourist.emergencyContact,
        geofenceId: geofence._id,
        geofenceName: geofence.name,
        dangerLevel: geofence.dangerLevel,
        location: location,
        timestamp: new Date().toISOString()
      },
      tag: `rescue-${tourist._id}-${geofence._id}`,
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 300]
    };

    let notificationsSent = 0;
    for (const rescuer of rescueTeam) {
      const subs = rescuer.pushSubscriptions || [];
      for (const sub of subs) {
        await sendPush(sub, alertPayload);
        notificationsSent++;
      }
    }

    // Log the notification
    await NotificationLog.create({
      userId: tourist._id,
      geofenceId: geofence._id,
      notificationType: 'rescue_alert',
      dangerLevel: geofence.dangerLevel,
      location: location,
      rescueNotified: true,
      message: `Rescue team notified (${notificationsSent} notifications sent)`
    });

    console.log(`✓ Rescue team notified: ${rescueTeam.length} members, ${notificationsSent} notifications sent`);
    return true;
  } catch (err) {
    console.error('❌ Failed to notify rescue team:', err);
    return false;
  }
}

// ============ AUTH ROUTES ============

// Register new user (tourist, admin, or rescue)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone, emergencyContact } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check if email already exists
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // All new registrations are tourists by default
    const user = await User.create({
      name,
      email,
      passwordHash,
      phone: phone || '',
      role: 'tourist', // Default role
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
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password, and role are required' });
    }

    if (!['tourist', 'admin', 'rescue'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be tourist, admin, or rescue' });
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

    // Check if user has permission for the requested role
    // For admin and rescue, the user must have that role in database
    if (role === 'admin' && user.role !== 'admin') {
      return res.status(403).json({ error: 'You do not have admin permissions' });
    }

    if (role === 'rescue' && user.role !== 'rescue') {
      return res.status(403).json({ error: 'You do not have rescue team permissions' });
    }

    // If logging in as tourist, allow regardless of actual role
    // This allows admins/rescue to also use tourist features

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

// ============ ADMIN ROUTES ============

// Create geofence (admin only)
app.post('/api/geofences', requireAdmin, async (req, res) => {
  try {
    const { name, description, reminder, coordinates, nearMeters, dangerLevel, autoNotifyRescue } = req.body;

    if (!name || !Array.isArray(coordinates) || coordinates.length < 3) {
      return res.status(400).json({ error: 'Invalid input. Name and ≥3 coordinates required.' });
    }

    const geofence = await Geofence.create({
      name,
      description: description || '',
      reminder: reminder || '',
      coordinates,
      nearMeters: nearMeters || 100,
      dangerLevel: dangerLevel || 'safe',
      autoNotifyRescue: autoNotifyRescue || false,
      createdBy: req.user._id
    });

    res.json(geofence);
  } catch (err) {
    console.error('Create geofence error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update geofence (admin only)
app.put('/api/geofences/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, reminder, coordinates, nearMeters, dangerLevel, autoNotifyRescue } = req.body;

    const updated = await Geofence.findByIdAndUpdate(
      req.params.id,
      { name, description, reminder, coordinates, nearMeters, dangerLevel, autoNotifyRescue },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: 'Geofence not found' });
    res.json(updated);
  } catch (err) {
    console.error('Update geofence error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete geofence (admin only)
app.delete('/api/geofences/:id', requireAdmin, async (req, res) => {
  try {
    const deleted = await Geofence.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Geofence not found' });
    res.json({ message: 'Geofence deleted successfully' });
  } catch (err) {
    console.error('Delete geofence error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all geofences (public for display, detailed for admin)
app.get('/api/geofences', async (req, res) => {
  try {
    const geofences = await Geofence.find().sort({ createdAt: -1 }).lean();
    res.json(geofences);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track all active users (admin only)
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find({ role: 'tourist' })
      .select('-passwordHash -pushSubscriptions')
      .sort({ createdAt: -1 })
      .lean();

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user location history (admin only)
app.get('/api/admin/user/:id/location', requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('name email currentLocation');
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ USER ROUTES ============

app.get('/api/push/vapidPublicKey', (req, res) => {
  if (!VAPID_PUBLIC) return res.status(500).json({ error: 'VAPID keys not configured' });
  res.json({ publicKey: VAPID_PUBLIC });
});

app.post('/api/users/:id/push-subscribe', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Only allow users to subscribe their own notifications
    if (user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const sub = req.body.subscription;
    if (!sub) return res.status(400).json({ error: 'Subscription required' });

    user.pushSubscriptions = user.pushSubscriptions || [];
    user.pushSubscriptions.push(sub);
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-passwordHash')
      .lean();

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subscribe to geofence alerts
app.post('/api/users/:id/subscribe', requireAuth, async (req, res) => {
  try {
    const { fenceId } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.subscribedGeofences.includes(fenceId)) {
      user.subscribedGeofences.push(fenceId);
      await user.save();
    }

    res.json({ message: 'Subscribed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unsubscribe from geofence alerts
app.post('/api/users/:id/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { fenceId } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ error: 'User not found' });

    user.subscribedGeofences = user.subscribedGeofences.filter(f => f.toString() !== fenceId);
    user.lastInside = user.lastInside.filter(f => f.toString() !== fenceId);
    await user.save();

    res.json({ message: 'Unsubscribed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ LOCATION CHECK & ALERTS ============

app.get('/api/check', requireAuth, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'Valid lat & lng required' });
    }

    const point = turf.point([lng, lat]);
    const fences = await Geofence.find().lean();

    const inside = [];
    const near = [];

    // Check each geofence
    for (const f of fences) {
      let coords = f.coordinates.slice();
      const first = coords[0], last = coords[coords.length - 1];
      if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
        coords.push(first);
      }

      const poly = turf.polygon([coords]);
      const inPoly = turf.booleanPointInPolygon(point, poly);

      if (inPoly) {
        inside.push(f);
        continue;
      }

      // Check if near
      const line = turf.lineString(coords);
      const distMeters = turf.pointToLineDistance(point, line, { units: 'meters' });
      const thresholdMeters = f.nearMeters || 100;

      if (distMeters <= thresholdMeters) {
        near.push({ ...f, distanceMeters: distMeters });
      }
    }

    const user = req.user;

    // Update user's current location
    user.currentLocation = { lat, lng, timestamp: new Date() };

    const subscribed = (user.subscribedGeofences || []).map(x => x.toString());
    const insideIds = inside.map(f => f._id.toString());
    const prevIds = (user.lastInside || []).map(x => x.toString());

    const subscribedInside = inside.filter(f => subscribed.includes(f._id.toString()));
    const subscribedNear = near.filter(f => subscribed.includes(f._id.toString()));

    const entered = subscribedInside.filter(f => !prevIds.includes(f._id.toString()));
    const exited = prevIds.filter(id => !insideIds.includes(id))
      .map(id => fences.find(f => f._id.toString() === id))
      .filter(f => f && subscribed.includes(f._id.toString()));

    // Handle danger zone alerts
    for (const f of entered) {
      // Notify user
      const userPayload = {
        title: `🚨 Entered ${f.dangerLevel.toUpperCase()} Zone`,
        body: `${f.name}: ${f.reminder || 'Stay alert!'}`,
        data: {
          type: 'entered',
          dangerLevel: f.dangerLevel,
          geofenceId: f._id
        },
        tag: `enter-${f._id}`,
        requireInteraction: ['danger', 'critical'].includes(f.dangerLevel)
      };

      const subs = user.pushSubscriptions || [];
      for (const sub of subs) {
        await sendPush(sub, userPayload);
      }

      // Log notification
      await NotificationLog.create({
        userId: user._id,
        geofenceId: f._id,
        notificationType: 'entered',
        dangerLevel: f.dangerLevel,
        location: { lat, lng },
        userNotified: true,
        message: `User entered ${f.name}`
      });

      // Notify rescue team if danger/critical zone
      if (f.autoNotifyRescue && ['danger', 'critical'].includes(f.dangerLevel)) {
        await notifyRescueTeam(user, f, { lat, lng });
      }
    }

    // Check if user is currently in danger zones (periodic alerts)
    for (const f of subscribedInside) {
      if (f.autoNotifyRescue && ['danger', 'critical'].includes(f.dangerLevel)) {
        // Check if we haven't sent alert recently (5 min cooldown)
        const recentAlert = await NotificationLog.findOne({
          userId: user._id,
          geofenceId: f._id,
          notificationType: 'rescue_alert',
          timestamp: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
        });

        if (!recentAlert) {
          await notifyRescueTeam(user, f, { lat, lng });
        }
      }
    }

    // Handle near zone alerts
    for (const f of subscribedNear) {
      const nearPayload = {
        title: `⚠️ Approaching ${f.dangerLevel.toUpperCase()} Zone`,
        body: `${f.name} is ${Math.round(f.distanceMeters)} meters away`,
        data: {
          type: 'near',
          dangerLevel: f.dangerLevel,
          distance: f.distanceMeters
        },
        tag: `near-${f._id}`
      };

      const subs = user.pushSubscriptions || [];
      for (const sub of subs) {
        await sendPush(sub, nearPayload);
      }

      await NotificationLog.create({
        userId: user._id,
        geofenceId: f._id,
        notificationType: 'near',
        dangerLevel: f.dangerLevel,
        location: { lat, lng },
        userNotified: true,
        message: `User near ${f.name} (${Math.round(f.distanceMeters)}m)`
      });
    }

    // Handle exit notifications
    for (const f of exited) {
      const exitPayload = {
        title: `✅ Exited ${f.name}`,
        body: f.reminder || 'You have left the area',
        data: { type: 'exited' },
        tag: `exit-${f._id}`
      };

      const subs = user.pushSubscriptions || [];
      for (const sub of subs) {
        await sendPush(sub, exitPayload);
      }

      await NotificationLog.create({
        userId: user._id,
        geofenceId: f._id,
        notificationType: 'exited',
        location: { lat, lng },
        userNotified: true,
        message: `User exited ${f.name}`
      });
    }

    user.lastInside = inside.map(f => f._id);
    await user.save();

    res.json({
      inside: subscribedInside,
      near: subscribedNear,
      entered,
      exited
    });
  } catch (err) {
    console.error('Location check error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ NOTIFICATION LOGS ============

// Get notification logs (admin and rescue)
app.get('/api/notifications', requireAdminOrRescue, async (req, res) => {
  try {
    const logs = await NotificationLog.find()
      .populate('userId', 'name email phone role')
      .populate('geofenceId', 'name dangerLevel')
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get active alerts (rescue team dashboard)
app.get('/api/rescue/active-alerts', requireAdminOrRescue, async (req, res) => {
  try {
    // Find tourists currently in danger zones
    const tourists = await User.find({ role: 'tourist' })
      .populate('lastInside')
      .lean();

    const activeAlerts = [];

    for (const tourist of tourists) {
      if (tourist.lastInside && tourist.lastInside.length > 0) {
        for (const geofence of tourist.lastInside) {
          if (geofence && ['danger', 'critical'].includes(geofence.dangerLevel)) {
            activeAlerts.push({
              tourist: {
                id: tourist._id,
                name: tourist.name,
                phone: tourist.phone,
                email: tourist.email,
                emergencyContact: tourist.emergencyContact,
                currentLocation: tourist.currentLocation
              },
              geofence: {
                id: geofence._id,
                name: geofence.name,
                dangerLevel: geofence.dangerLevel,
                description: geofence.description
              },
              timestamp: tourist.currentLocation?.timestamp || new Date()
            });
          }
        }
      }
    }

    res.json(activeAlerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ Server listening on port ${PORT}`);
  console.log(`✓ Roles: tourist (default), admin, rescue`);
});

// // server.js
// const express = require('express');
// const mongoose = require('mongoose');
// const cors = require('cors');
// require('dotenv').config();

// const app = express();
// app.use(cors());
// app.use(express.json());


// const MONGODB_URI = process.env.MONGODB_URI;
// if (!MONGODB_URI) {
//   console.error('MONGODB_URI not set in .env');
//   process.exit(1);
// }

// //  Connect to MongoDB Atlas
// mongoose.connect(MONGODB_URI, {
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
// })
// .then(() => console.log(' MongoDB connected'))
// .catch(err => {
//   console.error('MongoDB connection error:', err);
//   process.exit(1);
// });

// // Define Geofence Schema
// const geofenceSchema = new mongoose.Schema({
//   name: { type: String, required: true },
//   reminder: { type: String, default: '' },
//   coordinates: { type: [[Number]], required: true }, // [lng, lat]
//   createdAt: { type: Date, default: Date.now }
// });
// const Geofence = mongoose.model('Geofence', geofenceSchema);

// //Routes

// // Create new geofence
// app.post('/api/geofences', async (req, res) => {
//   try {
//     const { name, reminder, coordinates } = req.body;
//     if (!name || !Array.isArray(coordinates) || coordinates.length < 3)
//       return res.status(400).json({ error: 'Invalid input. name and >=3 coordinates required.' });

//     const doc = await Geofence.create({ name, reminder, coordinates });
//     res.json(doc);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // List all geofences
// app.get('/api/geofences', async (req, res) => {
//   try {
//     const items = await Geofence.find().sort({ createdAt: -1 }).lean();
//     res.json(items);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // Delete a geofence by ID
// app.delete('/api/geofences/:id', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const deleted = await Geofence.findByIdAndDelete(id);
//     if (!deleted) return res.status(404).json({ error: 'Geofence not found' });
//     res.json({ message: 'Geofence deleted' });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // Check which geofences contain a point
// app.get('/api/check', async (req, res) => {
//   try {
//     const lat = parseFloat(req.query.lat);
//     const lng = parseFloat(req.query.lng);
//     if (Number.isNaN(lat) || Number.isNaN(lng))
//       return res.status(400).json({ error: 'lat & lng required' });

//     const point = turf.point([lng, lat]);
//     const fences = await Geofence.find().lean();

//     const inside = fences.filter(f => {
//       let coords = f.coordinates.slice();
//       const first = coords[0], last = coords[coords.length - 1];
//       if (!first || !last || first[0] !== last[0] || first[1] !== last[1])
//         coords.push(first);
//       const poly = turf.polygon([coords]);
//       return turf.booleanPointInPolygon(point, poly);
//     });

//     res.json(inside);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// });

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => console.log(` Server listening on port ${PORT}`));
