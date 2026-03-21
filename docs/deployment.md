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
NGROK_DOMAIN=
```

Notes:

- `VITE_API_BASE_URL` is not required in production because the frontend uses same-origin APIs.
- `VITE_GOOGLE_CLIENT_ID` is not required in production because the frontend now reads the Google client ID from `/config/auth` at runtime.
- `NGROK_DOMAIN` is optional, but it is the only way to keep a fixed public ngrok URL. Without it, the free ngrok URL will change on restart.

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
