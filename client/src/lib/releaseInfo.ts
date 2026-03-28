export type ReleaseChange = {
  sha: string
  date: string
  summary: string
}

export type ReleaseInfo = {
  version: string
  channel: string
  displayLabel: string
  shortSha: string
  releaseDate: string
  headline: string
  changes: ReleaseChange[]
}

export const LOCAL_RELEASE_INFO: ReleaseInfo = {
  version: '0.0.0',
  channel: 'local',
  displayLabel: 'Local build',
  shortSha: 'local',
  releaseDate: '',
  headline: 'Latest release info unavailable',
  changes: [],
}

export function isReleaseInfo(value: unknown): value is ReleaseInfo {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ReleaseInfo>
  return (
    typeof candidate.version === 'string'
    && typeof candidate.channel === 'string'
    && typeof candidate.displayLabel === 'string'
    && typeof candidate.shortSha === 'string'
    && typeof candidate.headline === 'string'
    && typeof candidate.releaseDate === 'string'
    && Array.isArray(candidate.changes)
  )
}

export function mergeReleaseInfo(primary: unknown, fallback: ReleaseInfo): ReleaseInfo {
  if (!isReleaseInfo(primary)) {
    return fallback
  }

  return {
    version: primary.version || fallback.version,
    channel: primary.channel || fallback.channel,
    displayLabel: primary.displayLabel || fallback.displayLabel,
    shortSha: primary.shortSha || fallback.shortSha,
    releaseDate: primary.releaseDate || fallback.releaseDate,
    headline: primary.headline || fallback.headline,
    changes: primary.changes.length > 0 ? primary.changes : fallback.changes,
  }
}

export function getReleaseInfoCandidates(baseUrl: string): string[] {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return Array.from(new Set([
    `${normalizedBaseUrl}release-info.json`,
    '/release-info.json',
  ]))
}