import * as appInsights from 'applicationinsights'
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  appInsights.setup().setAutoCollectRequests(true).setAutoCollectPerformance(true, false).setAutoCollectExceptions(true).setAutoCollectDependencies(true).start()
}

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
  readSession,
  readUserProfile,
  readUserIds,
  saveInsightsText,
  userProfileExists,
  saveSession,
} from './storage'
import type { QuestionState, SessionMode, SessionRecord, Subject } from './types'
import { createQuestionPlaceholder, generateQuestionByType, getQuestionTypeForIndex, isAnswerCorrect, parseAnswer } from './utils'
import { generateHintSteps, generateExplanation, isOpenAIConfigured, flushCallStats } from './openai'
import {
  createReadingAssessmentQuestion,
  createReadingQuestionSetAsync,
  evaluateReadingQuiz,
  evaluateReadingSummary,
  getReadingGenerationInputs,
  getReadingAssessmentMode,
  getReadingQuestionCount,
} from './reading'
import { logger, requestLogger, asyncHandler } from './logger'

const app = express()
const port = Number(process.env.PORT || 3001)
const clientDistDir = path.resolve(process.cwd(), '../client/dist')
const clientIndexPath = path.join(clientDistDir, 'index.html')
const USER_ID_PATTERN = /^[a-z0-9_-]{1,64}$/i
const SESSION_ID_PATTERN = /^\d{8}-\d{6}-(Multiplication|Division|Reading)$/
const DAILY_TARGET_MS = 60 * 60 * 1000

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
app.use(requestLogger)

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

function isSessionMode(value: string): value is SessionMode {
  return value === 'guided' || value === 'quiz'
}

function getSessionMode(session: SessionRecord): SessionMode {
  return session.sessionMode ?? 'guided'
}

function getIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function getSessionPracticeTimeMs(session: SessionRecord): number {
  return session.answers.reduce((sum, answer) => sum + Math.max(0, answer.elapsedMs ?? 0), 0)
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
  recommendedFocus: string[]
  bySubject: SubjectInsight[]
  overall: {
    completedSessions: number
    totalQuestionsAnswered: number
    strongestSubject: Subject | null
    needsAttentionSubject: Subject | null
    subjectSessionBreakdown: Record<Subject, number>
  }
}

type InsightTrend = 'improving' | 'steady' | 'declining'

type SubjectInsight = {
  subject: Subject
  trend: InsightTrend
  sessionsCompleted: number
  headline: string
  strengths: string[]
  focusAreas: string[]
  recommendedNextStep: string
  metrics: {
    accuracy: number | null
    avgSeconds: number | null
    revealRate: number | null
    averageWpm: number | null
    comprehensionScore: number | null
    readingScore: number | null
  }
}

type MissionStatus = 'done' | 'in-progress' | 'up-next'
type MasteryStage = 'mastered' | 'developing' | 'fragile'

type WeeklyMissionItem = {
  id: string
  label: string
  detail: string
  status: MissionStatus
}

type RevisitItem = {
  subject: Subject
  skill: string
  reason: string
  action: string
}

type MasterySkill = {
  key: string
  label: string
  stage: MasteryStage
  accuracy: number | null
  evidenceCount: number
}

type MasterySubject = {
  subject: Subject
  summary: string
  overallStage: MasteryStage
  skills: MasterySkill[]
}

type ParentReview = {
  celebration: string[]
  watchlist: string[]
  supportMoves: string[]
}

type HabitSignal = {
  label: string
  value: string
  tone: 'strong' | 'steady' | 'watch'
}

type LearningCoach = {
  weeklyMission: {
    title: string
    subtitle: string
    items: WeeklyMissionItem[]
  }
  revisitQueue: RevisitItem[]
  masteryBySubject: MasterySubject[]
  parentReview: ParentReview
  habitSignals: HabitSignal[]
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

type AdaptiveNotification = {
  kind: 'difficulty-up' | 'difficulty-down' | 'reading-warning'
  title: string
  message: string
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
    quizItems: question.quizItems?.map((item) => ({
      id: item.id,
      prompt: item.prompt,
      options: item.options,
    })),
    index,
  }
}

async function ensureQuestionGenerated(session: SessionRecord, index: number): Promise<void> {
  const existing = session.questions[index]
  if (!existing || existing.generated) {
    return
  }

  if (session.subject === 'Reading') {
    const readingOptions = {
      ...(session.readingChallengeTier ? { challengeTier: session.readingChallengeTier } : {}),
      ...(session.readingPerformanceSummary ? { performanceSummary: session.readingPerformanceSummary } : {}),
      ...(session.readingPriorTitles ? { priorTitles: session.readingPriorTitles } : {}),
    }
    session.questions = await createReadingQuestionSetAsync(session.id, readingOptions)
  } else {
    session.questions[index] = generateQuestionByType(existing.id, existing.type, session.subject, session.adaptiveDifficultyLevel ?? 3)
  }
  await saveSession(session)
}

function clampDifficultyLevel(level: number): number {
  return Math.min(5, Math.max(1, Math.round(level)))
}

function getCompletedMathAnswersForSubject(allSessions: SessionRecord[], subject: Subject): Array<{
  answer: QuestionState
  session: SessionRecord
}> {
  return allSessions
    .filter((session) => session.status === 'completed' && session.subject === subject)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .flatMap((session) =>
      session.answers
        .filter((answer) => answer.completed)
        .map((answer) => ({ answer, session })),
    )
}

function computeAdaptiveDifficultyLevel(allSessions: SessionRecord[], subject: Subject): number {
  if (subject === 'Reading') return 3

  const recentAnswers = getCompletedMathAnswersForSubject(allSessions, subject).slice(0, 20)
  if (recentAnswers.length < 6) return 3

  const correctCount = recentAnswers.filter(({ answer }) => answer.isCorrect).length
  const firstAttemptCorrectCount = recentAnswers.filter(({ answer }) =>
    answer.firstAttemptCorrect ?? (answer.isCorrect && (answer.attemptCount ?? 1) <= 1 && !answer.usedHelp && !answer.usedReveal),
  ).length
  const slowCount = recentAnswers.filter(({ answer }) => answer.elapsedMs >= 120_000).length
  const helpOrRevealCount = recentAnswers.filter(({ answer }) => answer.usedHelp || answer.usedReveal).length
  const avgSeconds = Math.round(recentAnswers.reduce((sum, { answer }) => sum + answer.elapsedMs, 0) / recentAnswers.length / 1000)

  const accuracy = Math.round((correctCount / recentAnswers.length) * 100)
  const firstAttemptRate = Math.round((firstAttemptCorrectCount / recentAnswers.length) * 100)
  const supportRate = Math.round((helpOrRevealCount / recentAnswers.length) * 100)
  let level = 3

  if (accuracy >= 90) level += 1
  if (accuracy >= 96 && firstAttemptRate >= 88 && avgSeconds <= 70) level += 1
  if (firstAttemptRate < 72) level -= 1
  if (accuracy < 72) level -= 1
  if (avgSeconds > 120 || slowCount >= Math.ceil(recentAnswers.length / 3)) level -= 1
  if (supportRate > 20) level -= 1

  return clampDifficultyLevel(level)
}

