#!/usr/bin/env node

const baseUrl = process.env.SMOKE_BASE_URL
const authToken = process.env.SMOKE_AUTH_TOKEN

if (!baseUrl) {
  console.error('SMOKE_BASE_URL is required.')
  process.exit(1)
}

const normalizedBaseUrl = baseUrl.replace(/\/$/, '')

async function expectJson(pathname, validator, init = {}) {
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
}

async function expectHtml(pathname) {
  const response = await fetch(`${normalizedBaseUrl}${pathname}`)
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/html')) {
    throw new Error(`${pathname} did not return HTML`)
  }
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
