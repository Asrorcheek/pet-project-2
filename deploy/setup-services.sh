#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$HOME/.config/systemd/user"

cp "$HOME/pet-project-2/deploy/hermes-gateway.service" "$HOME/.config/systemd/user/hermes-gateway.service"
cp "$HOME/pet-project-2/deploy/telegram-bot.service" "$HOME/.config/systemd/user/telegram-bot.service"

systemctl --user daemon-reload
systemctl --user enable hermes-gateway telegram-bot

sudo loginctl enable-linger "$USER"

systemctl --user restart hermes-gateway
sleep 5
systemctl --user restart telegram-bot
sleep 5

systemctl --user --no-pager --full status hermes-gateway telegram-bot
