#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_TEMPLATE="$APP_DIR/deploy/systemd/api-center.service"
SERVICE_DST="/etc/systemd/system/api-center.service"
RUN_USER="${SUDO_USER:-${USER:-root}}"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "please run with sudo or as root" >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found on this system" >&2
  exit 1
fi

if [ ! -f "$SERVICE_TEMPLATE" ]; then
  echo "service file not found: $SERVICE_TEMPLATE" >&2
  exit 1
fi

TMP_SERVICE="$(mktemp)"
trap 'rm -f "$TMP_SERVICE"' EXIT

sed \
  -e "s|__APP_DIR__|$APP_DIR|g" \
  -e "s|__RUN_USER__|$RUN_USER|g" \
  "$SERVICE_TEMPLATE" > "$TMP_SERVICE"

install -m 0644 "$TMP_SERVICE" "$SERVICE_DST"
systemctl daemon-reload
systemctl enable api-center
systemctl restart api-center
systemctl status api-center --no-pager || true
