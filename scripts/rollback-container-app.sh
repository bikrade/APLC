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
set +e
ACTIVATE_OUTPUT=$(az containerapp revision activate \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --revision "$REVISION_NAME" 2>&1)
ACTIVATE_EXIT=$?
set -e

if [[ $ACTIVATE_EXIT -ne 0 ]]; then
  if [[ "$ACTIVATE_OUTPUT" == *"RevisionAlreadyInRequestedState"* ]]; then
    echo "Revision $REVISION_NAME is already active. Continuing rollback."
  else
    echo "$ACTIVATE_OUTPUT"
    exit $ACTIVATE_EXIT
  fi
fi

echo "Routing 100% traffic back to $REVISION_NAME"
az containerapp ingress traffic set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --revision-weight "${REVISION_NAME}=100"