function maybeAdjustDifficulty(
  session: SessionRecord,
  state: QuestionState,
  reason: 'wrong-first-attempt' | 'correct-answer' | 'reveal',
): AdaptiveNotification | null {
  if (session.subject === 'Reading') return null

  const currentLevel = clampDifficultyLevel(session.adaptiveDifficultyLevel ?? 3)
  let momentum = session.adaptiveMomentum ?? 0
  let questionsSinceChange = session.adaptiveQuestionsSinceChange ?? 0
  const attemptCount = state.attemptCount ?? 0
  const elapsedMs = state.elapsedMs ?? 0
  const usedSupport = state.usedHelp || state.usedReveal

  if (reason === 'wrong-first-attempt') {
    momentum -= elapsedMs >= 150_000 ? 0.85 : 0.65
  } else if (reason === 'reveal') {
    momentum -= elapsedMs >= 150_000 || state.usedHelp ? 1.1 : 0.9
  } else {
    const firstAttemptCorrect = state.firstAttemptCorrect ?? false
    const veryFast = elapsedMs > 0 && elapsedMs <= 40_000
    const solidPace = elapsedMs > 0 && elapsedMs <= 70_000
    const verySlow = elapsedMs >= 150_000
    const supported = usedSupport || attemptCount > 1

    if (firstAttemptCorrect && !supported && veryFast) momentum += 0.9
    else if (firstAttemptCorrect && !supported && solidPace) momentum += 0.65
    else if (firstAttemptCorrect && !supported && elapsedMs <= 95_000) momentum += 0.35
    else if (state.usedReveal || verySlow || attemptCount >= 3) momentum -= 0.75
    else if (usedSupport || attemptCount > 1 || elapsedMs >= 120_000) momentum -= 0.45
    else momentum += 0.1
  }

  questionsSinceChange += 1
  session.adaptiveMomentum = Number(momentum.toFixed(2))
  session.adaptiveQuestionsSinceChange = questionsSinceChange
  if (questionsSinceChange >= 3 && session.adaptiveMomentum >= 2.3 && currentLevel < 5) {
    session.adaptiveDifficultyLevel = currentLevel + 1
    session.adaptiveMomentum = 0.35
    session.adaptiveQuestionsSinceChange = 0
    return {
      kind: 'difficulty-up',
      title: 'Leveling Up',
      message: `You have been steadily answering with strong focus, so I’m nudging the next ${session.subject.toLowerCase()} questions up just a little to keep things interesting.`,
    }
  }

  if (questionsSinceChange >= 3 && session.adaptiveMomentum <= -2.3 && currentLevel > 1) {
    session.adaptiveDifficultyLevel = currentLevel - 1
    session.adaptiveMomentum = -0.35
    session.adaptiveQuestionsSinceChange = 0
    return {
      kind: 'difficulty-down',
      title: 'Dialing It Down',
      message: `This set looks a bit heavy right now, so I’m dialing the next ${session.subject.toLowerCase()} questions down slightly to help you rebuild confidence and keep enjoying the practice.`,
    }
  }

  return null
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function getSubjectSessionTrend(subject: Subject, sessions: SessionRecord[]): InsightTrend {
  if (sessions.length < 2) return 'steady'

  const latestCount = sessions.length >= 4 ? 2 : 1
  const latestSessions = sessions.slice(0, latestCount)
  const previousSessions = sessions.slice(latestCount, latestCount + Math.min(3, sessions.length - latestCount))
  if (previousSessions.length === 0) return 'steady'

  const getMathSessionScore = (session: SessionRecord): number | null => {
    const completedAnswers = session.answers.filter((answer) => answer.completed)
    if (completedAnswers.length === 0) return null

    const accuracy = (completedAnswers.filter((answer) => answer.isCorrect).length / completedAnswers.length) * 100
    const avgSeconds = completedAnswers.reduce((sum, answer) => sum + answer.elapsedMs, 0) / completedAnswers.length / 1000
    const revealRate = (completedAnswers.filter((answer) => answer.usedReveal).length / completedAnswers.length) * 100
    const firstAttemptRate = (
      completedAnswers.filter((answer) =>
        answer.firstAttemptCorrect ?? (answer.isCorrect && (answer.attemptCount ?? 1) <= 1 && !answer.usedHelp && !answer.usedReveal),
      ).length / completedAnswers.length
    ) * 100

    const paceScore = Math.max(0, Math.min(100, 100 - Math.max(avgSeconds - 55, 0) * 0.7))
    const independenceScore = Math.max(0, 100 - revealRate * 2)
    return accuracy * 0.5 + firstAttemptRate * 0.25 + paceScore * 0.15 + independenceScore * 0.1
  }

  const getReadingSessionScore = (session: SessionRecord): number | null => {
    const summaryAnswers = session.answers.filter((answer) => answer.completed && typeof answer.readingScore === 'number')
    if (summaryAnswers.length === 0) return null

    return summaryAnswers.reduce((sum, answer) => {
      const readingQuality = (answer.readingScore ?? 0) * 10
      const comprehension = (answer.comprehensionScore ?? 0) * 10
      return sum + readingQuality * 0.65 + comprehension * 0.35
    }, 0) / summaryAnswers.length
  }

  const getSessionScore = subject === 'Reading' ? getReadingSessionScore : getMathSessionScore
  const latestAverage = average(latestSessions.map(getSessionScore).filter((score): score is number => score !== null))
  const previousAverage = average(previousSessions.map(getSessionScore).filter((score): score is number => score !== null))

  if (latestAverage === null || previousAverage === null) return 'steady'

  const delta = latestAverage - previousAverage
  if (delta >= 6) return 'improving'
  if (delta <= -6) return 'declining'
  return 'steady'
}

function getMasteryStage(score: number | null, evidenceCount: number): MasteryStage {
  if (score === null || evidenceCount < 2) return 'developing'
  if (score >= 85 && evidenceCount >= 3) return 'mastered'
  if (score < 65) return 'fragile'
  return 'developing'
}

function formatSubjectLabel(subject: Subject): string {
  return subject.toLowerCase()
}

function buildLearningCoach(allSessions: SessionRecord[]): LearningCoach {
  const completedSessions = allSessions
    .filter((session) => session.status === 'completed')
    .sort((a, b) => new Date(b.completedAt ?? b.startedAt).getTime() - new Date(a.completedAt ?? a.startedAt).getTime())
  const subjects: Subject[] = ['Multiplication', 'Division', 'Reading']
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(weekStart.getDate() - 6)

  const completedThisWeek = completedSessions.filter((session) => new Date(session.completedAt ?? session.startedAt).getTime() >= weekStart.getTime())
  const completedThisWeekBySubject = Object.fromEntries(subjects.map((subject) => [subject, completedThisWeek.filter((session) => session.subject === subject).length])) as Record<Subject, number>

  const masteryBySubject: MasterySubject[] = subjects.map((subject) => {
    const subjectSessions = completedSessions.filter((session) => session.subject === subject)

    if (subject === 'Reading') {
      const readingAssessments = subjectSessions
        .map((session) => session.answers.find((answer) => answer.completed && typeof answer.readingScore === 'number'))
        .filter((answer): answer is NonNullable<typeof answer> => Boolean(answer))

      const comprehensionAvg = readingAssessments.length > 0
        ? Math.round(readingAssessments.reduce((sum, answer) => sum + (answer.comprehensionScore ?? 0), 0) / readingAssessments.length * 10)
        : null
      const paceAvg = readingAssessments.length > 0
        ? Math.round(readingAssessments.reduce((sum, answer) => sum + (answer.readingWpm ?? 0), 0) / readingAssessments.length)
        : null
      const staminaScore = readingAssessments.length > 0
        ? Math.round(readingAssessments.reduce((sum, answer) => sum + (answer.readingScore ?? 0), 0) / readingAssessments.length * 10)
        : null

      const comprehensionStage = getMasteryStage(comprehensionAvg, readingAssessments.length)
      const paceStage = paceAvg === null || readingAssessments.length < 2
        ? 'developing'
        : paceAvg >= 160 && paceAvg <= 180
          ? 'mastered'
          : paceAvg < 145
            ? 'fragile'
            : 'developing'
      const staminaStage = getMasteryStage(staminaScore, readingAssessments.length)
      const overallScore = average([comprehensionAvg ?? 0, paceAvg !== null ? Math.min(100, Math.round((paceAvg / 170) * 100)) : 0, staminaScore ?? 0].filter((value) => value > 0))
      const overallStage = getMasteryStage(overallScore, readingAssessments.length)

      return {
        subject,
        overallStage,
        summary: readingAssessments.length > 0
          ? `Reading is ${overallStage === 'mastered' ? 'settling into a strong groove' : overallStage === 'fragile' ? 'still feeling inconsistent' : 'developing nicely'}, especially around comprehension and pace control.`
          : 'Reading needs a few completed sessions before mastery patterns become reliable.',
        skills: [
          { key: 'reading-comprehension', label: 'Comprehension', stage: comprehensionStage, accuracy: comprehensionAvg, evidenceCount: readingAssessments.length },
          { key: 'reading-pace', label: 'Pace Control', stage: paceStage, accuracy: paceAvg !== null ? Math.min(100, Math.round((paceAvg / 170) * 100)) : null, evidenceCount: readingAssessments.length },
          { key: 'reading-stamina', label: 'Reading Quality', stage: staminaStage, accuracy: staminaScore, evidenceCount: readingAssessments.length },
        ],
      }
    }

    const skillStats = new Map<string, { total: number; correct: number }>()
    for (const session of subjectSessions) {
      for (const answer of session.answers) {
        if (!answer.completed) continue
        const question = session.questions[answer.questionIndex]
        const key = question?.type ?? 'mixed'
        const current = skillStats.get(key) ?? { total: 0, correct: 0 }
        current.total += 1
        if (answer.isCorrect) current.correct += 1
        skillStats.set(key, current)
      }
    }

    const skills = [...skillStats.entries()]
      .map(([key, stats]) => {
        const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : null
        return {
          key,
          label: key.replace('_', ' ').replace(/^\w/, (char) => char.toUpperCase()),
          stage: getMasteryStage(accuracy, stats.total),
          accuracy,
          evidenceCount: stats.total,
        }
      })
      .sort((a, b) => {
        const rank = { fragile: 0, developing: 1, mastered: 2 }
        return rank[a.stage] - rank[b.stage]
      })

    const overallAccuracy = skills.length > 0 ? Math.round(skills.reduce((sum, skill) => sum + (skill.accuracy ?? 0), 0) / skills.length) : null
    const overallStage = getMasteryStage(overallAccuracy, subjectSessions.length)

    return {
      subject,
      overallStage,
      summary: subjectSessions.length > 0
        ? `${subject} is ${overallStage === 'mastered' ? 'showing reliable mastery' : overallStage === 'fragile' ? 'still shaky in important spots' : 'moving forward, but not stable yet'}.`
        : `No stable mastery signal yet for ${formatSubjectLabel(subject)}.`,
      skills,
    }
  })

  const revisitQueue = masteryBySubject
    .flatMap((subject) =>
      subject.skills
        .filter((skill) => skill.stage !== 'mastered')
        .slice(0, 2)
        .map((skill) => ({
          subject: subject.subject,
          skill: skill.label,
          reason: skill.stage === 'fragile'
            ? `${skill.label} has been a repeat wobble in ${formatSubjectLabel(subject.subject)}.`
            : `${skill.label} is improving, but it still needs another calm repetition cycle.`,
          action: subject.subject === 'Reading'
            ? skill.label === 'Pace Control'
              ? 'Do one careful reading session and aim for steady pace with full meaning.'
              : 'Use the next reading session to pause after each page and say the key idea out loud.'
            : `Start the next ${formatSubjectLabel(subject.subject)} session and take extra care on ${skill.label.toLowerCase()} questions.`,
        }))
    )
    .slice(0, 4)

  const weakestSubject = [...masteryBySubject].sort((a, b) => {
    const rank = { fragile: 0, developing: 1, mastered: 2 }
    return rank[a.overallStage] - rank[b.overallStage]
  })[0]?.subject ?? 'Multiplication'

  const revealAnswers = completedSessions.flatMap((session) => session.answers.filter((answer) => answer.completed && answer.usedReveal))
  const totalCompletedAnswers = completedSessions.flatMap((session) => session.answers.filter((answer) => answer.completed))
  const revealRate = totalCompletedAnswers.length > 0 ? Math.round((revealAnswers.length / totalCompletedAnswers.length) * 100) : 0
  const firstAttemptRate = totalCompletedAnswers.length > 0
    ? Math.round((totalCompletedAnswers.filter((answer) => answer.firstAttemptCorrect ?? (answer.isCorrect && (answer.attemptCount ?? 1) <= 1 && !answer.usedHelp && !answer.usedReveal)).length / totalCompletedAnswers.length) * 100)
    : 0
  const avgResponseSeconds = totalCompletedAnswers.length > 0
    ? Math.round(totalCompletedAnswers.reduce((sum, answer) => sum + answer.elapsedMs, 0) / totalCompletedAnswers.length / 1000)
    : 0

  const weeklyMissionItems: WeeklyMissionItem[] = [
    {
      id: 'consistency',
      label: 'Build a 3-session week',
      detail: `${completedThisWeek.length}/3 sessions completed in the last 7 days.`,
      status: completedThisWeek.length >= 3 ? 'done' : completedThisWeek.length > 0 ? 'in-progress' : 'up-next',
    },
    {
      id: 'revisit',
      label: `Strengthen ${formatSubjectLabel(weakestSubject)}`,
      detail: `${completedThisWeekBySubject[weakestSubject]} sessions this week in the subject that needs the most support right now.`,
      status: completedThisWeekBySubject[weakestSubject] >= 2 ? 'done' : completedThisWeekBySubject[weakestSubject] >= 1 ? 'in-progress' : 'up-next',
    },
    {
      id: 'independence',
      label: 'Use hints before reveals',
      detail: `Current reveal rate is ${revealRate}%. The goal is calmer independence before showing the full answer.`,
      status: revealRate <= 10 ? 'done' : revealRate <= 20 ? 'in-progress' : 'up-next',
    },
  ]

  const habitSignals: HabitSignal[] = [
    {
      label: 'First-Try Success',
      value: `${firstAttemptRate}%`,
      tone: firstAttemptRate >= 80 ? 'strong' : firstAttemptRate >= 65 ? 'steady' : 'watch',
    },
    {
      label: 'Independence',
      value: `${Math.max(0, 100 - revealRate)}%`,
      tone: revealRate <= 10 ? 'strong' : revealRate <= 20 ? 'steady' : 'watch',
    },
    {
      label: 'Working Pace',
      value: avgResponseSeconds > 0 ? `${avgResponseSeconds}s avg` : 'Building',
      tone: avgResponseSeconds > 0 && avgResponseSeconds <= 110 ? 'strong' : avgResponseSeconds > 0 && avgResponseSeconds <= 145 ? 'steady' : 'watch',
    },
  ]

  const parentReview: ParentReview = {
    celebration: [
      completedThisWeek.length >= 3
        ? 'Adi is showing healthy learning rhythm this week, which is excellent for habit formation.'
        : completedSessions.length >= 3
          ? 'Adi has enough completed work now for patterns to become meaningful and coachable.'
          : 'Adi is still early in the journey, but the app is starting to gather useful learning signals.',
      firstAttemptRate >= 75
        ? 'First-try success is strong, which suggests growing confidence and better self-checking.'
        : 'Adi is still learning to settle before submitting, which is normal and coachable.',
      revealRate <= 12
        ? 'Reveal usage is low, showing that independence is growing.'
        : 'Adi is still leaning on full reveals more than ideal, but that is a clear target we can improve.',
    ].slice(0, 3),
    watchlist: [
      ...(revealRate > 20 ? [`Reveal usage is ${revealRate}%, which may mean frustration is rising before he fully tries the problem.`] : []),
      ...(avgResponseSeconds > 145 ? [`Average response time is ${avgResponseSeconds}s, so cognitive load may be running a little high.`] : []),
      ...masteryBySubject
        .filter((subject) => subject.overallStage === 'fragile')
        .map((subject) => `${subject.subject} currently looks fragile and would benefit from short, repeated wins.`),
    ].slice(0, 3),
    supportMoves: [
      'Praise calm effort, not just correct answers, especially after a hard question set.',
      weakestSubject === 'Reading'
        ? 'Ask Adi to tell you the main idea of each page aloud before rushing ahead.'
        : `Invite one short ${formatSubjectLabel(weakestSubject)} session tomorrow rather than a long catch-up block.`,
      revealRate > 20
        ? 'When he feels stuck, encourage Hint first and Show second so he still practices thinking.'
        : 'Keep sessions short and steady so the app stays associated with progress, not pressure.',
    ],
  }

  return {
    weeklyMission: {
      title: 'This Week\'s Learning Path',
      subtitle: 'A small set of clear wins helps Adi stay motivated, capable, and consistent.',
      items: weeklyMissionItems,
    },
    revisitQueue,
    masteryBySubject,
    parentReview,
    habitSignals,
  }
}

function buildInsightsPayloadFromSessions(allSessions: SessionRecord[]): InsightPayload {
  const completedSessions = allSessions.filter((session) => session.status === 'completed')

  if (completedSessions.length < 3) {
    return {
      hasEnoughData: false,
      message: 'We need at least 3 completed sessions to generate insights.',
      strengths: [],
      improvements: [],
      recommendedFocus: [],
      bySubject: [],
      overall: {
        completedSessions: completedSessions.length,
        totalQuestionsAnswered: 0,
        strongestSubject: null,
        needsAttentionSubject: null,
        subjectSessionBreakdown: {
          Multiplication: 0,
          Division: 0,
          Reading: 0,
        },
      },
    }
  }

  const subjects: Subject[] = ['Multiplication', 'Division', 'Reading']
  const overall = {
    totalQuestionsAnswered: 0,
    totalCorrect: 0,
    totalTimeMs: 0,
    revealCount: 0,
  }
  const subjectScores: Array<{ subject: Subject; score: number }> = []

  const bySubject = subjects.map((subject) => {
    const subjectSessions = completedSessions
      .filter((session) => session.subject === subject)
      .sort((a, b) => new Date(b.completedAt ?? b.startedAt).getTime() - new Date(a.completedAt ?? a.startedAt).getTime())

    let totalAnswered = 0
    let totalCorrect = 0
    let totalTimeMs = 0
    let revealCount = 0
    let readingScoreTotal = 0
    let comprehensionTotal = 0
    let wpmTotal = 0
    let readingSamples = 0
    const questionTypeStats = new Map<string, { total: number; correct: number }>()

    for (const session of subjectSessions) {
      for (const answer of session.answers) {
        if (!answer.completed) continue
        totalAnswered += 1
        overall.totalQuestionsAnswered += 1
        totalTimeMs += answer.elapsedMs
        overall.totalTimeMs += answer.elapsedMs

        if (answer.isCorrect) {
          totalCorrect += 1
          overall.totalCorrect += 1
        }
        if (answer.usedReveal) {
          revealCount += 1
          overall.revealCount += 1
        }

        const question = session.questions[answer.questionIndex]
        if (question?.type) {
          const current = questionTypeStats.get(question.type) ?? { total: 0, correct: 0 }
          current.total += 1
          if (answer.isCorrect) current.correct += 1
          questionTypeStats.set(question.type, current)
        }

        if (subject === 'Reading' && typeof answer.readingScore === 'number') {
          readingScoreTotal += answer.readingScore
          comprehensionTotal += answer.comprehensionScore ?? 0
          wpmTotal += answer.readingWpm ?? 0
          readingSamples += 1
        }
      }
    }

    const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : null
    const avgSeconds = totalAnswered > 0 ? Math.round(totalTimeMs / totalAnswered / 1000) : null
    const revealRate = totalAnswered > 0 ? Math.round((revealCount / totalAnswered) * 100) : null
    const averageWpm = readingSamples > 0 ? Math.round(wpmTotal / readingSamples) : null
    const comprehensionScore = readingSamples > 0 ? Number((comprehensionTotal / readingSamples).toFixed(1)) : null
    const readingScore = readingSamples > 0 ? Number((readingScoreTotal / readingSamples).toFixed(1)) : null

    const trend = getSubjectSessionTrend(subject, subjectSessions)

    const weakestType = [...questionTypeStats.entries()]
      .filter(([, value]) => value.total >= 2)
      .sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total))[0]
    const strongestType = [...questionTypeStats.entries()]
      .filter(([, value]) => value.total >= 2)
      .sort((a, b) => (b[1].correct / b[1].total) - (a[1].correct / a[1].total))[0]

    const strengths: string[] = []
    const focusAreas: string[] = []
    let headline = `We’re just getting started in ${subject.toLowerCase()}.`
    let recommendedNextStep = `Complete more ${subject.toLowerCase()} sessions so we can tailor support more precisely.`

    if (subjectSessions.length === 0) {
      focusAreas.push(`Complete your first ${subject.toLowerCase()} session so this area can start giving Adi targeted coaching.`)
    } else if (subject === 'Reading') {
      if (readingScore !== null && readingScore >= 8) strengths.push(`Reading quality is strong at ${readingScore}/10 overall.`)
      if (averageWpm !== null && averageWpm >= 160 && averageWpm <= 180) strengths.push(`Reading pace is on target at ${averageWpm} WPM.`)
      if (comprehensionScore !== null && comprehensionScore >= 8) strengths.push(`Comprehension is a strength at ${comprehensionScore}/10.`)

      if (averageWpm !== null && averageWpm < 160) focusAreas.push(`Reading pace is ${averageWpm} WPM. Work toward the 170 WPM target pace.`)
      if (averageWpm !== null && averageWpm > 190) focusAreas.push(`Reading pace is ${averageWpm} WPM. Slow down slightly to protect comprehension.`)
      if (comprehensionScore !== null && comprehensionScore < 7) focusAreas.push(`Comprehension is ${comprehensionScore}/10. Focus on main idea and supporting details.`)

      headline = readingScore !== null
        ? `Reading is ${trend === 'improving' ? 'improving' : trend === 'declining' ? 'slipping a little' : 'holding steady'} at ${readingScore}/10 overall.`
        : 'Reading has enough data to start building a clearer pattern.'
      recommendedNextStep = comprehensionScore !== null && comprehensionScore < 7
        ? 'After each page, pause and say the main idea out loud before writing the summary.'
        : averageWpm !== null && averageWpm < 160
          ? 'Do one reading session focused on building toward a steady 170 WPM pace without losing meaning.'
          : 'Keep balancing reading pace and comprehension to deepen consistency.'
    } else {
      if (accuracy !== null && accuracy >= 85) strengths.push(`${subject} accuracy is strong at ${accuracy}%.`)
      if (avgSeconds !== null && avgSeconds <= 110) strengths.push(`You are moving through ${subject.toLowerCase()} at a confident pace (${avgSeconds}s average).`)
      if (revealRate !== null && revealRate <= 10) strengths.push(`Answer reveals are low in ${subject.toLowerCase()}, showing growing independence.`)
      if (strongestType) {
        const typeLabel = strongestType[0].replace('_', ' ')
        const niceTypeLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)
        strengths.push(`${niceTypeLabel} questions are currently the strongest ${subject.toLowerCase()} pattern.`)
      }

      if (accuracy !== null && accuracy < 80) focusAreas.push(`${subject} accuracy is ${accuracy}%. Slow down and check each step before submitting.`)
      if (avgSeconds !== null && avgSeconds > 140) focusAreas.push(`${subject} is taking ${avgSeconds}s per question. Break problems into smaller chunks.`)
      if (revealRate !== null && revealRate > 20) focusAreas.push(`Reveals are being used ${revealRate}% of the time in ${subject.toLowerCase()}. Use hints first.`)
      if (weakestType) {
        const typeLabel = weakestType[0].replace('_', ' ')
        const niceTypeLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)
        focusAreas.push(`${niceTypeLabel} questions need the most attention in ${subject.toLowerCase()}.`)
      }

      headline = accuracy !== null
        ? `${subject} accuracy is ${accuracy}% across ${subjectSessions.length} completed session${subjectSessions.length === 1 ? '' : 's'}.`
        : `${subject} needs a few more answered questions before a stable pattern appears.`
      recommendedNextStep = weakestType
        ? `Use the next ${subject.toLowerCase()} session to focus on ${weakestType[0].replace('_', ' ')} questions.`
        : `Keep building consistency in ${subject.toLowerCase()} with another completed session.`
    }

    if (strengths.length === 0) {
      strengths.push(`This subject is building a usable baseline that will get sharper with more sessions.`)
    }
    if (focusAreas.length === 0) {
      focusAreas.push(`Keep practicing ${subject.toLowerCase()} regularly to turn this consistency into a stronger advantage.`)
    }

    if (subjectSessions.length > 0) {
      const score = (accuracy ?? (readingScore !== null ? Math.round(readingScore * 10) : 0)) - (revealRate ?? 0) / 4
      subjectScores.push({ subject, score })
    }

    return {
      subject,
      trend,
      sessionsCompleted: subjectSessions.length,
      headline,
      strengths,
      focusAreas,
      recommendedNextStep,
      metrics: {
        accuracy,
        avgSeconds,
        revealRate,
        averageWpm,
        comprehensionScore,
        readingScore,
      },
    }
  })

  const overallAccuracy = overall.totalQuestionsAnswered > 0
    ? Math.round((overall.totalCorrect / overall.totalQuestionsAnswered) * 100)
    : 0
  const overallAvgSeconds = overall.totalQuestionsAnswered > 0
    ? Math.round(overall.totalTimeMs / overall.totalQuestionsAnswered / 1000)
    : 0
  const strongestSubject = [...subjectScores].sort((a, b) => b.score - a.score)[0]?.subject ?? null
  const needsAttentionSubject = [...subjectScores].sort((a, b) => a.score - b.score)[0]?.subject ?? null
  const subjectSessionBreakdown = {
    Multiplication: bySubject.find((subject) => subject.subject === 'Multiplication')?.sessionsCompleted ?? 0,
    Division: bySubject.find((subject) => subject.subject === 'Division')?.sessionsCompleted ?? 0,
    Reading: bySubject.find((subject) => subject.subject === 'Reading')?.sessionsCompleted ?? 0,
  }

  const strengths: string[] = []
  const improvements: string[] = []
  const recommendedFocus: string[] = []

  if (overallAccuracy >= 85) strengths.push(`Adi is sustaining strong overall accuracy at ${overallAccuracy}% across completed work.`)
  else if (overallAccuracy >= 70) strengths.push(`Overall accuracy is holding at ${overallAccuracy}% and trending into a stable learning zone.`)
  else improvements.push(`Overall accuracy is ${overallAccuracy}%. The next step is to prioritize careful thinking over speed.`)

  if (overallAvgSeconds > 0 && overallAvgSeconds <= 120) strengths.push(`Average response time is a healthy ${overallAvgSeconds}s, which keeps sessions moving.`)
  else if (overallAvgSeconds > 120) improvements.push(`Average response time is ${overallAvgSeconds}s. Breaking questions into smaller steps would help.`)

  if (strongestSubject) strengths.push(`${strongestSubject} is currently the clearest subject strength.`)
  if (needsAttentionSubject && needsAttentionSubject !== strongestSubject) improvements.push(`${needsAttentionSubject} is the best candidate for the next focused practice block.`)

  const improvingSubjects = bySubject.filter((subject) => subject.trend === 'improving')
  if (improvingSubjects.length > 0) {
    strengths.push(`${improvingSubjects.map((subject) => subject.subject).join(' and ')} ${improvingSubjects.length === 1 ? 'is' : 'are'} improving in recent sessions.`)
  }

  for (const subject of bySubject) {
    recommendedFocus.push(`${subject.subject}: ${subject.recommendedNextStep}`)
  }

  return {
    hasEnoughData: true,
    message: `Insights are built from ${completedSessions.length} completed sessions, with recent work weighted more heavily than older history.`,
    strengths,
    improvements,
    recommendedFocus,
    bySubject,
    overall: {
      completedSessions: completedSessions.length,
      totalQuestionsAnswered: overall.totalQuestionsAnswered,
      strongestSubject,
      needsAttentionSubject,
      subjectSessionBreakdown,
    },
  }
}

