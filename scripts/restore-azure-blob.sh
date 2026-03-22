#!/usr/bin/env bash
set -euo pipefail

STORAGE_ACCOUNT="${1:-}"
CONTAINER_NAME="${2:-userdata}"
SOURCE_DIR="${3:-}"

if [[ -z "$STORAGE_ACCOUNT" || -z "$SOURCE_DIR" ]]; then
  echo "Usage: $0 <storage-account> [container-name] <source-dir>"
  exit 1
fi

az storage blob upload-batch \
  --auth-mode login \
  --account-name "$STORAGE_ACCOUNT" \
  --destination "$CONTAINER_NAME" \
  --source "$SOURCE_DIR" \
  --overwrite

echo "Uploaded restore data from $SOURCE_DIR to $CONTAINER_NAME"
