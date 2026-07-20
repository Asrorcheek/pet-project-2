# Telegram Hermes Bot

Node.js Telegram bot that forwards text messages to a local Hermes Agent API server and sends the answer back to Telegram.
Voice/audio messages and `/meet` text commands can create Google Calendar events with Google Meet links and return the meeting link in chat. After a meeting ends, the bot polls Google Meet for generated recordings and sends every new recording link to the originating Telegram chat once.

## Required Runtime

- Ubuntu VM with SSH access
- Node.js 18 or newer
- Git
- Hermes Agent installed and configured
- Telegram bot token from BotFather
- OpenAI API key for audio transcription
- Google OAuth client or service account with Calendar API access
- Hermes web/browser tools for product image discovery
- Meta/Instagram professional account token for live Instagram publishing

## Environment

Create `.env` from the example:

```bash
cp .env.example .env
nano .env
```

Required values:

```env
TELEGRAM_BOT_TOKEN=replace_with_botfather_token
ALLOWED_TELEGRAM_USER_IDS=123456789
TELEGRAM_API_BASE=https://api.telegram.org

HERMES_API_BASE=http://127.0.0.1:8642/v1
HERMES_API_KEY=replace_with_same_value_as_api_server_key
HERMES_MODEL=hermes-agent
HERMES_INSTRUCTIONS=Answer clearly and concisely.
HERMES_TIMEOUT_MS=180000
HERMES_TEXT_CONVERSATION_VERSION=v2
CONTENT_PLAN_TIMEOUT_MS=420000
CONTENT_PLAN_CATALOG_LIMIT=30

OPENAI_API_KEY=replace_with_openai_api_key
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe

# Option A: Google service account JSON key.
GOOGLE_CREDENTIALS_FILE=credentials.json
GOOGLE_IMPERSONATE_USER_EMAIL=

# Option B: Google OAuth user refresh token.
GOOGLE_CLIENT_ID=replace_with_google_oauth_client_id
GOOGLE_CLIENT_SECRET=replace_with_google_oauth_client_secret
GOOGLE_REFRESH_TOKEN=replace_with_google_oauth_refresh_token

GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_TIME_ZONE=Asia/Tashkent
GOOGLE_CALENDAR_SEND_UPDATES=all
DEFAULT_EVENT_DURATION_MINUTES=30

STORE_NAME=replace_with_store_name
STORE_INSTAGRAM_USERNAME=replace_with_instagram_username
STORE_LANGUAGE=uz
STORE_CURRENCY=USD
STORE_CITY=Tashkent
STORE_CONTACT_TEXT=DM or Telegram
STORE_CONTACT_URL=
DEFAULT_HASHTAGS="#computer #laptop #tashkent"

META_API_VERSION=v25.0
INSTAGRAM_GRAPH_BASE=https://graph.instagram.com
INSTAGRAM_PROFESSIONAL_ACCOUNT_ID=replace_with_instagram_professional_account_id
INSTAGRAM_ACCESS_TOKEN=replace_with_meta_access_token

POSTING_TIMEZONE=Asia/Tashkent
POSTING_ALLOWED_DAYS=mon,tue,wed,thu,fri,sat,sun
POSTING_ALLOWED_HOURS=10:00-22:00
POSTING_MAX_PER_DAY=3
POSTING_FALLBACK_WINDOWS=11:00,15:00,19:00
INSTAGRAM_POST_STORE_FILE=data/instagram-posts.json
```

Use `/id` in the bot to see your numeric Telegram user ID, then put it into `ALLOWED_TELEGRAM_USER_IDS`.
On the server, `deploy/configure-env.sh` can generate and sync `HERMES_API_KEY` with Hermes `API_SERVER_KEY`.

## Voice Meeting Creation

When the bot receives a Telegram voice/audio message, it:

1. Downloads the Telegram audio file.
2. Sends it to OpenAI speech-to-text.
3. Asks Hermes to extract `summary`, `start`, `end`, `attendees`, and `description`.
4. Creates a Google Calendar event with a fresh Google Meet conference.
5. Sends the Google Meet link back to Telegram.

The voice message should include at least a date and start time. If no duration or end time is spoken, `DEFAULT_EVENT_DURATION_MINUTES` is used. Attendees are added only when the transcript contains explicit email addresses.

Google OAuth must be authorized for one of these Calendar scopes:

```text
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/calendar.events
```

Text requests are also supported:

```text
/meet Acme kompaniyasi, ertaga soat 15:00
```

When no end time is supplied, the meeting lasts 30 minutes by default.

## Meeting recordings

The bot stores created event IDs, Meet codes, Telegram chat IDs, and delivered recording IDs in `data/meetings.json`. After the scheduled end time it polls Google Meet, then sends each recording whose state is `FILE_GENERATED`. Delivered recording resource names are persisted so restarts do not cause duplicate messages.

The Google OAuth grant must include these additional scopes:

```text
https://www.googleapis.com/auth/meetings.space.readonly
https://www.googleapis.com/auth/drive.meet.readonly
```

`RECORDING_POLL_INTERVAL_SECONDS` controls polling frequency (default 300 seconds), and `RECORDING_TRACKING_DAYS` controls how long ended meetings remain eligible (default 30 days). Recordings larger than `TELEGRAM_RECORDING_PART_BYTES` (default 45,000,000 bytes) are split without re-encoding into sequential playable MP4 files before upload; this requires `ffmpeg` and `ffprobe`. Google Meet recording availability depends on the organizer's Google Workspace edition and recording must actually be started during the meeting.

