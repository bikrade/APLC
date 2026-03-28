import type { ReleaseInfo } from '../lib/releaseInfo'

export const embeddedReleaseInfo = {
  "version": "0.6.41",
  "channel": "beta",
  "displayLabel": "v0.6.41 beta",
  "shortSha": "4ca0e25",
  "releaseDate": "2026-03-28",
  "headline": "Stabilize reading flow e2e assertion",
  "changes": [
    {
      "sha": "4ca0e25",
      "date": "2026-03-28",
      "summary": "Stabilize reading flow e2e assertion"
    },
    {
      "sha": "68c2965",
      "date": "2026-03-28",
      "summary": "Harden post-deploy readiness verification"
    },
    {
      "sha": "74486a6",
      "date": "2026-03-28",
      "summary": "Fix reading session startup and readiness checks"
    },
    {
      "sha": "4bc2d87",
      "date": "2026-03-28",
      "summary": "Harden reading AI generation retries"
    }
  ]
} satisfies ReleaseInfo
