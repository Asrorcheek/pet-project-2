require('dotenv').config();

const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_LIMIT = 4096;
const DEFAULT_HERMES_API_BASE = 'http://127.0.0.1:8642/v1';
const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const GOOGLE_MEET_READONLY_SCOPE = 'https://www.googleapis.com/auth/meetings.space.readonly';
const GOOGLE_DRIVE_MEET_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.meet.readonly';
const DEFAULT_CALENDAR_ID = 'primary';
const DEFAULT_INSTAGRAM_GRAPH_BASE = 'https://graph.instagram.com';
const DEFAULT_META_API_VERSION = 'v25.0';
const DEFAULT_INSTAGRAM_POST_STORE_FILE = path.join('data', 'instagram-posts.json');
const DEFAULT_INSTAGRAM_INSIGHTS_STORE_FILE = path.join('data', 'instagram-insights.json');
const DEFAULT_MEETING_STORE_FILE = path.join('data', 'meetings.json');
const execFileAsync = promisify(execFile);

const token = process.env.TELEGRAM_BOT_TOKEN;
const hermesApiBase = normalizeBaseUrl(process.env.HERMES_API_BASE || DEFAULT_HERMES_API_BASE);
const hermesApiKey = process.env.HERMES_API_KEY;
const hermesModel = process.env.HERMES_MODEL || 'hermes-agent';
const hermesInstructions = process.env.HERMES_INSTRUCTIONS || 'Answer clearly and concisely.';
const hermesTimeoutMs = parsePositiveInt(process.env.HERMES_TIMEOUT_MS, 180000);
const mentorProjectDir = process.env.MENTOR_PROJECT_DIR
  || path.join(process.env.HOME || process.cwd(), 'mentor');
const allowedUserIds = parseAllowedUserIds(process.env.ALLOWED_TELEGRAM_USER_IDS);
const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiTranscriptionModel = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe';
const openaiTranscriptionPrompt = process.env.OPENAI_TRANSCRIPTION_PROMPT
  || 'Meeting scheduling commands in Uzbek, Russian, or English. Preserve names, dates, times, and email addresses exactly.';
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;
const googleCredentialsFile = process.env.GOOGLE_CREDENTIALS_FILE || 'credentials.json';
const googleImpersonateUserEmail = normalizeText(process.env.GOOGLE_IMPERSONATE_USER_EMAIL);
const googleCalendarId = process.env.GOOGLE_CALENDAR_ID || DEFAULT_CALENDAR_ID;
const googleCalendarTimeZone = process.env.GOOGLE_CALENDAR_TIME_ZONE
  || process.env.TZ
  || Intl.DateTimeFormat().resolvedOptions().timeZone
  || 'UTC';
const googleCalendarSendUpdates = normalizeSendUpdates(process.env.GOOGLE_CALENDAR_SEND_UPDATES);
const defaultEventDurationMinutes = parsePositiveInt(process.env.DEFAULT_EVENT_DURATION_MINUTES, 30);
const meetingStoreFile = process.env.MEETING_STORE_FILE || DEFAULT_MEETING_STORE_FILE;
const recordingPollIntervalMs = parsePositiveInt(process.env.RECORDING_POLL_INTERVAL_SECONDS, 300) * 1000;
const recordingTrackingDays = parsePositiveInt(process.env.RECORDING_TRACKING_DAYS, 30);
const metaApiVersion = normalizeMetaApiVersion(process.env.META_API_VERSION || DEFAULT_META_API_VERSION);
const instagramGraphBase = normalizeBaseUrl(
  process.env.INSTAGRAM_GRAPH_BASE || DEFAULT_INSTAGRAM_GRAPH_BASE
);
const instagramProfessionalAccountId = normalizeText(process.env.INSTAGRAM_PROFESSIONAL_ACCOUNT_ID);
const instagramAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const instagramPostStoreFile = process.env.INSTAGRAM_POST_STORE_FILE || DEFAULT_INSTAGRAM_POST_STORE_FILE;
const instagramInsightsStoreFile = process.env.INSTAGRAM_INSIGHTS_STORE_FILE
  || DEFAULT_INSTAGRAM_INSIGHTS_STORE_FILE;
const instagramInsightsRefreshMs = parsePositiveInt(
  process.env.INSTAGRAM_INSIGHTS_REFRESH_MINUTES,
  360
) * 60 * 1000;
const hermesPythonBin = process.env.HERMES_PYTHON_BIN
  || path.join(process.env.HOME || '', '.hermes', 'hermes-agent', 'venv', 'bin', 'python');
const storeProfile = {
  name: normalizeText(process.env.STORE_NAME),
  instagramUsername: normalizeText(process.env.STORE_INSTAGRAM_USERNAME),
  language: normalizeText(process.env.STORE_LANGUAGE) || 'uz',
  currency: normalizeText(process.env.STORE_CURRENCY),
  city: normalizeText(process.env.STORE_CITY),
  contactText: normalizeText(process.env.STORE_CONTACT_TEXT),
  contactUrl: normalizeText(process.env.STORE_CONTACT_URL),
  defaultHashtags: normalizeText(process.env.DEFAULT_HASHTAGS),
};
const postingConfig = {
  timeZone: normalizeText(process.env.POSTING_TIMEZONE) || googleCalendarTimeZone || 'Asia/Tashkent',
  allowedDays: parseAllowedDays(process.env.POSTING_ALLOWED_DAYS || 'mon,tue,wed,thu,fri,sat,sun'),
  allowedHours: parseAllowedHours(process.env.POSTING_ALLOWED_HOURS || '10:00-22:00'),
  maxPerDay: parsePositiveInt(process.env.POSTING_MAX_PER_DAY, 3),
  fallbackWindows: parsePostingFallbackWindows(process.env.POSTING_FALLBACK_WINDOWS || '11:00,15:00,19:00'),
};
let googleTokenCache = null;
let instagramStore = loadInstagramStore();
let instagramInsightsStore = loadInstagramInsightsStore();
let meetingStore = loadMeetingStore();
let recordingPollRunning = false;
const instagramSessions = restoreInstagramSessions(instagramStore);
const mentorSessions = new Set();

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

const missingAudioMeetingConfig = getMissingAudioMeetingConfig();
if (missingAudioMeetingConfig.length > 0) {
  console.warn(`Audio meeting creation is disabled until these env vars are set: ${missingAudioMeetingConfig.join(', ')}`);
}

const missingInstagramPublishConfig = getMissingInstagramPublishConfig();
if (missingInstagramPublishConfig.length > 0) {
  console.warn(`Instagram publishing is disabled until these env vars are set: ${missingInstagramPublishConfig.join(', ')}`);
}

const bot = new TelegramBot(token, { polling: true });

setTimeout(() => pollMeetingRecordings().catch(logRecordingPollError), 5000);
setInterval(() => pollMeetingRecordings().catch(logRecordingPollError), recordingPollIntervalMs);
setTimeout(() => refreshInstagramInsights().catch(logInstagramInsightsError), 15000);
setInterval(() => refreshInstagramInsights().catch(logInstagramInsightsError), instagramInsightsRefreshMs);

bot.onText(/\/start/, async (msg) => {
  if (!isAllowed(msg.from)) {
    await denyAccess(msg.chat.id);
    return;
  }

  await bot.sendMessage(
    msg.chat.id,
    'Bot ishga tushdi. Matn yuboring, Google Meet uchun ovozli xabar yuboring, yoki Instagram post uchun /post ishlating.'
  );
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
      '/meet kompaniya, sana va vaqt - 30 daqiqalik Google Meet yaratish',
      '/post product model - Instagram product post draft yaratish',
      '/analytics [7|30] - Instagram post natijalari hisoboti',
      '/cancelpost - aktiv Instagram post draftni bekor qilish',
      'Ovozli xabar - Google Calendar event va Google Meet havolasini yaratish',
    ].join('\n')
  );
});

bot.onText(/^\/meet(?:@\w+)?(?:\s+([\s\S]+))?$/i, async (msg, match) => {
  if (!isAllowed(msg.from)) {
    await denyAccess(msg.chat.id);
    return;
  }

  const request = normalizeText(match?.[1]);
  if (!request) {
    await bot.sendMessage(msg.chat.id, 'Misol: /meet Acme kompaniyasi, ertaga soat 15:00');
    return;
  }

  await handleMeetingRequest(msg, request, 'text');
});

bot.onText(/\/id/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `Telegram user ID: ${msg.from.id}`);
});

bot.onText(/^\/post(?:@\w+)?(?:\s+([\s\S]+))?$/i, async (msg, match) => {
  if (!isAllowed(msg.from)) {
    await denyAccess(msg.chat.id);
    return;
  }

  await handleInstagramPostCommand(msg, match?.[1]);
});

bot.onText(/^\/cancelpost(?:@\w+)?$/i, async (msg) => {
  if (!isAllowed(msg.from)) {
    await denyAccess(msg.chat.id);
    return;
  }

  await cancelInstagramDraft(msg.chat.id, 'Instagram post draft bekor qilindi.');
});

bot.onText(/^\/posts(?:@\w+)?$/i, async (msg) => {
  if (!isAllowed(msg.from)) {
    await denyAccess(msg.chat.id);
    return;
  }

  await sendInstagramPostStatus(msg.chat.id);
});

bot.onText(/^\/analytics(?:@\w+)?(?:\s+(7|30))?$/i, async (msg, match) => {
  if (!isAllowed(msg.from)) {
    await denyAccess(msg.chat.id);
    return;
  }

  await sendInstagramAnalyticsReport(msg.chat.id, Number(match?.[1] || 30));
});

bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/')) {
    return;
  }

  if (!isAllowed(msg.from)) {
    await denyAccess(msg.chat.id);
    return;
  }

  if (hasActiveInstagramSession(msg.chat.id)) {
    await handleInstagramReply(msg);
    return;
  }

  if (msg.voice || msg.audio) {
    await handleAudioMeetingMessage(msg);
    return;
  }

  if (!msg.text) {
    return;
  }

  if (isTextMeetingRequest(msg.text)) {
    await handleMeetingRequest(msg, msg.text, 'text');
    return;
  }

  await handleTextMessage(msg);
});

