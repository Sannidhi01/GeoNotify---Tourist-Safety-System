require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const connectDB = require('./config/database');
const { attachUser } = require('./middleware/auth.middleware');

const authRoutes = require('./routes/auth.routes');
const geofenceRoutes = require('./routes/geofence.routes');
const userRoutes = require('./routes/user.routes');
const notificationRoutes = require('./routes/notification.routes');
const analyticsRoutes = require('./routes/analytics.routes'); // Added analyticsRoutes
const { importZonesIfEnabled, startZoneImportWatcher } = require('./services/zoneImport.service');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

connectDB().then(() => {
    importZonesIfEnabled();
    startZoneImportWatcher();
});

app.use(attachUser);

app.use('/api/auth', authRoutes);
app.use('/api/geofences', geofenceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/rescue', notificationRoutes);
app.use('/api/analytics', analyticsRoutes); // Mounted analyticsRoutes

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Roles: tourist (default), admin, rescue`);
    console.log(`Visit http://localhost:${PORT}`);
});
