const mongoose = require('mongoose');

const TwoFactorVerificationSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
    },
    code: {
      type: String,
      required: true,
    },
      botname: {
      type: String,
    },
    method: {
      type: String,
      enum: ['email', 'sms'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'verified', 'expired'],
      default: 'pending',
    },
    verifiedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TwoFactorVerification', TwoFactorVerificationSchema);