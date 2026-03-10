#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_SRC="$APP_DIR/deploy/systemd/api-center.service"
SERVICE_DST="/etc/systemd/system/api-center.service"

if [ ! -f "$SERVICE_SRC" ]; then
  echo "service file not found: $SERVICE_SRC" >&2
  exit 1
fi

cp "$SERVICE_SRC" "$SERVICE_DST"
systemctl daemon-reload
systemctl enable api-center
systemctl restart api-center
systemctl status api-center --no-pager || true
