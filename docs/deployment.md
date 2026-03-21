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

## Suggested hosting options

This app is a good fit for any host that supports:

- one Node/Docker service
- a persistent disk/volume
- environment variables

Examples:

- Render web service + persistent disk
- Fly.io app + volume
- Railway service + volume
- a small VM with Docker and a reverse proxy

For this app, the simplest reliable option is usually a small VM or a Docker host because the local JSON files behave like a tiny embedded datastore.

## Local always-on helper scripts

From the project root:

```bash
./aplc-up.sh
./aplc-status.sh
```

These are useful after a laptop reboot or any time you want to restart the local single-server app and ngrok tunnel.
