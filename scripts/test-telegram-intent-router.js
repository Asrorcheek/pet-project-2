'use strict';

const assert = require('assert');
const {
  isInstagramDraftReply,
  parseNaturalTelegramIntent,
} = require('../telegram-intent-router');

const cases = [
  [
    'Oxirgi Google Meet record kerak menga',
    { type: 'meeting_latest_recording' },
  ],
  [
    'Meet recordingni yubor',
    { type: 'meeting_latest_recording' },
  ],
  [
    'MacBook Air M2 8/256, $720 uchun Instagram post tayyorla',
    { type: 'instagram_post', productInput: 'MacBook Air M2 8/256, $720' },
  ],
  [
    'Instagramga ASUS TUF F17 FX707 uchun post yaratib ber',
    { type: 'instagram_post', productInput: 'ASUS TUF F17 FX707' },
  ],
  [
    'Create an Instagram post for iPhone 16 Pro 256GB, $999',
    { type: 'instagram_post', productInput: 'iPhone 16 Pro 256GB, $999' },
  ],
  [
    'Создай пост для Instagram MacBook Air M2 8/256, $720',
    { type: 'instagram_post', productInput: 'MacBook Air M2 8/256, $720' },
  ],
  [
    "Oxirgi 7 kunlik Instagram analitikasini ko'rsat",
    { type: 'instagram_analytics', days: 7 },
  ],
  [
    'Instagram analytics reportni ber',
    { type: 'instagram_analytics', days: 30 },
  ],
  [
    'Haftalik kontent reja tuz',
    { type: 'content_plan' },
  ],
  [
    "Content agent holatini ko'rsat",
    { type: 'content_status' },
  ],
  [
    'Haftalik kontent hisobotini ber',
    { type: 'content_report' },
  ],
  [
    "Instagram postlar holatini ko'rsat",
    { type: 'instagram_posts_status' },
  ],
  [
    'Oxirgi post qaysi edi?',
    { type: 'instagram_latest_post' },
  ],
];

for (const [input, expected] of cases) {
  assert.deepStrictEqual(parseNaturalTelegramIntent(input), expected, input);
}

const passthroughCases = [
  '/post MacBook Air M2 8/256, $720',
  'Instagram post qanday tayyorlanadi?',
  'Node.js kodidagi post funksiyasini tuzat',
  'MacBook Air M2 haqida ma`lumot ber',
  'Loyihada qayerda qolgan edik?',
];

for (const input of passthroughCases) {
  assert.strictEqual(parseNaturalTelegramIntent(input), null, input);
}

assert.strictEqual(isInstagramDraftReply({
  status: 'waiting_for_image_approval',
  text: 'Oxirgi post qaysi edi?',
}), false);
assert.strictEqual(isInstagramDraftReply({
  status: 'waiting_for_image_approval',
  text: '2',
}), true);
assert.strictEqual(isInstagramDraftReply({
  status: 'waiting_for_image_url',
  text: 'https://example.com/product.jpg',
}), true);
assert.strictEqual(isInstagramDraftReply({
  status: 'waiting_for_price',
  text: '$720',
}), true);
assert.strictEqual(isInstagramDraftReply({
  status: 'waiting_for_final_approval',
  text: 'post now',
}), true);
assert.strictEqual(isInstagramDraftReply({
  status: 'waiting_for_final_approval',
  text: "Oxirgi 7 kunlik analitikani ko'rsat",
}), false);

console.log('telegram intent router tests passed');
