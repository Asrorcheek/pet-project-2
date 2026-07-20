'use strict';

const PRODUCT_HINTS = [
  'macbook',
  'iphone',
  'ipad',
  'laptop',
  'noutbuk',
  'notebook',
  'computer',
  'kompyuter',
  'monitor',
  'keyboard',
  'klaviatura',
  'mouse',
  'sichqoncha',
  'headphone',
  'quloqchin',
  'printer',
  'router',
  'smartphone',
  'telefon',
  'camera',
  'kamera',
  'microphone',
  'mikrofon',
  'ssd',
  'gpu',
  'videokarta',
  'ноутбук',
  'компьютер',
  'монитор',
  'клавиатура',
  'телефон',
];

function parseNaturalTelegramIntent(text) {
  const value = normalizeText(text);
  if (!value || value.startsWith('/')) {
    return null;
  }

  const comparable = normalizeComparable(value);

  if (isLatestMeetingRecordingRequest(comparable)) {
    return { type: 'meeting_latest_recording' };
  }

  const productInput = extractInstagramProductInput(value);
  if (productInput !== null) {
    return {
      type: 'instagram_post',
      productInput,
    };
  }

  if (isInstagramAnalyticsRequest(comparable)) {
    return {
      type: 'instagram_analytics',
      days: extractAnalyticsDays(comparable),
    };
  }

  if (isContentPlanRequest(comparable)) {
    return { type: 'content_plan' };
  }

  if (isContentStatusRequest(comparable)) {
    return { type: 'content_status' };
  }

  if (isContentReportRequest(comparable)) {
    return { type: 'content_report' };
  }

  if (isLatestInstagramPostRequest(comparable)) {
    return { type: 'instagram_latest_post' };
  }

  if (isInstagramPostsStatusRequest(comparable)) {
    return { type: 'instagram_posts_status' };
  }

  return null;
}

function isLatestMeetingRecordingRequest(text) {
  const mentionsMeeting = /(?:^|\s)(?:google\s*meet|meet(?:ni)?|meeting|uchrashuv|митинг|встреча)(?:\s|$)/i.test(text);
  const mentionsRecording = /(?:^|\s)(?:record(?:ing)?(?:ni|ini)?|yozuv(?:i|ini)?|video(?:si|sini)?|запись|видео)(?:\s|$)/i.test(text);
  const requestsResult = /(?:^|\s)(?:kerak|ber|yubor|top|ko(?:'|`)rsat|need|send|show|find|give|нужен|нужна|дай|покажи|найди)(?:\s|$)/i.test(text)
    || /\?$/.test(text);
  return mentionsMeeting && mentionsRecording && requestsResult;
}

function isInstagramDraftReply({ text, status, hasPhoto = false }) {
  if (hasPhoto) {
    return true;
  }

  const value = normalizeText(text);
  if (!value) {
    return false;
  }

  if (/^(?:cancel|stop|bekor qil)$/i.test(value)) {
    return true;
  }

  if (status === 'waiting_for_image_approval' || status === 'waiting_for_image_url') {
    return /^(?:reject|search again|again)$/i.test(value)
      || /^(?:approve\s+|use\s+)?[1-5]$/i.test(value)
      || isPublicHttpUrl(value);
  }

  if (status === 'waiting_for_price') {
    return value.length <= 100 && /\d/.test(value);
  }

  if (status === 'waiting_for_final_approval' || status === 'ready_to_publish') {
    return /^(?:approve|post now)$/i.test(value)
      || /^change caption\s+[\s\S]+$/i.test(value)
      || /^schedule\s+[\s\S]+$/i.test(value);
  }

  return false;
}

function extractInstagramProductInput(text) {
  const value = normalizeText(text);
  const comparable = normalizeComparable(value);
  if (!value || isHowToQuestion(comparable)) {
    return null;
  }

  const mentionsInstagram = /\b(?:instagram|insta|инстаграм)\b/i.test(comparable);
  const hasPostAction = (
    /\bpost(?:ni|ini)?\b[\s\S]{0,30}\b(?:tayyorla|yarat|tuz|qil)(?:ib\s+ber)?\b/i.test(comparable)
    || /\b(?:tayyorla|yarat|tuz|qil)(?:ib\s+ber)?\b[\s\S]{0,30}\bpost(?:ni|ini)?\b/i.test(comparable)
    || /\b(?:create|make|prepare|draft)\b[\s\S]{0,35}\bpost\b/i.test(comparable)
    || /(?:создай|сделай|подготовь)[\s\S]{0,35}пост/i.test(comparable)
    || /пост[\s\S]{0,35}(?:создай|сделай|подготовь)/i.test(comparable)
  );

  if (!hasPostAction) {
    return null;
  }

  const patterns = [
    /^(?:iltimos\s*,?\s*)?(?:menga\s+)?(.+?)\s+(?:uchun\s+)?(?:instagram(?:ga|da|\s+uchun)?\s+)?(?:mahsulot\s+)?post(?:ni|ini)?\s+(?:tayyorla|yarat|tuz|qil)(?:ib\s+ber)?[.!]?$/i,
    /^(?:iltimos\s*,?\s*)?(?:menga\s+)?(?:instagram(?:ga|da|\s+uchun)?\s+)(.+?)\s+(?:uchun\s+)?(?:mahsulot\s+)?post(?:ni|ini)?\s+(?:tayyorla|yarat|tuz|qil)(?:ib\s+ber)?[.!]?$/i,
    /^(?:please\s+)?(?:create|make|prepare|draft)\s+(?:an?\s+)?(?:instagram\s+)?(?:product\s+)?post\s+(?:for|about)\s+(.+?)[.!]?$/i,
    /^(?:please\s+)?(.+?)\s+(?:for\s+)?(?:an?\s+)?instagram\s+(?:product\s+)?post\s+(?:create|make|prepare|draft)[.!]?$/i,
    /^(?:пожалуйста\s*,?\s*)?(?:создай|сделай|подготовь)\s+(?:пост\s+)?(?:для\s+)?(?:(?:instagram|инстаграм(?:а)?)\s+)?(.+?)[.!]?$/i,
    /^(?:пожалуйста\s*,?\s*)?(.+?)\s+(?:для\s+)?инстаграм(?:а)?\s+пост\s+(?:создай|сделай|подготовь)[.!]?$/i,
  ];

  let productInput = '';
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      productInput = normalizeText(match[1]);
      break;
    }
  }

  if (!productInput && mentionsInstagram) {
    return '';
  }

  if (!productInput || !looksLikeProductRequest(productInput)) {
    return null;
  }

  return productInput.replace(/^(?:instagram(?:ga|da|\s+uchun)?|insta(?:gram)?\s+uchun)\s+/i, '').trim();
}

