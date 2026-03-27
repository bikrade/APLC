# APLC (Adi's Personal Learning Center)

An adaptive, personalized learning web app for Grade 6 math and reading practice — deployed to Azure Container Apps with persistent storage, observability, and CI/CD.

**Live**: [aplc-app.redriver-82b9ce7a.eastus.azurecontainerapps.io](https://aplc-app.redriver-82b9ce7a.eastus.azurecontainerapps.io)

## Features

- **Multiplication** — decimal, fraction, percentage, and mixed question types with adaptive level shifting, expanded challenge ceiling (up to internal level 7), and broad word-problem template variety
- **Division** — same question types with division-specific help steps plus expanded word-problem template variety
- **Reading** — fresh AI-written middle-grade stories repaginated into book-like 6-page reading sessions with paragraph breaks, corrected server-verified WPM scoring, fast-reader quiz mode, and comprehension warnings
- **AI-powered** — OpenAI (gpt-4o-mini) generates questions, hints, and per-answer explanations
- **Adaptive difficulty** — uses historical subject performance plus live first-attempt behavior, pace, and support usage (multiplication can step up faster when Adi is consistently strong)
- **Template variety guardrails** — math question generation tracks recently used templates and avoids repeating them in a rolling 30-question window when possible
- **In-progress upgrades** — new difficulty and template-variety behavior applies as soon as the next unanswered question is generated (no need to complete the current session first)
- **Reset and restart** — any subject card with an unfinished session can now discard that in-progress work and start a fresh session immediately with the latest UI and generation logic
- **Dashboard** — GitHub-style activity heatmap, streak tracking, stat cards, today-vs-yesterday practice bars against a profile-driven daily goal, best-next-step coaching, mastery, detailed insights, and parent review
- **Session modes** — each subject can start in `Guided` mode with live correctness feedback or `Quiz` mode with end-of-session review
- **Release badge** — top-nav version pill generated from git history with click-to-open recent change notes
- **Google OAuth 2.0** — HMAC-SHA256 session tokens, single allowed email
- **Duolingo-style UX** — confetti celebrations, animated feedback, KaTeX math rendering

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript |
| Backend | Node.js 22 + Express 5 + TypeScript |
| AI | OpenAI API (gpt-4o-mini) |
| Auth | Google OAuth 2.0 + HMAC-SHA256 tokens |
| Storage (local) | Filesystem JSON (`data/`) |
| Storage (production) | Azure Blob Storage (managed identity) |
| Observability | Application Insights + Log Analytics |
| Hosting | Azure Container Apps (scale-to-zero) |
| CI/CD | GitHub Actions (OIDC → ACR → ACA) |
| Container | Docker multi-stage (`node:22-bookworm-slim`) |

## Project Structure

```
client/          React + Vite + TypeScript frontend
server/          Express + TypeScript backend APIs
  src/
    index.ts       Main server (routes, middleware, App Insights)
    storage.ts     Storage adapter (filesystem or Blob Storage)
    blobStorage.ts Azure Blob Storage adapter (managed identity)
    auth.ts        Google OAuth + session token management
    openai.ts      OpenAI API integration
    reading.ts     Reading comprehension logic
    logger.ts      Structured logging
    types.ts       Shared TypeScript types
    utils.ts       Utility functions
  test/            Vitest + Supertest tests
tests/e2e/         Playwright E2E tests
docs/              Product, architecture, storage, API, prompts, progress
seed/              Historical seed data (uploaded to Blob Storage)
.github/workflows/ CI/CD pipeline
```

## Run Locally

### Development mode

```bash
# Backend
cd server && npm install && npm run dev

# Frontend (separate terminal)
cd client && npm install && npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Docker

```bash
docker build -t aplc .
docker run --name aplc -p 3001:3001 -v "$(pwd)/data:/app/data" --env-file server/.env aplc
```

Open [http://localhost:3001](http://localhost:3001)

### Health check

```bash
curl http://localhost:3001/health
```

## Environment Variables

Create `server/.env` for local development:

```env
PORT=3001
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-4o-mini
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
AUTH_ALLOWED_EMAIL=allowed@email.com
AUTH_SESSION_SECRET=replace-with-a-long-random-secret
```

Without `OPENAI_API_KEY`, the app falls back to rule-based question generation and static hints/explanations.
Without `GOOGLE_CLIENT_ID`, the app runs in open-access local dev mode (no login required).

## Azure Deployment

APLC is deployed to Azure Container Apps with:

- **Scale-to-zero** — `minReplicas: 0`, no cost when idle
- **Azure Blob Storage** — persistent data via managed identity (no shared keys)
- **Application Insights** — auto-collected telemetry (requests, dependencies, exceptions)
- **Health probes** — liveness (30s), readiness (10s), startup (5s)
- **Alerts** — error spike + container restart monitoring
- **CI/CD** — push to `main` → lint + test → Docker production image validation → GitHub-runner Docker Buildx push to ACR → ACA deploy → health verify

See [docs/deployment.md](docs/deployment.md) for full details.

## Testing

```bash
# Full validation used by CI
npm run lint
npm run test

# Full local pre-push validation used before git/gh push
npm run validate:push

# Targeted commands
npm run lint:tests
npm run test:client
npm run test:server
npm run test:e2e
```

Notes:

- `npm run lint` now covers client app code, server source code, server test files, and Playwright E2E specs.
- `npm run test:client` runs client test linting before Vitest.
- `npm run test:server` runs server test linting plus source and test typechecks before Vitest.
- `npm run test:e2e` runs Playwright linting before browser automation.
- The production image path used by CI/CD is additionally validated by the workflow's Docker Buildx job before deployment.
- `npm run validate:push` runs lint, build, test, a Docker Buildx production-image build, and a local container smoke check on `/health` and `/config/auth`.
- `npm run setup:hooks` configures the versioned `.githooks/pre-push` hook so local pushes automatically enforce `npm run validate:push`.

## Documentation

- [docs/product.md](docs/product.md) — product vision, user flows, requirements
- [docs/architecture.md](docs/architecture.md) — system architecture, tech decisions
- [docs/database.md](docs/database.md) — data schemas, storage design
- [docs/api-contracts.md](docs/api-contracts.md) — API endpoints, request/response schemas
- [docs/deployment.md](docs/deployment.md) — Azure deployment, CI/CD, environment setup
- [docs/recovery.md](docs/recovery.md) — backup, restore, rollback, and recovery drill procedures
- [docs/prompts.md](docs/prompts.md) — OpenAI prompt strategy and templates
- [docs/progress.md](docs/progress.md) — development changelog

## Security

- Google OAuth 2.0 with timing-safe token verification
- Security headers (X-Frame-Options, CSP, CORP, COOP)
- IP-based rate limiting on auth and AI endpoints
- Route parameter validation (path traversal prevention)
- Request body limited to 32 KB
- CORS restricted to explicit origin allowlist
- Secrets stored as Container Apps secrets (never in image)
- Managed identity for storage (no shared keys or connection strings)

## Common "Failed to fetch" causes

- Backend is not running on `http://localhost:3001`.
- Frontend is using wrong API URL (set `VITE_API_BASE_URL`).
- Backend crashed unexpectedly; check `data/server.log`.