function formatInsightsText(payload: InsightPayload): string {
  return JSON.stringify(payload, null, 2)
}

async function refreshInsightsFile(userId: string): Promise<InsightPayload> {
  const allSessions = await listAllSessions(userId)
  const payload = buildInsightsPayloadFromSessions(allSessions)
  if (payload.hasEnoughData) {
    await saveInsightsText(userId, formatInsightsText(payload))
  }
  return payload
}

app.post('/auth/google', noStore, rateLimit('auth-google', 20, 10 * 60 * 1000), asyncHandler(async (req, res) => {
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
    logger.info('Google auth success', { userId: user.userId, email: user.email })
    res.json({
      token,
      user,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google sign-in failed.'
    logger.warn('Google auth failed', { error: message })
    res.status(401).json({ error: message })
  }
}))

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
app.get('/dashboard/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params
  const allSessions = await listAllSessions(userId)
    const completedSessions = allSessions.filter((s) => s.status === 'completed')
    const learningCoach = buildLearningCoach(allSessions)
    const today = new Date()
    const todayIso = getIsoDay(today)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayIso = getIsoDay(yesterday)

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
    const todayPracticeMs = allSessions
      .filter((session) => session.startedAt.slice(0, 10) === todayIso)
      .reduce((sum, session) => sum + getSessionPracticeTimeMs(session), 0)
    const yesterdayPracticeMs = allSessions
      .filter((session) => session.startedAt.slice(0, 10) === yesterdayIso)
      .reduce((sum, session) => sum + getSessionPracticeTimeMs(session), 0)

    // Current streak (consecutive days with at least one session)
    const uniqueDays = [...new Set(activityDays)].sort().reverse()
    let currentStreak = 0
    let checkDate = todayIso
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
      dailyPractice: {
        targetMs: DAILY_TARGET_MS,
        todayMs: todayPracticeMs,
        yesterdayMs: yesterdayPracticeMs,
      },
      progressInsights,
      learningCoach,
    })
}))

