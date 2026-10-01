/**
 * Get Telegram Chat ID
 * 
 * Usage:
 * 1. node get-chat-id.js
 * 2. Create/open the Telegram group/channel
 * 3. Add this bot to the group/channel
 * 4. Send any message in that group/channel
 * 5. Check console for the chat ID
 */

// const TelegramBot = require('node-telegram-bot-api');
// require('dotenv').config();

// const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN not set in .env file');
  process.exit(1);
}

console.log('🤖 Chat ID Detector Bot Started');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📝 Instructions:');
console.log('1. Create a Telegram Group or Channel');
console.log('2. Add this bot to the group/channel');
console.log('3. Send any message in that group/channel');
console.log('4. The chat ID will appear below\n');

const bot = new TelegramBot(TOKEN, { polling: true });

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  console.log(chatId)
  const chatType = msg.chat.type; // 'private', 'group', 'supergroup', 'channel'
  const chatName = msg.chat.title || msg.chat.username || msg.chat.first_name || 'N/A';
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Chat ID Found!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Chat ID: ${chatId}`);
  console.log(`📝 Name: ${chatName}`);
  console.log(`🏷️  Type: ${chatType}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('📋 Add this to your .env file:');
  console.log(`TELEGRAM_LOG_CHAT_ID=${chatId}\n`);
  
  console.log('⚠️  Note:');
  if (chatType === 'channel') {
    console.log('- This is a CHANNEL');
    console.log('- Channel IDs start with -100');
    console.log(`- Full ID format: -100${Math.abs(chatId).toString().slice(0)}`);
  } else if (chatType === 'supergroup') {
    console.log('- This is a SUPERGROUP (large group)');
    console.log(`- Supergroup IDs start with -100`);
  } else if (chatType === 'group') {
    console.log('- This is a REGULAR GROUP');
  } else if (chatType === 'private') {
    console.log('- This is a PRIVATE CHAT (direct message)');
  }
  
  console.log('\n✨ Done! You can now close this script (Ctrl+C)');
});

bot.on('polling_error', (err) => {
  console.error('❌ Polling error:', err.message);
});

bot.getMe()
  .then((me) => {
    console.log(`✅ Bot connected as @${me.username}\n`);
  })
  .catch((err) => {
    console.error('❌ Failed to connect bot:', err.message);
    process.exit(1);
  });