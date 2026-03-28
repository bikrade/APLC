import fs from 'node:fs/promises'
import path from 'node:path'
import type { SessionRecord, Subject, UserProfile } from './types'
import {
  isBlobStorageConfigured,
  blobUserProfileExists,
  blobReadUserProfile,
  blobSaveSession,
  blobReadSession,
  blobDeleteSession,
  blobListAllSessions,
  blobReadInsightsText,
  blobSaveInsightsText,
  blobReadUserIds,
  blobDeleteLegacySessionFiles,
} from './blobStorage'

const DATA_ROOT = path.resolve(process.env.DATA_ROOT || path.resolve(__dirname, '../../data'))
const USERS_ROOT = path.join(DATA_ROOT, 'users')
const USER_ID_PATTERN = /^[a-z0-9_-]{1,64}$/i
const SESSION_ID_PATTERN = /^\d{8}-\d{6}(?:\d{3})?-(Multiplication|Division|Reading)$/
const useBlob = isBlobStorageConfigured()

function assertSafeUserId(userId: string): void {
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error('Invalid userId')
  }
}

function assertSafeSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Invalid sessionId')
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

async function getSessionFiles(userId: string): Promise<string[]> {
  assertSafeUserId(userId)
  const userDir = path.join(USERS_ROOT, userId, 'sessions')
  await ensureDir(userDir)
  const files = await fs.readdir(userDir)
  return files.filter((file) => file.endsWith('.json'))
}

export async function readUserProfile(userId: string): Promise<UserProfile> {
  assertSafeUserId(userId)
  if (useBlob) return blobReadUserProfile(userId)
  const filePath = path.join(USERS_ROOT, userId, 'profile.json')
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as UserProfile
}

export async function userProfileExists(userId: string): Promise<boolean> {
  assertSafeUserId(userId)
  if (useBlob) return blobUserProfileExists(userId)
  try {
    await fs.access(path.join(USERS_ROOT, userId, 'profile.json'))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export async function saveSession(session: SessionRecord): Promise<void> {
  assertSafeUserId(session.userId)
  assertSafeSessionId(session.id)
  if (useBlob) return blobSaveSession(session)
  const userDir = path.join(USERS_ROOT, session.userId, 'sessions')
  await ensureDir(userDir)
  const sessionPath = path.join(userDir, `${session.id}.json`)
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8')
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  assertSafeUserId(userId)
  assertSafeSessionId(sessionId)
  if (useBlob) return blobDeleteSession(userId, sessionId)
  const sessionPath = path.join(USERS_ROOT, userId, 'sessions', `${sessionId}.json`)
  try {
    await fs.unlink(sessionPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

export async function deleteLegacySessionFiles(userId: string): Promise<void> {
  assertSafeUserId(userId)
  if (useBlob) return blobDeleteLegacySessionFiles(userId)
  const userDir = path.join(USERS_ROOT, userId, 'sessions')
  const files = await getSessionFiles(userId)
  await Promise.all(
    files
      .filter((file) => !SESSION_ID_PATTERN.test(path.basename(file, '.json')))
      .map((file) => fs.unlink(path.join(userDir, file))),
  )
}

export async function pruneActiveSessionsForSubject(userId: string, subject: Subject): Promise<SessionRecord | null> {
  assertSafeUserId(userId)
  const sessions = await listAllSessions(userId)
  const activeForSubject = sessions
    .filter((session) => session.subject === subject && session.status === 'active')
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

  const latest = activeForSubject[0] ?? null
  await Promise.all(
    activeForSubject
      .slice(1)
      .map((session) => deleteSession(userId, session.id)),
  )
  return latest
}

export async function readInsightsText(userId: string): Promise<string | null> {
  assertSafeUserId(userId)
  if (useBlob) return blobReadInsightsText(userId)
  try {
    const insightsPath = path.join(USERS_ROOT, userId, 'insights.txt')
    return await fs.readFile(insightsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function saveInsightsText(userId: string, content: string): Promise<void> {
  assertSafeUserId(userId)
  if (useBlob) return blobSaveInsightsText(userId, content)
  const userDir = path.join(USERS_ROOT, userId)
  await ensureDir(userDir)
  const insightsPath = path.join(userDir, 'insights.txt')
  await fs.writeFile(insightsPath, content, 'utf8')
}

export async function readSession(
  userId: string,
  sessionId: string,
): Promise<SessionRecord> {
  assertSafeUserId(userId)
  assertSafeSessionId(sessionId)
  if (useBlob) return blobReadSession(userId, sessionId)
  const sessionPath = path.join(USERS_ROOT, userId, 'sessions', `${sessionId}.json`)
  const raw = await fs.readFile(sessionPath, 'utf8')
  return JSON.parse(raw) as SessionRecord
}

export async function readUserIds(): Promise<string[]> {
  if (useBlob) return blobReadUserIds()
  await ensureDir(USERS_ROOT)
  const entries = await fs.readdir(USERS_ROOT, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && USER_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
}

export async function listRecentSessions(
  userId: string,
  limit = 3,
): Promise<SessionRecord[]> {
  assertSafeUserId(userId)
  if (useBlob) {
    const all = await blobListAllSessions(userId)
    return all.slice(0, limit)
  }
  const userDir = path.join(USERS_ROOT, userId, 'sessions')
  const jsonFiles = (await getSessionFiles(userId)).filter((f) => SESSION_ID_PATTERN.test(path.basename(f, '.json')))
  const sessions = await Promise.all(
    jsonFiles.map(async (file) => {
      const raw = await fs.readFile(path.join(userDir, file), 'utf8')
      return JSON.parse(raw) as SessionRecord
    }),
  )
  return sessions
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit)
}

export async function listAllSessions(
  userId: string,
): Promise<SessionRecord[]> {
  assertSafeUserId(userId)
  if (useBlob) return blobListAllSessions(userId)
  const userDir = path.join(USERS_ROOT, userId, 'sessions')
  const jsonFiles = (await getSessionFiles(userId)).filter((f) => SESSION_ID_PATTERN.test(path.basename(f, '.json')))
  const sessions = await Promise.all(
    jsonFiles.map(async (file) => {
      const raw = await fs.readFile(path.join(userDir, file), 'utf8')
      return JSON.parse(raw) as SessionRecord
    }),
  )
  return sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
}
