import type { ReleaseInfo } from '../lib/releaseInfo'

export const embeddedReleaseInfo = {
  "version": "0.6.43",
  "channel": "beta",
  "displayLabel": "v0.6.43 beta",
  "shortSha": "b14a046",
  "releaseDate": "2026-03-28",
  "headline": "Preserve release metadata in image builds",
  "changes": [
    {
      "sha": "b14a046",
      "date": "2026-03-28",
      "summary": "Preserve release metadata in image builds"
    },
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
    }
  ]
} satisfies ReleaseInfo
