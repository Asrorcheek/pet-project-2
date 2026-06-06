# Telegram Hermes Bot

Node.js Telegram bot that forwards user messages to a local Hermes Agent API server and sends the answer back to Telegram.

## Required Runtime

- Ubuntu VM with SSH access
- Node.js 18 or newer
- Git
- Hermes Agent installed and configured
- Telegram bot token from BotFather

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

HERMES_API_BASE=http://127.0.0.1:8642/v1
HERMES_API_KEY=replace_with_same_value_as_api_server_key
HERMES_MODEL=hermes-agent
HERMES_INSTRUCTIONS=Answer clearly and concisely.
```

Use `/id` in the bot to see your numeric Telegram user ID, then put it into `ALLOWED_TELEGRAM_USER_IDS`.
On the server, `deploy/configure-env.sh` can generate and sync `HERMES_API_KEY` with Hermes `API_SERVER_KEY`.

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
cp deploy/telegram-bot.service ~/.config/systemd/user/telegram-bot.service

systemctl --user daemon-reload
systemctl --user enable --now hermes-gateway
systemctl --user enable --now telegram-bot
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
