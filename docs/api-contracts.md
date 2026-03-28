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
- `DELETE /sessions/in-progress/:userId/:sessionId`
- `POST /session/start`
- `GET /session/:userId/:sessionId`
- `POST /session/:userId/:sessionId/answer`
- `POST /session/:userId/:sessionId/help`
- `POST /session/:userId/:sessionId/reveal`
- `POST /session/:userId/:sessionId/pause`

Reset / restart note:

- The app uses `DELETE /sessions/in-progress/:userId/:sessionId` when the learner chooses `Reset And Start Fresh` on a subject card.
- This deletes the saved active session so the next `POST /session/start` creates a fresh session with the latest question-generation and UI behavior.

## Request Schemas

- `POST /auth/google`
  - `credential: string` (Google ID token)
- `POST /session/start`
  - `userId: string` (ignored when Google auth is active; derived from token)
  - `questionCount?: number (10-15 clamped; ignored for Reading)`
  - `subject?: string ('Multiplication' | 'Division' | 'Reading', default 'Multiplication')`
  - `sessionMode?: 'guided' | 'quiz'` (default `guided`)
- `POST /session/:userId/:sessionId/answer`
  - `questionIndex: number`
  - `answer: string | number` (number or fraction string for math; text summary for reading summary mode)
  - `readingQuizAnswers?: number[]` (required when the final reading assessment is in quiz mode)
  - `elapsedMs: number`
- `POST /session/:userId/:sessionId/help`
  - `questionIndex: number`
- `POST /session/:userId/:sessionId/reveal`
  - `questionIndex: number`
  - `elapsedMs?: number`
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
- `GET /dashboard/:userId` -> `{ totalSessions, overallAccuracy, avgTimePerQuestion, currentStreak, activityDays[], progressInsights?, dailyPractice, learningCoach }`
  - `progressInsights`: `{ trend: 'improving'|'declining'|'steady'|'new', trendLabel, recentAccuracy, bestAccuracy, totalQuestionsAnswered, message }` (only present when ≥1 completed session exists)
  - `dailyPractice`: `{ targetMs, todayMs, yesterdayMs }`
  - `learningCoach`: landing-page coaching payload assembled from completed history
    - `weeklyMission`: `{ title, subtitle, items[] }`
    - `weeklyMission.items[]`: `{ id, label, detail, status: 'done'|'in-progress'|'up-next' }`
    - `habitSignals[]`: `{ label, value, tone: 'strong'|'steady'|'watch' }`
    - `masteryBySubject[]`: `{ subject, overallStage: 'mastered'|'developing'|'fragile', summary, skills[] }`
    - `masteryBySubject[].skills[]`: `{ key, label, stage, accuracy, evidenceCount }`
    - `revisitQueue[]`: `{ subject, skill, reason, action }`
    - `parentReview`: `{ celebration[], watchlist[], supportMoves[] }`
- `GET /sessions/in-progress/:userId` -> `{ sessions: [{ sessionId, startedAt, questionsAnswered, totalQuestions, accuracy, subject, sessionMode }] }`
- `DELETE /sessions/in-progress/:userId/:sessionId` -> `{ deleted: true, sessionId, subject }`
- `GET /insights/:userId` -> `{ hasEnoughData, message, strengths[], improvements[], recommendedFocus[], bySubject[], overall }`
  - `overall`: `{ completedSessions, totalQuestionsAnswered, strongestSubject, needsAttentionSubject, subjectSessionBreakdown }`
- `POST /session/start` -> `{ sessionId, subject, questionCount, questions[], answers[], currentIndex, totalTokensUsed, difficultyLevel, sessionMode }`
- `GET /session/:userId/:sessionId` -> `{ sessionId, subject, status, currentIndex, questions[], answers[], totalTokensUsed, difficultyLevel, sessionMode }`
- `POST /answer` -> `{ isCorrect, explanation, currentIndex, status, answers[], questions[], totalTokensUsed, difficultyLevel?, adaptiveNotification? }`
  - In `quiz` mode for math, wrong answers are recorded and the session advances immediately without showing instant right/wrong confirmation; the learner reviews results at the end of the session.
- `POST /help` -> `{ helpSteps[], helpSource, totalTokensUsed }`
- `POST /reveal` -> `{ correctAnswer, explanation, currentIndex, status, answers[], questions[], difficultyLevel?, adaptiveNotification? }`
- `POST /pause` -> `{ ok, answers[] }`

## Error Models

- `400` for validation issues (invalid input, invalid question index, out-of-order submit).
- `401` when authentication is required or session token is expired/invalid.
- `403` when authenticated user tries to access another user's data.
- `404` when user profile or session is missing.
- `409` when trying to delete a session that is not currently in progress.
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
- App is deployed to Azure Container Apps behind the current `aplc-app` ingress hostname. Query the active hostname with `az containerapp show -n aplc-app -g aplc-rg --query 'properties.configuration.ingress.fqdn' -o tsv` because the Azure-generated FQDN can change if the environment is recreated.
- Same API surface serves both local development and production.
- CORS restricted to explicit origin allowlist (localhost dev ports + configured `CORS_ALLOWED_ORIGINS`).
