#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$PROJECT_ROOT/data/runtime"
SERVER_PID_FILE="$RUNTIME_DIR/server.pid"
NGROK_PID_FILE="$RUNTIME_DIR/ngrok.pid"
APP_PORT="${APP_PORT:-3001}"
NGROK_API_PORT="${NGROK_API_PORT:-4040}"

read_pid() {
  local file="$1"
  if [[ -f "$file" ]]; then
    cat "$file"
  fi
}

SERVER_PID="$(read_pid "$SERVER_PID_FILE")"
NGROK_PID="$(read_pid "$NGROK_PID_FILE")"

echo "APLC status"
echo "-----------"

if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "Server: running (PID $SERVER_PID)"
else
  echo "Server: not running"
fi

if [[ -n "${NGROK_PID:-}" ]] && kill -0 "$NGROK_PID" 2>/dev/null; then
  echo "ngrok:  running (PID $NGROK_PID)"
else
  echo "ngrok:  not running"
fi

if curl -fsS "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then
  echo "Health: http://127.0.0.1:${APP_PORT}/health is OK"
else
  echo "Health: local app health check failed"
fi

PUBLIC_URL="$(python3 -c 'import json,sys
try:
    data=json.loads(sys.stdin.read() or "{}")
    tunnels=data.get("tunnels", [])
    https_url=next((t.get("public_url") for t in tunnels if str(t.get("public_url","")).startswith("https://")), "")
    print(https_url if https_url else "")
except Exception:
    pass
' <<< "$(curl -fsS "http://127.0.0.1:${NGROK_API_PORT}/api/tunnels" 2>/dev/null || true)")"

if [[ -n "$PUBLIC_URL" ]]; then
  echo "Public: $PUBLIC_URL"
fi
