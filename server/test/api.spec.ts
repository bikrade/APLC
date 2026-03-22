import request from 'supertest'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SessionRecord } from '../src/types'
import { generateQuestionByType } from '../src/utils'
import { buildReadingGenerationProfile, createReadingQuestionSet } from '../src/reading'
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
      .send({ questionIndex: 0, answer: '9999', elapsedMs: 5000 })

    expect(wrong.status).toBe(200)
    expect(wrong.body.isCorrect).toBe(false)
    expect(wrong.body.currentIndex).toBe(0)
    expect(wrong.body.answers[0].completed).toBe(false)

    const correct = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({ questionIndex: 0, answer: String(correctAnswer), elapsedMs: 7000 })

    expect(correct.status).toBe(200)
    expect(correct.body.isCorrect).toBe(true)
    expect(correct.body.currentIndex).toBe(1)
    expect(correct.body.answers[0].completed).toBe(true)
  })

  test('quiz mode records wrong answers and advances without requiring a retry', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const start = await request(ctx.app).post('/session/start').send({
      userId: 'adi',
      subject: 'Multiplication',
      sessionMode: 'quiz',
    })
    const sessionId = start.body.sessionId as string

    expect(start.status).toBe(200)
    expect(start.body.sessionMode).toBe('quiz')

    const wrong = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({ questionIndex: 0, answer: '9999', elapsedMs: 18000 })

    expect(wrong.status).toBe(200)
    expect(wrong.body.isCorrect).toBe(false)
    expect(wrong.body.currentIndex).toBe(1)
    expect(wrong.body.answers[0].completed).toBe(true)
    expect(wrong.body.answers[0].isCorrect).toBe(false)
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

  test('handles the full reading summary flow and records reading speed metrics', async () => {
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
    expect(start.body.questions[1].kind).toBe('reading-page')
    expect(start.body.questions[5].kind).toBe('reading-summary')

    for (let index = 0; index < 5; index += 1) {
      const pageResponse = await request(ctx.app)
        .post(`/session/adi/${sessionId}/answer`)
        .send({ questionIndex: index, elapsedMs: 180000, answer: '' })

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

  test('switches fast reading into a comprehension quiz and warns about high speed', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const start = await request(ctx.app).post('/session/start').send({
      userId: 'adi',
      subject: 'Reading',
    })
    const sessionId = start.body.sessionId as string
    const savedSession = await readSavedSession(ctx.dataRoot, sessionId)
    const quizAnswers = savedSession.questions[5]?.quizItems?.map((item) => item.correctOption) ?? []

    for (let index = 0; index < 5; index += 1) {
      const pageResponse = await request(ctx.app)
        .post(`/session/adi/${sessionId}/answer`)
        .send({ questionIndex: index, elapsedMs: 20000, answer: '' })

      expect(pageResponse.status).toBe(200)
      if (index === 4) {
        expect(pageResponse.body.questions[5].kind).toBe('reading-quiz')
        expect(pageResponse.body.adaptiveNotification?.kind).toBe('reading-warning')
      }
    }

    const quiz = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({
        questionIndex: 5,
        elapsedMs: 25000,
        readingQuizAnswers: quizAnswers,
      })

    expect(quiz.status).toBe(200)
    expect(quiz.body.status).toBe('completed')
    expect(quiz.body.answers[5].readingWpm).toBeGreaterThanOrEqual(190)
    expect(quiz.body.answers[5].comprehensionScore).toBe(10)
    expect(quiz.body.explanation).toContain('quiz questions correct')
  })

  test('raises difficulty after a steady run of fast success and lowers it gradually after sustained struggle', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const start = await request(ctx.app).post('/session/start').send({
      userId: 'adi',
      subject: 'Multiplication',
    })
    const sessionId = start.body.sessionId as string
    expect(start.body.difficultyLevel).toBe(3)

    let savedSession = await readSavedSession(ctx.dataRoot, sessionId)
    const answerOne = savedSession.questions[0]?.answer
    const first = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({ questionIndex: 0, answer: String(answerOne), elapsedMs: 25000 })

    expect(first.status).toBe(200)
    expect(first.body.adaptiveNotification).toBeFalsy()

    savedSession = await readSavedSession(ctx.dataRoot, sessionId)
    const answerTwo = savedSession.questions[1]?.answer
    const second = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({ questionIndex: 1, answer: String(answerTwo), elapsedMs: 22000 })

    expect(second.status).toBe(200)
    expect(second.body.difficultyLevel).toBe(3)
    expect(second.body.adaptiveNotification).toBeFalsy()

    savedSession = await readSavedSession(ctx.dataRoot, sessionId)
    const answerThree = savedSession.questions[2]?.answer
    const third = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({ questionIndex: 2, answer: String(answerThree), elapsedMs: 24000 })

    expect(third.status).toBe(200)
    expect(third.body.difficultyLevel).toBe(4)
    expect(third.body.adaptiveNotification?.kind).toBe('difficulty-up')

    const wrongOne = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({ questionIndex: 3, answer: '9999', elapsedMs: 170000 })
    expect(wrongOne.status).toBe(200)
    expect(wrongOne.body.difficultyLevel).toBe(4)
    expect(wrongOne.body.adaptiveNotification).toBeFalsy()

    const reveal = await request(ctx.app)
      .post(`/session/adi/${sessionId}/reveal`)
      .send({ questionIndex: 3, elapsedMs: 175000 })
    expect(reveal.status).toBe(200)
    expect(reveal.body.difficultyLevel).toBe(4)
    expect(reveal.body.adaptiveNotification).toBeFalsy()

    const wrongTwo = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({ questionIndex: 4, answer: '9998', elapsedMs: 190000 })

    expect(wrongTwo.status).toBe(200)
    expect(wrongTwo.body.difficultyLevel).toBe(3)
    expect(wrongTwo.body.adaptiveNotification?.kind).toBe('difficulty-down')
  })

  test('persists elapsed struggle time across wrong answers and reveal usage', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const start = await request(ctx.app).post('/session/start').send({
      userId: 'adi',
      subject: 'Division',
    })
    const sessionId = start.body.sessionId as string

    const wrong = await request(ctx.app)
      .post(`/session/adi/${sessionId}/answer`)
      .send({ questionIndex: 0, answer: '9999', elapsedMs: 91000 })

    expect(wrong.status).toBe(200)
    expect(wrong.body.answers[0].elapsedMs).toBe(91000)
    expect(wrong.body.answers[0].completed).toBe(false)

    const reveal = await request(ctx.app)
      .post(`/session/adi/${sessionId}/reveal`)
      .send({ questionIndex: 0, elapsedMs: 128000 })

    expect(reveal.status).toBe(200)
    expect(reveal.body.answers[0].elapsedMs).toBe(128000)
    expect(reveal.body.answers[0].usedReveal).toBe(true)
    expect(reveal.body.answers[0].completed).toBe(true)
  })

  test('creates a different reading story for a different session id', () => {
    const firstStory = createReadingQuestionSet('20260322-120000-Reading')
    const secondStory = createReadingQuestionSet('20260322-120001-Reading')

    expect(firstStory[0]?.content).not.toBe(secondStory[0]?.content)
    expect(firstStory[5]?.title).not.toBe(secondStory[5]?.title)
    expect(firstStory[5]?.quizItems?.[0]?.prompt).not.toBe(secondStory[5]?.quizItems?.[0]?.prompt)
  })

  test('raises reading generation challenge when recent reading is both fast and accurate', () => {
    const makeReadingSession = (id: string, startedAt: string, readingScore: number, comprehensionScore: number, readingWpm: number): SessionRecord => ({
      id,
      userId: 'adi',
      subject: 'Reading',
      status: 'completed',
      startedAt,
      completedAt: startedAt,
      currentIndex: 2,
      questions: [
        {
          id: `${id}-page`,
          prompt: 'Read the passage.',
          type: 'reading_page',
          kind: 'reading-page',
          answer: 0,
          tolerance: 0,
          helpSteps: [],
          explanation: '',
          generated: true,
        },
        {
          id: `${id}-summary`,
          prompt: 'Summarize the passage.',
          type: 'reading_summary',
          kind: 'reading-summary',
          answer: 0,
          tolerance: 0,
          helpSteps: [],
          explanation: '',
          generated: true,
        },
      ],
      answers: [
        {
          questionId: `${id}-page`,
          questionIndex: 0,
          completed: true,
          usedHelp: false,
          usedReveal: false,
          elapsedMs: 60000,
          isCorrect: true,
        },
        {
          questionId: `${id}-summary`,
          questionIndex: 1,
          completed: true,
          usedHelp: false,
          usedReveal: false,
          elapsedMs: 45000,
          isCorrect: true,
          readingScore,
          comprehensionScore,
          speedScore: 10,
          readingWpm,
        },
      ],
      totalTokensUsed: 0,
    })

    const profile = buildReadingGenerationProfile([
      makeReadingSession('20260318-090000-Reading', '2026-03-18T09:00:00.000Z', 9.2, 9, 191),
      makeReadingSession('20260320-090000-Reading', '2026-03-20T09:00:00.000Z', 8.9, 8.7, 188),
      makeReadingSession('20260322-090000-Reading', '2026-03-22T09:00:00.000Z', 9.1, 9.3, 194),
    ])

    expect(profile.challengeTier).toBe('advanced')
    expect(profile.performanceSummary).toContain('Increase the depth')
  })

  test('uses a mix of plain numeric and short descriptive math prompts at higher difficulty', () => {
    const plain = generateQuestionByType('q-4', 'decimal', 'Multiplication', 4)
    const descriptive = generateQuestionByType('q-6', 'decimal', 'Multiplication', 4)
    const divisionStory = generateQuestionByType('q-8', 'mixed', 'Division', 5)

    expect(plain.prompt).toContain('×')
    expect(descriptive.prompt).not.toContain('×')
    expect(descriptive.prompt).toMatch(/Adi|craft kit|reading challenge|snack/i)
    expect(descriptive.helpSteps[0]).toMatch(/Equation to solve:/i)
    expect(divisionStory.prompt).not.toContain('÷')
    expect(divisionStory.helpSteps[0]).toMatch(/Equation to solve:/i)
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

  test('dashboard returns today and yesterday practice time against the daily target', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const now = new Date()
    const isoDaysAgo = (daysAgo: number, hour: number) => {
      const date = new Date(now)
      date.setUTCDate(date.getUTCDate() - daysAgo)
      date.setUTCHours(hour, 0, 0, 0)
      return date.toISOString()
    }

    const makeSession = (id: string, startedAt: string, elapsedMs: number): SessionRecord => ({
      id,
      userId: 'adi',
      subject: 'Multiplication',
      status: 'completed',
      startedAt,
      completedAt: startedAt,
      currentIndex: 1,
      questions: [{
        id: 'q-1',
        prompt: '2 × 3',
        type: 'decimal',
        answer: 6,
        tolerance: 0.01,
        helpSteps: [],
        explanation: '',
        generated: true,
      }],
      answers: [{
        questionId: 'q-1',
        questionIndex: 0,
        completed: true,
        usedHelp: false,
        usedReveal: false,
        elapsedMs,
        isCorrect: true,
      }],
      totalTokensUsed: 0,
    })

    await writeSession(ctx.dataRoot, makeSession('20260322-090000-Multiplication', isoDaysAgo(0, 9), 25 * 60 * 1000))
    await writeSession(ctx.dataRoot, makeSession('20260322-150000-Multiplication', isoDaysAgo(0, 15), 20 * 60 * 1000))
    await writeSession(ctx.dataRoot, makeSession('20260321-110000-Multiplication', isoDaysAgo(1, 11), 35 * 60 * 1000))

    const res = await request(ctx.app).get('/dashboard/adi')

    expect(res.status).toBe(200)
    expect(res.body.dailyPractice).toEqual({
      targetMs: 60 * 60 * 1000,
      todayMs: 45 * 60 * 1000,
      yesterdayMs: 35 * 60 * 1000,
    })
  })

  test('dashboard returns learning coach guidance with missions, mastery, revisit queue, and parent review', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const now = new Date()
    const isoDaysAgo = (daysAgo: number) => {
      const date = new Date(now)
      date.setUTCDate(date.getUTCDate() - daysAgo)
      date.setUTCHours(9, 0, 0, 0)
      return date.toISOString()
    }

    const makeMathSession = (
      id: string,
      startedAt: string,
      subject: 'Multiplication' | 'Division',
      answers: Array<{ correct: boolean; elapsedMs: number; usedReveal?: boolean; type: 'decimal' | 'fraction' | 'percentage' | 'mixed' }>,
    ): SessionRecord => ({
      id,
      userId: 'adi',
      subject,
      status: 'completed',
      startedAt,
      completedAt: startedAt,
      currentIndex: answers.length,
      questions: answers.map((answer, index) => ({
        id: `${id}-q-${index}`,
        prompt: `Question ${index + 1}`,
        type: answer.type,
        kind: 'math',
        answer: 1,
        tolerance: 0.01,
        helpSteps: [],
        explanation: '',
        generated: true,
      })),
      answers: answers.map((answer, index) => ({
        questionId: `${id}-q-${index}`,
        questionIndex: index,
        completed: true,
        usedHelp: false,
        usedReveal: answer.usedReveal ?? false,
        elapsedMs: answer.elapsedMs,
        isCorrect: answer.correct,
        attemptCount: answer.correct ? 1 : 2,
        firstAttemptCorrect: answer.correct,
      })),
      totalTokensUsed: 0,
    })

    const makeReadingSession = (
      id: string,
      startedAt: string,
      readingScore: number,
      comprehensionScore: number,
      readingWpm: number,
    ): SessionRecord => ({
      id,
      userId: 'adi',
      subject: 'Reading',
      status: 'completed',
      startedAt,
      completedAt: startedAt,
      currentIndex: 2,
      questions: [
        {
          id: `${id}-page`,
          prompt: 'Read the passage.',
          type: 'reading_page',
          kind: 'reading-page',
          answer: 0,
          tolerance: 0,
          helpSteps: [],
          explanation: '',
          generated: true,
        },
        {
          id: `${id}-summary`,
          prompt: 'Summarize the passage.',
          type: 'reading_summary',
          kind: 'reading-summary',
          answer: 0,
          tolerance: 0,
          helpSteps: [],
          explanation: '',
          generated: true,
        },
      ],
      answers: [
        {
          questionId: `${id}-page`,
          questionIndex: 0,
          completed: true,
          usedHelp: false,
          usedReveal: false,
          elapsedMs: 95000,
          isCorrect: true,
        },
        {
          questionId: `${id}-summary`,
          questionIndex: 1,
          completed: true,
          usedHelp: false,
          usedReveal: false,
          elapsedMs: 60000,
          isCorrect: true,
          readingScore,
          comprehensionScore,
          speedScore: 8,
          readingWpm,
        },
      ],
      totalTokensUsed: 0,
    })

    await writeSession(ctx.dataRoot, makeMathSession(
      'recent-multiplication',
      isoDaysAgo(1),
      'Multiplication',
      [
        { correct: true, elapsedMs: 68000, type: 'decimal' },
        { correct: true, elapsedMs: 72000, type: 'decimal' },
        { correct: false, elapsedMs: 150000, usedReveal: true, type: 'fraction' },
      ],
    ))
    await writeSession(ctx.dataRoot, makeMathSession(
      'recent-division',
      isoDaysAgo(2),
      'Division',
      [
        { correct: true, elapsedMs: 82000, type: 'fraction' },
        { correct: true, elapsedMs: 84000, type: 'fraction' },
        { correct: true, elapsedMs: 88000, type: 'percentage' },
      ],
    ))
    await writeSession(ctx.dataRoot, makeReadingSession(
      'recent-reading',
      isoDaysAgo(3),
      8.8,
      8.5,
      171,
    ))
    await writeSession(ctx.dataRoot, makeReadingSession(
      'recent-reading-2',
      isoDaysAgo(4),
      8.6,
      8.2,
      168,
    ))

    const res = await request(ctx.app).get('/dashboard/adi')

    expect(res.status).toBe(200)
    expect(res.body.learningCoach).toBeTruthy()
    expect(res.body.learningCoach.weeklyMission.title).toBeTruthy()
    expect(res.body.learningCoach.weeklyMission.items).toHaveLength(3)
    expect(res.body.learningCoach.habitSignals).toHaveLength(3)
    expect(res.body.learningCoach.masteryBySubject).toHaveLength(3)
    expect(res.body.learningCoach.parentReview.celebration.length).toBeGreaterThan(0)
    expect(res.body.learningCoach.parentReview.supportMoves.length).toBeGreaterThan(0)
    expect(res.body.learningCoach.revisitQueue.length).toBeGreaterThan(0)
    expect(res.body.learningCoach.revisitQueue[0]).toEqual(expect.objectContaining({
      subject: expect.any(String),
      skill: expect.any(String),
      reason: expect.any(String),
      action: expect.any(String),
    }))

    const multiplication = res.body.learningCoach.masteryBySubject.find((item: { subject: string }) => item.subject === 'Multiplication')
    const reading = res.body.learningCoach.masteryBySubject.find((item: { subject: string }) => item.subject === 'Reading')

    expect(multiplication.overallStage).not.toBe('mastered')
    expect(reading.skills).toHaveLength(3)
    expect(reading.skills.some((skill: { label: string }) => skill.label === 'Pace Control')).toBe(true)
  })

  test('insights returns enriched overall and per-subject guidance', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const makeMathSession = (
      id: string,
      startedAt: string,
      subject: 'Multiplication' | 'Division',
      answers: Array<{ correct: boolean; elapsedMs: number; usedReveal?: boolean; type: 'decimal' | 'fraction' | 'percentage' | 'mixed' }>,
    ): SessionRecord => ({
      id,
      userId: 'adi',
      subject,
      status: 'completed',
      startedAt,
      completedAt: startedAt,
      currentIndex: answers.length,
      questions: answers.map((answer, index) => ({
        id: `${id}-q-${index}`,
        prompt: `Question ${index + 1}`,
        type: answer.type,
        kind: 'math',
        answer: 1,
        tolerance: 0.01,
        helpSteps: [],
        explanation: '',
        generated: true,
      })),
      answers: answers.map((answer, index) => ({
        questionId: `${id}-q-${index}`,
        questionIndex: index,
        completed: true,
        usedHelp: false,
        usedReveal: answer.usedReveal ?? false,
        elapsedMs: answer.elapsedMs,
        isCorrect: answer.correct,
      })),
      totalTokensUsed: 0,
    })

    const makeReadingSession = (
      id: string,
      startedAt: string,
      readingScore: number,
      comprehensionScore: number,
      readingWpm: number,
    ): SessionRecord => ({
      id,
      userId: 'adi',
      subject: 'Reading',
      status: 'completed',
      startedAt,
      completedAt: startedAt,
      currentIndex: 2,
      questions: [
        {
          id: `${id}-page`,
          prompt: 'Read the passage.',
          type: 'reading_page',
          kind: 'reading-page',
          answer: 0,
          tolerance: 0,
          helpSteps: [],
          explanation: '',
          generated: true,
        },
        {
          id: `${id}-summary`,
          prompt: 'Summarize the passage.',
          type: 'reading_summary',
          kind: 'reading-summary',
          answer: 0,
          tolerance: 0,
          helpSteps: [],
          explanation: '',
          generated: true,
        },
      ],
      answers: [
        {
          questionId: `${id}-page`,
          questionIndex: 0,
          completed: true,
          usedHelp: false,
          usedReveal: false,
          elapsedMs: 60000,
          isCorrect: true,
        },
        {
          questionId: `${id}-summary`,
          questionIndex: 1,
          completed: true,
          usedHelp: false,
          usedReveal: false,
          elapsedMs: 45000,
          isCorrect: true,
          readingScore,
          comprehensionScore,
          speedScore: 8,
          readingWpm,
        },
      ],
      totalTokensUsed: 0,
    })

    await writeSession(ctx.dataRoot, makeMathSession(
      '20260318-090000-Multiplication',
      '2026-03-18T09:00:00.000Z',
      'Multiplication',
      [
        { correct: true, elapsedMs: 85000, type: 'decimal' },
        { correct: true, elapsedMs: 95000, type: 'decimal' },
        { correct: false, elapsedMs: 170000, usedReveal: true, type: 'fraction' },
      ],
    ))
    await writeSession(ctx.dataRoot, makeMathSession(
      '20260319-090000-Division',
      '2026-03-19T09:00:00.000Z',
      'Division',
      [
        { correct: true, elapsedMs: 75000, type: 'fraction' },
        { correct: true, elapsedMs: 80000, type: 'fraction' },
        { correct: true, elapsedMs: 82000, type: 'percentage' },
      ],
    ))
    await writeSession(ctx.dataRoot, makeReadingSession(
      '20260320-090000-Reading',
      '2026-03-20T09:00:00.000Z',
      8.5,
      8,
      128,
    ))

    const res = await request(ctx.app).get('/insights/adi')

    expect(res.status).toBe(200)
    expect(res.body.hasEnoughData).toBe(true)
    expect(res.body.overall.completedSessions).toBe(3)
    expect(res.body.overall.totalQuestionsAnswered).toBe(8)
    expect(res.body.overall.strongestSubject).toBe('Division')
    expect(res.body.overall.needsAttentionSubject).toBe('Multiplication')
    expect(res.body.overall.subjectSessionBreakdown).toEqual({
      Multiplication: 1,
      Division: 1,
      Reading: 1,
    })
    expect(res.body.recommendedFocus).toHaveLength(3)
    expect(res.body.recommendedFocus).toContainEqual(expect.stringContaining('Multiplication:'))
    expect(res.body.bySubject).toHaveLength(3)

    const multiplication = res.body.bySubject.find((item: { subject: string }) => item.subject === 'Multiplication')
    expect(multiplication).toBeTruthy()
    expect(multiplication.trend).toBe('steady')
    expect(multiplication.metrics.accuracy).toBe(67)
    expect(multiplication.metrics.revealRate).toBe(33)
    expect(multiplication.focusAreas).toContainEqual(expect.stringContaining('accuracy is 67%'))

    const division = res.body.bySubject.find((item: { subject: string }) => item.subject === 'Division')
    expect(division).toBeTruthy()
    expect(division.metrics.accuracy).toBe(100)
    expect(division.strengths).toContainEqual(expect.stringContaining('Division accuracy is strong'))

    const reading = res.body.bySubject.find((item: { subject: string }) => item.subject === 'Reading')
    expect(reading).toBeTruthy()
    expect(reading.metrics.averageWpm).toBe(128)
    expect(reading.metrics.comprehensionScore).toBe(8)
    expect(reading.metrics.readingScore).toBe(8.5)
  })

  test('insights marks subject cards as improving or declining from recent session trends', async () => {
    const ctx = await setupTestApp()
    cleanupCurrent = ctx.cleanup

    const makeMathSession = (
      id: string,
      startedAt: string,
      subject: 'Multiplication' | 'Division',
      answerSet: Array<{ correct: boolean; elapsedMs: number; usedReveal?: boolean }>,
    ): SessionRecord => ({
      id,
      userId: 'adi',
      subject,
      status: 'completed',
      startedAt,
      completedAt: startedAt,
      currentIndex: answerSet.length,
      questions: answerSet.map((_, index) => ({
        id: `${id}-q-${index}`,
        prompt: `Question ${index + 1}`,
        type: 'decimal',
        kind: 'math',
        answer: 1,
        tolerance: 0.01,
        helpSteps: [],
        explanation: '',
        generated: true,
      })),
      answers: answerSet.map((answer, index) => ({
        questionId: `${id}-q-${index}`,
        questionIndex: index,
        completed: true,
        usedHelp: false,
        usedReveal: answer.usedReveal ?? false,
        elapsedMs: answer.elapsedMs,
        isCorrect: answer.correct,
        attemptCount: answer.correct ? 1 : 2,
        firstAttemptCorrect: answer.correct,
      })),
      totalTokensUsed: 0,
    })

    const makeReadingSession = (id: string, startedAt: string, readingScore: number, comprehensionScore: number): SessionRecord => ({
      id,
      userId: 'adi',
      subject: 'Reading',
      status: 'completed',
      startedAt,
      completedAt: startedAt,
      currentIndex: 2,
      questions: [
        {
          id: `${id}-page`,
          prompt: 'Read the passage.',
          type: 'reading_page',
          kind: 'reading-page',
          answer: 0,
          tolerance: 0,
          helpSteps: [],
          explanation: '',
          generated: true,
        },
        {
          id: `${id}-summary`,
          prompt: 'Summarize the passage.',
          type: 'reading_summary',
          kind: 'reading-summary',
          answer: 0,
          tolerance: 0,
          helpSteps: [],
          explanation: '',
          generated: true,
        },
      ],
      answers: [
        {
          questionId: `${id}-page`,
          questionIndex: 0,
          completed: true,
          usedHelp: false,
          usedReveal: false,
          elapsedMs: 60000,
          isCorrect: true,
        },
        {
          questionId: `${id}-summary`,
          questionIndex: 1,
          completed: true,
          usedHelp: false,
          usedReveal: false,
          elapsedMs: 45000,
          isCorrect: true,
          readingScore,
          comprehensionScore,
          speedScore: 8,
          readingWpm: 132,
        },
      ],
      totalTokensUsed: 0,
    })

    await writeSession(ctx.dataRoot, makeMathSession('20260315-090000-Multiplication', '2026-03-15T09:00:00.000Z', 'Multiplication', [
      { correct: false, elapsedMs: 155000, usedReveal: true },
      { correct: true, elapsedMs: 120000, usedReveal: true },
      { correct: false, elapsedMs: 145000, usedReveal: true },
    ]))
    await writeSession(ctx.dataRoot, makeMathSession('20260320-090000-Multiplication', '2026-03-20T09:00:00.000Z', 'Multiplication', [
      { correct: true, elapsedMs: 42000 },
      { correct: true, elapsedMs: 38000 },
      { correct: true, elapsedMs: 45000 },
    ]))
    await writeSession(ctx.dataRoot, makeMathSession('20260316-090000-Division', '2026-03-16T09:00:00.000Z', 'Division', [
      { correct: true, elapsedMs: 52000 },
      { correct: true, elapsedMs: 56000 },
      { correct: true, elapsedMs: 50000 },
    ]))
    await writeSession(ctx.dataRoot, makeMathSession('20260321-090000-Division', '2026-03-21T09:00:00.000Z', 'Division', [
      { correct: false, elapsedMs: 180000, usedReveal: true },
      { correct: true, elapsedMs: 160000, usedReveal: true },
      { correct: false, elapsedMs: 190000, usedReveal: true },
    ]))
    await writeSession(ctx.dataRoot, makeReadingSession('20260318-090000-Reading', '2026-03-18T09:00:00.000Z', 8.8, 9))
    await writeSession(ctx.dataRoot, makeReadingSession('20260322-090000-Reading', '2026-03-22T09:00:00.000Z', 8.7, 8.5))

    const res = await request(ctx.app).get('/insights/adi')

    expect(res.status).toBe(200)
    const multiplication = res.body.bySubject.find((item: { subject: string }) => item.subject === 'Multiplication')
    const division = res.body.bySubject.find((item: { subject: string }) => item.subject === 'Division')
    const reading = res.body.bySubject.find((item: { subject: string }) => item.subject === 'Reading')

    expect(multiplication.trend).toBe('improving')
    expect(division.trend).toBe('declining')
    expect(reading.trend).toBe('steady')
  })
})
