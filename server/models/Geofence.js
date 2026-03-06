const mongoose = require('mongoose');

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
    timeRules: [{
        startTime: String, // format "HH:mm"
        endTime: String,   // format "HH:mm"
        dangerLevel: {
            type: String,
            enum: ['safe', 'caution', 'warning', 'danger', 'critical']
        }
    }],
    createdBy: {

        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Geofence', geofenceSchema);