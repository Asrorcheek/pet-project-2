require('dotenv').config();

const DEFAULT_HERMES_API_BASE = 'http://127.0.0.1:8642/v1';
const TIMEOUT_MS = 180000;

const hermesApiBase = (process.env.HERMES_API_BASE || DEFAULT_HERMES_API_BASE).replace(/\/+$/, '');
const hermesApiKey = process.env.HERMES_API_KEY;
const hermesModel = process.env.HERMES_MODEL || 'hermes-agent';

if (!hermesApiKey) {
  console.error('HERMES_API_KEY is not set.');
  process.exit(1);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    clearTimeout(timeout);
  });

async function main() {
  const response = await fetch(`${hermesApiBase}/responses`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${hermesApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: hermesModel,
      input: 'Reply with OK only.',
      instructions: 'Return only the word OK.',
      conversation: 'smoke-test',
      store: false,
    }),
  });

  const bodyText = await response.text();
  console.log(`Hermes HTTP ${response.status}`);

  if (!response.ok) {
    console.log(bodyText.slice(0, 1000));
    process.exit(1);
  }

  const data = JSON.parse(bodyText);
  const answer = extractHermesText(data);

  console.log((answer || bodyText).slice(0, 500));
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
