#!/usr/bin/env bash
set -euo pipefail

STORAGE_ACCOUNT="${1:-}"
CONTAINER_NAME="${2:-userdata}"
OUTPUT_DIR="${3:-backups/blob-export}"

if [[ -z "$STORAGE_ACCOUNT" ]]; then
  echo "Usage: $0 <storage-account> [container-name] [output-dir]"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

az storage blob download-batch \
  --auth-mode login \
  --account-name "$STORAGE_ACCOUNT" \
  --destination "$OUTPUT_DIR" \
  --source "$CONTAINER_NAME"

echo "Downloaded blob backup to $OUTPUT_DIR"
