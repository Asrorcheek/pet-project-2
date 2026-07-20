require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set.');
  process.exit(1);
}

const cloudBot = new TelegramBot(token, {
  polling: false,
  baseApiUrl: 'https://api.telegram.org',
});

cloudBot.logOut()
  .then(() => {
    console.log('Telegram bot cloud API’dan chiqarildi; lokal API’ga ulash mumkin.');
  })
  .catch((error) => {
    const message = String(error?.message || error).replaceAll(token, '<redacted>');
    console.error(`Telegram cloud logOut bajarilmadi: ${message}`);
    process.exitCode = 1;
  });
