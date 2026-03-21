import 'dotenv/config'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { createSessionToken, getPublicGoogleClientId, isGoogleAuthConfigured, verifyGoogleCredential, verifySessionToken } from './auth'
import {
  deleteLegacySessionFiles,
  listAllSessions,
  pruneActiveSessionsForSubject,
  readInsightsText,
  readSession,
  readUserProfile,
  readUserIds,
  saveInsightsText,
  userProfileExists,
  saveSession,
} from './storage'
import type { QuestionState, SessionRecord, Subject } from './types'
import { createQuestionPlaceholder, generateQuestionByType, getQuestionTypeForIndex, isAnswerCorrect, parseAnswer } from './utils'
import { generateHintSteps, generateExplanation, isOpenAIConfigured, flushCallStats } from './openai'
import { evaluateReadingSummary, getReadingQuestionCount } from './reading'

const app = express()
const port = Number(process.env.PORT || 3001)
const clientDistDir = path.resolve(process.cwd(), '../client/dist')
const clientIndexPath = path.join(clientDistDir, 'index.html')
const USER_ID_PATTERN = /^[a-z0-9_-]{1,64}$/i
const SESSION_ID_PATTERN = /^\d{8}-\d{6}-(Multiplication|Division|Reading)$/

type RateLimitEntry = {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>([
    'http://127.0.0.1:4173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ])

  const configuredOrigins = String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  for (const origin of configuredOrigins) origins.add(origin)

  if (process.env.NGROK_DOMAIN) {
    origins.add(`https://${process.env.NGROK_DOMAIN}`)
  }

  return origins
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  next()
}

function validateRouteIds(req: Request, res: Response, next: NextFunction): void {
  if (typeof req.params.userId === 'string' && !USER_ID_PATTERN.test(req.params.userId)) {
    res.status(400).json({ error: 'Invalid userId.' })
    return
  }
  if (typeof req.params.sessionId === 'string' && !SESSION_ID_PATTERN.test(req.params.sessionId)) {
    res.status(400).json({ error: 'Invalid sessionId.' })
    return
  }
  next()
}

function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store')
  next()
}

function rateLimit(keyPrefix: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    const key = `${keyPrefix}:${ip}`
    const current = rateLimitStore.get(key)

    if (!current || current.resetAt <= now) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    if (current.count >= limit) {
      res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)))
      res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' })
      return
    }

    current.count += 1
    rateLimitStore.set(key, current)
    next()
  }
}

app.disable('x-powered-by')
app.use(securityHeaders)
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true)
      return
    }
    callback(null, getAllowedOrigins().has(origin))
  },
}))
app.use(express.json({ limit: '32kb' }))

const sessions = new Map<string, SessionRecord>()

function sessionKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`
}

function getQuestionAt(session: SessionRecord, index: number) {
  const question = session.questions[index]
  if (!question) {
    return null
  }
  return question
}

function getAnswerStateAt(session: SessionRecord, index: number) {
  const answer = session.answers[index]
  if (!answer) {
    return null
  }
  return answer
}

function isSubject(value: string): value is Subject {
  return value === 'Multiplication' || value === 'Division' || value === 'Reading'
}

function createSessionId(subject: Subject, date = new Date()): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hours}${minutes}${seconds}-${subject}`
}

type InsightPayload = {
  hasEnoughData: boolean
  message: string
  strengths: string[]
  improvements: string[]
}

type AuthenticatedRequest = Request & {
  authSession?: {
    email: string
    name: string
    picture?: string
    userId: string
    exp: number
  }
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!isGoogleAuthConfigured()) {
    next()
    return
  }

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' })
    return
  }

  const session = verifySessionToken(token)
  if (!session) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' })
    return
  }

  req.authSession = session
  if (typeof req.params.userId === 'string' && req.params.userId && req.params.userId !== session.userId) {
    res.status(403).json({ error: 'Forbidden for this user.' })
    return
  }
  next()
}

