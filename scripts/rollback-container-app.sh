#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${1:-}"
RESOURCE_GROUP="${2:-}"
REVISION_NAME="${3:-}"

if [[ -z "$APP_NAME" || -z "$RESOURCE_GROUP" || -z "$REVISION_NAME" ]]; then
  echo "Usage: $0 <app-name> <resource-group> <revision-name>"
  exit 1
fi

echo "Re-activating revision: $REVISION_NAME"
az containerapp revision activate \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --revision "$REVISION_NAME"

echo "Routing 100% traffic back to $REVISION_NAME"
az containerapp ingress traffic set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --revision-weight "${REVISION_NAME}=100"