async function handleTextMessage(msg) {
  try {
    await withChatAction(msg.chat.id, 'typing', async () => {
      const mentorRequest = parseMentorRequest(msg.text);
      const mentorSessionKey = String(msg.chat.id);
      const mentorText = mentorRequest?.text || (mentorSessions.has(mentorSessionKey) ? normalizeText(msg.text) : '');

      if (mentorRequest) {
        mentorSessions.add(mentorSessionKey);
      }

      if (isMentorExitText(mentorText)) {
        mentorSessions.delete(mentorSessionKey);
        await bot.sendMessage(msg.chat.id, 'Mentor mode o`chirildi.');
        return;
      }

      const answer = mentorText
        ? await askHermes(mentorText, msg.chat.id, {
          instructions: buildMentorInstructions(),
          conversation: `telegram-${msg.chat.id}-alex-mentor`,
        })
        : await askHermes(msg.text, msg.chat.id);

      await sendLongMessage(msg.chat.id, answer || 'Hermes javob qaytarmadi.');
    });
  } catch (error) {
    console.error('Hermes request failed:', error);
    const errorMessage = error.name === 'AbortError'
      ? 'Hermes Agent javob berishda juda sekin. Keyinroq qayta urinib ko`ring.'
      : 'Hermes Agent bilan ulanishda xatolik yuz berdi.';
    await bot.sendMessage(msg.chat.id, errorMessage);
  }
}

async function handleAudioMeetingMessage(msg) {
  try {
    await withChatAction(msg.chat.id, 'typing', async () => {
      assertAudioMeetingConfig();

      const audioMessage = msg.voice || msg.audio;
      const audio = await downloadTelegramAudio(audioMessage.file_id);
      const transcript = await transcribeAudio(audio);

      if (!transcript) {
        throw new UserVisibleError('Ovozli xabar matnini aniqlay olmadim. Iltimos, aniqroq qayta yuboring.');
      }

      await createAndReplyWithMeeting(msg, transcript, 'audio');
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      await bot.sendMessage(msg.chat.id, error.message);
      return;
    }

    console.error('Audio meeting creation failed:', error);
    await bot.sendMessage(msg.chat.id, 'Google Calendar uchrashuvini yaratishda xatolik yuz berdi.');
  }
}

async function handleMeetingRequest(msg, request, source) {
  try {
    await withChatAction(msg.chat.id, 'typing', async () => {
      assertGoogleMeetingConfig();
      await createAndReplyWithMeeting(msg, request, source);
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      await bot.sendMessage(msg.chat.id, error.message);
      return;
    }

    console.error('Meeting creation failed:', error);
    await bot.sendMessage(msg.chat.id, 'Google Calendar uchrashuvini yaratishda xatolik yuz berdi.');
  }
}

async function createAndReplyWithMeeting(msg, request, source) {
  const eventDetails = await extractCalendarEvent(request, msg.chat.id);
  const missingFields = getMissingCalendarFields(eventDetails);

  if (missingFields.length > 0) {
    throw new UserVisibleError(
      [
        `Uchrashuvni yaratish uchun yetarli ma'lumot yo'q: ${missingFields.join(', ')}.`,
        '',
        `Aniqlangan matn: ${request}`,
      ].join('\n')
    );
  }

  const event = await createGoogleCalendarEvent(eventDetails, request);
  const meetLink = extractMeetLink(event);
  const reply = formatCreatedMeetingReply(event, eventDetails, meetLink);

  trackMeeting(event, eventDetails, meetLink, msg.chat.id, source);
  await bot.sendMessage(msg.chat.id, reply);
}

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

console.log(`Telegram bot started. Hermes API: ${hermesApiBase}`);
setInterval(() => {
  processDueInstagramPosts().catch((error) => {
    console.error('Instagram scheduler failed:', redactAccessToken(error.message || String(error)));
  });
}, 60000);
processDueInstagramPosts().catch((error) => {
  console.error('Instagram scheduler startup failed:', redactAccessToken(error.message || String(error)));
});

function isAllowed(user) {
  if (allowedUserIds.size === 0) {
    return true;
  }

  return user && allowedUserIds.has(String(user.id));
}

function denyAccess(chatId) {
  return bot.sendMessage(chatId, 'Bu botdan foydalanish uchun ruxsat yo`q.');
}

async function askHermes(text, chatId, options = {}) {
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
      instructions: options.instructions || hermesInstructions,
      conversation: options.conversation || `telegram-${chatId}`,
      store: options.store ?? true,
    }),
  }).finally(() => clearTimeout(timeout));

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Hermes HTTP ${response.status}: ${bodyText}`);
  }

  const data = JSON.parse(bodyText);
  return extractHermesText(data);
}

async function handleInstagramPostCommand(msg, rawInput) {
  const input = normalizeText(rawInput);

  if (!input) {
    await bot.sendMessage(
      msg.chat.id,
      [
        'Instagram post draft yaratish uchun product modelini yuboring.',
        '',
        'Example:',
        '/post MacBook Air M2 8/256',
      ].join('\n')
    );
    return;
  }

  const product = parseProductRequest(input);
  if (!product.title) {
    await bot.sendMessage(
      msg.chat.id,
      [
        'Product nomi/modeli kerak.',
        '',
        'Example:',
        '/post MacBook Air M2 8/256',
      ].join('\n')
    );
    return;
  }

  await withChatAction(msg.chat.id, 'typing', async () => {
    const draft = createInstagramDraft(msg, input, product);
    setInstagramSession(msg.chat.id, draft.id);
    saveInstagramDraft(draft);

    let imageOptions = [];
    try {
      imageOptions = await findCandidateImages(draft);
    } catch (error) {
      console.error('Instagram image search failed:', redactAccessToken(error.message || String(error)));
    }

    if (imageOptions.length === 0) {
      draft.status = 'waiting_for_image_url';
      draft.imageOptions = [];
      saveInstagramDraft(draft);
      await bot.sendMessage(
        msg.chat.id,
        [
          `Draft created: ${draft.product.title}`,
          draft.product.price ? `Price: ${draft.product.price}` : '',
          '',
          'Hermes image search returned no safe public image candidates.',
          'Reply with a public JPEG image URL, or say search again.',
          '',
          'Commands: cancel',
        ].join('\n')
      );
      return;
    }

    draft.status = 'waiting_for_image_approval';
    draft.imageOptions = imageOptions;
    saveInstagramDraft(draft);
    await sendInstagramImageOptions(msg.chat.id, draft);
  });
}

async function handleInstagramReply(msg) {
  const draft = getActiveInstagramDraft(msg.chat.id);

  if (!draft) {
    instagramSessions.delete(String(msg.chat.id));
    return;
  }

  if (msg.photo) {
    await bot.sendMessage(
      msg.chat.id,
      'Telegram photo received, but Instagram API needs a public JPEG URL. Reply with a public .jpg/.jpeg URL instead.'
    );
    return;
  }

  const text = normalizeText(msg.text);
  if (!text) {
    await bot.sendMessage(msg.chat.id, 'Reply with a number, public JPEG URL, approve, post now, schedule ..., or cancel.');
    return;
  }

  if (isCancelText(text)) {
    await cancelInstagramDraft(msg.chat.id, 'Instagram post draft bekor qilindi.');
    return;
  }

  if (draft.status === 'waiting_for_image_approval' || draft.status === 'waiting_for_image_url') {
    await handleInstagramImageReply(msg.chat.id, draft, text);
    return;
  }

  if (draft.status === 'waiting_for_price') {
    await handleInstagramPriceReply(msg.chat.id, draft, text);
    return;
  }

  if (draft.status === 'waiting_for_final_approval' || draft.status === 'ready_to_publish') {
    await handleInstagramFinalReply(msg.chat.id, draft, text);
    return;
  }

  await bot.sendMessage(msg.chat.id, `Draft status: ${draft.status}. Use /post to start a new draft.`);
}

async function handleInstagramImageReply(chatId, draft, text) {
  if (/^(reject|search again|again)$/i.test(text)) {
    await withChatAction(chatId, 'typing', async () => {
      const imageOptions = await findCandidateImages(draft);

      if (imageOptions.length === 0) {
        draft.status = 'waiting_for_image_url';
        draft.imageOptions = [];
        saveInstagramDraft(draft);
        await bot.sendMessage(chatId, 'No new image options found. Reply with a public JPEG image URL.');
        return;
      }

      draft.status = 'waiting_for_image_approval';
      draft.imageOptions = imageOptions;
      saveInstagramDraft(draft);
      await sendInstagramImageOptions(chatId, draft);
    });
    return;
  }

  const selectedImage = resolveSelectedImage(draft, text);
  if (!selectedImage) {
    await bot.sendMessage(
      chatId,
      [
        'Choose an image by replying with its number, for example: 2',
        'Or reply with a public JPEG image URL.',
        'You can also say: reject or search again.',
      ].join('\n')
    );
    return;
  }

  draft.selectedImage = selectedImage;
  draft.status = 'image_approved';
  saveInstagramDraft(draft);

  if (!draft.product.price) {
    draft.status = 'waiting_for_price';
    saveInstagramDraft(draft);
    await bot.sendMessage(
      chatId,
      [
        `Rasm tanlandi: ${draft.product.title}`,
        'Endi sotuv narxini valyutasi bilan yuboring.',
        'Masalan: $720 yoki 9 200 000 so`m',
      ].join('\n')
    );
    return;
  }

  await prepareInstagramPostPreview(chatId, draft);
}

async function handleInstagramPriceReply(chatId, draft, text) {
  if (!/\d/.test(text)) {
    await bot.sendMessage(chatId, 'Narx raqam va valyuta bilan bo`lishi kerak. Masalan: $720');
    return;
  }

  draft.product.price = truncateText(text, 100);
  saveInstagramDraft(draft);
  await prepareInstagramPostPreview(chatId, draft);
}

