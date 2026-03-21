# Database Design

## Entities

- `UserProfile`: learner identity and learning metadata.
- `SessionRecord`: one practice session containing generated questions and answer states.
- `QuestionState`: per-question progress and telemetry (time, rating, reveal/help usage).

## Schemas

- `profile.json`
  - `id`, `name`, `learningFocus`, `timezone`, `notes`
- `sessions/<sessionId>.json`
  - `id`, `userId`, `subject` (Multiplication | Division | Reading), `status` (active | completed), `startedAt`, `completedAt?`, `currentIndex`, `questions[]`, `answers[]`, `totalTokensUsed`
  - Each question: `id`, `prompt`, `type`, `kind?` (math | reading-page | reading-summary), `answer`, `tolerance`, `helpSteps[]`, `explanation`, `generated`, `title?`, `content?`, `wordCount?`
  - Each answer: `questionId`, `questionIndex`, `completed`, `isCorrect?`, `usedHelp`, `usedReveal`, `elapsedMs`, `userAnswer?`, `userTextAnswer?`, `selfRating?`, `readingScore?`, `comprehensionScore?`, `speedScore?`, `readingWpm?`
- `insights.txt`
  - Plain-text file with `[Going Well]` and `[Focus Areas]` sections; refreshed after each completed session

## Folder Structure

- `data/users/<userId>/profile.json`
- `data/users/<userId>/sessions/<sessionId>.json`
- `data/users/<userId>/insights.txt`
- `data/runtime/` — PID files and logs for local helper scripts (gitignored)

## Naming Conventions

- User IDs: lowercase alphanumeric with hyphens/underscores, max 64 chars (regex: `/^[a-z0-9_-]{1,64}$/i`).
- Session IDs: timestamp + subject format `YYYYMMDD-HHMMSS-<Subject>` (e.g. `20260321-143005-Multiplication`).
- Question IDs: sequential session-local IDs (`q-1`, `q-2`, ...).

## Future Migration Notes

- Current phase intentionally avoids a database and uses filesystem JSON storage.
- If cloud constraints require DB later, first-choice option is Azure SQL for simple Azure setup.
- Keep API contract stable and introduce a storage adapter when migrating.
