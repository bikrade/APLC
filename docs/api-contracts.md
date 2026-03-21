# API Contracts

## Conventions

- Base URL (local): `http://localhost:3001`
- Content type: JSON for request/response bodies.
- Error format: `{ "error": "message" }`

## Endpoints

- `GET /health`
- `GET /users`
- `GET /config/openai`
- `GET /config/auth`
- `POST /auth/google`
- `GET /auth/session`
- `GET /dashboard/:userId`
- `GET /insights/:userId`
- `GET /sessions/in-progress/:userId`
- `POST /session/start`
- `GET /session/:userId/:sessionId`
- `POST /session/:userId/:sessionId/answer`
- `POST /session/:userId/:sessionId/help`
- `POST /session/:userId/:sessionId/reveal`
- `POST /session/:userId/:sessionId/pause`

## Request Schemas

- `POST /auth/google`
  - `credential: string` (Google ID token)
- `POST /session/start`
  - `userId: string` (ignored when Google auth is active; derived from token)
  - `questionCount?: number (10-15 clamped; ignored for Reading)`
  - `subject?: string ('Multiplication' | 'Division' | 'Reading', default 'Multiplication')`
- `POST /session/:userId/:sessionId/answer`
  - `questionIndex: number`
  - `answer: string | number` (number or fraction string for math; text summary for reading)
  - `elapsedMs: number`
  - `selfRating: number (1-5)`
- `POST /session/:userId/:sessionId/help`
  - `questionIndex: number`
- `POST /session/:userId/:sessionId/reveal`
  - `questionIndex: number`
- `POST /session/:userId/:sessionId/pause`
  - `questionIndex: number`
  - `elapsedMs: number`

## Response Schemas

- `GET /health` -> `{ status: 'ok', service: 'aplc-server' }`
- `GET /users` -> `{ users: [{ id, name }] }`
- `GET /config/openai` -> `{ configured: boolean }`
- `GET /config/auth` -> `{ googleConfigured: boolean, googleClientId: string | null }`
- `POST /auth/google` -> `{ token, user: { email, name, picture?, userId } }`
- `GET /auth/session` -> `{ user: { email, name, picture?, userId } }`
- `GET /dashboard/:userId` -> `{ totalSessions, overallAccuracy, avgTimePerQuestion, currentStreak, activityDays[], progressInsights? }`
  - `progressInsights`: `{ trend: 'improving'|'declining'|'steady'|'new', trendLabel, recentAccuracy, bestAccuracy, totalQuestionsAnswered, message }` (only present when ≥1 completed session exists)
- `GET /sessions/in-progress/:userId` -> `{ sessions: [{ sessionId, startedAt, questionsAnswered, totalQuestions, accuracy, subject }] }`
- `GET /insights/:userId` -> `{ hasEnoughData, message, strengths[], improvements[] }`
- `POST /session/start` -> `{ sessionId, subject, questionCount, questions[], answers[], currentIndex, totalTokensUsed }`
- `GET /session/:userId/:sessionId` -> `{ sessionId, subject, status, currentIndex, questions[], answers[], totalTokensUsed }`
- `POST /answer` -> `{ isCorrect, explanation, currentIndex, status, answers[], questions[], totalTokensUsed }`
- `POST /help` -> `{ helpSteps[], helpSource, totalTokensUsed }`
- `POST /reveal` -> `{ correctAnswer, explanation, currentIndex, answers[], questions[] }`
- `POST /pause` -> `{ ok, answers[] }`

## Error Models

- `400` for validation issues (invalid input, invalid question index, out-of-order submit).
- `401` when authentication is required or session token is expired/invalid.
- `403` when authenticated user tries to access another user's data.
- `404` when user profile or session is missing.
- `429` when rate limit is exceeded (includes `Retry-After` header).
- `502` when OpenAI hint generation fails.
- `503` when Google auth endpoint is called but auth is not configured.
- `500` for unhandled runtime issues.

## Rate Limits

| Endpoint pattern | Limit | Window |
|---|---|---|
| `/auth/google` | 20 requests | 10 minutes |
| `/session/:u/:s/help` | 30 requests | 60 seconds |
| `/session/:u/:s/reveal` | 30 requests | 60 seconds |
| `/session/:u/:s/answer` | 120 requests | 60 seconds |

Rate limiting is IP-based. Exceeding the limit returns 429 with a `Retry-After` header.

## Versioning Notes

- Phase 1 is unversioned for rapid iteration.
- App is deployed to Azure Container Apps at `https://aplc-app.redriver-82b9ce7a.eastus.azurecontainerapps.io`.
- Same API surface serves both local development and production.
- CORS restricted to explicit origin allowlist (localhost dev ports + configured `CORS_ALLOWED_ORIGINS`).