function toClientQuestion(question: SessionRecord['questions'][number], index: number) {
  return {
    id: question.id,
    prompt: question.prompt,
    type: question.type,
    kind: question.kind ?? 'math',
    title: question.title,
    content: question.content,
    wordCount: question.wordCount,
    index,
  }
}

async function ensureQuestionGenerated(session: SessionRecord, index: number): Promise<void> {
  const existing = session.questions[index]
  if (!existing || existing.generated) {
    return
  }

  session.questions[index] = generateQuestionByType(existing.id, existing.type, session.subject)
  await saveSession(session)
}

function buildInsightsPayloadFromSessions(allSessions: SessionRecord[]): InsightPayload {
  const recentCompleted = allSessions
    .filter((session) => session.status === 'completed')
    .slice(0, 3)

  if (recentCompleted.length < 3) {
    return {
      hasEnoughData: false,
      message: 'We need at least 3 completed sessions to generate insights.',
      strengths: [],
      improvements: [],
    }
  }

  const stats = {
    total: 0,
    correct: 0,
    totalTimeMs: 0,
    revealCount: 0,
  }

  for (const session of recentCompleted) {
    for (const answer of session.answers) {
      if (!answer.completed) continue
      stats.total += 1
      if (answer.isCorrect) stats.correct += 1
      stats.totalTimeMs += answer.elapsedMs
      if (answer.usedReveal) stats.revealCount += 1
    }
  }

  const accuracy = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0
  const avgSeconds = stats.total ? Math.round(stats.totalTimeMs / stats.total / 1000) : 0
  const strengths: string[] = []
  const improvements: string[] = []

  if (accuracy >= 70) strengths.push(`Solid accuracy trend (${accuracy}%).`)
  else improvements.push(`Accuracy is ${accuracy}% right now. Slow down and work through each step carefully.`)

  if (avgSeconds <= 120) strengths.push(`Good pace (${avgSeconds}s per question on average).`)
  else improvements.push(`Average time is ${avgSeconds}s. Break each question into smaller steps to speed up.`)

  if (stats.revealCount <= 2) strengths.push('Low answer reveal usage in recent sessions.')
  else improvements.push('Answer reveals are high. Try using hints before showing the full answer.')

  return {
    hasEnoughData: true,
    message: 'Insights generated from the last 3 completed sessions.',
    strengths,
    improvements,
  }
}

function formatInsightsText(payload: InsightPayload): string {
  return [
    `Message: ${payload.message}`,
    '',
    '[Going Well]',
    ...(payload.strengths.length > 0 ? payload.strengths.map((item) => `- ${item}`) : ['- None yet.']),
    '',
    '[Focus Areas]',
    ...(payload.improvements.length > 0 ? payload.improvements.map((item) => `- ${item}`) : ['- No major focus area right now.']),
    '',
  ].join('\n')
}

function parseInsightsText(content: string): InsightPayload {
  const lines = content.split('\n').map((line) => line.trim())
  const strengths: string[] = []
  const improvements: string[] = []
  let section: 'strengths' | 'improvements' | null = null
  let message = 'Insights generated from the last 3 completed sessions.'

  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('Message:')) {
      message = line.slice('Message:'.length).trim() || message
      continue
    }
    if (line === '[Going Well]') {
      section = 'strengths'
      continue
    }
    if (line === '[Focus Areas]') {
      section = 'improvements'
      continue
    }
    if (!line.startsWith('- ')) continue

    const item = line.slice(2).trim()
    if (!item || item === 'None yet.' || item === 'No major focus area right now.') continue
    if (section === 'strengths') strengths.push(item)
    if (section === 'improvements') improvements.push(item)
  }

  return {
    hasEnoughData: true,
    message,
    strengths,
    improvements,
  }
}

async function refreshInsightsFile(userId: string): Promise<InsightPayload> {
  const allSessions = await listAllSessions(userId)
  const payload = buildInsightsPayloadFromSessions(allSessions)
  if (payload.hasEnoughData) {
    await saveInsightsText(userId, formatInsightsText(payload))
  }
  return payload
}

