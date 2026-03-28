import type { ReleaseInfo } from '../lib/releaseInfo'

export const embeddedReleaseInfo = {
  "version": "0.6.42",
  "channel": "beta",
  "displayLabel": "v0.6.42 beta",
  "shortSha": "e7a36d3",
  "releaseDate": "2026-03-28",
  "headline": "Restore release metadata and add developer credit",
  "changes": [
    {
      "sha": "e7a36d3",
      "date": "2026-03-28",
      "summary": "Restore release metadata and add developer credit"
    },
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
    }
  ]
} satisfies ReleaseInfo
