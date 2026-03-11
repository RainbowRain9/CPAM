#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
PORT="${PORT:-7940}"

is_port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$1$"
    return $?
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  return 1
}

mkdir -p data

if [ ! -d node_modules ]; then
  echo "[local-start] installing dependencies..."
  npm install
fi

if [ ! -f dist/index.html ]; then
  echo "[local-start] building frontend..."
  npm run build
fi

if is_port_in_use "$PORT"; then
  if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:${PORT}/api/auth/status" >/dev/null 2>&1; then
    echo "[local-start] API Center is already running on port ${PORT}"
    exit 0
  fi

  echo "[local-start] port ${PORT} is already in use; set PORT to a free port and retry" >&2
  exit 1
fi

exec npm start