async function prepareInstagramPostPreview(chatId, draft) {
  await withChatAction(chatId, 'typing', async () => {
    const postPackage = await createInstagramPostPackage(draft);

    draft.caption = postPackage.caption;
    draft.altText = postPackage.altText;
    draft.recommendedScheduleAt = chooseNextPostingTime(new Date()).toISOString();
    draft.status = 'waiting_for_final_approval';
    saveInstagramDraft(draft);

    await sendInstagramPostPreview(chatId, draft);
  });
}

async function handleInstagramFinalReply(chatId, draft, text) {
  const changeCaptionMatch = text.match(/^change caption\s+([\s\S]+)$/i);
  if (changeCaptionMatch) {
    draft.caption = truncateInstagramCaption(changeCaptionMatch[1]);
    draft.pendingAction = null;
    draft.pendingScheduleAt = null;
    draft.status = 'waiting_for_final_approval';
    saveInstagramDraft(draft);
    await sendInstagramPostPreview(chatId, draft);
    return;
  }

  const scheduleAt = parseScheduleCommand(text);
  if (scheduleAt) {
    draft.pendingAction = 'schedule';
    draft.pendingScheduleAt = scheduleAt.toISOString();
    draft.status = 'ready_to_publish';
    saveInstagramDraft(draft);
    await bot.sendMessage(
      chatId,
      [
        'Rejalashtirish tayyor.',
        `Vaqt: ${formatScheduledAt(scheduleAt)}`,
        'Tasdiqlash uchun: approve',
        'Bekor qilish uchun: cancel',
      ].join('\n')
    );
    return;
  }

  if (/^approve$/i.test(text)) {
    if (draft.pendingAction === 'schedule' && draft.pendingScheduleAt) {
      await approveInstagramDraftForSchedule(chatId, draft, new Date(draft.pendingScheduleAt));
      return;
    }
    if (draft.pendingAction === 'publish_now') {
      await publishInstagramDraftNow(chatId, draft);
      return;
    }
    await bot.sendMessage(chatId, 'Avval vaqtni yuboring: schedule tomorrow 19:00 yoki post now.');
    return;
  }

  if (/^post now$/i.test(text)) {
    draft.pendingAction = 'publish_now';
    draft.pendingScheduleAt = null;
    draft.status = 'ready_to_publish';
    saveInstagramDraft(draft);
    await bot.sendMessage(chatId, 'Hozir chiqarish tayyor. Yakuniy tasdiq uchun: approve');
    return;
  }

  await bot.sendMessage(
    chatId,
    [
      'Final approval commands:',
      'schedule tomorrow 19:00 - choose a time, then approve',
      'post now - prepare immediate publishing, then approve',
      'approve - confirm a previously selected action',
      'change caption ... - replace caption',
      'cancel - cancel draft',
    ].join('\n')
  );
}

async function approveInstagramDraftForSchedule(chatId, draft, scheduleAt) {
  const missing = getMissingInstagramPublishConfig();
  if (missing.length > 0) {
    draft.status = 'ready_to_publish';
    draft.scheduledAt = scheduleAt.toISOString();
    saveInstagramDraft(draft);
    await bot.sendMessage(
      chatId,
      [
        'Final approval saved, but live Instagram publishing is not configured yet.',
        `Missing env vars: ${missing.join(', ')}`,
        '',
        `Planned time: ${formatScheduledAt(scheduleAt)}`,
        'After setting credentials and restarting the bot, reply "post now" or "approve" from this draft.',
      ].join('\n')
    );
    return;
  }

  if (!isAllowedPostingDate(scheduleAt) || !isWithinAllowedPostingHours(scheduleAt)) {
    await bot.sendMessage(
      chatId,
      `That time is outside allowed posting windows. Allowed hours: ${formatAllowedHours(postingConfig.allowedHours)}`
    );
    return;
  }

  draft.status = 'scheduled';
  draft.scheduledAt = scheduleAt.toISOString();
  saveInstagramDraft(draft);
  clearInstagramSession(chatId, draft.id);

  await bot.sendMessage(
    chatId,
    [
      'Instagram post scheduled.',
      `Time: ${formatScheduledAt(scheduleAt)}`,
      `Product: ${draft.product.title}`,
    ].join('\n')
  );
}

async function publishInstagramDraftNow(chatId, draft) {
  const missing = getMissingInstagramPublishConfig();
  if (missing.length > 0) {
    draft.status = 'ready_to_publish';
    saveInstagramDraft(draft);
    await bot.sendMessage(chatId, `Instagram publishing is not configured. Missing env vars: ${missing.join(', ')}`);
    return;
  }

  await withChatAction(chatId, 'upload_photo', async () => {
    draft.status = 'publishing';
    draft.scheduledAt = null;
    saveInstagramDraft(draft);

    try {
      const result = await publishInstagramDraft(draft);
      draft.status = 'published';
      draft.publishedAt = new Date().toISOString();
      draft.publishResult = result;
      saveInstagramDraft(draft);
      clearInstagramSession(chatId, draft.id);

      await bot.sendMessage(chatId, formatPublishedInstagramReply(draft));
    } catch (error) {
      draft.status = 'failed';
      draft.error = redactAccessToken(error.message || String(error));
      saveInstagramDraft(draft);
      clearInstagramSession(chatId, draft.id);

      console.error('Instagram publish failed:', draft.error);
      await bot.sendMessage(chatId, `Instagram publish failed: ${draft.error}`);
    }
  });
}

async function sendInstagramImageOptions(chatId, draft) {
  await bot.sendMessage(
    chatId,
    [
      `Image options for: ${draft.product.title}`,
      draft.product.price ? `Price: ${draft.product.price}` : '',
      '',
      'Reply with the number to approve, or say reject/search again.',
      'You can also reply with a public JPEG image URL.',
    ].join('\n')
  );

  for (const option of draft.imageOptions) {
    const caption = truncateTelegramCaption(
      [
        `${option.index}. ${option.title || 'Product image'}`,
        `Source: ${option.sourceName || 'unknown'}`,
        option.sourceUrl,
      ]
        .filter(Boolean)
        .join('\n')
    );

    try {
      await bot.sendPhoto(chatId, option.url, { caption });
    } catch (error) {
      await sendLongMessage(chatId, `${caption}\nImage URL: ${option.url}`);
    }
  }
}

async function sendInstagramPostPreview(chatId, draft) {
  const recommendedAt = draft.recommendedScheduleAt ? new Date(draft.recommendedScheduleAt) : chooseNextPostingTime(new Date());
  const imageLine = draft.selectedImage?.sourceUrl && draft.selectedImage.sourceUrl !== draft.selectedImage.url
    ? `Image source: ${draft.selectedImage.sourceUrl}`
    : `Image: ${draft.selectedImage?.url || 'selected'}`;

  await sendLongMessage(
    chatId,
    [
      'Caption preview:',
      '',
      draft.caption,
      '',
      imageLine,
      `Alt text: ${draft.altText || 'not set'}`,
      `Recommended time: ${formatScheduledAt(recommendedAt)}`,
      '',
      'Reply:',
      'post now',
      'schedule tomorrow 19:00',
      'change caption ...',
      'cancel',
    ].join('\n')
  );
}

async function sendInstagramPostStatus(chatId) {
  const drafts = instagramStore.drafts
    .filter((draft) => String(draft.chatId) === String(chatId))
    .slice(-10)
    .reverse();

  if (drafts.length === 0) {
    await bot.sendMessage(chatId, 'No Instagram post drafts yet.');
    return;
  }

  await sendLongMessage(
    chatId,
    drafts
      .map((draft) => {
        const time = draft.scheduledAt ? `\nTime: ${formatScheduledAt(new Date(draft.scheduledAt))}` : '';
        return `${draft.status}: ${draft.product?.title || draft.productInput}${time}`;
      })
      .join('\n\n')
  );
}

async function sendInstagramAnalyticsReport(chatId, days) {
  const missing = getMissingInstagramPublishConfig();
  if (missing.length > 0) {
    await bot.sendMessage(chatId, `Instagram analytics sozlanmagan. Missing env vars: ${missing.join(', ')}`);
    return;
  }

  try {
    await withChatAction(chatId, 'typing', async () => {
      await refreshInstagramInsights();
      await sendLongMessage(chatId, formatInstagramAnalyticsReport(days));
    });
  } catch (error) {
    const message = redactAccessToken(error.message || String(error));
    console.error('Instagram analytics report failed:', message);
    await bot.sendMessage(chatId, `Instagram analytics olishda xatolik: ${message}`);
  }
}

async function refreshInstagramInsights() {
  if (getMissingInstagramPublishConfig().length > 0) {
    return;
  }

  const account = await fetchInstagramJson(
    `${instagramProfessionalAccountId}?fields=id,username,account_type,media_count,followers_count&access_token=${encodeURIComponent(instagramAccessToken)}`
  );
  const mediaResponse = await fetchInstagramJson(
    `${instagramProfessionalAccountId}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink&limit=100&access_token=${encodeURIComponent(instagramAccessToken)}`
  );
  const mediaItems = Array.isArray(mediaResponse.data) ? mediaResponse.data : [];
  const collectedAt = new Date().toISOString();
  const media = [];

  for (const item of mediaItems) {
    try {
      const insights = await fetchInstagramJson(
        `${item.id}/insights?metric=views,reach,likes,comments,saved,shares,total_interactions&access_token=${encodeURIComponent(instagramAccessToken)}`
      );
      media.push({
        id: item.id,
        caption: truncateText(item.caption || '', 500),
        mediaType: item.media_type || '',
        mediaProductType: item.media_product_type || '',
        timestamp: item.timestamp || '',
        permalink: item.permalink || '',
        metrics: normalizeInstagramInsightMetrics(insights.data),
      });
    } catch (error) {
      console.warn(`Instagram insights skipped for media ${item.id}: ${redactAccessToken(error.message)}`);
    }
  }

  const snapshot = {
    collectedAt,
    account: {
      id: account.id || instagramProfessionalAccountId,
      username: account.username || storeProfile.instagramUsername,
      accountType: account.account_type || '',
      mediaCount: Number(account.media_count || mediaItems.length),
      followersCount: Number(account.followers_count || 0),
    },
    media,
  };

  instagramInsightsStore.latest = snapshot;
  instagramInsightsStore.history.push(buildInstagramAccountHistoryPoint(snapshot));
  instagramInsightsStore.history = instagramInsightsStore.history.slice(-360);
  saveInstagramInsightsStore();
}

