import type { ReleaseInfo } from '../lib/releaseInfo'

export const embeddedReleaseInfo = {
  "version": "0.6.44",
  "channel": "beta",
  "displayLabel": "v0.6.44 beta",
  "shortSha": "a9420c6",
  "releaseDate": "2026-03-28",
  "headline": "Fetch full history for release metadata",
  "changes": [
    {
      "sha": "a9420c6",
      "date": "2026-03-28",
      "summary": "Fetch full history for release metadata"
    },
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
    }
  ]
} satisfies ReleaseInfo
