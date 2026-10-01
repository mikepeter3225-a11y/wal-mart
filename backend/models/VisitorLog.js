const mongoose = require('mongoose');

const visitorLogSchema = new mongoose.Schema(
  {
    page: {
      type: String,
      required: true,
      trim: true,
    },
    ip: {
      type: String,
      default: 'Unknown',
    },
    userAgent: {
      type: String,
      default: 'Unknown',
    },
    referrer: {
      type: String, // Now stores search engine type (Google, Bing, Yahoo, etc.)
      default: 'Direct',
    },
    referrerUrl: {
      type: String, // Stores the full referrer URL
      default: 'Direct',
    },
    location: {
      country: { type: String, default: 'Unknown' },
      city: { type: String, default: 'Unknown' },
      region: { type: String, default: 'Unknown' },
      timezone: { type: String, default: 'Unknown' },
      isp: { type: String, default: 'Unknown' },
      coordinates: { type: String, default: 'Unknown' },
    },
    device: {
      type: String,
      default: 'Unknown',
    },
    screen: {
      type: String,
      default: 'Unknown',
    },
    language: {
      type: String,
      default: 'Unknown',
    },
    url: {
      type: String,
      default: 'Unknown',
    },
    localTime: {
      type: String,
      default: 'Unknown',
    },
    utcTime: {
      type: String,
      default: () => new Date().toLocaleString('en-US', { timeZone: 'UTC' }),
    },
  },
  {
    timestamps: true,
  }
);



module.exports = mongoose.model('VisitorLog', visitorLogSchema);