function normalizeInstagramInsightMetrics(data) {
  const metrics = {};
  for (const item of Array.isArray(data) ? data : []) {
    const value = item.values?.[0]?.value;
    if (item.name && Number.isFinite(Number(value))) {
      metrics[item.name] = Number(value);
    }
  }
  return metrics;
}

function buildInstagramAccountHistoryPoint(snapshot) {
  return {
    collectedAt: snapshot.collectedAt,
    followersCount: snapshot.account.followersCount,
    mediaCount: snapshot.account.mediaCount,
    totalReach: sumInstagramMetric(snapshot.media, 'reach'),
    totalViews: sumInstagramMetric(snapshot.media, 'views'),
    totalInteractions: sumInstagramMetric(snapshot.media, 'total_interactions'),
  };
}

function formatInstagramAnalyticsReport(days) {
  const snapshot = instagramInsightsStore.latest;
  if (!snapshot?.media?.length) {
    return 'Instagram analytics ma`lumoti hali yo`q.';
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const selected = snapshot.media.filter((item) => {
    const publishedAt = Date.parse(item.timestamp);
    return Number.isFinite(publishedAt) && publishedAt >= cutoff;
  });
  const media = selected.length > 0 ? selected : snapshot.media;
  const ranked = media
    .map((item) => ({ ...item, engagementRate: calculateInstagramEngagementRate(item.metrics) }))
    .sort((a, b) => (b.metrics.total_interactions || 0) - (a.metrics.total_interactions || 0));
  const top = ranked.slice(0, 5);
  const totalReach = sumInstagramMetric(media, 'reach');
  const totalViews = sumInstagramMetric(media, 'views');
  const totalInteractions = sumInstagramMetric(media, 'total_interactions');
  const overallRate = totalReach > 0 ? (totalInteractions / totalReach) * 100 : 0;
  const periodLabel = selected.length > 0 ? `${days} kun` : 'barcha mavjud postlar';

  return [
    `Instagram analytics — @${snapshot.account.username || storeProfile.instagramUsername}`,
    `Davr: ${periodLabel}`,
    `Followerlar: ${snapshot.account.followersCount}`,
    `Postlar: ${media.length}`,
    `Views: ${totalViews}`,
    `Reach: ${totalReach}`,
    `Interactions: ${totalInteractions}`,
    `Engagement/reach: ${overallRate.toFixed(1)}%`,
    '',
    'Eng yaxshi postlar:',
    ...top.map((item, index) => [
      `${index + 1}. ${instagramMediaLabel(item)}`,
      `Views ${item.metrics.views || 0} | Reach ${item.metrics.reach || 0} | Interactions ${item.metrics.total_interactions || 0} | ER ${item.engagementRate.toFixed(1)}%`,
      item.permalink,
    ].filter(Boolean).join('\n')),
    '',
    snapshot.account.followersCount < 100
      ? 'Eslatma: followerlar 100 dan kam, shuning uchun follower-active time o`rniga post natijalari ishlatiladi.'
      : 'Follower-active time keyingi scheduling hisobiga qo`shilishi mumkin.',
    `Yangilangan: ${formatScheduledAt(new Date(snapshot.collectedAt))}`,
  ].join('\n');
}

function instagramMediaLabel(item) {
  const firstLine = normalizeText(item.caption).split('\n')[0];
  return truncateText(firstLine || item.mediaProductType || item.mediaType || item.id, 80);
}

function sumInstagramMetric(media, metric) {
  return media.reduce((sum, item) => sum + Number(item.metrics?.[metric] || 0), 0);
}

function calculateInstagramEngagementRate(metrics) {
  const reach = Number(metrics?.reach || 0);
  return reach > 0 ? (Number(metrics?.total_interactions || 0) / reach) * 100 : 0;
}

function logInstagramInsightsError(error) {
  console.error('Instagram insights refresh failed:', redactAccessToken(error.message || String(error)));
}

async function cancelInstagramDraft(chatId, message) {
  const draft = getActiveInstagramDraft(chatId);

  if (draft) {
    draft.status = 'cancelled';
    saveInstagramDraft(draft);
    clearInstagramSession(chatId, draft.id);
  }

  await bot.sendMessage(chatId, message);
}

async function findCandidateImages(draft) {
  const answer = await askHermes(buildInstagramImageSearchPrompt(draft), draft.chatId, {
    instructions: [
      'Use the installed kronyx-instagram-publisher skill.',
      'Use only the web_search tool to find exact-model product images.',
      'Do not use execute_code, terminal, shell, or file mutation tools.',
      'Return only valid JSON. Do not include markdown or commentary.',
    ].join(' '),
    conversation: `telegram-${draft.chatId}-instagram-images-${draft.id}`,
    store: true,
  });
  const parsed = parseJsonObject(answer);
  const items = Array.isArray(parsed?.images)
    ? parsed.images
    : (Array.isArray(parsed) ? parsed : []);

  if (items.length === 0) {
    console.warn(
      `Hermes image search returned no parseable items: ${truncateText(answer || '[empty response]', 1200)}`
    );
  }

  const candidates = await Promise.all(items.slice(0, 8).map(async (item, index) => {
    const sourceUrl = normalizeText(item.source_url || item.sourceUrl || item.page_url || item.url);
    const suppliedImageUrl = normalizeText(item.url || item.image_url || item.direct_url);
    const imageUrl = isLikelyImageUrl(suppliedImageUrl)
      ? suppliedImageUrl
      : await extractPublicImageFromPage(sourceUrl).catch(() => '');

    return {
      index: index + 1,
      url: imageUrl,
      sourceUrl,
      sourceName: normalizeText(item.source_name || item.sourceName)
        || hostnameFromUrl(sourceUrl),
      title: normalizeText(item.title) || draft.product.title,
      mime: normalizeText(item.mime || item.content_type),
      note: normalizeText(item.note) || 'Candidate/reference image found by Hermes web search',
    };
  }));

  const resolvedCandidates = candidates.filter((item) => isPublicHttpUrl(item.url));

  if (resolvedCandidates.length < 3) {
    const directCandidates = await findDdgsImageCandidates(draft).catch((error) => {
      console.warn(`DDGS direct image search failed: ${error.message}`);
      return [];
    });
    resolvedCandidates.push(...directCandidates);
  }

  const seenUrls = new Set();
  return resolvedCandidates
    .filter((item) => {
      if (!isPublicHttpUrl(item.url) || seenUrls.has(item.url)) {
        return false;
      }
      seenUrls.add(item.url);
      return true;
    })
    .slice(0, 5)
    .map((item, index) => ({ ...item, index: index + 1 }));
}

async function findDdgsImageCandidates(draft) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'search-product-images.py');
  const query = `${draft.product.title} official product photo`;
  const { stdout } = await execFileAsync(hermesPythonBin, [scriptPath, query, '8'], {
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const items = JSON.parse(stdout);

  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => ({
    index: null,
    url: normalizeText(item.image),
    sourceUrl: normalizeText(item.url),
    sourceName: normalizeText(item.source) || hostnameFromUrl(item.url),
    title: normalizeText(item.title) || draft.product.title,
    mime: isLikelyJpegUrl(item.image) ? 'image/jpeg' : '',
    note: 'Direct image candidate from Hermes DDGS image discovery',
  }));
}

async function extractPublicImageFromPage(pageUrl) {
  if (!isPublicHttpUrl(pageUrl)) {
    return '';
  }

  const response = await fetchWithTimeout(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; KronyxProductBot/1.0)',
      Accept: 'text/html,application/xhtml+xml,image/*',
    },
  }, 20000);

  if (!response.ok) {
    return '';
  }

  const contentType = normalizeText(response.headers.get('content-type')).toLowerCase();
  if (contentType.startsWith('image/')) {
    return pageUrl;
  }

  const html = (await response.text()).slice(0, 1000000);
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    try {
      return new URL(decodeHtmlUrl(match[1]), pageUrl).toString();
    } catch (error) {
      // Try the next metadata field.
    }
  }

  return '';
}

function decodeHtmlUrl(value) {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/gi, '"');
}

function buildInstagramImageSearchPrompt(draft) {
  return [
    'Find 3 to 5 image candidates for this exact product:',
    JSON.stringify({
      title: draft.product.title,
      price: draft.product.price,
      rawInput: draft.productInput,
    }),
    '',
    'Return only valid JSON in this shape:',
    '{"images":[{"source_url":"real product or image page URL from search","url":"direct image URL when the search result provides one, otherwise empty","source_name":"site or manufacturer","title":"exact model","mime":"image/jpeg when known","note":"why this source matches"}]}',
    '',
    'Rules:',
    '- Search the web; do not invent URLs.',
    '- Use web_search only. Never use web_extract, execute_code, or terminal tools.',
    '- Match the exact product model and stated configuration.',
    '- Prefer official manufacturer or authorized retailer sources.',
    '- Prefer clean, high-resolution, product-only JPEG images.',
    '- Exclude watermarks, competitor branding, wrong variants, placeholders, and unrelated colors when known.',
    '- Always return real search-result pages in source_url, even when no direct image URL is available.',
    '- Put a URL in url only when it points directly to an image; otherwise use an empty string.',
  ].join('\n');
}

