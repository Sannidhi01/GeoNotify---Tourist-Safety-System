const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    geofenceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Geofence',
        required: true
    },
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

module.exports = mongoose.model('NotificationLog', notificationLogSchema);