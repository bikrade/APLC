#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"
node scripts/prepare-e2e-data.mjs
VITE_API_BASE_URL= npm --prefix client run build
npm --prefix server run build

cd "$ROOT_DIR/server"
PORT=3100 \
DATA_ROOT="$ROOT_DIR/.tmp/e2e-data" \
GOOGLE_CLIENT_ID='' \
AUTH_ALLOWED_EMAILS='' \
AUTH_SESSION_SECRET='' \
OPENAI_API_KEY='mock-openai-key' \
OPENAI_MOCK_RESPONSES='true' \
npm run start
