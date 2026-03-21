# Deployment

APLC is packaged to run as a single server process:

- the Express server serves the built React frontend
- the same server exposes all API routes
- JSON session data lives on disk under `data/`

## Recommended shape

Use a single container with a persistent disk mounted at:

```text
/app/data
```

That matches the app's filesystem storage path in production.

## Required environment variables

Set these on the host:

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
- `NGROK_DOMAIN` is optional; it keeps a fixed public ngrok URL. Without it, free ngrok URLs change on restart.
- `CORS_ALLOWED_ORIGINS` is a comma-separated list of additional origins; localhost dev origins are always allowed.
- `DATA_ROOT` overrides the default data directory (`../../data` relative to server); useful for Docker or test environments.
- Azure OpenAI vars are optional; the adapter exists but is not wired into the main flow.

## CI

GitHub Actions runs on every push (`.github/workflows/ci.yml`):

1. Install dependencies (root, client, server)
2. Install Playwright Chromium
3. Build client and server
4. Run server unit/integration tests (Vitest)
5. Run E2E tests (Playwright)

## Build the image

```bash
docker build -t aplc .
```

## Run locally like production

```bash
docker run \
  --name aplc \
  -p 3001:3001 \
  -v "$(pwd)/data:/app/data" \
  --env-file server/.env \
  aplc
```

Then open:

```text
http://localhost:3001
```

## Data persistence

Mount a persistent volume to `/app/data`.

Without that mount, session files and insights will be lost on redeploy or container restart.

## Azure Deployment (Recommended)

APLC is deployed to **Azure Container Apps** — a serverless container platform with built-in HTTPS, scale-to-zero, and minimal ops overhead.

### Architecture

| Component | Azure Service | SKU / Tier |
|-----------|---------------|------------|
| App runtime | Azure Container Apps | Consumption (free tier) |
| Container image | Azure Container Registry | Basic (~$5/mo) |
| Persistent storage | Azure Files (SMB share) | Standard LRS |
| Logging | Log Analytics Workspace | Free tier (5 GB/mo) |
| Secrets | Container Apps secrets | Built-in |

### Why Container Apps

- **Scale to zero** — no cost when idle; free tier covers 2M requests/month.
- **Built-in HTTPS** — TLS termination and custom domain support out of the box.
- **Docker-native** — runs the existing `Dockerfile` with zero changes.
- **Azure Files mount** — persistent `/app/data` survives redeployments.
- **Estimated cost** — ~$5–6/month for a prototype (mostly ACR Basic).

### Why NOT Other Options

| Alternative | Reason to Skip |
|-------------|----------------|
| Azure Static Web Apps + Functions | Frontend is served by Express (same-origin), splitting adds complexity with no gain. |
| Azure App Service | Works but doesn't scale to zero — costs more at low traffic. |
| Azure Kubernetes Service (AKS) | Overkill for a single-container app. |
| Azure VM | Unmanaged, no auto-TLS, no auto-scale. |

### Resources Created

| Resource | Name |
|----------|------|
| Resource Group | `aplc-rg` |
| Container Registry | `aplcregistry<unique>` |
| Log Analytics Workspace | `aplc-logs` |
| Container Apps Environment | `aplc-env` |
| Storage Account + File Share | `aplcstorage<unique>` / `aplcdata` |
| Container App | `aplc-app` |

### Secrets

All secrets are stored as Container Apps secrets (never in the image):

- `OPENAI_API_KEY`
- `GOOGLE_CLIENT_ID`
- `AUTH_ALLOWED_EMAIL`
- `AUTH_SESSION_SECRET`

### CD Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main`:

1. **CI** — build + test (Vitest + Playwright)
2. **CD** — build Docker image → push to ACR → update Container App revision
3. Zero-downtime rollout using `/health` probe

The CD job requires these GitHub repository secrets:

- `AZURE_CREDENTIALS` — service principal JSON for `az login`
- `REGISTRY_LOGIN_SERVER` — e.g. `aplcregistry<unique>.azurecr.io`
- `REGISTRY_USERNAME` / `REGISTRY_PASSWORD` — ACR admin credentials
- `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `AUTH_ALLOWED_EMAIL`, `AUTH_SESSION_SECRET`

### Manual Deployment

```bash
# Build and push image
az acr login --name <registry-name>
docker build -t <registry-name>.azurecr.io/aplc:latest .
docker push <registry-name>.azurecr.io/aplc:latest

# Update container app
az containerapp update \
  -n aplc-app -g aplc-rg \
  --image <registry-name>.azurecr.io/aplc:latest
```

### Scaling Considerations

The current filesystem JSON storage works with Azure Files for a **single-replica** app. If multi-instance scaling is needed in the future, swap the storage layer to Azure Cosmos DB or Azure SQL — the architecture doc notes this as a known risk.

## Other Hosting Options

This app also works on any host that supports one Node/Docker service, a persistent disk, and environment variables:

- Render web service + persistent disk
- Fly.io app + volume
- Railway service + volume
- A small VM with Docker and a reverse proxy

## Local always-on helper scripts

From the project root:

```bash
./aplc-up.sh
./aplc-status.sh
```

These are useful after a laptop reboot or any time you want to restart the local single-server app and ngrok tunnel.
