import { BlobServiceClient } from '@azure/storage-blob'
import { DefaultAzureCredential } from '@azure/identity'
import type { SessionRecord, UserProfile } from './types'
import { logger } from './logger'

const ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT || ''
const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER || 'userdata'

let clientInstance: BlobServiceClient | null = null

function getClient(): BlobServiceClient {
  if (!clientInstance) {
    const url = `https://${ACCOUNT_NAME}.blob.core.windows.net`
    clientInstance = new BlobServiceClient(url, new DefaultAzureCredential())
  }
  return clientInstance
}

function container() {
  return getClient().getContainerClient(CONTAINER_NAME)
}

function sessionBlobPath(userId: string, sessionId: string): string {
  return `users/${userId}/sessions/${sessionId}.json`
}

function profileBlobPath(userId: string): string {
  return `users/${userId}/profile.json`
}

function insightsBlobPath(userId: string): string {
  return `users/${userId}/insights.txt`
}

async function blobExists(blobPath: string): Promise<boolean> {
  return container().getBlockBlobClient(blobPath).exists()
}

async function readBlob(blobPath: string): Promise<string> {
  const blob = container().getBlockBlobClient(blobPath)
  const response = await blob.download(0)
  const chunks: Buffer[] = []
  for await (const chunk of response.readableStreamBody!) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function writeBlob(blobPath: string, content: string): Promise<void> {
  const blob = container().getBlockBlobClient(blobPath)
  await blob.upload(content, Buffer.byteLength(content), {
    blobHTTPHeaders: {
      blobContentType: blobPath.endsWith('.json') ? 'application/json' : 'text/plain',
    },
  })
}

async function deleteBlob(blobPath: string): Promise<void> {
  const blob = container().getBlockBlobClient(blobPath)
  await blob.deleteIfExists()
}

export async function blobUserProfileExists(userId: string): Promise<boolean> {
  return blobExists(profileBlobPath(userId))
}

export async function blobReadUserProfile(userId: string): Promise<UserProfile> {
  const raw = await readBlob(profileBlobPath(userId))
  return JSON.parse(raw) as UserProfile
}

export async function blobSaveSession(session: SessionRecord): Promise<void> {
  const blobPath = sessionBlobPath(session.userId, session.id)
  await writeBlob(blobPath, JSON.stringify(session, null, 2))
}

export async function blobReadSession(userId: string, sessionId: string): Promise<SessionRecord> {
  const raw = await readBlob(sessionBlobPath(userId, sessionId))
  return JSON.parse(raw) as SessionRecord
}

export async function blobDeleteSession(userId: string, sessionId: string): Promise<void> {
  await deleteBlob(sessionBlobPath(userId, sessionId))
}

export async function blobListAllSessions(userId: string): Promise<SessionRecord[]> {
  const prefix = `users/${userId}/sessions/`
  const sessions: SessionRecord[] = []
  for await (const blob of container().listBlobsFlat({ prefix })) {
    if (!blob.name.endsWith('.json')) continue
    try {
      const raw = await readBlob(blob.name)
      sessions.push(JSON.parse(raw) as SessionRecord)
    } catch (err) {
      logger.warn('Failed to read session blob', { blob: blob.name, error: String(err) })
    }
  }
  return sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
}

export async function blobReadInsightsText(userId: string): Promise<string | null> {
  const blobPath = insightsBlobPath(userId)
  if (!(await blobExists(blobPath))) return null
  return readBlob(blobPath)
}

export async function blobSaveInsightsText(userId: string, content: string): Promise<void> {
  await writeBlob(insightsBlobPath(userId), content)
}

export async function blobReadUserIds(): Promise<string[]> {
  const userIds = new Set<string>()
  for await (const blob of container().listBlobsFlat({ prefix: 'users/' })) {
    const parts = blob.name.split('/')
    if (parts.length >= 2 && parts[0] === 'users' && parts[1]) {
      userIds.add(parts[1])
    }
  }
  return Array.from(userIds)
}

export async function blobDeleteLegacySessionFiles(_userId: string): Promise<void> {
  void _userId
  // No-op for blob storage — legacy files only exist on local filesystem
}

export function isBlobStorageConfigured(): boolean {
  return !!ACCOUNT_NAME
}
