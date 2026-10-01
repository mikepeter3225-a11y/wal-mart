const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
    },

    username: {
      type: String,
      required: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    passwordHash: {
      type: String,
    },

    fullname: {
      type: String,
      trim: true,
    },

    firstName: {
      type: String,
      trim: true,
      default: '',
    },

    lastName: {
      type: String,
      trim: true,
      default: '',
    },

    memberId: {
      type: String,
      trim: true,
      default: '',
    },

    balance: {
      type: Number,
      default: 0,
    },

    notificationPreferences: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      push: { type: Boolean, default: true },
    },

    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },

    lastLoginAt: {
      type: Date,
    },

    loginAttempts: [
      {
        timestamp: Date,
        ip: String,
        userAgent: String,
        status: String,
      }
    ],
  },
  {
    timestamps: true,
    autoIndex: false,
  }
);

module.exports = mongoose.model('User', UserSchema);