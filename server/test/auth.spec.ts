import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

describe('auth allowlist', () => {
  const originalAllowedEmail = process.env.AUTH_ALLOWED_EMAIL
  const originalAllowedEmails = process.env.AUTH_ALLOWED_EMAILS

  beforeEach(() => {
    vi.resetModules()
    process.env.AUTH_ALLOWED_EMAIL = ''
    process.env.AUTH_ALLOWED_EMAILS = 'aditya.debnath.999@gmail.com,d.bikram@gmail.com'
  })

  afterEach(() => {
    process.env.AUTH_ALLOWED_EMAIL = originalAllowedEmail
    process.env.AUTH_ALLOWED_EMAILS = originalAllowedEmails
    vi.resetModules()
  })

  test('accepts both approved Google accounts', async () => {
    const authModule = await import('../src/auth')

    expect(authModule.isEmailAllowedForSignIn('aditya.debnath.999@gmail.com')).toBe(true)
    expect(authModule.isEmailAllowedForSignIn('d.bikram@gmail.com')).toBe(true)
    expect(authModule.isEmailAllowedForSignIn('D.BIKRAM@gmail.com')).toBe(true)
  })

  test('rejects emails outside the approved allowlist', async () => {
    const authModule = await import('../src/auth')

    expect(authModule.isEmailAllowedForSignIn('someone@example.com')).toBe(false)
  })
})