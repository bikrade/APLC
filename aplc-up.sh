#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"
CLIENT_DIR="$PROJECT_ROOT/client"
RUNTIME_DIR="$PROJECT_ROOT/data/runtime"
APP_PORT="${APP_PORT:-3001}"
PREVIEW_PORT="${PREVIEW_PORT:-4173}"
NGROK_API_PORT="${NGROK_API_PORT:-4040}"
SERVER_LOG="$RUNTIME_DIR/server.log"
NGROK_LOG="$RUNTIME_DIR/ngrok.log"
SERVER_PID_FILE="$RUNTIME_DIR/server.pid"
NGROK_PID_FILE="$RUNTIME_DIR/ngrok.pid"

mkdir -p "$RUNTIME_DIR"

load_env_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  fi
}

load_env_file "$PROJECT_ROOT/.env"
load_env_file "$SERVER_DIR/.env"

kill_pid_if_running() {
  local pid="$1"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
  fi
}

kill_from_pid_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file" 2>/dev/null || true)"
    kill_pid_if_running "$pid"
    rm -f "$file"
  fi
}

kill_port_listener() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-30}"
  local delay="${3:-1}"
  local i
  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

wait_for_port_to_clear() {
  local port="$1"
  local attempts="${2:-20}"
  local delay="${3:-1}"
  local i
  for ((i=1; i<=attempts; i++)); do
    if ! lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

get_ngrok_public_url() {
  local attempts="${1:-20}"
  local delay="${2:-1}"
  local body
  local i
  for ((i=1; i<=attempts; i++)); do
    body="$(curl -fsS "http://127.0.0.1:${NGROK_API_PORT}/api/tunnels" 2>/dev/null || true)"
    if [[ -n "$body" ]]; then
      python3 - <<'PY' "$body"
import json, sys
try:
    data = json.loads(sys.argv[1])
    tunnels = data.get("tunnels", [])
    https_url = next((t.get("public_url") for t in tunnels if str(t.get("public_url", "")).startswith("https://")), "")
    if https_url:
        print(https_url)
except Exception:
    pass
PY
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

echo "==> Restarting APLC"

kill_from_pid_file "$SERVER_PID_FILE"
kill_from_pid_file "$NGROK_PID_FILE"
kill_port_listener "$APP_PORT"
kill_port_listener "$PREVIEW_PORT"
kill_port_listener "$NGROK_API_PORT"

if ! wait_for_port_to_clear "$APP_PORT" 10 1; then
  echo "Port ${APP_PORT} is still busy. Stop the old process first, then rerun ./aplc-up.sh" >&2
  exit 1
fi

if ! wait_for_port_to_clear "$NGROK_API_PORT" 10 1; then
  echo "Port ${NGROK_API_PORT} is still busy. Stop the old ngrok process first, then rerun ./aplc-up.sh" >&2
  exit 1
fi

echo "==> Building client"
(
  cd "$CLIENT_DIR"
  VITE_API_BASE_URL= npm run build
)

echo "==> Building server"
(
  cd "$SERVER_DIR"
  npm run build
)

echo "==> Starting server on port ${APP_PORT}"
(
  cd "$SERVER_DIR"
  nohup env PORT="$APP_PORT" npm run start >"$SERVER_LOG" 2>&1 &
  echo $! > "$SERVER_PID_FILE"
)

if ! wait_for_http "http://127.0.0.1:${APP_PORT}/health" 30 1; then
  echo "Server failed to start. See log: $SERVER_LOG" >&2
  exit 1
fi

echo "==> Starting ngrok"
NGROK_CMD=(ngrok http "$APP_PORT" --log stdout)
if [[ -n "${NGROK_DOMAIN:-}" ]]; then
  NGROK_CMD=(ngrok http --url="$NGROK_DOMAIN" "$APP_PORT" --log stdout)
fi

nohup "${NGROK_CMD[@]}" >"$NGROK_LOG" 2>&1 &
echo $! > "$NGROK_PID_FILE"

PUBLIC_URL="$(get_ngrok_public_url 30 1 | tail -n 1 || true)"

echo
echo "APLC is running."
echo "Local URL:  http://127.0.0.1:${APP_PORT}"
echo "Health URL: http://127.0.0.1:${APP_PORT}/health"

if [[ -n "$PUBLIC_URL" ]]; then
  echo "Public URL: $PUBLIC_URL"
  if [[ -z "${NGROK_DOMAIN:-}" ]]; then
    echo
    echo "Note: this is a temporary ngrok free URL."
    echo "For a fixed public URL, reserve an ngrok domain and set NGROK_DOMAIN in server/.env."
  fi
else
  echo "ngrok started, but the public URL could not be read yet. See log: $NGROK_LOG"
fi

echo
echo "Logs:"
echo "  Server: $SERVER_LOG"
echo "  ngrok:  $NGROK_LOG"