function isInstagramAnalyticsRequest(text) {
  if (isHowToQuestion(text)) {
    return false;
  }

  const mentionsAnalytics = /\b(?:analytics?|analitika(?:si(?:ni)?|ni)?|statistika(?:si(?:ni)?|ni)?|insights?|аналитика|статистика)\b/i.test(text);
  const requestsResult = /\b(?:ko(?:'|`)rsat|chiqar|ber|hisobot|show|send|report|display|покажи|дай|отчет)\b/i.test(text);
  return mentionsAnalytics && requestsResult;
}

function extractAnalyticsDays(text) {
  const match = text.match(/\b(7|30)\s*(?:kun|days?|дн(?:я|ей|ь))?\b/i);
  return Number(match?.[1] || 30);
}

function isContentPlanRequest(text) {
  if (isHowToQuestion(text)) {
    return false;
  }

  const mentionsContent = /\b(?:content|kontent|контент)\b/i.test(text);
  const mentionsPlan = /\b(?:plan|reja(?:ni)?|план)\b/i.test(text);
  const requestsAction = /\b(?:tuz|yarat|tayyorla|ko(?:'|`)rsat|ber|create|make|prepare|show|создай|составь|покажи)\b/i.test(text);
  return mentionsContent && mentionsPlan && requestsAction;
}

function isContentStatusRequest(text) {
  const mentionsContent = /\b(?:content|kontent|контент)\b/i.test(text);
  const mentionsStatus = /\b(?:status|holat(?:i(?:ni)?|ni)?|статус|состояние)\b/i.test(text);
  const requestsResult = /\b(?:ko(?:'|`)rsat|ayt|ber|show|tell|покажи|скажи)\b/i.test(text);
  return mentionsContent && mentionsStatus && requestsResult;
}

function isContentReportRequest(text) {
  const mentionsContent = /\b(?:content|kontent|strategiya|контент|стратегия)\b/i.test(text);
  const mentionsReport = /\b(?:report|hisobot(?:i(?:ni)?|ni)?|отчет)\b/i.test(text);
  const requestsResult = /\b(?:ko(?:'|`)rsat|chiqar|ber|show|send|покажи|дай)\b/i.test(text);
  return mentionsContent && mentionsReport && requestsResult;
}

function isInstagramPostsStatusRequest(text) {
  const mentionsPosts = /\b(?:instagram|insta|инстаграм)\b/i.test(text)
    && /\b(?:postlar|posts?|посты)\b/i.test(text);
  const requestsStatus = /\b(?:status|holat|ko(?:'|`)rsat|show|статус|покажи)\b/i.test(text);
  return mentionsPosts && requestsStatus;
}

function isLatestInstagramPostRequest(text) {
  const mentionsLatest = /(?:^|\s)(?:oxirgi|so(?:'|`)nggi|latest|last)(?:\s|$)/i.test(text)
    || /(?:^|\s)последн(?:ий|яя|ее)(?:\s|$)/i.test(text);
  const mentionsPost = /(?:^|\s)(?:post(?:im|imiz|ni|lar)?|пост)(?:\s|$)/i.test(text);
  const requestsAnswer = /(?:^|\s)(?:qaysi|nima|ayt|ko(?:'|`)rsat|which|what|show|tell|какой|покажи|скажи)(?:\s|$)/i.test(text)
    || /\?$/.test(text);
  return mentionsLatest && mentionsPost && requestsAnswer;
}

function looksLikeProductRequest(text) {
  const comparable = normalizeComparable(text);
  if (/\d|[$€£]|\b(?:usd|uzs|so(?:'|`)m|sum|сум)\b/i.test(comparable)) {
    return true;
  }

  return PRODUCT_HINTS.some((hint) => comparable.includes(hint));
}

function isHowToQuestion(text) {
  return /\b(?:qanday|nima|nega|how|what|why|как|что|почему)\b/i.test(text)
    || /\?$/.test(text);
}

function normalizeComparable(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[‘’ʻʼ]/g, "'")
    .replace(/\s+/g, ' ');
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

module.exports = {
  extractInstagramProductInput,
  isInstagramDraftReply,
  parseNaturalTelegramIntent,
};
