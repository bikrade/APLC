# Database Design

## Entities

- `UserProfile`: learner identity and learning metadata.
- `SessionRecord`: one practice session containing generated questions and answer states.
- `QuestionState`: per-question progress and telemetry (time, reveal/help usage, attempts, reading metrics).

## Schemas

- `profile.json`
  - `id`, `name`, `learningFocus`, `timezone`, `notes`
- `sessions/<sessionId>.json`
  - `id`, `userId`, `subject` (Multiplication | Division | Reading), `sessionMode?` (`guided` | `quiz`), `status` (active | completed), `startedAt`, `completedAt?`, `currentIndex`, `questions[]`, `answers[]`, `totalTokensUsed`, `adaptiveDifficultyLevel?`, `adaptiveMomentum?`
  - Each question: `id`, `prompt`, `type`, `kind?` (math | reading-page | reading-summary | reading-quiz), `answer`, `tolerance`, `helpSteps[]`, `explanation`, `generated`, `title?`, `content?`, `wordCount?`, `quizItems?`
  - Each answer: `questionId`, `questionIndex`, `completed`, `isCorrect?`, `usedHelp`, `usedReveal`, `elapsedMs`, `userAnswer?`, `userTextAnswer?`, `selectedOptions?`, `attemptCount?`, `firstAttemptCorrect?`, `readingScore?`, `comprehensionScore?`, `speedScore?`, `readingWpm?`
- `insights.txt`
  - JSON payload persisted as text for the dashboard insights view; refreshed after each completed session

## Folder Structure

### Local (filesystem mode)

- `data/users/<userId>/profile.json`
- `data/users/<userId>/sessions/<sessionId>.json`
- `data/users/<userId>/insights.txt`
- `data/runtime/` — PID files and logs for local helper scripts (gitignored)

### Production (Azure Blob Storage mode)

- Storage account: `aplcfiles2026`, blob container: `userdata`
- `users/<userId>/profile.json`
- `users/<userId>/sessions/<sessionId>.json`
- `users/<userId>/insights.txt`
- Authentication: `DefaultAzureCredential` (system-assigned managed identity, no shared keys)
- Mode auto-selected: if `AZURE_STORAGE_ACCOUNT` env var is set, all storage operations use Blob Storage; otherwise filesystem

## Naming Conventions

- User IDs: lowercase alphanumeric with hyphens/underscores, max 64 chars (regex: `/^[a-z0-9_-]{1,64}$/i`).
- Session IDs: timestamp + subject format `YYYYMMDD-HHMMSS-<Subject>` (e.g. `20260321-143005-Multiplication`).
- Question IDs: sequential session-local IDs (`q-1`, `q-2`, ...).

## Future Migration Notes

- Local development uses filesystem JSON storage; production uses Azure Blob Storage with managed identity.
- Storage adapter pattern (`server/src/storage.ts`) delegates to either `blobStorage.ts` or filesystem functions based on `AZURE_STORAGE_ACCOUNT` env var.
- If cloud constraints require a database later, first-choice option is Azure SQL for simple Azure setup.
- Keep API contract stable and introduce additional storage adapters as needed.
