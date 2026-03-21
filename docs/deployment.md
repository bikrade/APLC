# Deployment

APLC is deployed to **Azure Container Apps** — a serverless container platform with built-in HTTPS, scale-to-zero, and minimal ops overhead. It can also run locally as a single server process.

## Production Architecture

| Component | Azure Service | Details |
|-----------|---------------|---------|
| App runtime | Azure Container Apps | Consumption (scale-to-zero, minReplicas: 0, maxReplicas: 1) |
| Container image | Azure Container Registry | `aplcregistry2026` (Basic, ~$5/mo) |
| Persistent storage | Azure Blob Storage | `aplcfiles2026` / `userdata` (managed identity, no shared keys) |
| Telemetry | Application Insights | `aplc-insights` (auto-collect requests, dependencies, exceptions) |
| Logging | Log Analytics Workspace | `aplc-logs` (free tier, 5 GB/mo) |
| Alerts | Azure Monitor | Error spike (≥5 in 15min) + container restart (≥3 in 15min) |
| Secrets | Container Apps secrets | Built-in (referenced via `secretref:`) |
| Auth | System-assigned Managed Identity | Storage Blob Data Contributor role on storage account |

### App URL

```
https://aplc-app.redriver-82b9ce7a.eastus.azurecontainerapps.io
```

### Health Probes

| Probe | Interval | Path |
|-------|----------|------|
| Liveness | 30s | `/health` |
| Readiness | 10s | `/health` |
| Startup | 5s | `/health` |

## Docker Image

Multi-stage build (`node:22-bookworm-slim`):

1. Build React client → `client/dist`
2. Build server TypeScript → `server/dist`
3. Runtime stage: production deps only, serves API + static frontend

The image contains **no user data** — all data lives in Azure Blob Storage in production.

```bash
docker build -t aplc .
```

## Required Environment Variables

### Production (set on Container App)

```env
PORT=3001
OPENAI_MODEL=gpt-4o-mini
DATA_ROOT=/app/data
OPENAI_API_KEY=secretref:openai-key
GOOGLE_CLIENT_ID=secretref:google-client-id
AUTH_ALLOWED_EMAIL=secretref:auth-email
AUTH_SESSION_SECRET=secretref:session-secret
AZURE_STORAGE_ACCOUNT=aplcfiles2026
AZURE_STORAGE_CONTAINER=userdata
APPLICATIONINSIGHTS_CONNECTION_STRING=<connection-string>
CORS_ALLOWED_ORIGINS=https://aplc-app.redriver-82b9ce7a.eastus.azurecontainerapps.io
```

### Local development (`server/.env`)

```env
PORT=3001
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
AUTH_ALLOWED_EMAIL=adi@gmail.com
AUTH_SESSION_SECRET=replace-with-a-long-random-secret
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

### Optional variables

```env
CORS_ALLOWED_ORIGINS=https://example.com,https://other.com
NGROK_DOMAIN=your-fixed-subdomain.ngrok-free.app
DATA_ROOT=/app/data
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=2024-10-21
```

Notes:

- `VITE_API_BASE_URL` is not required in production because the frontend uses same-origin APIs.
- `VITE_GOOGLE_CLIENT_ID` is not required in production because the frontend reads the Google client ID from `/config/auth` at runtime.
- When `AZURE_STORAGE_ACCOUNT` is set, all storage operations use Azure Blob Storage; otherwise, filesystem JSON storage is used (local dev).
- Azure OpenAI vars are optional; the adapter exists but is not wired into the main flow.

## CI/CD Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every push:

### CI (all branches)

1. Install dependencies (root, client, server)
2. Install Playwright Chromium
3. Lint (ESLint for client + server)
4. Build client and server
5. Run server unit/integration tests (Vitest)
6. Run E2E tests (Playwright)

### CD (main branch only)

1. **Azure Login** via OIDC (federated credentials, no stored secrets)
2. **ACR Build** — Docker image built in ACR (`aplc:<sha>` + `aplc:latest`)
3. **Update secrets** — syncs Container Apps secrets from GitHub secrets
4. **Deploy** — updates Container App with new image + env vars
5. **Health check** — verifies `/health` returns `{"status":"ok"}`

### GitHub Secrets (11)

| Secret | Purpose |
|--------|---------|
| `AZURE_CLIENT_ID` | Service principal app ID for OIDC |
| `AZURE_TENANT_ID` | Azure AD tenant |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription |
| `REGISTRY_LOGIN_SERVER` | `aplcregistry2026.azurecr.io` |
| `REGISTRY_USERNAME` | ACR admin username |
| `REGISTRY_PASSWORD` | ACR admin password |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `AUTH_ALLOWED_EMAIL` | Allowed user email |
| `AUTH_SESSION_SECRET` | HMAC session signing secret |
| `APPINSIGHTS_CONNECTION_STRING` | Application Insights connection |

GitHub environment: `production` (required for CD job).

## Azure Resources

| Resource | Name | Region |
|----------|------|--------|
| Resource Group | `aplc-rg` | East US |
| Container Registry | `aplcregistry2026` | East US |
| Log Analytics Workspace | `aplc-logs` | East US |
| Application Insights | `aplc-insights` | East US |
| Container Apps Environment | `aplc-env` | East US |
| Storage Account | `aplcfiles2026` | East US |
| Blob Container | `userdata` | — |
| Container App | `aplc-app` | East US |
| Alert: Error Spike | `aplc-error-spike` | East US |
| Alert: Restart | `aplc-restart-alert` | East US |

## Manual Deployment

```bash
# Build and push image
az acr build --registry aplcregistry2026 --image aplc:latest --file Dockerfile .

# Update container app
az containerapp update \
  -n aplc-app -g aplc-rg \
  --image aplcregistry2026.azurecr.io/aplc:latest
```

## Scaling Considerations

- **Scale-to-zero** (`minReplicas: 0`): no compute cost when idle; ~10-15s cold start on first request.
- **Single replica** (`maxReplicas: 1`): sufficient for single-user usage; avoids in-memory cache divergence.
- All persistent data is in Azure Blob Storage — survives container restarts, redeployments, and scale events.
- If multi-instance scaling is needed, all filesystem-dependent code paths are already bypassed when Blob Storage is configured.

## Estimated Monthly Cost

| Scenario | Cost |
|----------|------|
| Scale-to-zero (current, minReplicas: 0) | ~$7–8/mo |
| Always-on (minReplicas: 1, 24×7) | ~$20–22/mo |

Main cost drivers: ACR Basic ($5), ACA compute ($0–14), alerts (~$1.50). Blob Storage, Log Analytics, and App Insights are effectively free at this usage level.

## Run Locally

### Docker

```bash
docker run \
  --name aplc \
  -p 3001:3001 \
  -v "$(pwd)/data:/app/data" \
  --env-file server/.env \
  aplc
```

### Development mode

```bash
# Backend
cd server && npm install && npm run dev

# Frontend (separate terminal)
cd client && npm install && npm run dev
```

Open `http://localhost:5173` (dev) or `http://localhost:3001` (Docker/production).

## Other Hosting Options

This app also works on any host that supports one Node/Docker service and environment variables:

- Render web service
- Fly.io app + volume
- Railway service + volume
- A small VM with Docker and a reverse proxy

Note: without `AZURE_STORAGE_ACCOUNT` set, data falls back to filesystem (requires a persistent volume mount at `/app/data`).

## Local Helper Scripts

```bash
./aplc-up.sh    # rebuild and start local server + ngrok
./aplc-status.sh # check status
```
