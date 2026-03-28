import test from 'node:test'
import assert from 'node:assert/strict'

import { parseEmbeddedReleaseInfoModule } from './generate-release-info.mjs'

test('parseEmbeddedReleaseInfoModule reads the committed embedded release info payload', () => {
  const moduleContents = `import type { ReleaseInfo } from '../lib/releaseInfo'

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
    }
  ]
} satisfies ReleaseInfo
`

  assert.deepEqual(parseEmbeddedReleaseInfoModule(moduleContents), {
    version: '0.6.42',
    channel: 'beta',
    displayLabel: 'v0.6.42 beta',
    shortSha: 'e7a36d3',
    releaseDate: '2026-03-28',
    headline: 'Restore release metadata and add developer credit',
    changes: [
      {
        sha: 'e7a36d3',
        date: '2026-03-28',
        summary: 'Restore release metadata and add developer credit',
      },
    ],
  })
})

test('parseEmbeddedReleaseInfoModule rejects unexpected module contents', () => {
  assert.throws(
    () => parseEmbeddedReleaseInfoModule('export const nope = {}'),
    /expected format/,
  )
})