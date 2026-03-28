import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionRecord } from '../src/types'

type TestAppContext = {
  app: import('express').Express
  dataRoot: string
  cleanup: () => Promise<void>
  createAuthToken: () => string
}

type SetupOptions = {
  googleAuth?: boolean
}

const TEST_PROFILE = {
  id: 'adi',
  name: 'Adi',
  learningFocus: 'Decimals, fractions & percentages',
  timezone: 'Asia/Singapore',
  notes: 'Test profile',
}

export async function setupTestApp(options: SetupOptions = {}): Promise<TestAppContext> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aplc-server-test-'))
  const dataRoot = path.join(tempRoot, 'data')
  const sessionDir = path.join(dataRoot, 'users', 'adi', 'sessions')
  await fs.mkdir(sessionDir, { recursive: true })
  await fs.writeFile(
    path.join(dataRoot, 'users', 'adi', 'profile.json'),
    JSON.stringify(TEST_PROFILE, null, 2),
    'utf8',
  )

  process.env.NODE_ENV = 'test'
  process.env.DATA_ROOT = dataRoot

  if (options.googleAuth) {
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com'
    process.env.AUTH_ALLOWED_EMAIL = 'adi@gmail.com'
    process.env.AUTH_SESSION_SECRET = 'test-session-secret'
  } else {
    process.env.GOOGLE_CLIENT_ID = ''
    process.env.AUTH_ALLOWED_EMAIL = ''
    process.env.AUTH_SESSION_SECRET = ''
  }
  process.env.OPENAI_API_KEY = ''
  delete process.env.AZURE_OPENAI_ENDPOINT
  delete process.env.AZURE_OPENAI_API_KEY
  delete process.env.AZURE_OPENAI_DEPLOYMENT
  delete process.env.AZURE_OPENAI_API_VERSION

  const serverModule = await import('../src/index')
  const authModule = await import('../src/auth')
  serverModule.resetInMemoryState()

  return {
    app: serverModule.app,
    dataRoot,
    createAuthToken: () =>
      authModule.createSessionToken({
        email: 'adi@gmail.com',
        name: 'Adi',
        userId: 'adi',
      }),
    cleanup: async () => {
      serverModule.resetInMemoryState()
      delete process.env.DATA_ROOT
      delete process.env.GOOGLE_CLIENT_ID
      delete process.env.AUTH_ALLOWED_EMAIL
      delete process.env.AUTH_SESSION_SECRET
      delete process.env.OPENAI_API_KEY
      delete process.env.AZURE_OPENAI_ENDPOINT
      delete process.env.AZURE_OPENAI_API_KEY
      delete process.env.AZURE_OPENAI_DEPLOYMENT
      delete process.env.AZURE_OPENAI_API_VERSION
      await fs.rm(tempRoot, { recursive: true, force: true })
    },
  }
}

export async function readSavedSession(dataRoot: string, sessionId: string): Promise<SessionRecord> {
  const raw = await fs.readFile(
    path.join(dataRoot, 'users', 'adi', 'sessions', `${sessionId}.json`),
    'utf8',
  )
  return JSON.parse(raw) as SessionRecord
}

export async function writeSession(dataRoot: string, session: SessionRecord): Promise<void> {
  const filePath = path.join(dataRoot, 'users', session.userId, 'sessions', `${session.id}.json`)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8')
}