// In-progress session endpoint
app.get('/sessions/in-progress/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params
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
        sessionMode: getSessionMode(session),
      }
    })

    res.json({
      sessions,
    })
}))

app.get('/insights/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params
  const refreshed = await refreshInsightsFile(userId)
  res.json(refreshed)
}))

app.post('/session/start', asyncHandler(async (req, res) => {
  const userId = isGoogleAuthConfigured()
    ? ((req as AuthenticatedRequest).authSession?.userId ?? '')
    : String(req.body?.userId || '').trim()
  const questionCount = Number(req.body?.questionCount || 12)
  const requestedSubject = String(req.body?.subject || 'Multiplication').trim()
  const requestedSessionMode = String(req.body?.sessionMode || 'guided').trim()
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
  if (!isSessionMode(requestedSessionMode)) {
    res.status(400).json({ error: 'sessionMode must be guided or quiz' })
    return
  }
  const exists = await userProfileExists(userId)
  if (!exists) {
    logger.warn('Session start failed: profile not found', { userId })
    res.status(404).json({ error: 'User profile not found' })
    return
  }
  await deleteLegacySessionFiles(userId)
  const existingActiveSession = await pruneActiveSessionsForSubject(userId, requestedSubject)
  if (existingActiveSession) {
    existingActiveSession.sessionMode = getSessionMode(existingActiveSession)
    existingActiveSession.adaptiveDifficultyLevel = clampDifficultyLevel(existingActiveSession.adaptiveDifficultyLevel ?? 3)
    existingActiveSession.adaptiveMomentum = existingActiveSession.adaptiveMomentum ?? 0
    existingActiveSession.adaptiveQuestionsSinceChange = existingActiveSession.adaptiveQuestionsSinceChange ?? 0
    sessions.set(sessionKey(userId, existingActiveSession.id), existingActiveSession)
    await ensureQuestionGenerated(existingActiveSession, existingActiveSession.currentIndex)
    res.json({
      sessionId: existingActiveSession.id,
      subject: existingActiveSession.subject,
      sessionMode: getSessionMode(existingActiveSession),
      questionCount: existingActiveSession.questions.length,
      questions: existingActiveSession.questions.map((question, idx) => toClientQuestion(question, idx)),
      answers: existingActiveSession.answers,
      currentIndex: existingActiveSession.currentIndex,
      totalTokensUsed: existingActiveSession.totalTokensUsed,
      difficultyLevel: existingActiveSession.adaptiveDifficultyLevel ?? 3,
    })
    return
  }
  const allSessions = await listAllSessions(userId)
  const startingDifficultyLevel = computeAdaptiveDifficultyLevel(allSessions, requestedSubject)
  const readingGenerationInputs = requestedSubject === 'Reading'
    ? getReadingGenerationInputs(allSessions)
    : null
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
    attemptCount: 0,
  }))

  const session: SessionRecord = {
    id: createSessionId(requestedSubject),
    userId,
    subject: requestedSubject,
    sessionMode: requestedSessionMode,
    status: 'active',
    startedAt: new Date().toISOString(),
    currentIndex: 0,
    questions,
    answers,
    totalTokensUsed: 0,
    adaptiveDifficultyLevel: startingDifficultyLevel,
    adaptiveMomentum: 0,
    adaptiveQuestionsSinceChange: 0,
    ...(readingGenerationInputs
      ? {
          readingChallengeTier: readingGenerationInputs.challengeTier,
          readingPerformanceSummary: readingGenerationInputs.performanceSummary,
          readingPriorTitles: readingGenerationInputs.priorTitles,
        }
      : {}),
  }
  await ensureQuestionGenerated(session, 0)
  sessions.set(sessionKey(userId, session.id), session)
  await saveSession(session)
  if (session.status === 'completed') {
    await refreshInsightsFile(userId)
  }
  logger.info('Session started', { userId, sessionId: session.id, subject: requestedSubject })
  res.json({
    sessionId: session.id,
    subject: session.subject,
    sessionMode: getSessionMode(session),
    questionCount: questions.length,
    questions: session.questions.map((question, idx) => toClientQuestion(question, idx)),
    answers,
    currentIndex: session.currentIndex,
    totalTokensUsed: session.totalTokensUsed,
    difficultyLevel: session.adaptiveDifficultyLevel ?? 3,
  })
}))