async function createInstagramPostPackage(draft) {
  const prompt = buildInstagramCaptionPrompt(draft);
  const answer = await askHermes(prompt, draft.chatId, {
    instructions: 'Create a professional Instagram product post package. Return only valid JSON. Do not include markdown.',
    conversation: `telegram-${draft.chatId}-instagram-post-${draft.id}`,
    store: true,
  });
  const parsed = parseJsonObject(answer);

  if (parsed?.caption) {
    return {
      caption: truncateInstagramCaption(parsed.caption),
      altText: truncateText(parsed.alt_text || parsed.altText || '', 1000),
    };
  }

  return {
    caption: truncateInstagramCaption(answer || buildFallbackInstagramCaption(draft)),
    altText: truncateText(`${draft.product.title} product photo`, 1000),
  };
}

async function processDueInstagramPosts() {
  const now = Date.now();
  const dueDrafts = instagramStore.drafts.filter((draft) => (
    draft.status === 'scheduled'
    && draft.scheduledAt
    && Date.parse(draft.scheduledAt) <= now
  ));

  if (dueDrafts.length === 0) {
    return;
  }

  const missing = getMissingInstagramPublishConfig();
  if (missing.length > 0) {
    console.warn(`Instagram scheduled posts are due, but publishing is not configured. Missing env vars: ${missing.join(', ')}`);
    return;
  }

  for (const draft of dueDrafts) {
    draft.status = 'publishing';
    saveInstagramDraft(draft);

    try {
      const result = await publishInstagramDraft(draft);
      draft.status = 'published';
      draft.publishedAt = new Date().toISOString();
      draft.publishResult = result;
      saveInstagramDraft(draft);

      await bot.sendMessage(draft.chatId, formatPublishedInstagramReply(draft));
    } catch (error) {
      draft.status = 'failed';
      draft.error = redactAccessToken(error.message || String(error));
      saveInstagramDraft(draft);

      console.error('Scheduled Instagram publish failed:', draft.error);
      await bot.sendMessage(draft.chatId, `Scheduled Instagram publish failed: ${draft.error}`);
    }
  }
}

async function publishInstagramDraft(draft) {
  await verifyInstagramImageUrl(draft.selectedImage.url);

  const container = await createInstagramMediaContainer(draft);
  const containerId = container.id || container.creation_id;

  if (!containerId) {
    throw new Error('Meta API did not return a media container id.');
  }

  await waitForInstagramContainer(containerId);
  const published = await publishInstagramMediaContainer(containerId);
  const mediaId = published.id || published.media_id;
  let permalink = '';

  if (mediaId) {
    permalink = await getInstagramMediaPermalink(mediaId).catch(() => '');
  }

  return {
    containerId,
    mediaId,
    permalink,
  };
}

async function createInstagramMediaContainer(draft) {
  const params = new URLSearchParams({
    image_url: draft.selectedImage.url,
    caption: draft.caption,
    access_token: instagramAccessToken,
  });

  return fetchInstagramJson(`${instagramProfessionalAccountId}/media`, {
    method: 'POST',
    body: params,
  });
}

async function waitForInstagramContainer(containerId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const container = await fetchInstagramJson(
      `${containerId}?fields=status_code,status&access_token=${encodeURIComponent(instagramAccessToken)}`
    );
    const statusCode = normalizeText(container.status_code).toUpperCase();

    if (statusCode === 'FINISHED') {
      return container;
    }

    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(`Instagram media container failed: ${container.status || statusCode}`);
    }

    await sleep(2000);
  }

  throw new Error('Instagram media container was not ready in time.');
}

async function publishInstagramMediaContainer(containerId) {
  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: instagramAccessToken,
  });

  return fetchInstagramJson(`${instagramProfessionalAccountId}/media_publish`, {
    method: 'POST',
    body: params,
  });
}

async function getInstagramMediaPermalink(mediaId) {
  const media = await fetchInstagramJson(
    `${mediaId}?fields=permalink&access_token=${encodeURIComponent(instagramAccessToken)}`
  );
  return media.permalink || '';
}

async function fetchInstagramJson(pathname, options = {}) {
  const url = `${instagramGraphBase}/${metaApiVersion}/${pathname}`;
  const response = await fetch(url, options);
  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Meta API HTTP ${response.status}: ${redactAccessToken(bodyText)}`);
  }

  return JSON.parse(bodyText);
}

async function verifyInstagramImageUrl(imageUrl) {
  const result = await fetchImageMetadata(imageUrl);

  if (!result.ok) {
    throw new Error(`Selected image is not publicly reachable. HTTP ${result.status}`);
  }

  if (!isJpegContentType(result.contentType) && !isLikelyJpegUrl(imageUrl)) {
    throw new Error('Selected image must be a public JPEG URL for Instagram publishing.');
  }
}

async function fetchImageMetadata(imageUrl) {
  let response = await fetchWithTimeout(imageUrl, { method: 'HEAD' }, 20000).catch(() => null);

  if (!response || response.status === 405 || response.status === 403) {
    response = await fetchWithTimeout(imageUrl, { method: 'GET' }, 20000);
  }

  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
}

async function downloadTelegramAudio(fileId) {
  const fileLink = await bot.getFileLink(fileId);
  const response = await fetch(fileLink);
  const body = await response.arrayBuffer();

  if (!response.ok) {
    throw new Error(`Telegram file HTTP ${response.status}: ${Buffer.from(body).toString('utf8')}`);
  }

  const fileName = normalizeAudioFileName(fileLink);
  const mimeType = response.headers.get('content-type') || guessAudioMimeType(fileName);

  return {
    buffer: Buffer.from(body),
    fileName,
    mimeType,
  };
}

async function transcribeAudio(audio) {
  const form = new FormData();
  const blob = new Blob([audio.buffer], { type: audio.mimeType || 'application/octet-stream' });

  form.append('file', blob, audio.fileName);
  form.append('model', openaiTranscriptionModel);

  if (openaiTranscriptionPrompt) {
    form.append('prompt', openaiTranscriptionPrompt);
  }

  const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: form,
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`OpenAI transcription HTTP ${response.status}: ${bodyText}`);
  }

  const data = JSON.parse(bodyText);
  return typeof data.text === 'string' ? data.text.trim() : '';
}

async function extractCalendarEvent(transcript, chatId) {
  const prompt = buildCalendarExtractionPrompt(transcript);
  const answer = await askHermes(prompt, chatId, {
    instructions: 'Extract one calendar event and return only valid JSON. Do not include markdown.',
    conversation: `telegram-${chatId}-calendar-event`,
    store: false,
  });
  const parsed = parseJsonObject(answer);

  if (!parsed) {
    throw new Error(`Hermes did not return JSON: ${answer}`);
  }

  return normalizeCalendarDetails(parsed);
}

function buildCalendarExtractionPrompt(transcript) {
  return [
    'Extract one Google Calendar meeting event from the transcript.',
    `Current local date/time: ${formatZonedDateTimeForPrompt(new Date(), googleCalendarTimeZone)}`,
    `Time zone: ${googleCalendarTimeZone}`,
    `Default duration: ${defaultEventDurationMinutes} minutes`,
    '',
    'Return only this JSON shape:',
    '{"summary":"short title","start":{"dateTime":"YYYY-MM-DDTHH:mm:ss"},"end":{"dateTime":"YYYY-MM-DDTHH:mm:ss"},"attendees":["email@example.com"],"description":"optional details","missing":[]}',
    '',
    'Rules:',
    '- Resolve relative dates like today, tomorrow, and next Monday using the current local date/time above.',
    '- If the user gives no end time, use the default duration.',
    '- If the date or start time is missing, add "start.dateTime" to missing and leave start.dateTime empty.',
    '- Use attendees only for explicit email addresses. Put names without email addresses into description.',
    '- Keep dateTime values in the listed time zone and do not add markdown fences.',
    '',
    'Transcript:',
    transcript,
  ].join('\n');
}

async function createGoogleCalendarEvent(eventDetails, transcript) {
  const accessToken = await getGoogleAccessToken();
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleCalendarId)}/events`);

  url.searchParams.set('conferenceDataVersion', '1');
  url.searchParams.set('sendUpdates', googleCalendarSendUpdates);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildGoogleCalendarEventBody(eventDetails, transcript)),
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Google Calendar HTTP ${response.status}: ${bodyText}`);
  }

  const event = JSON.parse(bodyText);
  return waitForMeetLink(event);
}

async function waitForMeetLink(event) {
  if (extractMeetLink(event) || !event.id) {
    return event;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(1000);

    const refreshedEvent = await getGoogleCalendarEvent(event.id);

    if (extractMeetLink(refreshedEvent)) {
      return refreshedEvent;
    }
  }

  return event;
}

async function getGoogleCalendarEvent(eventId) {
  const accessToken = await getGoogleAccessToken();
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleCalendarId)}/events/${encodeURIComponent(eventId)}`
  );

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Google Calendar get HTTP ${response.status}: ${bodyText}`);
  }

  return JSON.parse(bodyText);
}

function buildGoogleCalendarEventBody(eventDetails, transcript) {
  const event = {
    summary: eventDetails.summary || 'Meeting',
    description: buildEventDescription(eventDetails.description, transcript),
    start: {
      dateTime: eventDetails.start.dateTime,
      timeZone: googleCalendarTimeZone,
    },
    end: {
      dateTime: eventDetails.end.dateTime,
      timeZone: googleCalendarTimeZone,
    },
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: {
          type: 'hangoutsMeet',
        },
      },
    },
    reminders: {
      useDefault: true,
    },
  };

  if (eventDetails.attendees.length > 0) {
    event.attendees = eventDetails.attendees.map((email) => ({ email }));
  }

  return event;
}

function buildEventDescription(description, transcript) {
  return [
    description,
    'Created from a Telegram voice message.',
    '',
    'Transcript:',
    transcript,
  ]
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
    .join('\n');
}

function isTextMeetingRequest(text) {
  const value = normalizeText(text);
  if (!value) {
    return false;
  }

  const mentionsMeeting = /\b(?:google\s*meet|meet|meeting|uchrashuv|митинг|встреча)\b/i.test(value);
  const mentionsTime = /\b(?:bugun|ertaga|today|tomorrow|сегодня|завтра|soat|at|в|\d{1,2}[:.]\d{2})\b/i.test(value);
  return mentionsMeeting && mentionsTime;
}

function trackMeeting(event, eventDetails, meetLink, chatId, source) {
  const meetingCode = extractMeetingCode(meetLink);
  if (!event.id || !meetingCode) {
    console.warn('Meeting recording tracking skipped: Calendar event ID or Meet code is missing.');
    return;
  }

  const tracked = {
    eventId: event.id,
    chatId: String(chatId),
    summary: event.summary || eventDetails.summary || 'Meeting',
    startDateTime: event.start?.dateTime || eventDetails.start.dateTime,
    endDateTime: event.end?.dateTime || eventDetails.end.dateTime,
    meetLink,
    meetingCode,
    source,
    createdAt: new Date().toISOString(),
    conferenceRecords: [],
    sentRecordingNames: [],
    lastCheckedAt: null,
    lastError: null,
  };

  const index = meetingStore.meetings.findIndex((item) => item.eventId === tracked.eventId);
  if (index >= 0) {
    meetingStore.meetings[index] = { ...meetingStore.meetings[index], ...tracked };
  } else {
    meetingStore.meetings.push(tracked);
  }
  saveMeetingStore();
}

function extractMeetingCode(meetLink) {
  try {
    const url = new URL(meetLink);
    if (url.hostname !== 'meet.google.com') {
      return '';
    }
    return url.pathname.split('/').filter(Boolean)[0] || '';
  } catch (error) {
    return '';
  }
}

async function pollMeetingRecordings() {
  if (recordingPollRunning || meetingStore.meetings.length === 0) {
    return;
  }

  recordingPollRunning = true;
  try {
    for (const meeting of meetingStore.meetings) {
      if (!shouldPollMeeting(meeting)) {
        continue;
      }

      try {
        await pollOneMeetingRecordings(meeting);
        meeting.lastError = null;
      } catch (error) {
        meeting.lastError = `${new Date().toISOString()} ${error.message}`;
        console.error(`Recording poll failed for event ${meeting.eventId}:`, error.message);
      }
      meeting.lastCheckedAt = new Date().toISOString();
      saveMeetingStore();
    }
  } finally {
    recordingPollRunning = false;
  }
}

function shouldPollMeeting(meeting) {
  const endMs = Date.parse(meeting.endDateTime);
  if (!Number.isFinite(endMs) || Date.now() < endMs) {
    return false;
  }
  return Date.now() - endMs <= recordingTrackingDays * 24 * 60 * 60 * 1000;
}

async function pollOneMeetingRecordings(meeting) {
  const conferenceRecords = await listConferenceRecords(meeting);
  meeting.conferenceRecords = conferenceRecords.map((record) => record.name).filter(Boolean);

  for (const record of conferenceRecords.filter((item) => item.name)) {
    const recordings = await listConferenceRecordings(record.name);
    for (const recording of recordings) {
      if (
        recording.state !== 'FILE_GENERATED'
        || !recording.name
        || meeting.sentRecordingNames.includes(recording.name)
      ) {
        continue;
      }

      const exportUri = recording.driveDestination?.exportUri;
      if (!exportUri) {
        continue;
      }

      await bot.sendMessage(
        meeting.chatId,
        [
          `Meeting recording tayyor: ${meeting.summary}`,
          `Recording: ${exportUri}`,
          recording.startTime ? `Boshlangan: ${recording.startTime}` : '',
        ].filter(Boolean).join('\n'),
        { disable_web_page_preview: true }
      );
      meeting.sentRecordingNames.push(recording.name);
      saveMeetingStore();
    }
  }
}

async function listConferenceRecords(meeting) {
  const accessToken = await getGoogleAccessToken();
  const url = new URL('https://meet.googleapis.com/v2/conferenceRecords');
  url.searchParams.set('pageSize', '100');
  url.searchParams.set('filter', `space.meeting_code = "${meeting.meetingCode}"`);

  const data = await fetchGoogleJson(url, accessToken, 'Google Meet conferenceRecords.list');
  const records = Array.isArray(data.conferenceRecords) ? data.conferenceRecords : [];
  const scheduledStart = Date.parse(meeting.startDateTime);
  const scheduledEnd = Date.parse(meeting.endDateTime);

  return records.filter((record) => {
    const actualStart = Date.parse(record.startTime);
    if (![scheduledStart, scheduledEnd, actualStart].every(Number.isFinite)) {
      return true;
    }
    const margin = 12 * 60 * 60 * 1000;
    return actualStart >= scheduledStart - margin && actualStart <= scheduledEnd + margin;
  });
}

async function listConferenceRecordings(conferenceRecordName) {
  const accessToken = await getGoogleAccessToken();
  const url = new URL(`https://meet.googleapis.com/v2/${conferenceRecordName}/recordings`);
  url.searchParams.set('pageSize', '100');
  const data = await fetchGoogleJson(url, accessToken, 'Google Meet recordings.list');
  return Array.isArray(data.recordings) ? data.recordings : [];
}

