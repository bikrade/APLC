import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionRecord } from '../src/types'
import { AUTH_SESSION_COOKIE_NAME } from '../src/auth'

type TestAppContext = {
  app: import('express').Express
  dataRoot: string
  cleanup: () => Promise<void>
  createAuthToken: () => string
  createAuthCookie: () => string
}

type SetupOptions = {
  googleAuth?: boolean
  clientDist?: boolean
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

  const clientDistDir = path.resolve(process.cwd(), '../client/dist')
  const clientDistExisted = await fs.access(clientDistDir).then(() => true).catch(() => false)
  const authProbePath = path.join(clientDistDir, 'assets', '__auth_probe.js')
  let createdIndexFile = false

  if (options.googleAuth) {
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com'
    process.env.AUTH_ALLOWED_EMAILS = 'adi@gmail.com,parent@gmail.com'
    process.env.AUTH_SESSION_SECRET = 'test-session-secret'
  } else {
    process.env.GOOGLE_CLIENT_ID = ''
    process.env.AUTH_ALLOWED_EMAILS = ''
    process.env.AUTH_SESSION_SECRET = ''
  }
  process.env.OPENAI_API_KEY = ''
  delete process.env.AZURE_OPENAI_ENDPOINT
  delete process.env.AZURE_OPENAI_API_KEY
  delete process.env.AZURE_OPENAI_DEPLOYMENT
  delete process.env.AZURE_OPENAI_API_VERSION

  if (options.clientDist) {
    await fs.mkdir(path.join(clientDistDir, 'assets'), { recursive: true })
    await fs.writeFile(authProbePath, 'window.__AUTH_PROBE__ = true;\n', 'utf8')
    const indexPath = path.join(clientDistDir, 'index.html')
    const indexExists = await fs.access(indexPath).then(() => true).catch(() => false)
    if (!indexExists) {
      await fs.writeFile(indexPath, '<!doctype html><html><body>aplc-test-shell</body></html>\n', 'utf8')
      createdIndexFile = true
    }
  }

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
    createAuthCookie: () => `${AUTH_SESSION_COOKIE_NAME}=${authModule.createSessionToken({
      email: 'adi@gmail.com',
      name: 'Adi',
      userId: 'adi',
    })}`,
    cleanup: async () => {
      serverModule.resetInMemoryState()
      delete process.env.DATA_ROOT
      delete process.env.GOOGLE_CLIENT_ID
      delete process.env.AUTH_ALLOWED_EMAIL
      delete process.env.AUTH_ALLOWED_EMAILS
      delete process.env.AUTH_SESSION_SECRET
      delete process.env.OPENAI_API_KEY
      delete process.env.AZURE_OPENAI_ENDPOINT
      delete process.env.AZURE_OPENAI_API_KEY
      delete process.env.AZURE_OPENAI_DEPLOYMENT
      delete process.env.AZURE_OPENAI_API_VERSION
      if (options.clientDist) {
        await fs.rm(authProbePath, { force: true })
        if (createdIndexFile) {
          await fs.rm(path.join(clientDistDir, 'index.html'), { force: true })
        }
        if (!clientDistExisted) {
          await fs.rm(clientDistDir, { recursive: true, force: true })
        }
      }
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