app.get('/users', asyncHandler(async (_req, res) => {
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
}))

app.get('/session/:userId/:sessionId', asyncHandler(async (req, res) => {
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
    sessionMode: getSessionMode(session),
    status: session.status,
    currentIndex: session.currentIndex,
    questions: session.questions.map((question, idx) => toClientQuestion(question, idx)),
    answers: session.answers,
    totalTokensUsed: session.totalTokensUsed,
    difficultyLevel: session.adaptiveDifficultyLevel ?? 3,
  })
}))

app.post('/session/:userId/:sessionId/help', asyncHandler(async (req, res) => {
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
}))

app.post('/session/:userId/:sessionId/reveal', asyncHandler(async (req, res) => {
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
  answerState.attemptCount = Math.max(1, answerState.attemptCount ?? 0)
  answerState.firstAttemptCorrect = false
  answerState.elapsedMs = Math.max(answerState.elapsedMs ?? 0, Math.max(0, elapsedMs))
  const adaptiveNotification = maybeAdjustDifficulty(session, answerState, 'reveal')
  if (questionIndex === session.currentIndex && session.currentIndex < session.questions.length - 1) {
    session.currentIndex += 1
    await ensureQuestionGenerated(session, session.currentIndex)
  } else if (questionIndex === session.currentIndex) {
    session.status = 'completed'
    session.completedAt = new Date().toISOString()
  }
  await saveSession(session)
  if (session.status === 'completed') {
    await refreshInsightsFile(userId)
  }
  res.json({
    correctAnswer: hydratedQuestion.answer,
    explanation: hydratedQuestion.explanation,
    currentIndex: session.currentIndex,
    status: session.status,
    answers: session.answers,
    questions: session.questions.map((item, idx) => toClientQuestion(item, idx)),
    difficultyLevel: session.adaptiveDifficultyLevel ?? 3,
    adaptiveNotification,
  })
}))