async function fetchGoogleJson(url, accessToken, label) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`${label} HTTP ${response.status}: ${bodyText}`);
  }
  return bodyText ? JSON.parse(bodyText) : {};
}

function logRecordingPollError(error) {
  console.error('Meeting recording poll failed:', error);
}

async function getGoogleAccessToken() {
  if (googleTokenCache && Date.now() < googleTokenCache.expiresAt - 60000) {
    return googleTokenCache.accessToken;
  }

  if (hasGoogleOAuthConfig()) {
    return getGoogleOAuthAccessToken();
  }

  return getGoogleServiceAccountAccessToken();
}

async function getGoogleOAuthAccessToken() {
  const params = new URLSearchParams({
    client_id: googleClientId,
    client_secret: googleClientSecret,
    refresh_token: googleRefreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Google OAuth HTTP ${response.status}: ${bodyText}`);
  }

  const data = JSON.parse(bodyText);
  const expiresInMs = parsePositiveInt(data.expires_in, 3600) * 1000;

  googleTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  };

  return googleTokenCache.accessToken;
}

async function getGoogleServiceAccountAccessToken() {
  const credentials = readGoogleServiceAccountCredentials();
  const assertion = createGoogleServiceAccountJwt(credentials);
  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const response = await fetch(credentials.token_uri || GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Google service account OAuth HTTP ${response.status}: ${bodyText}`);
  }

  const data = JSON.parse(bodyText);
  const expiresInMs = parsePositiveInt(data.expires_in, 3600) * 1000;

  googleTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  };

  return googleTokenCache.accessToken;
}

function readGoogleServiceAccountCredentials() {
  const filePath = resolveCredentialsPath(googleCredentialsFile);
  const credentials = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) {
    throw new Error(`${googleCredentialsFile} must be a Google service account JSON key.`);
  }

  return credentials;
}

function createGoogleServiceAccountJwt(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: credentials.private_key_id,
  };
  const claimSet = {
    iss: credentials.client_email,
    scope: [
      GOOGLE_CALENDAR_EVENTS_SCOPE,
      GOOGLE_MEET_READONLY_SCOPE,
      GOOGLE_DRIVE_MEET_READONLY_SCOPE,
    ].join(' '),
    aud: credentials.token_uri || GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  if (googleImpersonateUserEmail) {
    claimSet.sub = googleImpersonateUserEmail;
  }

  const unsignedJwt = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claimSet))}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsignedJwt)
    .sign(credentials.private_key);

  return `${unsignedJwt}.${base64Url(signature)}`;
}

