import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const publicOutputPath = path.join(repoRoot, 'client', 'public', 'release-info.json')
const embeddedOutputPath = path.join(repoRoot, 'client', 'src', 'generated', 'releaseInfo.ts')

function runGit(command) {
  return execSync(command, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function prettifyCommitSubject(subject) {
  const withoutPrefix = subject.replace(/^([a-z]+)(\([^)]+\))?:\s*/i, '').trim()
  const normalized = withoutPrefix
    .replace(/\bSPA\b/g, 'SPA')
    .replace(/\bCI\/CD\b/g, 'CI/CD')
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function buildReleaseInfo() {
  const commitSubjects = runGit('git log --format=%s').split('\n').filter(Boolean)
  const recentCommits = runGit('git log --format=%h%x09%ad%x09%s --date=short -4')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, date, subject] = line.split('\t')
      return {
        sha,
        date,
        subject,
        label: prettifyCommitSubject(subject),
      }
    })

  const featureCount = commitSubjects.filter((subject) => /^feat(\(|:)/i.test(subject)).length
  let patchCount = 0
  for (const subject of commitSubjects) {
    if (/^feat(\(|:)/i.test(subject)) break
    patchCount += 1
  }

  const latest = recentCommits[0]
  return {
    version: `0.${Math.max(featureCount, 1)}.${patchCount}`,
    channel: 'beta',
    displayLabel: `v0.${Math.max(featureCount, 1)}.${patchCount} beta`,
    shortSha: latest?.sha ?? 'local',
    releaseDate: latest?.date ?? '',
    headline: latest?.label ?? 'Latest release',
    changes: recentCommits.map((commit) => ({
      sha: commit.sha,
      date: commit.date,
      summary: commit.label,
    })),
  }
}

function buildLocalFallbackReleaseInfo() {
  return {
    version: '0.0.0',
    channel: 'local',
    displayLabel: 'Local build',
    shortSha: 'local',
    releaseDate: '',
    headline: 'Latest release info unavailable',
    changes: [],
  }
}

function writePublicReleaseInfoFile(releaseInfo) {
  const contents = `${JSON.stringify(releaseInfo, null, 2)}\n`
  fs.mkdirSync(path.dirname(publicOutputPath), { recursive: true })
  fs.writeFileSync(publicOutputPath, contents)
}

function writeEmbeddedReleaseInfoModule(releaseInfo) {
  const moduleContents = `import type { ReleaseInfo } from '../lib/releaseInfo'\n\nexport const embeddedReleaseInfo = ${JSON.stringify(releaseInfo, null, 2)} satisfies ReleaseInfo\n`
  fs.mkdirSync(path.dirname(embeddedOutputPath), { recursive: true })
  fs.writeFileSync(embeddedOutputPath, moduleContents)
}

try {
  const releaseInfo = buildReleaseInfo()
  writePublicReleaseInfoFile(releaseInfo)
  writeEmbeddedReleaseInfoModule(releaseInfo)
  console.log(`release info synced -> ${path.relative(repoRoot, publicOutputPath)} and ${path.relative(repoRoot, embeddedOutputPath)}`)
} catch (error) {
  const fallbackReleaseInfo = buildLocalFallbackReleaseInfo()
  writePublicReleaseInfoFile(fallbackReleaseInfo)
  writeEmbeddedReleaseInfoModule(fallbackReleaseInfo)
  console.warn('release info sync fell back to local metadata')
  console.warn(error instanceof Error ? error.message : String(error))
  process.exit(0)
}