app.post('/session/:userId/:sessionId/answer', asyncHandler(async (req, res) => {
  const { userId, sessionId } = req.params
  const questionIndex = Number(req.body?.questionIndex)
  const answerRaw = String(req.body?.answer ?? '')
  const elapsedMs = Number(req.body?.elapsedMs || 0)
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
      let adaptiveNotification: AdaptiveNotification | null = null
      if (session.currentIndex < session.questions.length - 1) {
        session.currentIndex += 1
        await ensureQuestionGenerated(session, session.currentIndex)
        if (session.currentIndex === session.questions.length - 1 && getReadingAssessmentMode(session.questions, session.answers) === 'quiz') {
          const currentQuestion = getQuestionAt(session, session.currentIndex)
          if (currentQuestion) {
            session.questions[session.currentIndex] = createReadingAssessmentQuestion(currentQuestion.id, session.questions, session.answers)
          }
          adaptiveNotification = {
            kind: 'reading-warning',
            title: 'Quick Comprehension Check',
            message: 'You read this passage very quickly, so I’m switching the final reflection to a short quiz to make sure the meaning really landed.',
          }
        }
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
        adaptiveNotification,
      })
      return
    }

    const readingResult = hydratedQuestion.kind === 'reading-quiz'
        ? (() => {
          const rawQuizAnswers = Array.isArray(req.body?.readingQuizAnswers)
            ? (req.body.readingQuizAnswers as unknown[])
            : []
          const selectedOptions = rawQuizAnswers.length > 0
            ? rawQuizAnswers.map((value: unknown): number => Number(value))
            : []
          if (
            hydratedQuestion.quizItems
            && selectedOptions.length !== hydratedQuestion.quizItems.length
          ) {
            return null
          }
          if (selectedOptions.some((value: number) => Number.isNaN(value) || value < 0)) {
            return null
          }
          state.selectedOptions = selectedOptions
          return evaluateReadingQuiz(session.questions, session.answers, selectedOptions)
        })()
      : (() => {
          const summaryText = answerRaw.trim()
          if (!summaryText) {
            return null
          }
          state.userTextAnswer = summaryText
          return evaluateReadingSummary(session.questions, session.answers, summaryText)
        })()
    if (!readingResult) {
      res.status(400).json({
        error: hydratedQuestion.kind === 'reading-quiz'
          ? 'Please answer every comprehension question before submitting.'
          : 'Please write a short summary before submitting.',
      })
      return
    }
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
      adaptiveNotification: readingResult.warning
        ? {
            kind: 'reading-warning',
            title: 'Slow Down a Touch',
            message: readingResult.warning,
          }
        : null,
    })
    return
  }

  const parsed = parseAnswer(answerRaw)
  if (parsed === null) {
    res.status(400).json({ error: 'Please enter a number or fraction (e.g. 0.6 or 3/5)' })
    return
  }
  const sessionMode = getSessionMode(session)
  const isCorrect = isAnswerCorrect(parsed, hydratedQuestion.answer, hydratedQuestion.tolerance)
  state.attemptCount = (state.attemptCount ?? 0) + 1
  state.userAnswer = parsed
  state.isCorrect = isCorrect
  let adaptiveNotification: AdaptiveNotification | null = null
  if (sessionMode === 'quiz') {
    state.completed = true
    state.elapsedMs = Math.max(state.elapsedMs ?? 0, Math.max(0, elapsedMs))
    state.firstAttemptCorrect = isCorrect && (state.attemptCount ?? 1) === 1 && !state.usedHelp && !state.usedReveal
    adaptiveNotification = maybeAdjustDifficulty(session, state, isCorrect ? 'correct-answer' : 'wrong-first-attempt')
    if (session.currentIndex < session.questions.length - 1) {
      session.currentIndex += 1
      await ensureQuestionGenerated(session, session.currentIndex)
    } else {
      session.status = 'completed'
      session.completedAt = new Date().toISOString()
    }
  } else if (isCorrect) {
    state.completed = true
    state.elapsedMs = Math.max(state.elapsedMs ?? 0, Math.max(0, elapsedMs))
    state.firstAttemptCorrect = (state.attemptCount ?? 1) === 1 && !state.usedHelp && !state.usedReveal
    adaptiveNotification = maybeAdjustDifficulty(session, state, 'correct-answer')
    if (session.currentIndex < session.questions.length - 1) {
      session.currentIndex += 1
      await ensureQuestionGenerated(session, session.currentIndex)
    } else {
      session.status = 'completed'
      session.completedAt = new Date().toISOString()
    }
  } else {
    state.completed = false
    state.firstAttemptCorrect = false
    state.elapsedMs = Math.max(state.elapsedMs ?? 0, Math.max(0, elapsedMs))
    if ((state.attemptCount ?? 0) === 1) {
      adaptiveNotification = maybeAdjustDifficulty(session, state, 'wrong-first-attempt')
    }
  }
  await saveSession(session)
  let explanation: string
  if (sessionMode === 'quiz') {
    explanation = isCorrect
      ? 'Recorded for your final score. Keep moving through the quiz.'
      : 'Recorded for your final score. You will see how you did at the end of the quiz.'
  } else if (isOpenAIConfigured()) {
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
    difficultyLevel: session.adaptiveDifficultyLevel ?? 3,
    adaptiveNotification,
  })
}))

