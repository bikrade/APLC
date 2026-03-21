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

- Dummy login only (user selection from local profiles).
- No real authentication provider in this phase.

## AI Integration

- OpenAI API (direct, not Azure) is integrated for question generation, hints, and per-answer explanations.
- Required env var: `OPENAI_API_KEY`. Optional: `OPENAI_MODEL` (defaults to `gpt-4o-mini`).
- On missing configuration, app uses rule-based question generation, static hints, and static explanations.
- On OpenAI API failure, hints return a 502 error; questions and explanations fall back to rule-based/static.
- All OpenAI calls are logged to console with latency, token usage, model, finish reason, and request ID.
- In-memory call-stat accumulator captures structured stats per API call for filesystem logging.

## Storage

- Filesystem-first persistence via JSON files.
- `data/users/<userId>/profile.json` for user profile.
- `data/users/<userId>/sessions/<sessionId>.json` for session history.
- `data/logs/YYYYMMDDHHMMSS.json` for structured activity logs (in progress).
- No database dependency for current prototype.
- If DB becomes necessary later, prefer Azure SQL first for ease of Azure setup.

## Local Development

- Frontend: `cd client && npm run dev` (Vite on port 5173).
- Backend: `cd server && npm run dev` (Express on port 3001).
- Frontend communicates with backend via `http://localhost:3001`.

## Azure Deployment

- Current design is cloud-portable but optimized for local prototype speed.
- Future Azure deployment can keep same API surface while swapping storage layer.
- If filesystem persistence is insufficient in Azure runtime, add a storage adapter (without changing UI flow).

## UX Enhancements

- Duolingo-inspired celebration on correct answers: multiple confetti styles (classic, shooting stars, school pride, cascade) and animated overlay.
- Feedback banners: green for correct (🎉), blue/red for incorrect (💪), with contextual messaging.
- Both correct and incorrect answer flows pause for student acknowledgement ("Continue" or "Next Question" button) instead of auto-advancing.
- CSS animations: slideUp, popIn, celebBounce, fadeInOut, pulse, shake.
- Modern dashboard with GitHub-style activity heatmap, streak tracking, and stat cards.

## Observability

- Console logging for every OpenAI call: `[OpenAI:<label>] ✓ <latency>ms | model=... | tokens: prompt=... completion=... total=... | finish=... | id=...`
- Labels identify call type: `questions`, `hints`, `explanation`.
- Filesystem logging (in progress): structured JSON logs with YYYYMMDDHHMMSS-named files capturing session activity and OpenAI stats.

## Risks

- Filesystem persistence in some cloud runtimes may require mounted durable storage.
- Single-process in-memory cache can diverge from disk if multi-instance scaling is introduced.
- Mathematical answer parsing currently numeric-only; fraction string inputs may require enhancement.
