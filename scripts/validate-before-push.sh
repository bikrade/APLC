#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() {
  printf '[validate:push] %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[validate:push] Required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "${VALIDATE_CONTAINER_NAME:-}" ]]; then
    docker rm -f "$VALIDATE_CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  if [[ -n "${VALIDATE_TMP_DATA_DIR:-}" && -d "${VALIDATE_TMP_DATA_DIR:-}" ]]; then
    rm -rf "$VALIDATE_TMP_DATA_DIR"
  fi
}

trap cleanup EXIT

log 'Running repo lint/build/test checks.'
npm run lint
npm run build
npm run test

require_command docker

if ! docker info >/dev/null 2>&1; then
  printf '[validate:push] Docker daemon is not running or is unavailable. Start the local container runtime and try again.\n' >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  printf '[validate:push] Docker Buildx is not available. Install/enable buildx and try again.\n' >&2
  exit 1
fi

VALIDATE_IMAGE_NAME="aplc-local-validate:prepush"
VALIDATE_CONTAINER_NAME="aplc-prepush-validate"
VALIDATE_TMP_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aplc-prepush-data.XXXXXX")"

log 'Building the production container image with Docker Buildx.'
docker buildx build --platform linux/amd64 -f Dockerfile -t "$VALIDATE_IMAGE_NAME" --load .

log 'Starting the production container image for smoke tests.'
docker rm -f "$VALIDATE_CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d --name "$VALIDATE_CONTAINER_NAME" -p 127.0.0.1::3001 -v "$VALIDATE_TMP_DATA_DIR:/app/data" "$VALIDATE_IMAGE_NAME" >/dev/null

HOST_PORT="$(docker port "$VALIDATE_CONTAINER_NAME" 3001/tcp | tail -n 1 | sed 's/.*://')"
if [[ -z "$HOST_PORT" ]]; then
  printf '[validate:push] Failed to determine mapped host port for validation container.\n' >&2
  docker logs --tail 100 "$VALIDATE_CONTAINER_NAME" || true
  exit 1
fi

log "Waiting for container health on port ${HOST_PORT}."
for attempt in {1..20}; do
  if curl --silent --fail --max-time 5 "http://127.0.0.1:${HOST_PORT}/health" >/dev/null 2>&1; then
    break
  fi

  if [[ "$attempt" == "20" ]]; then
    printf '[validate:push] Container did not become healthy in time. Recent logs follow.\n' >&2
    docker logs --tail 100 "$VALIDATE_CONTAINER_NAME" || true
    exit 1
  fi

  sleep 2
done

log 'Running container smoke checks.'
curl --silent --fail --max-time 5 "http://127.0.0.1:${HOST_PORT}/health" >/dev/null
curl --silent --fail --max-time 5 "http://127.0.0.1:${HOST_PORT}/config/auth" >/dev/null

RELEASE_INFO_RESPONSE="$(curl --silent --fail --max-time 5 "http://127.0.0.1:${HOST_PORT}/release-info.json")"
printf '%s' "$RELEASE_INFO_RESPONSE" | node -e "
const chunks = []
process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', () => {
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const hasChanges = Array.isArray(payload.changes) && payload.changes.length > 0
  if (payload.channel === 'local' || !hasChanges) {
    console.error('[validate:push] release-info.json returned fallback metadata from the production image build.')
    process.exit(1)
  }
})
"

log 'All pre-push validation checks passed.'