For a single recording file up to 2000 MB, run the official Telegram Bot API server in local mode and set `TELEGRAM_API_BASE=http://127.0.0.1:8081`. Store `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` in `~/.config/telegram-bot-api.env`, and set `TELEGRAM_RECORDING_PART_BYTES=1900000000` in the bot `.env`. Before moving an existing bot from the cloud API, call `logOut` once against `https://api.telegram.org`.

For personal calendars, use an OAuth refresh token for the Google account that owns the calendar. `GOOGLE_CALENDAR_ID=primary` targets that account's main calendar.

If you use `GOOGLE_CREDENTIALS_FILE=credentials.json`, the file must be a Google service account JSON key. Share the target calendar with the service account `client_email` and grant permission to make changes to events, then set `GOOGLE_CALENDAR_ID` to that shared calendar ID, usually the calendar owner's email address for a primary calendar. `primary` refers to the service account's own calendar and is usually not what you want. For Google Workspace domain-wide delegation, set `GOOGLE_IMPERSONATE_USER_EMAIL` to the calendar owner email.

## Instagram Product Posts

Start a Telegram draft with:

```text
/post MacBook Air M2 8/256, $720
```

The bot will:

1. Ask Hermes to search the web for exact-model product image candidates.
2. Send numbered image options to Telegram.
3. Wait for you to approve an image, reject/search again, or provide a public JPEG image URL.
4. Generate a caption through Hermes using the configured store profile.
5. Wait for final approval: `approve`, `post now`, `schedule tomorrow 19:00`, `change caption ...`, or `cancel`.
6. Publish through the official Meta Graph API only when `INSTAGRAM_PROFESSIONAL_ACCOUNT_ID` and `INSTAGRAM_ACCESS_TOKEN` are configured.

Approved scheduled posts are stored in `data/instagram-posts.json` so they survive bot restarts. Instagram publishing requires a professional Instagram account and a public JPEG image URL. If Hermes returns no safe image candidates or Meta credentials are missing, the bot still creates a draft and explains what is needed.

## Instagram Analytics

Use `/analytics` for the last 30 days or `/analytics 7` for the last 7 days. The bot refreshes account and media insights before replying, including views, reach, likes, comments, saves, shares, total interactions, and engagement per reached account.

Snapshots are stored in `data/instagram-insights.json` and refreshed in the background every `INSTAGRAM_INSIGHTS_REFRESH_MINUTES` (default: 360). When the requested period has no posts, the report clearly falls back to all available media. Accounts with fewer than 100 followers use observed post performance instead of follower-active-time data.

## Adaptive Content Strategy Agent

The content agent uses a published Google Sheets CSV catalog, owned Instagram insights, approved public competitor handles, and public global research to create a five-item weekly plan. The current growth-test mix is one product/value post, two educational/expert carousels, one branding/trust post, and one trend/engagement post. Sunday at 18:00 `Asia/Tashkent` is the default review time.

Commands:

```text
/contentplan
/approveplan
/rejectplan reason
/approveitem item-1
/contentstatus
/contentreport
/pausecontent
/resumecontent
/contentmode shadow|approval|auto
/competitors
/competitor add username
/competitor approve username
/competitor remove username
```

`shadow` is the safe default and never publishes plan items. `approval` requires weekly approval and item-level approval. `auto` publishes only due items inside an approved weekly plan. Missing captions or public media URLs block an item instead of creating substitute content. All content state is persisted in `data/content-strategy.json` for restart-safe, idempotent processing.

Publish the catalog sheet as CSV and set `CONTENT_CATALOG_CSV_URL`, or place a local export at `CONTENT_CATALOG_FILE` (default: `data/content-catalog.csv`). Google Sheets takes precedence when both are configured. Required logical columns are `sku`, `name`, `price`, `specs`, `availability`, `active`, `image_urls`, `priority`, and `updated_at`. The bot accepts common case-insensitive aliases. Product facts are never invented from missing cells.

## Hermes Agent API

Install Hermes Agent:

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.bashrc
hermes setup
```

Enable the API server in `~/.hermes/.env`:

```env
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=replace_with_same_value_as_hermes_api_key
```

Or run:

```bash
bash deploy/configure-env.sh
```

Run Hermes:

```bash
hermes gateway
```

Health check:

```bash
curl http://127.0.0.1:8642/v1/health
```

## Local Run

```bash
npm ci
npm start
```

## Ubuntu User Services

From the cloned project directory:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/hermes-gateway.service ~/.config/systemd/user/hermes-gateway.service
cp deploy/telegram-bot-api.service ~/.config/systemd/user/telegram-bot-api.service
cp deploy/telegram-bot.service ~/.config/systemd/user/telegram-bot.service

systemctl --user daemon-reload
systemctl --user enable --now hermes-gateway
systemctl --user enable --now telegram-bot-api
systemctl --user enable --now telegram-bot
```

Or run:

```bash
bash deploy/setup-services.sh
```

Allow user services to keep running after SSH logout:

```bash
sudo loginctl enable-linger "$USER"
```

Logs:

```bash
journalctl --user -u hermes-gateway -f
journalctl --user -u telegram-bot -f
```

Restart after code changes:

```bash
git pull
npm ci
systemctl --user restart telegram-bot
```
