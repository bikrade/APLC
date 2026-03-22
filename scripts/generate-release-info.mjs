import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const outputPath = path.join(repoRoot, 'client', 'src', 'generated', 'releaseInfo.ts')

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

function writeReleaseInfoFile(releaseInfo) {
  const contents = `export const releaseInfo = ${JSON.stringify(releaseInfo, null, 2)} as const\n`
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, contents)
}

try {
  writeReleaseInfoFile(buildReleaseInfo())
  console.log(`release info synced -> ${path.relative(repoRoot, outputPath)}`)
} catch (error) {
  if (fs.existsSync(outputPath)) {
    console.warn('release info sync skipped, using existing file')
    process.exit(0)
  }

  console.error('failed to generate release info')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
