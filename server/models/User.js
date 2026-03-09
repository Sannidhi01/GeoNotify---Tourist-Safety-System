const mongoose = require('mongoose');

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
    subscribedGeofences: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Geofence'
    }],
    lastInside: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Geofence'
    }],
    lastNear: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Geofence'
    }],
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
    // Per-zone timestamps to preserve "time of entry" context for alerts/AI prompts
    nearEntryTimes: {
        type: Map,
        of: Date,
        default: {}
    },
    insideEntryTimes: {
        type: Map,
        of: Date,
        default: {}
    },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
