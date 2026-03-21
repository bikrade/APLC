import request from 'supertest'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SessionRecord } from '../src/types'
import { readSavedSession, setupTestApp, writeSession } from './helpers'

let cleanupCurrent: (() => Promise<void>) | null = null

beforeEach(() => {
  vi.resetModules()
})

afterEach(async () => {
  if (cleanupCurrent) {
    await cleanupCurrent()
    cleanupCurrent = null
  }
  vi.resetModules()
})

describe('APLC backend', () => {
  test('serves health and baseline hardening headers', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const response = await request(ctx.app).get('/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', service: 'aplc-server' })
    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups')
  })

  test('lists local users when Google auth is disabled', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const response = await request(ctx.app).get('/users')

    expect(response.status).toBe(200)
    expect(response.body.users).toEqual([{ id: 'adi', name: 'Adi' }])
  })

  test('requires auth on protected routes when Google auth is enabled', async () => {
    const ctx = await setupTestApp({ googleAuth: true })
    cleanupCurrent = ctx.cleanup

    const unauthenticated = await request(ctx.app).get('/users')
    expect(unauthenticated.status).toBe(401)

    const authenticated = await request(ctx.app)
      .get('/users')
      .set('Authorization', `Bearer ${ctx.createAuthToken()}`)

    expect(authenticated.status).toBe(200)
    expect(authenticated.body.users).toEqual([{ id: 'adi', name: 'Adi' }])
  })

  test('rate limits repeated Google auth attempts', async () => {
    const ctx = await setupTestApp({ googleAuth: true })
    cleanupCurrent = ctx.cleanup

    for (let index = 0; index < 20; index += 1) {
      const response = await request(ctx.app).post('/auth/google').send({})
      expect(response.status).toBe(400)
    }

    const limited = await request(ctx.app).post('/auth/google').send({})
    expect(limited.status).toBe(429)
    expect(limited.body.error).toMatch(/Too many requests/i)
  })

  test('starts a fresh multiplication session lazily and resumes the same active session', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const start = await request(ctx.app).post('/session/start').send({
      userId: 'adi',
      subject: 'Multiplication',
    })

    expect(start.status).toBe(200)
    expect(start.body.subject).toBe('Multiplication')
    expect(start.body.questionCount).toBe(12)
    expect(start.body.totalTokensUsed).toBe(0)
    expect(start.body.questions[0].prompt).not.toBe('')
    expect(start.body.questions[1].prompt).toBe('')

    const resumed = await request(ctx.app).post('/session/start').send({
      userId: 'adi',
      subject: 'Multiplication',
    })

    expect(resumed.status).toBe(200)
    expect(resumed.body.sessionId).toBe(start.body.sessionId)
  })

  test('keeps the same math question active on a wrong answer and advances on a correct answer', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const start = await request(ctx.app).post('/session/start').send({
      userId: 'adi',
      subject: 'Multiplication',
    })
    const sessionId = start.body.sessionId as string
    const savedSession = await readSavedSession(ctx.dataRoot, sessionId)
    const correctAnswer = savedSession.questions[0]?.answer

    const wrong = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({ questionIndex: 0, answer: '9999', elapsedMs: 5000, selfRating: 3 })

    expect(wrong.status).toBe(200)
    expect(wrong.body.isCorrect).toBe(false)
    expect(wrong.body.currentIndex).toBe(0)
    expect(wrong.body.answers[0].completed).toBe(false)

    const correct = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({ questionIndex: 0, answer: String(correctAnswer), elapsedMs: 7000, selfRating: 4 })

    expect(correct.status).toBe(200)
    expect(correct.body.isCorrect).toBe(true)
    expect(correct.body.currentIndex).toBe(1)
    expect(correct.body.answers[0].completed).toBe(true)
  })

  test('rejects invalid route ids before file access', async () => {
    const ctx = await setupTestApp({ googleAuth: true })
    cleanupCurrent = ctx.cleanup

    const response = await request(ctx.app)
      .get('/session/adi/not-a-valid-session')
      .set('Authorization', `Bearer ${ctx.createAuthToken()}`)

    expect(response.status).toBe(400)
    expect(response.body.error).toMatch(/Invalid sessionId/i)
  })

  test('handles the full reading flow and records reading speed metrics', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const start = await request(ctx.app).post('/session/start').send({
      userId: 'adi',
      subject: 'Reading',
    })
    const sessionId = start.body.sessionId as string

    expect(start.status).toBe(200)
    expect(start.body.questionCount).toBe(6)
    expect(start.body.questions[0].kind).toBe('reading-page')
    expect(start.body.questions[1].prompt).toBe('')

    for (let index = 0; index < 5; index += 1) {
      const pageResponse = await request(ctx.app)
        .post(`/session/adi/${sessionId}/answer`)
        .send({ questionIndex: index, elapsedMs: 60000, answer: '' })

      expect(pageResponse.status).toBe(200)
      expect(pageResponse.body.isCorrect).toBe(true)
    }

    const summary = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({
        questionIndex: 5,
        elapsedMs: 45000,
        answer: 'Mira and Dev restore the Monsoon Clock, use notebooks and tide patterns to warn the town, and help prevent the market from flooding because the community learns to observe and work together again.',
      })

    expect(summary.status).toBe(200)
    expect(summary.body.status).toBe('completed')
    expect(summary.body.answers[5].readingScore).toBeGreaterThanOrEqual(0)
    expect(summary.body.answers[5].readingWpm).toBeGreaterThan(0)
    expect(summary.body.explanation).toContain('Overall reading score')

    const inProgress = await request(ctx.app).get('/sessions/in-progress/adi')
    expect(inProgress.status).toBe(200)
    expect(inProgress.body.sessions).toHaveLength(0)
  })

  test('keeps only the latest active session per subject', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const olderSession: SessionRecord = {
      id: '20260320-120000-Multiplication',
      userId: 'adi',
      subject: 'Multiplication',
      status: 'active',
      startedAt: '2026-03-20T12:00:00.000Z',
      currentIndex: 0,
      questions: [
        {
          id: 'q-1',
          prompt: '1 × 2',
          type: 'decimal',
          kind: 'math',
          answer: 2,
          tolerance: 0.01,
          helpSteps: [],
          explanation: '',
          generated: true,
        },
      ],
      answers: [
        {
          questionId: 'q-1',
          questionIndex: 0,
          completed: false,
          usedHelp: false,
          usedReveal: false,
          elapsedMs: 0,
        },
      ],
      totalTokensUsed: 0,
    }

    const newerSession: SessionRecord = {
      ...olderSession,
      id: '20260321-120000-Multiplication',
      startedAt: '2026-03-21T12:00:00.000Z',
    }

    await writeSession(ctx.dataRoot, olderSession)
    await writeSession(ctx.dataRoot, newerSession)

    const resumed = await request(ctx.app).post('/session/start').send({
      userId: 'adi',
      subject: 'Multiplication',
    })

    expect(resumed.status).toBe(200)
    expect(resumed.body.sessionId).toBe(newerSession.id)

    const sessionFiles = await request(ctx.app).get('/sessions/in-progress/adi')
    expect(sessionFiles.status).toBe(200)
    expect(sessionFiles.body.sessions).toHaveLength(1)
    expect(sessionFiles.body.sessions[0].sessionId).toBe(newerSession.id)
  })

  test('dashboard returns activityDays from all sessions including historical', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const makeSession = (id: string, startedAt: string, status: 'active' | 'completed'): SessionRecord => ({
      id,
      userId: 'adi',
      subject: 'Multiplication',
      status,
      startedAt,
      currentIndex: status === 'completed' ? 1 : 0,
      questions: [{
        id: 'q-1', prompt: '2 × 3', type: 'decimal', answer: 6,
        tolerance: 0.01, helpSteps: [], explanation: '', generated: true,
      }],
      answers: [{
        questionId: 'q-1', questionIndex: 0,
        completed: status === 'completed', usedHelp: false, usedReveal: false,
        elapsedMs: 5000, isCorrect: true,
      }],
      totalTokensUsed: 0,
      ...(status === 'completed' ? { completedAt: startedAt } : {}),
    })

    // Sessions on 3 different days
    await writeSession(ctx.dataRoot, makeSession('20260315-100000-Multiplication', '2026-03-15T10:00:00.000Z', 'completed'))
    await writeSession(ctx.dataRoot, makeSession('20260320-170000-Multiplication', '2026-03-20T17:00:00.000Z', 'completed'))
    await writeSession(ctx.dataRoot, makeSession('20260320-180000-Multiplication', '2026-03-20T18:00:00.000Z', 'completed'))
    await writeSession(ctx.dataRoot, makeSession('20260321-140000-Multiplication', '2026-03-21T14:00:00.000Z', 'active'))

    const res = await request(ctx.app).get('/dashboard/adi')
    expect(res.status).toBe(200)

    // All 4 sessions contribute to activityDays
    expect(res.body.activityDays).toHaveLength(4)
    expect(res.body.activityDays).toContain('2026-03-15')
    expect(res.body.activityDays).toContain('2026-03-20')
    expect(res.body.activityDays).toContain('2026-03-21')

    // 2 sessions on March 20
    expect(res.body.activityDays.filter((d: string) => d === '2026-03-20')).toHaveLength(2)

    // Stats from 3 completed sessions only
    expect(res.body.totalSessions).toBe(4)
    expect(res.body.overallAccuracy).toBe(100)
  })
})
