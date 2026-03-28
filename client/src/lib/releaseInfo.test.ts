import { describe, expect, it } from 'vitest'
import { getReleaseInfoCandidates, isReleaseInfo, LOCAL_RELEASE_INFO, mergeReleaseInfo } from './releaseInfo'

describe('releaseInfo helpers', () => {
  it('recognizes valid release info payloads', () => {
    expect(isReleaseInfo({
      version: '0.6.41',
      channel: 'beta',
      displayLabel: 'v0.6.41 beta',
      shortSha: '4ca0e25',
      releaseDate: '2026-03-28',
      headline: 'Example release',
      changes: [{ sha: '4ca0e25', date: '2026-03-28', summary: 'Example release' }],
    })).toBe(true)
  })

  it('deduplicates release info fetch candidates', () => {
    expect(getReleaseInfoCandidates('/')).toEqual(['/release-info.json'])
    expect(getReleaseInfoCandidates('/app/')).toEqual(['/app/release-info.json', '/release-info.json'])
  })

  it('falls back to embedded changes when runtime payload is incomplete', () => {
    const merged = mergeReleaseInfo({
      version: '0.6.41',
      channel: 'beta',
      displayLabel: 'v0.6.41 beta',
      shortSha: '4ca0e25',
      releaseDate: '2026-03-28',
      headline: 'Runtime metadata',
      changes: [],
    }, {
      ...LOCAL_RELEASE_INFO,
      displayLabel: 'v0.6.40 beta',
      shortSha: '68c2965',
      headline: 'Embedded metadata',
      changes: [
        { sha: '68c2965', date: '2026-03-28', summary: 'Embedded metadata' },
      ],
    })

    expect(merged.displayLabel).toBe('v0.6.41 beta')
    expect(merged.changes).toHaveLength(1)
    expect(merged.changes[0]?.sha).toBe('68c2965')
  })
})