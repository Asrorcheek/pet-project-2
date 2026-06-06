#!/usr/bin/env bash
set -euo pipefail

BOT_ENV="${BOT_ENV:-$HOME/pet-project-2/.env}"
HERMES_ENV="${HERMES_ENV:-$HOME/.hermes/.env}"

mkdir -p "$(dirname "$BOT_ENV")" "$(dirname "$HERMES_ENV")"
touch "$BOT_ENV" "$HERMES_ENV"

if ! grep -qE '^TELEGRAM_BOT_TOKEN=.+' "$BOT_ENV"; then
  echo "TELEGRAM_BOT_TOKEN is missing in $BOT_ENV" >&2
  exit 1
fi

key="$(grep -E '^API_SERVER_KEY=' "$HERMES_ENV" | tail -n1 | cut -d= -f2- || true)"

if [[ -z "$key" || "$key" == "change-me-secret" ]]; then
  key="$(openssl rand -hex 32)"
fi

set_env() {
  local file="$1"
  local name="$2"
  local value="$3"

  if grep -qE "^${name}=" "$file"; then
    sed -i "s|^${name}=.*|${name}=${value}|" "$file"
  else
    printf "\n%s=%s\n" "$name" "$value" >> "$file"
  fi
}

set_env "$HERMES_ENV" API_SERVER_ENABLED true
set_env "$HERMES_ENV" API_SERVER_HOST 127.0.0.1
set_env "$HERMES_ENV" API_SERVER_PORT 8642
set_env "$HERMES_ENV" API_SERVER_KEY "$key"

set_env "$BOT_ENV" HERMES_API_BASE http://127.0.0.1:8642/v1
set_env "$BOT_ENV" HERMES_API_KEY "$key"
set_env "$BOT_ENV" HERMES_MODEL hermes-agent
set_env "$BOT_ENV" HERMES_TIMEOUT_MS 180000

chmod 600 "$BOT_ENV" "$HERMES_ENV"

echo "Environment configured."
grep -hE '^(TELEGRAM_BOT_TOKEN|HERMES_API_BASE|HERMES_API_KEY|HERMES_MODEL|HERMES_TIMEOUT_MS|API_SERVER_)' "$BOT_ENV" "$HERMES_ENV" | sed -E 's/=.*/=<set>/'