function base64Url(value) {
  return Buffer
    .from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
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

function parseMentorRequest(text) {
  const match = normalizeText(text).match(/^(?:alex-mentor|mentor)\s*:?\s*([\s\S]*)$/i);
  if (!match) {
    return null;
  }

  return {
    text: normalizeText(match[1]) || 'Create today sprint.',
  };
}

function isMentorExitText(text) {
  return /^(?:exit|stop|quit|cancel)\s+mentor$/i.test(normalizeText(text))
    || /^mentor\s+(?:off|exit|stop)$/i.test(normalizeText(text));
}

function buildMentorInstructions() {
  const files = [
    'SYSTEM_PROMPT.md',
    'MENTOR.md',
    'MEMORY.md',
    'ROADMAP.md',
    'DAILY.md',
    'REVIEW.md',
    'SPRINT_RULES.md',
    'STARTUP_CHECKLIST.md',
  ];

  const sections = files.map((fileName) => {
    const filePath = path.join(mentorProjectDir, fileName);
    let content = '';

    try {
      content = fs.readFileSync(filePath, 'utf8').trim();
    } catch (error) {
      content = `[missing: ${filePath}]`;
    }

    return `# ${fileName}\n${content}`;
  });

  return [
    'You are alex-mentor. Follow the loaded mentor files exactly.',
    'Do not ask for generic sprint fields if the mentor files already provide enough context.',
    'For daily sprint requests, create one focused sprint from MEMORY.md and ROADMAP.md, then wait for user confirmation before starting.',
    'If the user confirms with start, begin the already proposed sprint and give only task 1. Do not ask for a new sprint goal.',
    'Keep the answer concise. Uzbek is preferred unless the user asks otherwise.',
    '',
    sections.join('\n\n---\n\n'),
  ].join('\n');
}

async function withChatAction(chatId, action, task) {
  const actionInterval = setInterval(() => {
    bot.sendChatAction(chatId, action).catch((error) => {
      console.error('Telegram chat action failed:', error.message);
    });
  }, 5000);

  try {
    await bot.sendChatAction(chatId, action);
    return await task();
  } finally {
    clearInterval(actionInterval);
  }
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

function parseProductRequest(input) {
  const parts = input.split(',').map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 2 && /(?:[$€£]|usd|uzs|so'?m|sum|сум)/i.test(parts[parts.length - 1])) {
    return {
      title: parts.slice(0, -1).join(', '),
      price: parts[parts.length - 1],
    };
  }

  const priceMatch = input.match(/((?:[$€£]|usd|uzs|so'?m|sum|сум)\s*[\d\s.,]+|[\d\s.,]+\s*(?:[$€£]|usd|uzs|so'?m|sum|сум))/i);
  const price = normalizeText(priceMatch?.[1]);
  const title = price
    ? normalizeText(input.replace(price, '').replace(/[,\-\s]+$/, ''))
    : normalizeText(input);

  return { title, price };
}

function createInstagramDraft(msg, productInput, product) {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    chatId: msg.chat.id,
    ownerUserId: msg.from?.id,
    status: 'draft_requested',
    productInput,
    product,
    imageOptions: [],
    selectedImage: null,
    caption: '',
    altText: '',
    recommendedScheduleAt: null,
    pendingAction: null,
    pendingScheduleAt: null,
    scheduledAt: null,
    publishResult: null,
    error: '',
    createdAt: now,
    updatedAt: now,
  };
}

function resolveSelectedImage(draft, text) {
  const selectedNumber = parseImageSelection(text);

  if (selectedNumber) {
    const option = draft.imageOptions.find((item) => item.index === selectedNumber);
    return option ? { ...option, approvedAt: new Date().toISOString() } : null;
  }

  if (isPublicHttpUrl(text)) {
    return {
      index: null,
      url: text,
      sourceUrl: text,
      sourceName: hostnameFromUrl(text),
      title: 'Owner-provided image',
      mime: isLikelyJpegUrl(text) ? 'image/jpeg' : '',
      note: 'Owner-provided public URL',
      approvedAt: new Date().toISOString(),
    };
  }

  return null;
}

function parseImageSelection(text) {
  const match = text.match(/^(?:approve\s+|use\s+)?([1-5])$/i);
  return match ? Number(match[1]) : 0;
}

function buildInstagramCaptionPrompt(draft) {
  return [
    'Create a professional Instagram product post package for a computer/electronics shop.',
    '',
    'Return only valid JSON in this shape:',
    '{"caption":"...","alt_text":"..."}',
    '',
    'Rules:',
    '- Do not invent specs, warranty, discount, stock status, or condition.',
    '- Include only details from the owner input and configured store profile.',
    '- Keep the caption concise, sales-focused, and trustworthy.',
    '- Include price exactly as provided.',
    '- Use the configured store language.',
    '- Add 5 to 12 relevant, non-spam hashtags for the exact product and store market.',
    '- Prefer configured DEFAULT_HASHTAGS when provided, but create suitable hashtags when it is empty.',
    '',
    'Store profile:',
    JSON.stringify(storeProfile, null, 2),
    '',
    'Product:',
    JSON.stringify({
      title: draft.product.title,
      price: draft.product.price,
      rawInput: draft.productInput,
      selectedImage: draft.selectedImage?.sourceUrl || draft.selectedImage?.url || '',
    }, null, 2),
  ].join('\n');
}

function buildFallbackInstagramCaption(draft) {
  return [
    draft.product.title,
    '',
    `Price: ${draft.product.price}`,
    storeProfile.city ? `Location: ${storeProfile.city}` : '',
    storeProfile.contactText || storeProfile.contactUrl
      ? `Contact: ${[storeProfile.contactText, storeProfile.contactUrl].filter(Boolean).join(' ')}`
      : '',
    storeProfile.defaultHashtags,
  ]
    .filter(Boolean)
    .join('\n');
}

function loadMeetingStore() {
  const filePath = resolveProjectPath(meetingStoreFile);

  try {
    if (!fs.existsSync(filePath)) {
      return { meetings: [] };
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      meetings: Array.isArray(data.meetings) ? data.meetings : [],
    };
  } catch (error) {
    console.warn(`Could not read meeting store: ${error.message}`);
    return { meetings: [] };
  }
}

function saveMeetingStore() {
  const filePath = resolveProjectPath(meetingStoreFile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(meetingStore, null, 2)}\n`);
}

function loadInstagramInsightsStore() {
  const filePath = resolveProjectPath(instagramInsightsStoreFile);

  try {
    if (!fs.existsSync(filePath)) {
      return { latest: null, history: [] };
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      latest: data.latest && typeof data.latest === 'object' ? data.latest : null,
      history: Array.isArray(data.history) ? data.history : [],
    };
  } catch (error) {
    console.warn(`Could not read Instagram insights store: ${error.message}`);
    return { latest: null, history: [] };
  }
}

function saveInstagramInsightsStore() {
  const filePath = resolveProjectPath(instagramInsightsStoreFile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(instagramInsightsStore, null, 2)}\n`);
}

function loadInstagramStore() {
  const filePath = resolveProjectPath(instagramPostStoreFile);

  try {
    if (!fs.existsSync(filePath)) {
      return { drafts: [] };
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      drafts: Array.isArray(data.drafts) ? data.drafts : [],
    };
  } catch (error) {
    console.warn(`Could not read Instagram post store: ${error.message}`);
    return { drafts: [] };
  }
}

