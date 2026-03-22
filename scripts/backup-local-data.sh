#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-data}"
OUTPUT_DIR="${2:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$OUTPUT_DIR"
ARCHIVE_PATH="${OUTPUT_DIR}/aplc-local-data-${STAMP}.tar.gz"

tar -czf "$ARCHIVE_PATH" "$SOURCE_DIR"
echo "Created local backup: $ARCHIVE_PATH"
