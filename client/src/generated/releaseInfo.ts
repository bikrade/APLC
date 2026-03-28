import type { ReleaseInfo } from '../lib/releaseInfo'

export const embeddedReleaseInfo = {
  "version": "0.6.45",
  "channel": "beta",
  "displayLabel": "v0.6.45 beta",
  "shortSha": "288559a",
  "releaseDate": "2026-03-28",
  "headline": "Refresh top developer banner",
  "changes": [
    {
      "sha": "288559a",
      "date": "2026-03-28",
      "summary": "Refresh top developer banner"
    },
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
    }
  ]
} satisfies ReleaseInfo
