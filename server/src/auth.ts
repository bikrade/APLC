import crypto from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'

export const AUTH_SESSION_COOKIE_NAME = 'aplc_session'
export const AUTH_TOKEN_STORAGE_KEY = 'aplc_auth_token'

type AuthSession = {
  email: string
  name: string
  picture?: string
  userId: string
  exp: number
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

function getGoogleClientId(): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new Error('Missing GOOGLE_CLIENT_ID.')
  }
  return clientId
}

export function getPublicGoogleClientId(): string | null {
  return process.env.GOOGLE_CLIENT_ID || null
}

function getAllowedEmailConfig(): string {
  const configuredEmails = process.env.AUTH_ALLOWED_EMAILS || process.env.AUTH_ALLOWED_EMAIL
  if (!configuredEmails) {
    throw new Error('Missing AUTH_ALLOWED_EMAILS.')
  }
  return configuredEmails
}

export function getAllowedAuthEmails(): string[] {
  return Array.from(new Set(
    getAllowedEmailConfig()
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ))
}

export function isEmailAllowedForSignIn(email: string): boolean {
  return getAllowedAuthEmails().includes(email.trim().toLowerCase())
}

function getSessionSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET
  if (!secret) {
    throw new Error('Missing AUTH_SESSION_SECRET.')
  }
  return secret
}

export function isGoogleAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && (process.env.AUTH_ALLOWED_EMAILS || process.env.AUTH_ALLOWED_EMAIL) && process.env.AUTH_SESSION_SECRET)
}

export async function verifyGoogleCredential(credential: string): Promise<Omit<AuthSession, 'exp'>> {
  const client = new OAuth2Client(getGoogleClientId())
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: getGoogleClientId(),
  })
  const payload = ticket.getPayload()
  const email = payload?.email?.toLowerCase()
  if (!payload || !email || !payload.email_verified) {
    throw new Error('Google account could not be verified.')
  }
  if (!isEmailAllowedForSignIn(email)) {
    throw new Error('This app is only available to approved Google accounts.')
  }

  return {
    email,
    name: payload.name ?? 'Adi',
    userId: 'adi',
    ...(payload.picture ? { picture: payload.picture } : {}),
  }
}

function signPayload(payloadBase64: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(payloadBase64).digest('base64url')
}

export function createSessionToken(session: Omit<AuthSession, 'exp'>, ttlHours = 12): string {
  const payload: AuthSession = {
    ...session,
    exp: Date.now() + ttlHours * 60 * 60 * 1000,
  }
  const payloadBase64 = base64UrlEncode(JSON.stringify(payload))
  const signature = signPayload(payloadBase64)
  return `${payloadBase64}.${signature}`
}

export function verifySessionToken(token: string): AuthSession | null {
  const [payloadBase64, signature] = token.split('.')
  if (!payloadBase64 || !signature) {
    return null
  }
  const expectedSignature = signPayload(payloadBase64)
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null
  }
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadBase64)) as AuthSession
    if (!payload.exp || payload.exp < Date.now()) {
      return null
    }
    return payload
  } catch {
    return null
  }
}
