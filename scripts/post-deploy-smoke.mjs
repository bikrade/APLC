#!/usr/bin/env node

const baseUrl = process.env.SMOKE_BASE_URL
const authToken = process.env.SMOKE_AUTH_TOKEN
const retryAttempts = Math.max(1, Number(process.env.SMOKE_RETRY_ATTEMPTS || 12))
const retryDelayMs = Math.max(250, Number(process.env.SMOKE_RETRY_DELAY_MS || 5000))

if (!baseUrl) {
  console.error('SMOKE_BASE_URL is required.')
  process.exit(1)
}

const normalizedBaseUrl = baseUrl.replace(/\/$/, '')

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function withRetry(label, fn) {
  let lastError
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === retryAttempts) {
        break
      }
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`${label} failed on attempt ${attempt}/${retryAttempts}: ${message}`)
      await sleep(retryDelayMs)
    }
  }
  throw lastError
}

async function expectJson(pathname, validator, init = {}) {
  return withRetry(pathname, async () => {
    const response = await fetch(`${normalizedBaseUrl}${pathname}`, init)
    if (!response.ok) {
      throw new Error(`${pathname} returned ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      throw new Error(`${pathname} did not return JSON`)
    }

    const body = await response.json()
    validator(body)
    return body
  })
}

async function expectHtml(pathname) {
  await withRetry(pathname, async () => {
    const response = await fetch(`${normalizedBaseUrl}${pathname}`)
    if (!response.ok) {
      throw new Error(`${pathname} returned ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) {
      throw new Error(`${pathname} did not return HTML`)
    }
  })
}

async function maybeCheckAuthenticatedFlow() {
  if (!authToken) {
    return
  }

  await expectJson(
    '/users',
    (body) => {
      if (!Array.isArray(body.users) || body.users.length === 0) {
        throw new Error('/users returned no users for authenticated smoke test')
      }
    },
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    },
  )
}

async function main() {
  await expectHtml('/')
  await expectJson('/health', (body) => {
    if (body.status !== 'ok') {
      throw new Error(`/health status was ${body.status}`)
    }
  })
  await expectJson('/ready', (body) => {
    if (body.status !== 'ready') {
      throw new Error(`/ready status was ${body.status}`)
    }
  })
  await expectJson('/config/auth', (body) => {
    if (typeof body.googleConfigured !== 'boolean') {
      throw new Error('/config/auth payload was invalid')
    }
  })
  await maybeCheckAuthenticatedFlow()
  console.log(`Smoke checks passed for ${normalizedBaseUrl}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
