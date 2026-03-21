# Database Design

## Entities

- `UserProfile`: learner identity and learning metadata.
- `SessionRecord`: one practice session containing generated questions and answer states.
- `QuestionState`: per-question progress and telemetry (time, rating, reveal/help usage).

## Schemas

- `profile.json`
  - `id`, `name`, `learningFocus`, `timezone`, `notes`
- `sessions/<sessionId>.json`
  - `id`, `userId`, `status`, `startedAt`, `completedAt`, `currentIndex`, `questions[]`, `answers[]`
- `insights.txt`
  - refreshed plain-text insight summary used by the dashboard

## Folder Structure

- `data/users/<userId>/profile.json`
- `data/users/<userId>/sessions/<sessionId>.json`
- `data/users/<userId>/insights.txt`
- `data/logs/YYYYMMDDHHMMSS.json` — structured activity & OpenAI call logs (in progress)

## Naming Conventions

- User IDs: lowercase slug-like strings (example: `adi`).
- Session IDs: UUID strings.
- Question IDs: deterministic session-local IDs (`q-1`, `q-2`, ...).
- Log files: `YYYYMMDDHHMMSS.json` timestamp-based names for easy identification.

## Future Migration Notes

- Current phase intentionally avoids a database and uses filesystem JSON storage.
- If cloud constraints require DB later, first-choice option is Azure SQL for simple Azure setup.
- Keep API contract stable and introduce a storage adapter when migrating.
