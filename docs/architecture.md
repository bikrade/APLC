# Architecture

## Frontend

- React + TypeScript SPA using Vite.
- Core views: Login, Home (dashboard & insights), Session, Summary.
- One-question-at-a-time interaction model with back navigation only.
- Primary UX goal: engaging, Duolingo-style learning flow with immediate animated feedback.

## Backend

- Node.js + Express + TypeScript REST API.
- Session lifecycle endpoints: start, fetch, answer, help, reveal, pause.
- Dashboard endpoint aggregates historical session data (accuracy, streaks, activity heatmap).
- Insights endpoint derives performance guidance from the latest 3 sessions.
- Health endpoint for operational checks.

## Authentication

- Google OAuth 2.0 via Google Identity Services.
- Server verifies Google ID tokens and issues HMAC-SHA256 signed session tokens (12-hour TTL).
- Single allowed email enforced via `AUTH_ALLOWED_EMAIL`.
- When Google auth is not configured, falls back to open access (local dev mode).
- Auth middleware protects all user-scoped routes; 403 returned if token userId ≠ route userId.
- `POST /auth/google` accepts credentials; `GET /auth/session` returns current session; `GET /config/auth` exposes public client ID.

## AI Integration

- OpenAI API (direct) is the active AI provider for question generation, hints, and per-answer explanations.
- Required env var: `OPENAI_API_KEY`. Optional: `OPENAI_MODEL` (defaults to `gpt-4o-mini`).
- On missing configuration, app uses rule-based question generation, static hints, and static explanations.
- On OpenAI API failure, hints return a 502 error; questions and explanations fall back to rule-based/static.
- All OpenAI calls are logged to console with latency, token usage, model, finish reason, and request ID.
- In-memory call-stat accumulator captures structured stats per API call; `totalTokensUsed` tracked per session.
- Azure OpenAI adapter exists in `azureOpenAI.ts` but is not wired into the main flow (future option).

## Storage

- Dual-mode storage layer: filesystem (local dev) or Azure Blob Storage (production).
- Mode selected automatically via `AZURE_STORAGE_ACCOUNT` env var — if set, all storage operations delegate to Blob Storage; otherwise, filesystem JSON is used.
- `data/users/<userId>/profile.json` — user profile (filesystem) or `users/<userId>/profile.json` (blob).
- `data/users/<userId>/sessions/<sessionId>.json` — session history (filesystem) or `users/<userId>/sessions/<sessionId>.json` (blob).
- `data/users/<userId>/insights.txt` — performance insights (filesystem) or `users/<userId>/insights.txt` (blob).
- Azure Blob Storage uses `DefaultAzureCredential` (system-assigned managed identity in production — no shared keys).
- Storage account: `aplcfiles2026`, blob container: `userdata`.
- No database dependency. If DB becomes necessary later, prefer Azure SQL for ease of Azure setup.

## Local Development

- Frontend: `cd client && npm run dev` (Vite on port 5173).
- Backend: `cd server && npm run dev` (Express on port 3001).
- Frontend communicates with backend via `http://localhost:3001`.

## Azure Deployment

- Deployed to **Azure Container Apps** (Consumption tier, East US).
- Scale-to-zero: `minReplicas: 0`, `maxReplicas: 1` — no cost when idle.
- Data persists in **Azure Blob Storage** via managed identity (no filesystem dependency in production).
- Docker image is data-free — no seed data baked in; all user data lives in Blob Storage.
- Container Registry: `aplcregistry2026` (Basic tier).
- HTTPS with built-in TLS termination at `aplc-app.redriver-82b9ce7a.eastus.azurecontainerapps.io`.

## UX Enhancements

- Duolingo-inspired celebration on correct answers: multiple confetti styles (classic, shooting stars, school pride, cascade) and animated overlay.
- Feedback banners: green for correct (🎉), blue/red for incorrect (💪), with contextual messaging.
- Both correct and incorrect answer flows pause for student acknowledgement ("Continue" or "Next Question" button) instead of auto-advancing.
- CSS animations: slideUp, popIn, celebBounce, fadeInOut, pulse, shake.
- Modern dashboard with GitHub-style activity heatmap, streak tracking, and stat cards.

## Observability

- **Application Insights** (`aplc-insights`): auto-collects HTTP requests, dependencies, exceptions, and performance metrics via `applicationinsights` Node.js SDK.
- **Log Analytics** (`aplc-logs`): centralized log sink for Container Apps system logs and Application Insights telemetry.
- **Structured logging**: `server/src/logger.ts` provides leveled logging (info, warn, error) with timestamps. Request logger middleware logs method, URL, status, and duration for every HTTP request.
- **Health probes**: liveness (30s interval, `/health`), readiness (10s, `/health`), startup (5s, `/health`).
- **Alerts**: `aplc-error-spike` (≥5 errors in 15min, severity 2) and `aplc-restart-alert` (≥3 container crashes in 15min, severity 1).
- Console logging for every OpenAI call: `[OpenAI:<label>] ✓ <latency>ms | model=... | tokens: prompt=... completion=... total=... | finish=... | id=...`
- Labels identify call type: `questions`, `hints`, `explanation`.

## Subjects

- **Multiplication**: Decimal, fraction, percentage, and mixed question types. Rule-based generation with optional AI override.
- **Division**: Decimal, fraction, percentage, and mixed question types with division-specific help steps. Fully distinct from Multiplication.
- **Reading**: Story-based reading comprehension ("The Monsoon Clock", 5 pages). Evaluates keyword-based comprehension score (65%) and reading speed in WPM (35%). Overall score ≥ 7 to pass.

## Security

- Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`.
- `x-powered-by` header disabled.
- CORS restricted to explicit origin allowlist (localhost dev ports + configured origins + ngrok domain).
- Request body limited to 32 KB.
- Route parameter validation via regex before any filesystem access (prevents path traversal).
- IP-based rate limiting on auth, help, reveal, and answer endpoints.
- `Cache-Control: no-store` on auth routes.
- Session token signature verified with `crypto.timingSafeEqual` (timing-attack resistant).

## Testing

- **Unit / integration**: Vitest + Supertest (`server/test/api.spec.ts`). Covers auth, rate limiting, session lifecycle, reading flow, answer validation.
- **E2E**: Playwright + Chromium (`tests/e2e/app.spec.ts`). Covers Multiplication wrong-answer flow, Division session launch, Reading flow completion.
- **CI/CD**: GitHub Actions (`.github/workflows/ci.yml`):
  - **CI** (all branches): lint, build, Vitest unit tests, Playwright E2E tests.
  - **CD** (main only): OIDC Azure login → ACR image build → Container App update → health check verification.
  - Zero-downtime deployment with `/health` probe validation.

## Risks

- Single-process in-memory cache can diverge from Blob Storage if multi-instance scaling is introduced (current max replicas: 1).
- Azure OpenAI adapter exists but is not yet wired into the main flow.
- Scale-to-zero causes cold starts (~10-15s) on first request after idle period.
- Blob Storage latency is higher than local filesystem; acceptable for current single-user usage.