function saveInstagramStore() {
  const filePath = resolveProjectPath(instagramPostStoreFile);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(instagramStore, null, 2)}\n`);
}

function saveInstagramDraft(draft) {
  draft.updatedAt = new Date().toISOString();

  const index = instagramStore.drafts.findIndex((item) => item.id === draft.id);
  if (index >= 0) {
    instagramStore.drafts[index] = draft;
  } else {
    instagramStore.drafts.push(draft);
  }

  saveInstagramStore();
}

function restoreInstagramSessions(store) {
  const sessions = new Map();

  for (const draft of store.drafts || []) {
    if (isActiveInstagramStatus(draft.status)) {
      sessions.set(String(draft.chatId), draft.id);
    }
  }

  return sessions;
}

function hasActiveInstagramSession(chatId) {
  return Boolean(getActiveInstagramDraft(chatId));
}

function getActiveInstagramDraft(chatId) {
  const draftId = instagramSessions.get(String(chatId));
  if (!draftId) {
    return null;
  }

  const draft = instagramStore.drafts.find((item) => item.id === draftId);
  return draft && isActiveInstagramStatus(draft.status) ? draft : null;
}

function setInstagramSession(chatId, draftId) {
  instagramSessions.set(String(chatId), draftId);
}

function clearInstagramSession(chatId, draftId) {
  const key = String(chatId);
  if (!draftId || instagramSessions.get(key) === draftId) {
    instagramSessions.delete(key);
  }
}

function isActiveInstagramStatus(status) {
  return [
    'waiting_for_image_approval',
    'waiting_for_image_url',
    'waiting_for_price',
    'waiting_for_final_approval',
    'ready_to_publish',
  ].includes(status);
}

function chooseNextPostingTime(from) {
  const candidates = [];
  const earliest = new Date(from.getTime() + 5 * 60 * 1000);

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    for (const windowTime of postingConfig.fallbackWindows) {
      const candidate = new Date(from);
      candidate.setDate(from.getDate() + dayOffset);
      candidate.setHours(windowTime.hour, windowTime.minute, 0, 0);

      if (candidate <= earliest) {
        continue;
      }

      if (!isAllowedPostingDate(candidate) || !isWithinAllowedPostingHours(candidate)) {
        continue;
      }

      if (countScheduledPostsForDay(candidate) >= postingConfig.maxPerDay) {
        continue;
      }

      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0] || new Date(from.getTime() + 60 * 60 * 1000);
}

function parseScheduleCommand(text) {
  const match = text.match(/^schedule\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const value = normalizeText(match[1]).toLowerCase();
  const timeMatch = value.match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) {
    return null;
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }

  const date = new Date();
  const explicitDate = value.match(/(\d{4})-(\d{2})-(\d{2})/);

  if (explicitDate) {
    date.setFullYear(Number(explicitDate[1]), Number(explicitDate[2]) - 1, Number(explicitDate[3]));
  } else if (value.includes('tomorrow')) {
    date.setDate(date.getDate() + 1);
  } else if (!value.includes('today')) {
    return null;
  }

  date.setHours(hour, minute, 0, 0);
  return date;
}

function isAllowedPostingDate(date) {
  return postingConfig.allowedDays.has(date.getDay());
}

function isWithinAllowedPostingHours(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= postingConfig.allowedHours.startMinutes && minutes <= postingConfig.allowedHours.endMinutes;
}

function countScheduledPostsForDay(date) {
  return instagramStore.drafts.filter((draft) => {
    if (draft.status !== 'scheduled' || !draft.scheduledAt) {
      return false;
    }

    const scheduled = new Date(draft.scheduledAt);
    return scheduled.getFullYear() === date.getFullYear()
      && scheduled.getMonth() === date.getMonth()
      && scheduled.getDate() === date.getDate();
  }).length;
}

function formatPublishedInstagramReply(draft) {
  const lines = [
    'Instagram post published.',
    `Product: ${draft.product.title}`,
  ];

  if (draft.publishResult?.permalink) {
    lines.push(`Post: ${draft.publishResult.permalink}`);
  }

  if (draft.publishResult?.mediaId) {
    lines.push(`Media ID: ${draft.publishResult.mediaId}`);
  }

  return lines.join('\n');
}

function formatScheduledAt(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  return `${formatZonedDateTimeForPrompt(date, postingConfig.timeZone)} (${postingConfig.timeZone})`;
}

function formatAllowedHours(allowedHours) {
  return `${formatMinutesAsTime(allowedHours.startMinutes)}-${formatMinutesAsTime(allowedHours.endMinutes)}`;
}

function formatMinutesAsTime(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function getMissingInstagramPublishConfig() {
  return [
    ['INSTAGRAM_PROFESSIONAL_ACCOUNT_ID', instagramProfessionalAccountId],
    ['INSTAGRAM_ACCESS_TOKEN', instagramAccessToken],
  ]
    .filter(([, value]) => !isConfiguredValue(value))
    .map(([name]) => name);
}

function isCancelText(text) {
  return /^(cancel|stop|bekor qil)$/i.test(text);
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function isLikelyImageUrl(value) {
  try {
    return /^https?:\/\//i.test(value) && /\.(jpe?g|png|webp)$/i.test(new URL(value).pathname);
  } catch (error) {
    return false;
  }
}

function isLikelyJpegUrl(value) {
  try {
    return /\.(jpe?g)$/i.test(new URL(value).pathname);
  } catch (error) {
    return false;
  }
}

function isJpegContentType(value) {
  return /^image\/jpe?g\b/i.test(value);
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch (error) {
    return '';
  }
}

function redactAccessToken(value) {
  if (!value) {
    return '';
  }

  let redacted = String(value).replace(/access_token=([^&\s"]+)/gi, 'access_token=[redacted]');

  if (instagramAccessToken) {
    redacted = redacted.split(instagramAccessToken).join('[redacted]');
  }

  return redacted;
}

function truncateTelegramCaption(value) {
  return truncateText(value, 1000);
}

function truncateInstagramCaption(value) {
  return truncateText(normalizeText(value), 2200) || 'Product post';
}

function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
}

function getMissingCalendarFields(eventDetails) {
  const missing = new Set(eventDetails.missing);

  if (!eventDetails.start.dateTime) {
    missing.add('start.dateTime');
  }

  if (!eventDetails.end.dateTime) {
    missing.add('end.dateTime');
  }

  return Array.from(missing);
}

function normalizeCalendarDetails(value) {
  const startDateTime = normalizeDateTime(value.start?.dateTime || value.start);
  let endDateTime = normalizeDateTime(value.end?.dateTime || value.end);

  if (startDateTime && !endDateTime) {
    endDateTime = addMinutesToDateTime(startDateTime, defaultEventDurationMinutes);
  }

  return {
    summary: normalizeText(value.summary) || 'Meeting',
    start: {
      dateTime: startDateTime,
    },
    end: {
      dateTime: endDateTime,
    },
    attendees: normalizeAttendees(value.attendees),
    description: normalizeText(value.description),
    missing: Array.isArray(value.missing)
      ? value.missing.map((item) => normalizeText(item)).filter(Boolean)
      : [],
  };
}

function normalizeDateTime(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  const withoutZone = trimmed.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/);

  if (withoutZone) {
    return `${withoutZone[1]}:${withoutZone[2] || '00'}`;
  }

  const withZone = trimmed.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/);

  if (withZone) {
    return `${withZone[1]}:${withZone[2] || '00'}${withZone[3]}`;
  }

  return '';
}

function addMinutesToDateTime(dateTime, minutes) {
  const local = dateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);

  if (local) {
    const date = new Date(
      Number(local[1]),
      Number(local[2]) - 1,
      Number(local[3]),
      Number(local[4]),
      Number(local[5]) + minutes,
      Number(local[6])
    );

    return formatLocalDateTime(date);
  }

  const parsed = new Date(dateTime);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  parsed.setMinutes(parsed.getMinutes() + minutes);
  return parsed.toISOString();
}

function normalizeAttendees(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((attendee) => (typeof attendee === 'string' ? attendee : attendee?.email))
        .map((email) => normalizeText(email).toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
  );
}

function parseJsonObject(text) {
  if (!text) {
    return null;
  }

  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  const candidates = [
    trimmed,
    fenced ? fenced[1].trim() : '',
    firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      // Try the next candidate.
    }
  }

  return null;
}

function extractMeetLink(event) {
  if (event.hangoutLink) {
    return event.hangoutLink;
  }

  const entryPoints = event.conferenceData?.entryPoints;
  if (!Array.isArray(entryPoints)) {
    return '';
  }

  const videoEntry = entryPoints.find((entryPoint) => entryPoint.entryPointType === 'video' && entryPoint.uri);
  return videoEntry?.uri || '';
}

function formatCreatedMeetingReply(event, eventDetails, meetLink) {
  const lines = [
    'Uchrashuv yaratildi.',
    `Nomi: ${event.summary || eventDetails.summary}`,
    `Vaqti: ${formatCalendarDateTime(event.start) || eventDetails.start.dateTime}`,
  ];

  if (meetLink) {
    lines.push(`Google Meet: ${meetLink}`);
  } else {
    lines.push('Google Meet havolasi Google Calendar javobida topilmadi.');
  }

  if (event.htmlLink) {
    lines.push(`Calendar: ${event.htmlLink}`);
  }

  return lines.join('\n');
}

function formatCalendarDateTime(start) {
  const dateTime = start?.dateTime;

  if (!dateTime) {
    return '';
  }

  const parsed = new Date(dateTime);

  if (Number.isNaN(parsed.getTime())) {
    return `${dateTime} (${start.timeZone || googleCalendarTimeZone})`;
  }

  return `${formatZonedDateTimeForPrompt(parsed, start.timeZone || googleCalendarTimeZone)} (${start.timeZone || googleCalendarTimeZone})`;
}

function formatZonedDateTimeForPrompt(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.weekday}, ${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function formatLocalDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function normalizeAudioFileName(fileLink) {
  const pathname = new URL(fileLink).pathname;
  const rawFileName = pathname.split('/').filter(Boolean).pop() || 'telegram-audio.ogg';
  const fileName = rawFileName.replace(/[^\w.-]/g, '_');

  if (/\.oga$/i.test(fileName)) {
    return fileName.replace(/\.oga$/i, '.ogg');
  }

  if (/\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm)$/i.test(fileName)) {
    return fileName;
  }

  return `${fileName}.ogg`;
}

function guessAudioMimeType(fileName) {
  if (/\.mp3$/i.test(fileName)) {
    return 'audio/mpeg';
  }

  if (/\.m4a$/i.test(fileName)) {
    return 'audio/mp4';
  }

  if (/\.wav$/i.test(fileName)) {
    return 'audio/wav';
  }

  if (/\.webm$/i.test(fileName)) {
    return 'audio/webm';
  }

  return 'audio/ogg';
}

function getMissingAudioMeetingConfig() {
  const missing = [
    ['OPENAI_API_KEY', openaiApiKey],
  ]
    .filter(([, value]) => !isConfiguredValue(value))
    .map(([name]) => name);

  if (!hasGoogleOAuthConfig() && !hasGoogleServiceAccountConfig()) {
    missing.push('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN or GOOGLE_CREDENTIALS_FILE');
  }

  return missing;
}

function assertAudioMeetingConfig() {
  const missing = getMissingAudioMeetingConfig();

  if (missing.length > 0) {
    throw new UserVisibleError(`Audio meeting tool hali sozlanmagan. Missing env vars: ${missing.join(', ')}`);
  }
}

function assertGoogleMeetingConfig() {
  if (!hasGoogleOAuthConfig() && !hasGoogleServiceAccountConfig()) {
    throw new UserVisibleError(
      'Google Meet tool hali sozlanmagan. Missing env vars: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN or GOOGLE_CREDENTIALS_FILE'
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeSendUpdates(value) {
  const normalized = value || 'all';
  return ['all', 'externalOnly', 'none'].includes(normalized) ? normalized : 'all';
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasGoogleOAuthConfig() {
  return [googleClientId, googleClientSecret, googleRefreshToken].every(isConfiguredValue);
}

function hasGoogleServiceAccountConfig() {
  if (!googleCredentialsFile) {
    return false;
  }

  try {
    return fs.statSync(resolveCredentialsPath(googleCredentialsFile)).isFile();
  } catch (error) {
    return false;
  }
}

function resolveCredentialsPath(filePath) {
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
}

function resolveProjectPath(filePath) {
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
}

function normalizeMetaApiVersion(value) {
  const normalized = normalizeText(value) || DEFAULT_META_API_VERSION;
  return normalized.startsWith('v') ? normalized : `v${normalized}`;
}

function parseAllowedDays(value) {
  const aliases = new Map([
    ['sun', 0],
    ['sunday', 0],
    ['0', 0],
    ['mon', 1],
    ['monday', 1],
    ['1', 1],
    ['tue', 2],
    ['tuesday', 2],
    ['2', 2],
    ['wed', 3],
    ['wednesday', 3],
    ['3', 3],
    ['thu', 4],
    ['thursday', 4],
    ['4', 4],
    ['fri', 5],
    ['friday', 5],
    ['5', 5],
    ['sat', 6],
    ['saturday', 6],
    ['6', 6],
  ]);
  const days = new Set();

  for (const part of String(value || '').split(',')) {
    const day = aliases.get(part.trim().toLowerCase());
    if (day !== undefined) {
      days.add(day);
    }
  }

  return days.size > 0 ? days : new Set([0, 1, 2, 3, 4, 5, 6]);
}

function parseAllowedHours(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);

  if (!match) {
    return { startMinutes: 10 * 60, endMinutes: 22 * 60 };
  }

  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);

  if (
    startHour > 23
    || endHour > 23
    || startMinute > 59
    || endMinute > 59
  ) {
    return { startMinutes: 10 * 60, endMinutes: 22 * 60 };
  }

  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  return startMinutes <= endMinutes
    ? { startMinutes, endMinutes }
    : { startMinutes: 10 * 60, endMinutes: 22 * 60 };
}

function parsePostingFallbackWindows(value) {
  const windows = [];

  for (const part of String(value || '').split(',')) {
    const match = part.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      continue;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour <= 23 && minute <= 59) {
      windows.push({ hour, minute });
    }
  }

  return windows.length > 0
    ? windows
    : [{ hour: 11, minute: 0 }, { hour: 15, minute: 0 }, { hour: 19, minute: 0 }];
}

function isConfiguredValue(value) {
  return Boolean(value && !String(value).startsWith('replace_with_'));
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class UserVisibleError extends Error {}
