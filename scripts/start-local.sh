#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

mkdir -p data

if [ ! -d node_modules ]; then
  echo "[local-start] installing dependencies..."
  npm install
fi

if [ ! -f dist/index.html ]; then
  echo "[local-start] building frontend..."
  npm run build
fi

exec npm start
