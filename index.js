require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token === 'sizning_bot_tokeningiz') {
  console.error('TELEGRAM_BOT_TOKEN is not set. Replace the placeholder in .env with your real bot token.');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Bot ishga tushdi.');
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Mavjud buyruqlar: /start, /help');
});

bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/')) {
    return;
  }

  bot.sendMessage(msg.chat.id, 'Xabaringiz qabul qilindi.');
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

console.log('Telegram bot started.');
