require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_LIMIT = 4096;
const DEFAULT_HERMES_API_BASE = 'http://127.0.0.1:8642/v1';

const token = process.env.TELEGRAM_BOT_TOKEN;
const hermesApiBase = normalizeBaseUrl(process.env.HERMES_API_BASE || DEFAULT_HERMES_API_BASE);
const hermesApiKey = process.env.HERMES_API_KEY;
const hermesModel = process.env.HERMES_MODEL || 'hermes-agent';
const hermesInstructions = process.env.HERMES_INSTRUCTIONS || 'Answer clearly and concisely.';
const hermesTimeoutMs = parsePositiveInt(process.env.HERMES_TIMEOUT_MS, 180000);
const allowedUserIds = parseAllowedUserIds(process.env.ALLOWED_TELEGRAM_USER_IDS);

if (!token || token === 'sizning_bot_tokeningiz') {
  console.error('TELEGRAM_BOT_TOKEN is not set. Replace the placeholder in .env with your real BotFather token.');
  process.exit(1);
}

if (!hermesApiKey) {
  console.error('HERMES_API_KEY is not set. It must match API_SERVER_KEY in ~/.hermes/.env on the server.');
  process.exit(1);
}

if (allowedUserIds.size === 0) {
  console.warn('ALLOWED_TELEGRAM_USER_IDS is empty. Anyone who can message this bot can reach Hermes.');
}

const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, async (msg) => {
  if (!isAllowed(msg.from)) {
    await denyAccess(msg.chat.id);
    return;
  }

  await bot.sendMessage(msg.chat.id, 'Bot ishga tushdi. Xabar yuboring, men Hermes Agent orqali javob beraman.');
});

bot.onText(/\/help/, async (msg) => {
  if (!isAllowed(msg.from)) {
    await denyAccess(msg.chat.id);
    return;
  }

  await bot.sendMessage(
    msg.chat.id,
    [
      'Buyruqlar:',
      '/start - botni boshlash',
      '/help - yordam',
      '/id - Telegram user ID ni ko`rsatish',
    ].join('\n')
  );
});

bot.onText(/\/id/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `Telegram user ID: ${msg.from.id}`);
});

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) {
    return;
  }

  if (!isAllowed(msg.from)) {
    await denyAccess(msg.chat.id);
    return;
  }

  const typingInterval = setInterval(() => {
    bot.sendChatAction(msg.chat.id, 'typing').catch((error) => {
      console.error('Telegram typing action failed:', error.message);
    });
  }, 5000);

  try {
    await bot.sendChatAction(msg.chat.id, 'typing');
    const answer = await askHermes(msg.text, msg.chat.id);
    await sendLongMessage(msg.chat.id, answer || 'Hermes javob qaytarmadi.');
  } catch (error) {
    console.error('Hermes request failed:', error);
    const errorMessage = error.name === 'AbortError'
      ? 'Hermes Agent javob berishda juda sekin. Keyinroq qayta urinib ko`ring.'
      : 'Hermes Agent bilan ulanishda xatolik yuz berdi.';
    await bot.sendMessage(msg.chat.id, errorMessage);
  } finally {
    clearInterval(typingInterval);
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

console.log(`Telegram bot started. Hermes API: ${hermesApiBase}`);

function isAllowed(user) {
  if (allowedUserIds.size === 0) {
    return true;
  }

  return user && allowedUserIds.has(String(user.id));
}

function denyAccess(chatId) {
  return bot.sendMessage(chatId, 'Bu botdan foydalanish uchun ruxsat yo`q.');
}

async function askHermes(text, chatId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hermesTimeoutMs);

  const response = await fetch(`${hermesApiBase}/responses`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${hermesApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: hermesModel,
      input: text,
      instructions: hermesInstructions,
      conversation: `telegram-${chatId}`,
      store: true,
    }),
  }).finally(() => clearTimeout(timeout));

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Hermes HTTP ${response.status}: ${bodyText}`);
  }

  const data = JSON.parse(bodyText);
  return extractHermesText(data);
}

function extractHermesText(data) {
  if (typeof data.output_text === 'string') {
    return data.output_text.trim();
  }

  if (Array.isArray(data.output)) {
    const parts = [];

    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content.text === 'string') {
            parts.push(content.text);
          }
        }
      }
    }

    return parts.join('\n').trim();
  }

  return '';
}

async function sendLongMessage(chatId, text) {
  const chunks = splitTelegramMessage(text);

  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk);
  }
}

function splitTelegramMessage(text) {
  if (text.length <= TELEGRAM_LIMIT) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > TELEGRAM_LIMIT) {
    const slice = remaining.slice(0, TELEGRAM_LIMIT);
    const splitAt = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
    const cut = splitAt > 1000 ? splitAt : TELEGRAM_LIMIT;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function parseAllowedUserIds(value) {
  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
