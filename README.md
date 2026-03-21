# APLC (Adi's Personal Learning Center)

Local end-to-end prototype for multiplication practice (Phase 1), using filesystem JSON persistence.

## Structure

- `client/` React + Vite + TypeScript frontend.
- `server/` Express + TypeScript backend APIs.
- `data/` user profiles and saved session JSON files.
- `docs/` product, architecture, storage, API contracts, prompts, and progress.
- `scripts/` reserved for automation.

## Run locally

Backend:

```bash
cd server
npm install
npm run dev
```

Reliable local backend (keeps logs for troubleshooting):

```bash
cd server
npm run dev:local &
tail -f ../data/server.log
```

Frontend:

```bash
cd client
npm install
npm run dev
```

Open app:

```bash
http://localhost:5173
```

Health check:

```bash
curl http://localhost:3001/health
```

## Single-server production mode

APLC can now run as a single server app:

- React is built into `client/dist`
- Express serves the frontend and APIs from the same origin
- filesystem data stays under `data/`

That makes it suitable for a simple always-on Docker deployment with one persistent disk.

See [docs/deployment.md](/Users/bikram/Documents/GHCP-CLI/APLC/docs/deployment.md).

## Restart after reboot

Use the root script:

```bash
./aplc-up.sh
```

It will:

- stop any old APLC server / preview / ngrok listeners
- rebuild client and server
- start the single-server app on `3001`
- start ngrok
- print the local and public URLs

Check status anytime with:

```bash
./aplc-status.sh
```

If you want a stable public URL instead of a changing free ngrok URL, reserve an ngrok domain and set:

```env
NGROK_DOMAIN=your-fixed-subdomain.ngrok-free.app
```

in `server/.env`.

## OpenAI Configuration (optional for AI features)

Set these in your `server/.env` file to enable AI-generated questions, hints, and explanations:

- `OPENAI_API_KEY` (required for AI features)
- `OPENAI_MODEL` (optional, defaults to `gpt-4o-mini`)

If not configured, the app will gracefully fall back to rule-based question generation and static hints/explanations.

## Common "Failed to fetch" causes

- Backend is not running on `http://localhost:3001`.
- Frontend is using wrong API URL (set `VITE_API_BASE_URL`).
- Backend crashed unexpectedly; check `data/server.log`.
