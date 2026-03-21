# API Contracts

## Conventions

- Base URL (local): `http://localhost:3001`
- Content type: JSON for request/response bodies.
- Error format: `{ "error": "message" }`

## Endpoints

- `GET /health`
- `GET /users`
- `GET /dashboard/:userId`
- `GET /insights/:userId`
- `POST /session/start`
- `GET /session/:userId/:sessionId`
- `POST /session/:userId/:sessionId/answer`
- `POST /session/:userId/:sessionId/help`
- `POST /session/:userId/:sessionId/reveal`
- `POST /session/:userId/:sessionId/pause`
- `GET /sessions/in-progress/:userId`
- `GET /config/openai`

## Request Schemas

- `POST /session/start`
  - `userId: string`
  - `questionCount?: number (10-15 clamped)`
- `POST /session/:userId/:sessionId/answer`
  - `questionIndex: number`
  - `answer: string | number`
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

- `GET /users` -> `{ users: [{ id, name }] }`
- `GET /dashboard/:userId` -> `{ totalSessions, overallAccuracy, avgTimePerQuestion, currentStreak, activityDays[], progressInsights? }`
  - `progressInsights`: `{ trend: 'improving'|'declining'|'steady'|'new', trendLabel, recentAccuracy, bestAccuracy, totalQuestionsAnswered, message }` (only present when ≥1 completed session exists)
- `GET /sessions/in-progress/:userId` -> `{ session: { sessionId, startedAt, questionsAnswered, totalQuestions, accuracy } | null }`
- `GET /insights/:userId` -> `{ hasEnoughData, message, strengths[], improvements[] }`
- `POST /session/start` -> `{ sessionId, questionCount, questions[], answers[], currentIndex }`
- `GET /session/:userId/:sessionId` -> `{ sessionId, status, currentIndex, questions[], answers[] }`
- `POST /answer` -> `{ isCorrect, explanation, currentIndex, status, answers[] }`
- `POST /help` -> `{ helpSteps[], helpSource }`
- `POST /reveal` -> `{ correctAnswer, explanation, currentIndex, answers[] }`
- `POST /pause` -> `{ ok, answers[] }`
- `GET /config/openai` -> `{ configured: boolean }`

## Error Models

- `400` for validation issues (invalid input, invalid question index, out-of-order submit).
- `404` when user profile or session is missing.
- `502` when OpenAI hint generation fails.
- `500` for unhandled runtime issues.

## Versioning Notes

- Phase 1 is unversioned for rapid local iteration.
- Introduce `/api/v1` prefix before public/cloud rollout.