app.post('/auth/google', noStore, rateLimit('auth-google', 20, 10 * 60 * 1000), async (req, res) => {
  if (!isGoogleAuthConfigured()) {
    res.status(503).json({ error: 'Google authentication is not configured yet.' })
    return
  }

  const credential = String(req.body?.credential || '').trim()
  if (!credential) {
    res.status(400).json({ error: 'Missing Google credential.' })
    return
  }

  try {
    const user = await verifyGoogleCredential(credential)
    const token = createSessionToken(user)
    res.json({
      token,
      user,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google sign-in failed.'
    res.status(401).json({ error: message })
  }
})

app.get('/auth/session', noStore, requireAuth, (req: AuthenticatedRequest, res) => {
  if (!req.authSession) {
    res.status(401).json({ error: 'Authentication required.' })
    return
  }
  res.json({
    user: {
      email: req.authSession.email,
      name: req.authSession.name,
      picture: req.authSession.picture,
      userId: req.authSession.userId,
    },
  })
})

app.param('userId', (req, res, next, userId) => {
  req.params.userId = userId
  validateRouteIds(req, res, next)
})

app.param('sessionId', (req, res, next, sessionId) => {
  req.params.sessionId = sessionId
  validateRouteIds(req, res, next)
})
app.use('/users', requireAuth)
app.use('/dashboard/:userId', requireAuth)
app.use('/sessions/in-progress/:userId', requireAuth)
app.use('/insights/:userId', requireAuth)
app.use('/session/start', requireAuth)
app.use('/session/:userId/:sessionId', requireAuth)
app.use('/session/:userId/:sessionId/help', rateLimit('help', 30, 60 * 1000))
app.use('/session/:userId/:sessionId/reveal', rateLimit('reveal', 30, 60 * 1000))
app.use('/session/:userId/:sessionId/answer', rateLimit('answer', 120, 60 * 1000))

// Dashboard stats endpoint
app.get('/dashboard/:userId', async (req, res) => {
  const { userId } = req.params
  try {
    const allSessions = await listAllSessions(userId)
    const completedSessions = allSessions.filter((s) => s.status === 'completed')

    // Total sessions
    const totalSessions = allSessions.length

    // Overall accuracy
    let totalAnswered = 0
    let totalCorrect = 0
    let totalTimeMs = 0
    for (const session of completedSessions) {
      for (const answer of session.answers) {
        if (!answer.completed) continue
        totalAnswered++
        if (answer.isCorrect) totalCorrect++
        totalTimeMs += answer.elapsedMs
      }
    }
    const overallAccuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0
    const avgTimePerQuestion = totalAnswered > 0 ? Math.round(totalTimeMs / totalAnswered / 1000) : 0

    // Activity days (ISO date strings for heatmap)
    const activityDays: string[] = allSessions.map((s) => s.startedAt.slice(0, 10))

    // Current streak (consecutive days with at least one session)
    const uniqueDays = [...new Set(activityDays)].sort().reverse()
    let currentStreak = 0
    const today = new Date().toISOString().slice(0, 10)
    let checkDate = today
    for (const day of uniqueDays) {
      if (day === checkDate) {
        currentStreak++
        const d = new Date(checkDate)
        d.setDate(d.getDate() - 1)
        checkDate = d.toISOString().slice(0, 10)
      } else {
        break
      }
    }

    // Progress insights: compare recent sessions vs older sessions
    type ProgressInsights = {
      trend: 'improving' | 'declining' | 'steady' | 'new'
      trendLabel: string
      recentAccuracy: number
      bestAccuracy: number
      totalQuestionsAnswered: number
      message: string
    }
    let progressInsights: ProgressInsights | undefined
    if (completedSessions.length >= 2) {
      // Per-session accuracy
      const sessionAccuracies = completedSessions.map((s) => {
        const answered = s.answers.filter((a) => a.completed)
        const correct = answered.filter((a) => a.isCorrect).length
        return answered.length > 0 ? Math.round((correct / answered.length) * 100) : 0
      })
      const bestAccuracy = Math.max(...sessionAccuracies)
      const totalQuestionsAnswered = totalAnswered

      // Recent = last 3 sessions, older = before that
      const recentSessions = sessionAccuracies.slice(-3)
      const olderSessions = sessionAccuracies.slice(0, -3)
      const recentAvg = Math.round(recentSessions.reduce((a, b) => a + b, 0) / recentSessions.length)
      const olderAvg = olderSessions.length > 0
        ? Math.round(olderSessions.reduce((a, b) => a + b, 0) / olderSessions.length)
        : recentAvg

      let trend: 'improving' | 'declining' | 'steady'
      let trendLabel: string
      let message: string
      const diff = recentAvg - olderAvg

      if (olderSessions.length === 0) {
        // Only recent sessions, compare first vs last
        const firstAcc = sessionAccuracies[0] ?? 0
        const lastAcc = sessionAccuracies[sessionAccuracies.length - 1] ?? 0
        const d = lastAcc - firstAcc
        if (d >= 10) {
          trend = 'improving'
          trendLabel = 'You are improving!'
          message = `Your accuracy went from ${firstAcc}% to ${lastAcc}% — great progress!`
        } else if (d <= -10) {
          trend = 'declining'
          trendLabel = 'Needs more practice'
          message = `Accuracy has dipped. Focus on hints and take your time with each question.`
        } else {
          trend = 'steady'
          trendLabel = 'Consistent performance'
          message = `You're performing steadily at ${recentAvg}% accuracy. Keep pushing for ${Math.min(100, recentAvg + 10)}%!`
        }
      } else if (diff >= 10) {
        trend = 'improving'
        trendLabel = `Up ${diff}% vs earlier sessions!`
        message = `Your recent accuracy (${recentAvg}%) is higher than before (${olderAvg}%). You're on a roll!`
      } else if (diff <= -10) {
        trend = 'declining'
        trendLabel = `Down ${Math.abs(diff)}% vs earlier sessions`
        message = `Recent accuracy (${recentAvg}%) is lower than before (${olderAvg}%). Try using hints more often.`
      } else {
        trend = 'steady'
        trendLabel = 'Consistent performance'
        message = `You're holding steady at ~${recentAvg}% accuracy. Push for ${Math.min(100, recentAvg + 10)}% next!`
      }

      progressInsights = { trend, trendLabel, recentAccuracy: recentAvg, bestAccuracy, totalQuestionsAnswered, message }
    } else if (completedSessions.length === 1) {
      const s = completedSessions[0]!
      const answered = s.answers.filter((a) => a.completed)
      const correct = answered.filter((a) => a.isCorrect).length
      const acc = answered.length > 0 ? Math.round((correct / answered.length) * 100) : 0
      progressInsights = {
        trend: 'new',
        trendLabel: 'First session complete!',
        recentAccuracy: acc,
        bestAccuracy: acc,
        totalQuestionsAnswered: answered.length,
        message: 'Complete more sessions to see your progress trend.',
      }
    }

    res.json({
      totalSessions,
      overallAccuracy,
      avgTimePerQuestion,
      currentStreak,
      activityDays,
      progressInsights,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute dashboard stats' })
  }
})

// In-progress session endpoint
app.get('/sessions/in-progress/:userId', async (req, res) => {
  const { userId } = req.params
  try {
    const allSessions = await listAllSessions(userId)
    const activeSessions = allSessions
      .filter((s) => s.status === 'active')
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

    const sessions = activeSessions.map((session) => {
      const answered = session.answers.filter((a) => a.completed)
      const correct = answered.filter((a) => a.isCorrect).length
      const accuracy = answered.length > 0 ? Math.round((correct / answered.length) * 100) : 0
      return {
        sessionId: session.id,
        startedAt: session.startedAt,
        questionsAnswered: answered.length,
        totalQuestions: session.questions.length,
        accuracy,
        subject: session.subject,
      }
    })

    res.json({
      sessions,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get in-progress sessions' })
  }
})

app.get('/insights/:userId', async (req, res) => {
  const { userId } = req.params
  const allSessions = await listAllSessions(userId)
  const computed = buildInsightsPayloadFromSessions(allSessions)
  if (!computed.hasEnoughData) {
    res.json(computed)
    return
  }

  const storedInsights = await readInsightsText(userId)
  if (storedInsights) {
    res.json(parseInsightsText(storedInsights))
    return
  }

  const refreshed = await refreshInsightsFile(userId)
  res.json(refreshed)
})

app.post('/session/start', async (req, res) => {
  const userId = isGoogleAuthConfigured()
    ? ((req as AuthenticatedRequest).authSession?.userId ?? '')
    : String(req.body?.userId || '').trim()
  const questionCount = Number(req.body?.questionCount || 12)
  const requestedSubject = String(req.body?.subject || 'Multiplication').trim()
  if (!userId) {
    res.status(400).json({ error: 'userId is required' })
    return
  }
  if (!USER_ID_PATTERN.test(userId)) {
    res.status(400).json({ error: 'Invalid userId.' })
    return
  }
  if (!isSubject(requestedSubject)) {
    res.status(400).json({ error: 'subject must be Multiplication, Division, or Reading' })
    return
  }
  const exists = await userProfileExists(userId)
  if (!exists) {
    res.status(404).json({ error: 'User profile not found' })
    return
  }
  await deleteLegacySessionFiles(userId)
  const existingActiveSession = await pruneActiveSessionsForSubject(userId, requestedSubject)
  if (existingActiveSession) {
    sessions.set(sessionKey(userId, existingActiveSession.id), existingActiveSession)
    await ensureQuestionGenerated(existingActiveSession, existingActiveSession.currentIndex)
    res.json({
      sessionId: existingActiveSession.id,
      subject: existingActiveSession.subject,
      questionCount: existingActiveSession.questions.length,
      questions: existingActiveSession.questions.map((question, idx) => toClientQuestion(question, idx)),
      answers: existingActiveSession.answers,
      currentIndex: existingActiveSession.currentIndex,
      totalTokensUsed: existingActiveSession.totalTokensUsed,
    })
    return
  }
  const safeCount = requestedSubject === 'Reading'
    ? getReadingQuestionCount()
    : Math.min(15, Math.max(10, questionCount))
  const questions = Array.from({ length: safeCount }, (_, index) =>
    createQuestionPlaceholder(
      `q-${index + 1}`,
      requestedSubject === 'Reading'
        ? (index < getReadingQuestionCount() - 1 ? 'reading_page' : 'reading_summary')
        : getQuestionTypeForIndex(index),
    ),
  )
  const answers: QuestionState[] = questions.map((question, idx) => ({
    questionId: question.id,
    questionIndex: idx,
    completed: false,
    usedHelp: false,
    usedReveal: false,
    elapsedMs: 0,
  }))

  const session: SessionRecord = {
    id: createSessionId(requestedSubject),
    userId,
    subject: requestedSubject,
    status: 'active',
    startedAt: new Date().toISOString(),
    currentIndex: 0,
    questions,
    answers,
    totalTokensUsed: 0,
  }
  await ensureQuestionGenerated(session, 0)
  sessions.set(sessionKey(userId, session.id), session)
  await saveSession(session)
  if (session.status === 'completed') {
    await refreshInsightsFile(userId)
  }
  res.json({
    sessionId: session.id,
    subject: session.subject,
    questionCount: questions.length,
    questions: session.questions.map((question, idx) => toClientQuestion(question, idx)),
    answers,
    currentIndex: session.currentIndex,
    totalTokensUsed: session.totalTokensUsed,
  })
})

app.get('/users', async (_req, res) => {
  if (isGoogleAuthConfigured()) {
    const authReq = _req as AuthenticatedRequest
    if (authReq.authSession) {
      res.json({ users: [{ id: authReq.authSession.userId, name: authReq.authSession.name }] })
      return
    }
  }
  const userIds = await readUserIds()
  const users = []
  for (const userId of userIds) {
    const exists = await userProfileExists(userId)
    if (exists) {
      const profile = await readUserProfile(userId)
      users.push({ id: profile.id, name: profile.name })
    }
  }
  res.json({ users })
})

app.get('/session/:userId/:sessionId', async (req, res) => {
  const { userId, sessionId } = req.params
  const key = sessionKey(userId, sessionId)
  let session = sessions.get(key)
  if (!session) {
    session = await readSession(userId, sessionId)
    sessions.set(key, session)
  }
  await ensureQuestionGenerated(session, session.currentIndex)
  res.json({
    sessionId: session.id,
    subject: session.subject,
    status: session.status,
    currentIndex: session.currentIndex,
    questions: session.questions.map((question, idx) => toClientQuestion(question, idx)),
    answers: session.answers,
    totalTokensUsed: session.totalTokensUsed,
  })
})

app.post('/session/:userId/:sessionId/help', async (req, res) => {
  const { userId, sessionId } = req.params
  const questionIndex = Number(req.body?.questionIndex)
  const key = sessionKey(userId, sessionId)
  let session = sessions.get(key)
  if (!session) {
    session = await readSession(userId, sessionId)
    sessions.set(key, session)
  }
  if (Number.isNaN(questionIndex) || questionIndex < 0 || questionIndex >= session.questions.length) {
    res.status(400).json({ error: 'Invalid questionIndex' })
    return
  }
  const answerState = getAnswerStateAt(session, questionIndex)
  const question = getQuestionAt(session, questionIndex)
  if (!answerState || !question) {
    res.status(404).json({ error: 'Question not found' })
    return
  }
  await ensureQuestionGenerated(session, questionIndex)
  const hydratedQuestion = getQuestionAt(session, questionIndex)
  if (!hydratedQuestion) {
    res.status(404).json({ error: 'Question not found' })
    return
  }
  if (session.subject === 'Reading') {
    res.status(400).json({ error: 'Hints are not available for reading pages.' })
    return
  }
  answerState.usedHelp = true
  let helpSteps = hydratedQuestion.helpSteps
  let helpSource: 'openai' | 'rule-based' = 'rule-based'
  if (isOpenAIConfigured()) {
    try {
      helpSteps = await generateHintSteps(hydratedQuestion.prompt)
      helpSource = 'openai'
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenAI hint generation failed'
      res.status(502).json({ error: message })
      return
    }
  }
  // Accumulate tokens from hint generation
  const hintStats = flushCallStats()
  session.totalTokensUsed = (session.totalTokensUsed ?? 0) + hintStats.reduce((sum, s) => sum + s.totalTokens, 0)
  await saveSession(session)
  res.json({
    helpSteps,
    helpSource,
    totalTokensUsed: session.totalTokensUsed,
  })
})

app.post('/session/:userId/:sessionId/reveal', async (req, res) => {
  const { userId, sessionId } = req.params
  const questionIndex = Number(req.body?.questionIndex)
  const key = sessionKey(userId, sessionId)
  let session = sessions.get(key)
  if (!session) {
    session = await readSession(userId, sessionId)
    sessions.set(key, session)
  }
  if (Number.isNaN(questionIndex) || questionIndex < 0 || questionIndex >= session.questions.length) {
    res.status(400).json({ error: 'Invalid questionIndex' })
    return
  }
  const answerState = getAnswerStateAt(session, questionIndex)
  const question = getQuestionAt(session, questionIndex)
  if (!answerState || !question) {
    res.status(404).json({ error: 'Question not found' })
    return
  }
  await ensureQuestionGenerated(session, questionIndex)
  const hydratedQuestion = getQuestionAt(session, questionIndex)
  if (!hydratedQuestion) {
    res.status(404).json({ error: 'Question not found' })
    return
  }
  if (session.subject === 'Reading') {
    res.status(400).json({ error: 'Show answer is not available in reading mode.' })
    return
  }
  answerState.usedReveal = true
  answerState.completed = true
  answerState.isCorrect = false
  if (questionIndex === session.currentIndex && session.currentIndex < session.questions.length - 1) {
    session.currentIndex += 1
    await ensureQuestionGenerated(session, session.currentIndex)
  } else if (questionIndex === session.currentIndex) {
    session.status = 'completed'
    session.completedAt = new Date().toISOString()
  }
  await saveSession(session)
  res.json({
    correctAnswer: hydratedQuestion.answer,
    explanation: hydratedQuestion.explanation,
    currentIndex: session.currentIndex,
    answers: session.answers,
    questions: session.questions.map((item, idx) => toClientQuestion(item, idx)),
  })
})

app.post('/session/:userId/:sessionId/answer', async (req, res) => {
  const { userId, sessionId } = req.params
  const questionIndex = Number(req.body?.questionIndex)
  const answerRaw = String(req.body?.answer ?? '')
  const elapsedMs = Number(req.body?.elapsedMs || 0)
  const selfRating = Number(req.body?.selfRating || 3)
  const key = sessionKey(userId, sessionId)
  let session = sessions.get(key)
  if (!session) {
    session = await readSession(userId, sessionId)
    sessions.set(key, session)
  }
  if (questionIndex !== session.currentIndex) {
    res.status(400).json({ error: 'You can only submit the current question' })
    return
  }
  const question = getQuestionAt(session, questionIndex)
  const state = getAnswerStateAt(session, questionIndex)
  if (!question || !state) {
    res.status(404).json({ error: 'Question not found' })
    return
  }
  await ensureQuestionGenerated(session, questionIndex)
  const hydratedQuestion = getQuestionAt(session, questionIndex)
  if (!hydratedQuestion) {
    res.status(404).json({ error: 'Question not found' })
    return
  }

  if (session.subject === 'Reading') {
    if (hydratedQuestion.kind === 'reading-page') {
      state.completed = true
      state.isCorrect = true
      state.elapsedMs = Math.max(0, elapsedMs)
      if (session.currentIndex < session.questions.length - 1) {
        session.currentIndex += 1
        await ensureQuestionGenerated(session, session.currentIndex)
      } else {
        session.status = 'completed'
        session.completedAt = new Date().toISOString()
      }
      await saveSession(session)
      res.json({
        isCorrect: true,
        explanation: 'Nice focus. Move on to the next page when you are ready.',
        currentIndex: session.currentIndex,
        status: session.status,
        answers: session.answers,
        questions: session.questions.map((item, idx) => toClientQuestion(item, idx)),
        totalTokensUsed: session.totalTokensUsed,
      })
      return
    }

    const summaryText = answerRaw.trim()
    if (!summaryText) {
      res.status(400).json({ error: 'Please write a short summary before submitting.' })
      return
    }
    const readingResult = evaluateReadingSummary(session.questions, session.answers, summaryText)
    state.userTextAnswer = summaryText
    state.completed = true
    state.isCorrect = readingResult.overallScore >= 7
    state.elapsedMs = Math.max(0, elapsedMs)
    state.readingScore = readingResult.overallScore
    state.comprehensionScore = readingResult.comprehensionScore
    state.speedScore = readingResult.speedScore
    state.readingWpm = readingResult.averageWpm
    session.status = 'completed'
    session.completedAt = new Date().toISOString()
    await saveSession(session)
    await refreshInsightsFile(userId)
    res.json({
      isCorrect: state.isCorrect,
      explanation: readingResult.explanation,
      currentIndex: session.currentIndex,
      status: session.status,
      answers: session.answers,
      questions: session.questions.map((item, idx) => toClientQuestion(item, idx)),
      totalTokensUsed: session.totalTokensUsed,
    })
    return
  }

  const parsed = parseAnswer(answerRaw)
  if (parsed === null) {
    res.status(400).json({ error: 'Please enter a number or fraction (e.g. 0.6 or 3/5)' })
    return
  }
  const isCorrect = isAnswerCorrect(parsed, hydratedQuestion.answer, hydratedQuestion.tolerance)
  state.userAnswer = parsed
  state.isCorrect = isCorrect
  if (isCorrect) {
    state.completed = true
    state.selfRating = Math.min(5, Math.max(1, selfRating))
    state.elapsedMs = Math.max(0, elapsedMs)
    if (session.currentIndex < session.questions.length - 1) {
      session.currentIndex += 1
      await ensureQuestionGenerated(session, session.currentIndex)
    } else {
      session.status = 'completed'
      session.completedAt = new Date().toISOString()
    }
  } else {
    state.completed = false
  }
  await saveSession(session)
  let explanation: string
  if (isOpenAIConfigured()) {
    try {
      explanation = await generateExplanation(hydratedQuestion.prompt, parsed, hydratedQuestion.answer, isCorrect)
    } catch (err) {
      console.warn('OpenAI explanation generation failed, using static fallback:', err)
      explanation = isCorrect
        ? 'Great work. Your steps are correct.'
        : 'Not quite yet. Try using Need Help for step-by-step hints or Show Answer when you want the full solution.'
    }
  } else {
    explanation = isCorrect
      ? 'Great work. Your steps are correct.'
      : 'Not quite yet. Try using Need Help for step-by-step hints or Show Answer when you want the full solution.'
  }
  // Accumulate tokens from explanation generation
  const explStats = flushCallStats()
  session.totalTokensUsed = (session.totalTokensUsed ?? 0) + explStats.reduce((sum, s) => sum + s.totalTokens, 0)
  await saveSession(session)
  if (session.status === 'completed') {
    await refreshInsightsFile(userId)
  }

  res.json({
    isCorrect,
    explanation,
    currentIndex: session.currentIndex,
    status: session.status,
    answers: session.answers,
    questions: session.questions.map((item, idx) => toClientQuestion(item, idx)),
    totalTokensUsed: session.totalTokensUsed,
  })
})

app.post('/session/:userId/:sessionId/pause', async (req, res) => {
  const { userId, sessionId } = req.params
  const questionIndex = Number(req.body?.questionIndex)
  const elapsedMs = Number(req.body?.elapsedMs || 0)
  const key = sessionKey(userId, sessionId)
  let session = sessions.get(key)
  if (!session) {
    session = await readSession(userId, sessionId)
    sessions.set(key, session)
  }
  if (Number.isNaN(questionIndex) || questionIndex < 0 || questionIndex >= session.questions.length) {
    res.status(400).json({ error: 'Invalid questionIndex' })
    return
  }
  const answerState = getAnswerStateAt(session, questionIndex)
  if (!answerState) {
    res.status(404).json({ error: 'Question not found' })
    return
  }
  answerState.elapsedMs = Math.max(0, elapsedMs)
  await saveSession(session)
  res.json({ ok: true, answers: session.answers })
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'aplc-server' })
})

app.get('/config/openai', (_req, res) => {
  res.json({ configured: isOpenAIConfigured() })
})

app.get('/config/auth', noStore, (_req, res) => {
  res.json({
    googleConfigured: isGoogleAuthConfigured(),
    googleClientId: getPublicGoogleClientId(),
  })
})

if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir))
  app.get(/^\/(?!auth\/|users$|dashboard\/|sessions\/in-progress\/|insights\/|session\/|config\/|health$).*/, (_req, res) => {
    res.sendFile(clientIndexPath)
  })
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unhandled server error'
  console.error('Unhandled route error:', err)
  res.status(500).json({ error: message })
})

export function resetInMemoryState(): void {
  sessions.clear()
  rateLimitStore.clear()
}

export function startServer(listenPort = port) {
  const server = app.listen(listenPort, () => {
    console.log(`APLC server running on port ${listenPort}`)
  })

  server.on('error', (error) => {
    console.error('Server runtime error:', error)
  })

  return server
}

export { app }

if (process.env.NODE_ENV !== 'test') {
  startServer()

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason)
  })

  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error)
  })
}