app.post('/session/:userId/:sessionId/pause', asyncHandler(async (req, res) => {
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
}))

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
  app.use(express.static(clientDistDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store')
        return
      }

      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        return
      }

      res.setHeader('Cache-Control', 'public, max-age=0')
    },
  }))
  app.get(/^\/(?!auth\/|users$|dashboard\/|sessions\/in-progress\/|insights\/|session\/|config\/|health$).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(clientIndexPath)
  })
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unhandled server error'
  const stack = err instanceof Error ? err.stack : undefined
  logger.error('Unhandled route error', { error: message, stack })
  if (!res.headersSent) {
    res.status(500).json({ error: message })
  }
})

export function resetInMemoryState(): void {
  sessions.clear()
  rateLimitStore.clear()
}

export function startServer(listenPort = port) {
  // Startup diagnostics
  const DATA_ROOT = path.resolve(process.env.DATA_ROOT || path.resolve(process.cwd(), '../data'))
  logger.info('Starting APLC server', {
    port: listenPort,
    nodeEnv: process.env.NODE_ENV,
    googleAuth: isGoogleAuthConfigured(),
    openAI: isOpenAIConfigured(),
    dataRoot: DATA_ROOT,
    blobStorage: !!process.env.AZURE_STORAGE_ACCOUNT,
    appInsights: !!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
    corsOrigins: [...getAllowedOrigins()],
  })

  // Check data directory writability
  try {
    const testPath = path.join(DATA_ROOT, '.write-test')
    fs.writeFileSync(testPath, 'ok')
    fs.unlinkSync(testPath)
    logger.info('Data directory writable', { dataRoot: DATA_ROOT })
  } catch {
    logger.error('Data directory NOT writable', { dataRoot: DATA_ROOT })
  }

  // Check user profiles
  const usersDir = path.join(DATA_ROOT, 'users')
  if (fs.existsSync(usersDir)) {
    const userDirs = fs.readdirSync(usersDir).filter(d => fs.statSync(path.join(usersDir, d)).isDirectory())
    for (const dir of userDirs) {
      const profilePath = path.join(usersDir, dir, 'profile.json')
      const hasProfile = fs.existsSync(profilePath)
      logger.info(`User directory: ${dir}`, { hasProfile })
      if (!hasProfile) {
        logger.warn(`Missing profile.json for user: ${dir}`)
      }
    }
  } else {
    logger.warn('Users directory does not exist', { usersDir })
  }

  const server = app.listen(listenPort, () => {
    logger.info(`APLC server running on port ${listenPort}`)
  })

  server.on('error', (error) => {
    logger.error('Server runtime error', { error: error.message })
  })

  return server
}

export { app }

if (process.env.NODE_ENV !== 'test') {
  startServer()

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) })
  })

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack })
  })
}
