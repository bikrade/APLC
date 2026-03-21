import fs from 'node:fs/promises'
import path from 'node:path'

const rootDir = path.resolve(new URL('..', import.meta.url).pathname)
const dataRoot = path.join(rootDir, '.tmp', 'e2e-data')
const userDir = path.join(dataRoot, 'users', 'adi')
const sessionsDir = path.join(userDir, 'sessions')

await fs.rm(dataRoot, { recursive: true, force: true })
await fs.mkdir(sessionsDir, { recursive: true })
await fs.writeFile(
  path.join(userDir, 'profile.json'),
  JSON.stringify(
    {
      id: 'adi',
      name: 'Adi',
      learningFocus: 'Decimals, fractions & percentages',
      timezone: 'Asia/Singapore',
      notes: 'E2E test profile',
    },
    null,
    2,
  ),
  'utf8',
)
