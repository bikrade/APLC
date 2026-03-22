import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import 'katex/dist/katex.min.css'
import './App.css'
import { formatMs, getAccuracyColor, getQuestionTypeBadge, renderMath } from './lib/sessionUi'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (
            parent: HTMLElement,
            options: Record<string, string | number>,
          ) => void
          prompt: () => void
        }
      }
    }
  }
}

/* ── Types ─────────────────────────────────────────────────── */
type Stage = 'login' | 'home' | 'session' | 'summary'
type User = { id: string; name: string }
type AuthUser = { email: string; name: string; picture?: string; userId: string }
type Subject = 'Multiplication' | 'Division' | 'Reading'
type AuthConfig = { googleConfigured: boolean; googleClientId?: string | null }

type InsightResponse = {
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
  }
}

type SubjectInsight = {
  subject: Subject
  trend: 'improving' | 'steady' | 'building' | 'needs-attention'
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

type DashboardStats = {
  totalSessions: number
  overallAccuracy: number
  avgTimePerQuestion: number
  currentStreak: number
  activityDays: string[]
  progressInsights?: ProgressInsights
}

type ProgressInsights = {
  trend: 'improving' | 'declining' | 'steady' | 'new'
  trendLabel: string
  recentAccuracy: number
  bestAccuracy: number
  totalQuestionsAnswered: number
  message: string
}

type InProgressSession = {
  sessionId: string
  startedAt: string
  questionsAnswered: number
  totalQuestions: number
  accuracy: number
  subject: Subject
}

type Question = {
  id: string
  prompt: string
  type: string
  kind?: 'math' | 'reading-page' | 'reading-summary'
  title?: string
  content?: string
  wordCount?: number
  index: number
}

type AnswerState = {
  questionId: string
  questionIndex: number
  userAnswer?: number
  userTextAnswer?: string
  isCorrect?: boolean
  completed: boolean
  selfRating?: number
  usedHelp: boolean
  usedReveal: boolean
  elapsedMs: number
  readingScore?: number
  comprehensionScore?: number
  speedScore?: number
  readingWpm?: number
}

type StartSessionResponse = {
  sessionId: string
  subject: Subject
  questionCount: number
  questions: Question[]
  answers: AnswerState[]
  currentIndex: number
  totalTokensUsed?: number
}

type SubmitAnswerResponse = {
  isCorrect: boolean
  explanation: string
  currentIndex: number
  status: 'active' | 'completed'
  answers: AnswerState[]
  questions: Question[]
  totalTokensUsed?: number
}

type HelpResponse = {
  helpSteps: string[]
  helpSource?: 'openai' | 'rule-based'
  totalTokensUsed?: number
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const BUILD_TIME_GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const AUTH_TOKEN_KEY = 'aplc_auth_token'
const SESSION_TARGET_ACCURACY = 80 // target % for the session

const ACTIVE_SUBJECTS: Array<{
  id: Subject
  iconClass: 'mult' | 'div' | 'read'
  icon: string
  description: string
}> = [
  {
    id: 'Multiplication',
    iconClass: 'mult',
    icon: '✖️',
    description: 'Decimals, fractions & percentages',
  },
  {
    id: 'Division',
    iconClass: 'div',
    icon: '➗',
    description: 'Decimals, fractions & percentages',
  },
  {
    id: 'Reading',
    iconClass: 'read',
    icon: '📖',
    description: 'Reading speed & comprehension',
  },
]
/* ── MathText Component ────────────────────────────────────── */
function MathText({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMath(text), [text])
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function getGreeting(name: string): string {
  const hour = new Date().getHours()
  if (hour < 12) return `Good morning, ${name}! ☀️`
  if (hour < 17) return `Good afternoon, ${name}! 🌤️`
  return `Good evening, ${name}! 🌙`
}

function formatCurrentDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function getCelebrationMessages(): string[] {
  return [
    '🎉 Excellent!',
    '🌟 Amazing!',
    '🔥 On Fire!',
    '💥 Brilliant!',
    '⚡ Perfect!',
    '🚀 Outstanding!',
    '🎯 Spot On!',
    '✨ Superb!',
  ]
}

function getEncouragementMessages(): string[] {
  return [
    "💪 Keep Going!",
    "🧠 You've Got This!",
    "🌱 Learning Happens!",
    "⭐ Try Again!",
    "🎮 Level Up!",
  ]
}

function formatRelativeTime(isoDate: string): string {
  const now = new Date()
  const then = new Date(isoDate)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function getSubjectTrendLabel(trend: SubjectInsight['trend']): string {
  switch (trend) {
    case 'improving':
      return 'Improving'
    case 'needs-attention':
      return 'Needs Focus'
    case 'steady':
      return 'Steady'
    default:
      return 'Building'
  }
}

function defaultInsightsMessage(): InsightResponse {
  return {
    hasEnoughData: false,
    message: 'Welcome back. Your latest progress is loading.',
    strengths: [],
    improvements: [],
    recommendedFocus: [],
    bySubject: [],
    overall: {
      completedSessions: 0,
      totalQuestionsAnswered: 0,
      strongestSubject: null,
      needsAttentionSubject: null,
    },
  }
}

/* ── Activity Heatmap Component ────────────────────────────── */
function getWindowStartDate(monthCount: number, now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() - (monthCount - 1), 1)
}

function getWindowEndDate(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0)
}

function getWeekCountForWindow(monthCount: number, now: Date): number {
  const startDate = getWindowStartDate(monthCount, now)
  const endDate = getWindowEndDate(now)
  const startGridDate = new Date(startDate)
  startGridDate.setDate(startDate.getDate() - startDate.getDay())
  const endGridDate = new Date(endDate)
  endGridDate.setDate(endDate.getDate() + (6 - endDate.getDay()))
  return Math.ceil((endGridDate.getTime() - startGridDate.getTime() + 86400000) / (7 * 86400000))
}

function ActivityHeatmap({ activityDays }: { activityDays: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const cellSize = 12
  const cellGap = 4
  const dayLabelWidth = 42
  const now = useMemo(() => new Date(), [])

  const monthsToShow = useMemo(() => {
    if (containerWidth <= 0) return 12

    const availableWidth = Math.max(containerWidth - dayLabelWidth - 24, 0)
    for (const option of [12, 6, 3]) {
      const weekCount = getWeekCountForWindow(option, now)
      const requiredWidth = weekCount * cellSize + Math.max(weekCount - 1, 0) * cellGap
      if (requiredWidth <= availableWidth) return option
    }
    return 3
  }, [containerWidth, now])

  const startDate = getWindowStartDate(monthsToShow, now)
  const endDate = getWindowEndDate(now)
  const startGridDate = new Date(startDate)
  startGridDate.setDate(startDate.getDate() - startDate.getDay())
  const endGridDate = new Date(endDate)
  endGridDate.setDate(endDate.getDate() + (6 - endDate.getDay()))

  useEffect(() => {
    const updateWidth = (): void => {
      setContainerWidth(containerRef.current?.clientWidth ?? 0)
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  const cells: { date: string; level: number; inRange: boolean }[] = []
  for (let date = new Date(startGridDate); date <= endGridDate; date.setDate(date.getDate() + 1)) {
    const iso = date.toISOString().slice(0, 10)
    const count = activityDays.filter((a) => a.slice(0, 10) === iso).length
    let level = 0
    if (count === 1) level = 1
    else if (count === 2) level = 2
    else if (count === 3) level = 3
    else if (count >= 4) level = 4
    cells.push({
      date: iso,
      level,
      inRange: date >= startDate && date <= endDate,
    })
  }

  const weeks: { date: string; level: number; inRange: boolean }[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  const visibleMonths = Array.from({ length: monthsToShow }, (_, index) =>
    new Date(startDate.getFullYear(), startDate.getMonth() + index, 1).toLocaleString('en-US', { month: 'short' }),
  )
  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', '']
  const trackWidth = weeks.length * cellSize + Math.max(weeks.length - 1, 0) * cellGap

  return (
    <div className="heatmap-panel">
      <h3 className="panel-title">📅 Practice Activity</h3>
      <div ref={containerRef} className="heatmap-chart">
        <div className="heatmap-months">
          <div className="heatmap-corner" />
          <div
            className="heatmap-month-track"
            style={{
              width: `${trackWidth}px`,
              gridTemplateColumns: `repeat(${visibleMonths.length}, minmax(0, 1fr))`,
            }}
          >
            {visibleMonths.map((label) => (
              <div key={label} className="heatmap-month-label">
                {label}
              </div>
            ))}
          </div>
        </div>
        <div className="heatmap-body">
          <div className="heatmap-days">
            {dayLabels.map((label, index) => (
              <div key={`${label}-${index}`} className="heatmap-day-label">
                {label}
              </div>
            ))}
          </div>
          <div
            className="heatmap-grid"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, ${cellSize}px)` }}
          >
            {weeks.map((week, wi) => (
              <div key={wi} className="heatmap-week">
                {week.map((cell) => (
                  <div
                    key={cell.date}
                    className={`heatmap-cell ${cell.inRange ? '' : 'outside-range'}`.trim()}
                    data-level={cell.level}
                    title={cell.inRange ? `${cell.date}: ${cell.level} session${cell.level !== 1 ? 's' : ''}` : ''}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="heatmap-legend">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <div key={l} className="heatmap-legend-cell heatmap-cell" data-level={l} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}

/* ── Score Card ────────────────────────────────────────────── */
function ScoreGauge({ correctCount, answeredCount }: { correctCount: number; answeredCount: number }) {
  return (
    <div
      className="score-fraction"
      aria-label={`${correctCount} correct out of ${answeredCount}`}
      style={{ fontSize: '34px', fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}
    >
      <span className="score-fraction-correct" style={{ color: '#58cc02' }}>{correctCount}</span>
      <span className="score-fraction-separator" style={{ color: '#1a1a2e' }}>/</span>
      <span className="score-fraction-total" style={{ color: '#1a1a2e' }}>{answeredCount}</span>
    </div>
  )
}

function App() {
  const googleButtonRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Stage>('login')
  const [users, setUsers] = useState<User[]>([])
  const [selectedUserId, setSelectedUserId] = useState('adi')
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authToken, setAuthToken] = useState('')
  const [authConfigLoaded, setAuthConfigLoaded] = useState(false)
  const [googleClientId, setGoogleClientId] = useState(BUILD_TIME_GOOGLE_CLIENT_ID ?? '')
  const [authLoading, setAuthLoading] = useState(true)
  const [googleScriptReady, setGoogleScriptReady] = useState(typeof window !== 'undefined' ? Boolean(window.google) : false)
  const [insights, setInsights] = useState<InsightResponse | null>(null)
  const [dashStats, setDashStats] = useState<DashboardStats | null>(null)
  const [inProgressSessions, setInProgressSessions] = useState<InProgressSession[]>([])
  const [sessionId, setSessionId] = useState('')
  const [sessionSubject, setSessionSubject] = useState<Subject>('Multiplication')
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<AnswerState[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [viewIndex, setViewIndex] = useState(0)
  const [questionStartedAt, setQuestionStartedAt] = useState<number | null>(null)
  const [pausedElapsed, setPausedElapsed] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [answerInput, setAnswerInput] = useState('')
  const [selfRating, setSelfRating] = useState(3)
  const [hintSteps, setHintSteps] = useState<string[]>([])
  const [feedback, setFeedback] = useState('')
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const [helpSource, setHelpSource] = useState<'openai' | 'rule-based' | null>(null)
  const [tick, setTick] = useState(0)
  const [celebrationMsg, setCelebrationMsg] = useState('')
  const [showCelebration, setShowCelebration] = useState(false)
  const [showWrongAnim, setShowWrongAnim] = useState(false)
  const [wrongMsg, setWrongMsg] = useState('')
  const [inputState, setInputState] = useState<'idle' | 'correct' | 'incorrect'>('idle')
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [totalTokensUsed, setTotalTokensUsed] = useState(0)
  const answerInputRef = useRef<HTMLInputElement>(null)
  const answerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const isGoogleAuthEnabled = Boolean(googleClientId)

  useEffect(() => {
    const loadAuthConfig = async (): Promise<void> => {
      try {
        const res = await fetch(`${API_BASE}/config/auth`)
        if (!res.ok) throw new Error('Failed to load auth config')
        const data = (await res.json()) as AuthConfig
        if (data.googleConfigured && data.googleClientId) {
          setGoogleClientId(data.googleClientId)
        } else {
          setGoogleClientId('')
        }
      } catch {
        setGoogleClientId(BUILD_TIME_GOOGLE_CLIENT_ID ?? '')
      } finally {
        setAuthConfigLoaded(true)
      }
    }

    void loadAuthConfig()
  }, [])

  const selectedUserName = useMemo(() => {
    if (authUser?.name) return authUser.name
    const user = users.find((u) => u.id === selectedUserId)
    return user ? user.name : selectedUserId
  }, [authUser?.name, users, selectedUserId])

  const apiFetch = useCallback(async (
    path: string,
    init: RequestInit = {},
    tokenOverride?: string,
    timeoutMs = 12000,
  ): Promise<Response> => {
    const headers = new Headers(init.headers)
    const bearerToken = tokenOverride ?? authToken
    if (bearerToken) {
      headers.set('Authorization', `Bearer ${bearerToken}`)
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      })
    } finally {
      window.clearTimeout(timeout)
    }
  }, [authToken])

  const currentQuestion = questions[viewIndex]
  const currentAnswerState = answers[viewIndex]
  const isReadingSession = sessionSubject === 'Reading'
  const isReadingPage = currentQuestion?.kind === 'reading-page'
  const isReadingSummary = currentQuestion?.kind === 'reading-summary'

  const elapsedMs = useMemo(() => {
    void tick
    if (stage !== 'session') return 0
    if (isPaused || questionStartedAt === null) return pausedElapsed
    return pausedElapsed + (Date.now() - questionStartedAt)
  }, [stage, isPaused, pausedElapsed, questionStartedAt, tick])

  const sessionElapsedMs = useMemo(() => {
    const savedElapsedMs = answers.reduce((sum, answer, index) => {
      if (!answer.completed && index === currentIndex) return sum
      return sum + answer.elapsedMs
    }, 0)

    const activeQuestionElapsedMs = answers[currentIndex]?.completed ? 0 : elapsedMs
    return savedElapsedMs + activeQuestionElapsedMs
  }, [answers, currentIndex, elapsedMs])

  const scoreSummary = useMemo(() => {
    const completed = answers.filter((a) => a.completed)
    const correct = completed.filter((a) => a.isCorrect).length
    const positionCount = questions.length === 0 ? 0 : Math.min(questions.length, currentIndex + 1)
    if (sessionSubject === 'Reading') {
      return {
        answeredCount: positionCount,
        correctCount: completed.length,
      }
    }
    return {
      answeredCount: positionCount,
      correctCount: correct,
    }
  }, [answers, currentIndex, questions.length, sessionSubject])

  const latestInProgressBySubject = useMemo(() => {
    const latest: Partial<Record<Subject, InProgressSession>> = {}
    for (const session of inProgressSessions) {
      if (!latest[session.subject]) {
        latest[session.subject] = session
      }
    }
    return latest
  }, [inProgressSessions])

  /* ── Dashboard stats computation ───────────────────────────── */
  const computeDashStats = useCallback(async (userId: string, tokenOverride?: string): Promise<void> => {
    try {
      const res = await apiFetch(`/dashboard/${userId}`, {}, tokenOverride)
      if (res.ok) {
        const data = (await res.json()) as DashboardStats
        setDashStats(data)
      }
    } catch {
      // Dashboard stats are optional
    }
  }, [apiFetch])

  /* ── Compute in-progress sessions ──────────────────────────── */
  const computeInProgress = useCallback(async (userId: string, tokenOverride?: string): Promise<void> => {
    try {
      const res = await apiFetch(`/sessions/in-progress/${userId}`, {}, tokenOverride)
      if (res.ok) {
        const data = (await res.json()) as { sessions: InProgressSession[] }
        setInProgressSessions(data.sessions ?? [])
      }
    } catch {
      // optional
    }
  }, [apiFetch])

  const loadHomeData = useCallback(async (userId: string, tokenOverride?: string): Promise<void> => {
    setStage('home')
    const [insightsResult, dashboardResult, inProgressResult] = await Promise.allSettled([
      apiFetch(`/insights/${userId}`, {}, tokenOverride, 10000),
      computeDashStats(userId, tokenOverride),
      computeInProgress(userId, tokenOverride),
    ])

    if (insightsResult.status === 'fulfilled' && insightsResult.value.ok) {
      setInsights((await insightsResult.value.json()) as InsightResponse)
    } else {
      setInsights(defaultInsightsMessage())
    }

    const dashboardLoaded = dashboardResult.status === 'fulfilled'
    const inProgressLoaded = inProgressResult.status === 'fulfilled'
    setError(dashboardLoaded || inProgressLoaded
      ? ''
      : 'Signed in, but dashboard data is still loading. Please refresh once if it does not appear.')
  }, [apiFetch, computeDashStats, computeInProgress])

  /* ── Timer ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (stage !== 'session' || isPaused) return
    const timer = window.setInterval(() => setTick((v) => v + 1), 500)
    return () => window.clearInterval(timer)
  }, [stage, isPaused])

  /* ── Load users on mount ────────────────────────────────────── */
  useEffect(() => {
    if (!authConfigLoaded) {
      return
    }
    if (isGoogleAuthEnabled) {
      setUsers([{ id: 'adi', name: 'Adi' }])
      setSelectedUserId('adi')
      return
    }
    const loadUsers = async (): Promise<void> => {
      const res = await apiFetch('/users')
      if (!res.ok) throw new Error('Failed to load users')
      const data = (await res.json()) as { users: User[] }
      setUsers(data.users)
      if (data.users.length > 0) setSelectedUserId(data.users[0].id)
    }
    loadUsers().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Unexpected error')
    })
  }, [apiFetch, authConfigLoaded, isGoogleAuthEnabled, loadHomeData])

  useEffect(() => {
    if (!authConfigLoaded) {
      return
    }
    if (!isGoogleAuthEnabled) {
      setAuthLoading(false)
      return
    }

    const savedToken = window.localStorage.getItem(AUTH_TOKEN_KEY)
    if (!savedToken) {
      setAuthLoading(false)
      return
    }

    const restoreSession = async (): Promise<void> => {
      try {
        const res = await apiFetch('/auth/session', {}, savedToken, 10000)
        if (!res.ok) {
          window.localStorage.removeItem(AUTH_TOKEN_KEY)
          setAuthLoading(false)
          return
        }
        const data = (await res.json()) as { user: AuthUser }
        setAuthToken(savedToken)
        setAuthUser(data.user)
        setSelectedUserId(data.user.userId)
        setInsights(defaultInsightsMessage())
        setStage('home')
        void loadHomeData(data.user.userId, savedToken)
      } catch {
        window.localStorage.removeItem(AUTH_TOKEN_KEY)
      } finally {
        setAuthLoading(false)
      }
    }

    void restoreSession()
  }, [apiFetch, authConfigLoaded, isGoogleAuthEnabled, loadHomeData])

  useEffect(() => {
    if (!isGoogleAuthEnabled || googleScriptReady) {
      return
    }
    const interval = window.setInterval(() => {
      if (window.google) {
        setGoogleScriptReady(true)
        window.clearInterval(interval)
      }
    }, 250)
    return () => window.clearInterval(interval)
  }, [googleScriptReady, isGoogleAuthEnabled])

  /* ── Reset timer on question change ────────────────────────── */
  useEffect(() => {
    if (stage === 'session') {
      setQuestionStartedAt(Date.now())
      setIsPaused(false)
      setPausedElapsed(currentAnswerState?.elapsedMs ?? 0)
    }
  }, [stage, viewIndex, currentAnswerState?.elapsedMs])

  /* ── Focus input when question changes ─────────────────────── */
  useEffect(() => {
    if (stage === 'session') {
      if (isReadingSummary && answerTextareaRef.current) {
        answerTextareaRef.current.focus()
        return
      }
      if (answerInputRef.current) {
        answerInputRef.current.focus()
      }
    }
  }, [stage, viewIndex, isReadingSummary])

  const handleGoogleCredential = useCallback(async (credential: string): Promise<void> => {
    setError('')
    setIsBusy(true)
    try {
      const res = await fetch(`${API_BASE}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      })
      const data = (await res.json()) as { token?: string; user?: AuthUser; error?: string }
      if (!res.ok || !data.token || !data.user) {
        throw new Error(data.error || 'Google sign-in failed')
      }
      window.localStorage.setItem(AUTH_TOKEN_KEY, data.token)
      setAuthToken(data.token)
      setAuthUser(data.user)
      setSelectedUserId(data.user.userId)
      setInsights(defaultInsightsMessage())
      setStage('home')
      await loadHomeData(data.user.userId, data.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed')
    } finally {
      setIsBusy(false)
      setAuthLoading(false)
    }
  }, [loadHomeData])

  useEffect(() => {
    if (!isGoogleAuthEnabled || authUser || authLoading || !googleScriptReady || !googleButtonRef.current || !window.google) {
      return
    }

    googleButtonRef.current.innerHTML = ''
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: (response) => {
        void handleGoogleCredential(response.credential)
      },
    })
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      width: 320,
      text: 'continue_with',
    })
  }, [authLoading, authUser, googleClientId, googleScriptReady, handleGoogleCredential, isGoogleAuthEnabled])

  /* ── Login ──────────────────────────────────────────────── */
  const onLogin = async (): Promise<void> => {
    if (isGoogleAuthEnabled) return
    setError('')
    setIsBusy(true)
    try {
      await loadHomeData(selectedUserId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsBusy(false)
    }
  }

  const signOut = (): void => {
    window.localStorage.removeItem(AUTH_TOKEN_KEY)
    setAuthToken('')
    setAuthUser(null)
    setInsights(null)
    setDashStats(null)
    setInProgressSessions([])
    setSessionId('')
    setQuestions([])
    setAnswers([])
    setError('')
    setStage('login')
  }

  /* ── Start Session ──────────────────────────────────────────── */
  const startSession = async (subject: Subject): Promise<void> => {
    setError('')
    setIsBusy(true)
    try {
      const res = await apiFetch('/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId, questionCount: 12, subject }),
      })
      if (!res.ok) throw new Error('Failed to start session')
      const data = (await res.json()) as StartSessionResponse
      setSessionId(data.sessionId)
      setSessionSubject(data.subject)
      setQuestions(data.questions)
      setAnswers(data.answers)
      setCurrentIndex(data.currentIndex)
      setViewIndex(0)
      setAnswerInput('')
      setHintSteps([])
      setFeedback('')
      setIsCorrect(null)
      setHelpSource(null)
      setInputState('idle')
      setShowExitConfirm(false)
      setTotalTokensUsed(data.totalTokensUsed ?? 0)
      setStage('session')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Session start failed')
    } finally {
      setIsBusy(false)
    }
  }

  /* ── Resume In-Progress Session ─────────────────────────────── */
  const resumeSession = async (resumeSessionId: string): Promise<void> => {
    setError('')
    setIsBusy(true)
    try {
      const res = await apiFetch(`/session/${selectedUserId}/${resumeSessionId}`)
      if (!res.ok) throw new Error('Failed to load session')
      const data = (await res.json()) as {
        sessionId: string
        subject: Subject
        status: string
        currentIndex: number
        questions: Question[]
        answers: AnswerState[]
        totalTokensUsed?: number
      }
      setSessionId(data.sessionId)
      setSessionSubject(data.subject)
      setQuestions(data.questions)
      setAnswers(data.answers)
      setCurrentIndex(data.currentIndex)
      setViewIndex(data.currentIndex)
      setAnswerInput('')
      setHintSteps([])
      setFeedback('')
      setIsCorrect(null)
      setHelpSource(null)
      setInputState('idle')
      setShowExitConfirm(false)
      setTotalTokensUsed(data.totalTokensUsed ?? 0)
      setStage('session')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed')
    } finally {
      setIsBusy(false)
    }
  }

  /* ── Exit Session (save as in-progress) ─────────────────────── */
  const exitSession = async (): Promise<void> => {
    // Save current elapsed time before leaving
    if (sessionId && viewIndex === currentIndex) {
      try {
        await apiFetch(`/session/${selectedUserId}/${sessionId}/pause`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionIndex: viewIndex, elapsedMs }),
        })
      } catch {
        // best-effort save
      }
    }
    setShowExitConfirm(false)
    // Refresh dashboard to show in-progress session
    await Promise.all([
      computeDashStats(selectedUserId),
      computeInProgress(selectedUserId),
    ])
    setStage('home')
  }

  const requestStartSession = (subject: Subject): void => {
    const latestInProgressSession = latestInProgressBySubject[subject]
    if (latestInProgressSession) {
      void resumeSession(latestInProgressSession.sessionId)
      return
    }
    void startSession(subject)
  }

  /* ── Fetch Help ─────────────────────────────────────────── */
  const fetchHelp = async (): Promise<void> => {
    if (!sessionId) return
    setIsBusy(true)
    setError('')
    try {
      const res = await apiFetch(`/session/${selectedUserId}/${sessionId}/help`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIndex: viewIndex }),
      })
      if (!res.ok) throw new Error('Failed to load help')
      const data = (await res.json()) as HelpResponse
      setHintSteps(data.helpSteps)
      setHelpSource(data.helpSource ?? null)
      if (data.totalTokensUsed !== undefined) setTotalTokensUsed(data.totalTokensUsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Help failed')
    } finally {
      setIsBusy(false)
    }
  }

  /* ── Celebration Animations ─────────────────────────────────── */
  const fireCelebration = useCallback(() => {
    const messages = getCelebrationMessages()
    const msg = messages[Math.floor(Math.random() * messages.length)]
    setCelebrationMsg(msg)
    setShowCelebration(true)

    const celebStyle = Math.floor(Math.random() * 4)

    if (celebStyle === 0) {
      void confetti({ particleCount: 100, spread: 70, origin: { x: 0.15, y: 0.65 }, colors: ['#58cc02', '#ffc800', '#ff4b4b', '#1cb0f6', '#ce82ff'] })
      setTimeout(() => {
        void confetti({ particleCount: 100, spread: 70, origin: { x: 0.85, y: 0.65 }, colors: ['#58cc02', '#ffc800', '#ff4b4b', '#1cb0f6', '#ce82ff'] })
      }, 200)
    } else if (celebStyle === 1) {
      void confetti({ particleCount: 150, angle: 90, spread: 120, origin: { x: 0.5, y: 1 }, colors: ['#58cc02', '#ffc800', '#1cb0f6', '#ce82ff'] })
    } else if (celebStyle === 2) {
      void confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0, y: 0.65 }, colors: ['#58cc02', '#ffc800'] })
      void confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1, y: 0.65 }, colors: ['#1cb0f6', '#ce82ff'] })
    } else {
      let count = 0
      const interval = setInterval(() => {
        void confetti({ particleCount: 30, spread: 60, origin: { x: Math.random(), y: 0 }, colors: ['#58cc02', '#ffc800', '#ff4b4b', '#1cb0f6', '#ce82ff'] })
        count++
        if (count >= 4) clearInterval(interval)
      }, 200)
    }

    setTimeout(() => setShowCelebration(false), 2200)
  }, [])

  const fireWrongAnimation = useCallback(() => {
    const messages = getEncouragementMessages()
    const msg = messages[Math.floor(Math.random() * messages.length)]
    setWrongMsg(msg)
    setShowWrongAnim(true)
    setTimeout(() => setShowWrongAnim(false), 2100)
  }, [])

  const fireReadingAdvanceAnimation = useCallback(() => {
    setCelebrationMsg('Awesome, keep reading.')
    setShowCelebration(true)
    setTimeout(() => setShowCelebration(false), 900)
  }, [])

  /* ── Submit Answer ──────────────────────────────────────────── */
  const submitAnswer = async (): Promise<void> => {
    if (!sessionId || viewIndex !== currentIndex) return
    if (!isReadingPage && !answerInput.trim()) return
    setIsBusy(true)
    setError('')
    try {
      const res = await apiFetch(`/session/${selectedUserId}/${sessionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIndex: viewIndex, answer: answerInput, elapsedMs, selfRating }),
      })
      const data = (await res.json()) as SubmitAnswerResponse | { error: string }
      if (!res.ok) throw new Error('error' in data ? data.error : 'Failed to submit answer')
      const payload = data as SubmitAnswerResponse
      setAnswers(payload.answers)
      setQuestions(payload.questions)
      setCurrentIndex(payload.currentIndex)
      setIsCorrect(payload.isCorrect)
      if (payload.totalTokensUsed !== undefined) setTotalTokensUsed(payload.totalTokensUsed)

      if (isReadingPage) {
        fireReadingAdvanceAnimation()
        setFeedback('')
        setIsCorrect(null)
        setAnswerInput('')
        setHintSteps([])
        setInputState('idle')
        setPausedElapsed(0)
        setQuestionStartedAt(Date.now())
        setViewIndex(payload.currentIndex)
      } else if (isReadingSummary) {
        setFeedback('')
        setIsCorrect(null)
        setHintSteps([])
        setInputState('idle')
      } else if (payload.isCorrect) {
        setInputState('correct')
        setFeedback(payload.explanation)
        fireCelebration()
        setPausedElapsed(0)
        setQuestionStartedAt(Date.now())
      } else {
        setInputState('incorrect')
        setFeedback(payload.explanation)
        fireWrongAnimation()
      }

      setHintSteps([])
      if (payload.status === 'completed') {
        setTimeout(() => setStage('summary'), isReadingSession ? 150 : payload.isCorrect ? 2500 : 500)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      setIsBusy(false)
    }
  }

  /* ── Reveal Answer ──────────────────────────────────────────── */
  const revealAnswer = async (): Promise<void> => {
    if (!sessionId || viewIndex !== currentIndex) return
    setIsBusy(true)
    setError('')
    try {
      const res = await apiFetch(`/session/${selectedUserId}/${sessionId}/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIndex: viewIndex }),
      })
      if (!res.ok) throw new Error('Failed to reveal answer')
      const data = (await res.json()) as { correctAnswer: number; explanation: string; currentIndex: number; answers: AnswerState[]; questions: Question[] }
      setAnswers(data.answers)
      setQuestions(data.questions)
      setCurrentIndex(data.currentIndex)
      setIsCorrect(false)
      setFeedback(`The answer is ${data.correctAnswer}. ${data.explanation}`)
      setInputState('incorrect')
      setHintSteps([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reveal failed')
    } finally {
      setIsBusy(false)
    }
  }

  /* ── Pause/Resume ───────────────────────────────────────────── */
  const togglePause = async (): Promise<void> => {
    if (!isPaused) {
      const newElapsed = elapsedMs
      setPausedElapsed(newElapsed)
      setIsPaused(true)
      await apiFetch(`/session/${selectedUserId}/${sessionId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIndex: viewIndex, elapsedMs: newElapsed }),
      })
      return
    }
    setQuestionStartedAt(Date.now())
    setIsPaused(false)
  }

  /* ── Navigation ─────────────────────────────────────────── */
  const goPrevious = (): void => {
    if (viewIndex > 0) {
      setViewIndex(viewIndex - 1)
      setFeedback('')
      setIsCorrect(null)
      setInputState('idle')
    }
  }

  const goCurrent = (): void => {
    setViewIndex(currentIndex)
    setFeedback('')
    setHintSteps([])
    setIsCorrect(null)
    setAnswerInput('')
    setInputState('idle')
  }

  const continueToNext = (): void => {
    setFeedback('')
    setIsCorrect(null)
    setAnswerInput('')
    setInputState('idle')
    setHintSteps([])
    setViewIndex(currentIndex)
  }

  const retryQuestion = (): void => {
    setFeedback('')
    setIsCorrect(null)
    setInputState('idle')
    setHintSteps([])
    if (answerInputRef.current) {
      answerInputRef.current.focus()
      answerInputRef.current.select()
    } else if (answerTextareaRef.current) {
      answerTextareaRef.current.focus()
      answerTextareaRef.current.select()
    }
  }

  /* ── Summary ────────────────────────────────────────────── */
  const summary = useMemo(() => {
    const completed = answers.filter((a) => a.completed)
    const correct = completed.filter((a) => a.isCorrect).length
    const totalTime = completed.reduce((sum, a) => sum + a.elapsedMs, 0)
    const avgTime = completed.length ? Math.round(totalTime / completed.length / 1000) : 0
    const reveals = completed.filter((a) => a.usedReveal).length
    const accuracy = completed.length ? Math.round((correct / completed.length) * 100) : 0
    return { completed: completed.length, correct, avgTime, reveals, accuracy }
  }, [answers])

  const readingSummary = useMemo(() => {
    const readingPages = questions.filter((question) => question.kind === 'reading-page')
    const totalWords = readingPages.reduce((sum, question) => sum + (question.wordCount ?? 0), 0)
    const totalReadingMs = answers
      .filter((answer, index) => questions[index]?.kind === 'reading-page' && answer.completed)
      .reduce((sum, answer) => sum + answer.elapsedMs, 0)
    const finalAnswer = answers.find((_answer, index) => questions[index]?.kind === 'reading-summary')
    const averageWpm = finalAnswer?.readingWpm ?? (totalWords > 0 && totalReadingMs > 0 ? Math.round(totalWords / (totalReadingMs / 60000)) : 0)
    return {
      pagesRead: readingPages.length,
      totalWords,
      averageWpm,
      overallScore: finalAnswer?.readingScore ?? 0,
      comprehensionScore: finalAnswer?.comprehensionScore ?? 0,
      speedScore: finalAnswer?.speedScore ?? 0,
    }
  }, [answers, questions])

  const liveScore = useMemo(() => {
    if (sessionSubject === 'Reading') {
      const completed = answers.filter((a) => a.completed).length
      return questions.length > 0 ? Math.round((completed / questions.length) * 100) : 0
    }
    const completed = answers.filter((a) => a.completed)
    if (completed.length === 0) return 0
    const correct = completed.filter((a) => a.isCorrect).length
    return Math.round((correct / completed.length) * 100)
  }, [answers, questions.length, sessionSubject])

  const progressPercent = useMemo(() => {
    if (questions.length === 0) return 0
    return Math.round((summary.completed / questions.length) * 100)
  }, [questions.length, summary.completed])

  const timerWarning = elapsedMs > 120000

  /* ── Render: Login ──────────────────────────────────────────── */
  if (stage === 'login') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo">
            <div className="login-logo-icon">
              <img src="/adi_avatar.png" alt="Adi" className="login-avatar-img" />
            </div>
            <h1>APLC</h1>
            <p>Adi's Personal Learning Center</p>
          </div>

          {error && (
            <div className="error-msg">⚠️ {error}</div>
          )}

          <div className="login-form">
            {!authConfigLoaded ? (
              <div className="login-google-wrap">
                <div className="login-google-loading">
                  <span className="loading-dots"><span /><span /><span /></span>
                </div>
              </div>
            ) : isGoogleAuthEnabled ? (
              <>
                <div className="login-google-wrap">
                  <p className="login-google-note">
                    Sign in with Adi&apos;s Google account to continue.
                  </p>
                  {authLoading ? (
                    <div className="login-google-loading">
                      <span className="loading-dots"><span /><span /><span /></span>
                    </div>
                  ) : (
                    <div ref={googleButtonRef} className="google-signin-slot" />
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="login-field">
                  <label htmlFor="user">Select Student</label>
                  <div className="login-select-wrap">
                    <select
                      id="user"
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  className="btn-login"
                  onClick={() => void onLogin()}
                  disabled={isBusy || users.length === 0}
                >
                  {isBusy ? (
                    <span className="loading-dots">
                      <span /><span /><span />
                    </span>
                  ) : "Let's Learn! →"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  /* ── Render: Home / Dashboard ───────────────────────────────── */
  if (stage === 'home') {
    const streak = dashStats?.currentStreak ?? 0
    const activityDays = dashStats?.activityDays ?? []

    return (
      <div className="dashboard-screen">
        {/* Nav */}
        <nav className="dashboard-nav">
          <div className="nav-brand">
            <img src="/adi_avatar.png" alt="Adi" className="nav-brand-avatar" />
            APLC
          </div>
          <div className="nav-user">
            {streak > 0 && (
              <div className="nav-streak">🔥 {streak} day streak</div>
            )}
            {authUser && (
              <button className="nav-signout" onClick={signOut}>
                Sign out
              </button>
            )}
            <span className="nav-username">{selectedUserName}</span>
          </div>
        </nav>

        <div className="dashboard-body">
          {error && <div className="error-msg">⚠️ {error}</div>}

          <div className="welcome-header">
            <p className="welcome-date">{formatCurrentDate()}</p>
            <h2 className="welcome-title">{getGreeting(selectedUserName)}</h2>
          </div>

          {/* Subject Selection — primary action, shown near top */}
          <div className="subjects-section">
            <h3 className="panel-title">📚 Choose a Subject</h3>
            <div className="subjects-grid">
              {ACTIVE_SUBJECTS.map((subject) => {
                const latestInProgressSession = latestInProgressBySubject[subject.id]
                const unfinishedForSubject = inProgressSessions.filter((session) => session.subject === subject.id)
                return (
                  <div key={subject.id} className="subject-card active">
                    <div className="subject-badge">Active</div>
                    <div className={`subject-card-icon ${subject.iconClass}`}>{subject.icon}</div>
                    <p className="subject-card-name">{subject.id}</p>
                    <p className="subject-card-desc">{subject.description}</p>
                    {latestInProgressSession && (
                      <div className="subject-session-stack">
                        <div className="subject-session-stack-title">Session In Progress</div>
                        <div className="subject-session-item">
                          <div className="subject-session-copy">
                            <p className="subject-session-title">{subject.id}</p>
                            <p className="subject-session-meta">
                              Pick up from question {latestInProgressSession.questionsAnswered + 1} of {latestInProgressSession.totalQuestions}
                              {latestInProgressSession.accuracy > 0 && ` · ${latestInProgressSession.accuracy}% accuracy`}
                              {' · '}{formatRelativeTime(latestInProgressSession.startedAt)}
                            </p>
                            {unfinishedForSubject.length > 1 && (
                              <p className="subject-session-meta">
                                {unfinishedForSubject.length - 1} older unfinished session{unfinishedForSubject.length - 1 === 1 ? '' : 's'} also saved.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    <button
                      className="btn-start-subject"
                      onClick={() => requestStartSession(subject.id)}
                      disabled={isBusy}
                    >
                      {isBusy ? (
                        <span className="loading-dots"><span /><span /><span /></span>
                      ) : latestInProgressSession ? 'Continue Session →' : 'Start Session →'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Insights */}
          {insights?.hasEnoughData && (
            <div className="insights-panel">
              <h3 className="panel-title">💡 Your Insights</h3>
              <p className="insights-summary">{insights.message}</p>
              <div className="insights-overview">
                <div className="insights-overview-stat">
                  <span className="insights-overview-value">{insights.overall.completedSessions}</span>
                  <span className="insights-overview-label">Completed Sessions</span>
                </div>
                <div className="insights-overview-stat">
                  <span className="insights-overview-value">{insights.overall.totalQuestionsAnswered}</span>
                  <span className="insights-overview-label">Questions Answered</span>
                </div>
                <div className="insights-overview-stat">
                  <span className="insights-overview-value">{insights.overall.strongestSubject ?? 'Building'}</span>
                  <span className="insights-overview-label">Strongest Subject</span>
                </div>
              </div>
              <div className="insights-grid">
                <div className="insight-box strengths">
                  <p className="insight-box-title">✅ Going Well</p>
                  {insights.strengths.length > 0 ? (
                    <ul className="insight-list">
                      {insights.strengths.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : (
                    <p className="no-data-msg">Keep practicing to unlock insights!</p>
                  )}
                </div>
                <div className="insight-box improvements">
                  <p className="insight-box-title">📈 Focus Areas</p>
                  {insights.improvements.length > 0 ? (
                    <ul className="insight-list">
                      {insights.improvements.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : (
                    <p className="no-data-msg">You're crushing it! No weak areas found.</p>
                  )}
                </div>
              </div>
              {insights.recommendedFocus.length > 0 && (
                <div className="insight-box recommendations">
                  <p className="insight-box-title">🎯 Next Best Focus</p>
                  <ul className="insight-list">
                    {insights.recommendedFocus.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              )}
              {insights.bySubject.length > 0 && (
                <div className="subject-insights-grid">
                  {insights.bySubject.map((subjectInsight) => (
                    <div key={subjectInsight.subject} className={`subject-insight-card trend-${subjectInsight.trend}`}>
                      <div className="subject-insight-header">
                        <div>
                          <p className="subject-insight-name">{subjectInsight.subject}</p>
                          <p className="subject-insight-headline">{subjectInsight.headline}</p>
                        </div>
                        <span className="subject-insight-trend">{getSubjectTrendLabel(subjectInsight.trend)}</span>
                      </div>
                      <div className="subject-insight-metrics">
                        {subjectInsight.metrics.accuracy !== null && (
                          <div className="subject-insight-metric">
                            <span className="subject-insight-metric-value">{subjectInsight.metrics.accuracy}%</span>
                            <span className="subject-insight-metric-label">Accuracy</span>
                          </div>
                        )}
                        {subjectInsight.metrics.avgSeconds !== null && (
                          <div className="subject-insight-metric">
                            <span className="subject-insight-metric-value">{subjectInsight.metrics.avgSeconds}s</span>
                            <span className="subject-insight-metric-label">Avg Time</span>
                          </div>
                        )}
                        {subjectInsight.metrics.averageWpm !== null && (
                          <div className="subject-insight-metric">
                            <span className="subject-insight-metric-value">{subjectInsight.metrics.averageWpm}</span>
                            <span className="subject-insight-metric-label">WPM</span>
                          </div>
                        )}
                        {subjectInsight.metrics.comprehensionScore !== null && (
                          <div className="subject-insight-metric">
                            <span className="subject-insight-metric-value">{subjectInsight.metrics.comprehensionScore}</span>
                            <span className="subject-insight-metric-label">Comprehension</span>
                          </div>
                        )}
                      </div>
                      <div className="subject-insight-columns">
                        <div>
                          <p className="subject-insight-section-title">Going Well</p>
                          <ul className="insight-list compact">
                            {subjectInsight.strengths.map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </div>
                        <div>
                          <p className="subject-insight-section-title">Focus Next</p>
                          <ul className="insight-list compact">
                            {subjectInsight.focusAreas.map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </div>
                      </div>
                      <p className="subject-insight-next-step">{subjectInsight.recommendedNextStep}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!insights?.hasEnoughData && (
            <div className="insights-panel">
              <h3 className="panel-title">💡 Insights</h3>
              <p className="no-data-msg">
                📊 Complete at least 3 sessions to unlock personalized insights about your strengths and areas to improve!
              </p>
            </div>
          )}

          {/* Activity Heatmap */}
          <ActivityHeatmap activityDays={activityDays} />
        </div>
      </div>
    )
  }

  /* ── Render: Session ────────────────────────────────────── */
  if (stage === 'session' && currentQuestion) {
    const isCurrentQuestion = viewIndex === currentIndex
    const isCompleted = currentAnswerState?.completed ?? false
    const isViewingPast = viewIndex < currentIndex

    return (
      <div className="session-screen">
        {/* Top Bar */}
        <div className="session-topbar">
          <button
            className="session-back-btn"
            onClick={() => setShowExitConfirm(true)}
            title="Exit Session"
          >
            🚪 Exit
          </button>
          <div className="session-progress-wrap">
            <div
              className="session-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="session-score-badge">
            🎯 {liveScore}%
          </div>
        </div>

        {/* Exit Confirmation Modal */}
        {showExitConfirm && (
          <div className="modal-overlay">
            <div className="modal-card">
              <div className="modal-icon">🚪</div>
              <h3 className="modal-title">Exit Session?</h3>
              <p className="modal-message">
                Your progress will be saved. You can resume this session from the dashboard later.
              </p>
              <div className="modal-actions">
                <button className="btn-modal-cancel" onClick={() => setShowExitConfirm(false)}>
                  Keep Going
                </button>
                <button className="btn-modal-confirm" onClick={() => void exitSession()}>
                  Save & Exit
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="session-body">
          {error && <div className="error-msg">⚠️ {error}</div>}

          {/* Question Header */}
          <div className="question-header">
            <span className="question-counter">
              Question {viewIndex + 1} of {questions.length}
            </span>
            <div className={`question-type-badge ${currentQuestion.type}`}>
              {getQuestionTypeBadge(currentQuestion.type)}
            </div>
          </div>

          {/* Session Meta Row — uniform cards */}
          <div className="session-meta-row">

            {/* Card 1: Timer + Pause */}
            <div className="meta-card meta-card-timer">
              <span className="meta-card-label">TIME</span>
              <div className="meta-card-value-row">
                <div className="meta-timer-values">
                  <span className={`meta-timer-value ${isPaused ? 'paused' : timerWarning ? 'warning' : ''}`}>
                    {isPaused ? '⏸️' : timerWarning ? '⚡' : '⏱️'} {formatMs(elapsedMs)}
                  </span>
                  <span className="meta-timer-subvalue">
                    <span className="meta-timer-subvalue-label">Session:</span>{' '}
                    <span className="meta-timer-subvalue-elapsed">{formatMs(sessionElapsedMs)}</span>{' '}
                    <span className="meta-timer-subvalue-total">/ 30:00</span>
                  </span>
                </div>
                <button
                  className="btn-pause-inline"
                  onClick={() => void togglePause()}
                  disabled={!isCurrentQuestion}
                  title={isPaused ? 'Resume' : 'Pause'}
                >
                  {isPaused ? '▶️' : '⏸️'}
                </button>
              </div>
            </div>

            {/* Card 2: Score */}
            <div className="meta-card meta-card-score">
              <span className="meta-card-label">{isReadingSession ? 'PROGRESS' : 'SCORE'}</span>
              {scoreSummary.answeredCount > 0
                ? <ScoreGauge correctCount={scoreSummary.correctCount} answeredCount={scoreSummary.answeredCount} />
                : <span className="meta-card-empty">{isReadingSession ? 'Open page 1 to begin reading' : 'Answer Q1 to start tracking'}</span>
              }
            </div>

            {/* Card 3: Tokens Used */}
            <div className="meta-card meta-card-tokens">
              <span className="meta-card-label">AI TOKENS USED</span>
              <div className="meta-card-value-row">
                <span className="meta-tokens-value">🤖 {totalTokensUsed.toLocaleString()}</span>
              </div>
            </div>

            {/* Card 4: Home */}
            <div className="meta-card meta-card-home">
              <button
                className="btn-home-card"
                onClick={() => setShowExitConfirm(true)}
                title="Save & go to Home"
              >
                <span className="btn-home-card-label">Home</span>
              </button>
            </div>

          </div>

          {/* Question Card */}
          <div className="question-card">
            <div className={`question-prompt ${isViewingPast ? 'viewed' : ''}`}>
              <MathText text={currentQuestion.prompt} />
            </div>

            {isReadingPage && (
              <div className="reading-page-panel">
                <div className="reading-page-header">
                  <div>
                    <p className="reading-page-title">{currentQuestion.title}</p>
                    <p className="reading-page-meta">{currentQuestion.wordCount ?? 0} words on this page</p>
                  </div>
                  <div className="reading-target-chip">Target pace: 120-140 WPM</div>
                </div>
                <div className="reading-page-content">
                  {currentQuestion.content}
                </div>
              </div>
            )}

            {isReadingSummary && (
              <div className="reading-page-panel">
                <div className="reading-page-header">
                  <div>
                    <p className="reading-page-title">{currentQuestion.title}</p>
                    <p className="reading-page-meta">Write the core summary in about 100 words.</p>
                  </div>
                </div>
                {currentQuestion.content && (
                  <div className="reading-summary-guidance">{currentQuestion.content}</div>
                )}
              </div>
            )}

            {/* Answer Input */}
            {!isReadingPage && (
              <div className="answer-section">
                <label className="answer-label">{isReadingSummary ? 'Your Summary' : 'Your Answer'}</label>
                <div className="answer-input-wrap">
                  {isReadingSummary ? (
                    <textarea
                      ref={answerTextareaRef}
                      className={`answer-input answer-textarea ${inputState !== 'idle' ? inputState : ''}`}
                      value={answerInput}
                      disabled={!isCurrentQuestion || isCompleted}
                      onChange={(e) => setAnswerInput(e.target.value)}
                      placeholder={isViewingPast ? 'Viewing previous page' : 'Summarize the story in about 100 words.'}
                      rows={6}
                    />
                  ) : (
                    <input
                      ref={answerInputRef}
                      className={`answer-input ${inputState !== 'idle' ? inputState : ''}`}
                      type="text"
                      value={answerInput}
                      disabled={!isCurrentQuestion || isCompleted}
                      onChange={(e) => setAnswerInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isBusy && isCurrentQuestion && !isCompleted && answerInput.trim()) {
                          void submitAnswer()
                        }
                      }}
                      placeholder={isViewingPast ? 'Viewing previous question' : 'e.g. 0.6 or 3/5'}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            {isCurrentQuestion && !isCompleted && (
              <div className="action-buttons">
                <button
                  className="btn-submit"
                  onClick={() => void submitAnswer()}
                  disabled={isBusy || (!isReadingPage && !answerInput.trim())}
                >
                  {isBusy ? <span className="loading-dots"><span /><span /><span /></span> : isReadingPage ? 'Next Page →' : isReadingSummary ? 'Submit Summary' : 'Check Answer'}
                </button>
                {!isReadingSession && (
                  <>
                    <button
                      className="btn-secondary help"
                      onClick={() => void fetchHelp()}
                      disabled={isBusy}
                    >
                      Hint
                    </button>
                    <button
                      className="btn-secondary reveal"
                      onClick={() => void revealAnswer()}
                      disabled={isBusy}
                    >
                      Show
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Difficulty Slider */}
            {isCurrentQuestion && !isCompleted && !isReadingSession && (
              <div className="difficulty-section">
                <div className="difficulty-label-row">
                  <span className="difficulty-label">How hard was this?</span>
                  <span className="difficulty-value-label">{['', 'Easy', 'Pretty easy', 'Medium', 'Hard', 'Very hard'][selfRating]}</span>
                </div>
                <input
                  className="difficulty-slider"
                  type="range"
                  min={1}
                  max={5}
                  value={selfRating}
                  onChange={(e) => setSelfRating(Number(e.target.value))}
                />
              </div>
            )}
          </div>

          {/* Hint Panel */}
          {hintSteps.length > 0 && (
            <div className="hint-panel">
              <p className="hint-panel-title">
                💡 Step-by-step hint {helpSource === 'openai' ? '(AI-powered)' : ''}
              </p>
              <ol className="hint-steps">
                {hintSteps.map((step, i) => (
                  <li key={i}><MathText text={step} /></li>
                ))}
              </ol>
            </div>
          )}

          {/* Feedback Banner */}
          {feedback && isCorrect !== null && (
            <div className={`feedback-banner ${isCorrect ? 'correct' : 'incorrect'}`}>
              <div className="feedback-header">
                <div className="feedback-icon-wrap">
                  {isCorrect ? '✓' : '✗'}
                </div>
                <p className="feedback-title">
                  {isCorrect ? 'Correct! Well done! 🎉' : 'Not quite right — keep going! 💪'}
                </p>
              </div>
              <div className="feedback-message">
                <MathText text={feedback} />
              </div>
              <div className="feedback-actions">
                {!isCorrect && isCurrentQuestion && (
                  <button className="btn-retry" onClick={retryQuestion}>
                    Retry
                  </button>
                )}
                <button className="btn-continue" onClick={continueToNext}>
                  {isCorrect ? 'Continue →' : 'Move On →'}
                </button>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="nav-buttons">
            <button
              className="btn-nav"
              onClick={goPrevious}
              disabled={viewIndex === 0}
            >
              ← Previous
            </button>

            {viewIndex < currentIndex && (
              <button className="btn-nav" onClick={goCurrent}>
                Go to Current →
              </button>
            )}
          </div>
        </div>

        {/* Celebration Overlay */}
        {showCelebration && (
          <div className="celebration-overlay">
            <div className="celebration-content">
              <span className="celebration-text">{celebrationMsg}</span>
            </div>
          </div>
        )}

        {/* Wrong Answer Overlay */}
        {showWrongAnim && (
          <div className="wrong-overlay">
            <div className="wrong-content">
              <span className="wrong-text">{wrongMsg}</span>
              <span className="wrong-sub">You can do it! 💪</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ── Render: Summary ────────────────────────────────────── */
  if (stage === 'summary') {
    if (sessionSubject === 'Reading') {
      const targetHit = readingSummary.averageWpm >= 120 && readingSummary.averageWpm <= 140
      return (
        <div className="summary-screen">
          <div className="summary-hero">
            <span className="summary-trophy">📖</span>
            <h2>Reading Session Complete!</h2>
            <p>You finished the story and reflected on its core meaning.</p>
            <div className="summary-target-badge">
              {targetHit ? `On target at ${readingSummary.averageWpm} WPM` : `Target pace: 120-140 WPM`}
            </div>
          </div>

          <div className="summary-stats">
            <div className="summary-stat-card">
              <span className="summary-stat-icon">⚡</span>
              <div className="summary-stat-value">{readingSummary.averageWpm}</div>
              <div className="summary-stat-label">Average WPM</div>
            </div>
            <div className="summary-stat-card">
              <span className="summary-stat-icon">🧠</span>
              <div className="summary-stat-value">{readingSummary.comprehensionScore}/10</div>
              <div className="summary-stat-label">Comprehension</div>
            </div>
            <div className="summary-stat-card">
              <span className="summary-stat-icon">🎯</span>
              <div className="summary-stat-value">{readingSummary.speedScore}/10</div>
              <div className="summary-stat-label">Speed Score</div>
            </div>
            <div className="summary-stat-card">
              <span className="summary-stat-icon">⭐</span>
              <div className="summary-stat-value">{readingSummary.overallScore}/10</div>
              <div className="summary-stat-label">Overall Reading</div>
            </div>
          </div>

          <div className="reading-summary-note">
            You read about {readingSummary.totalWords.toLocaleString()} words across {readingSummary.pagesRead} pages.
            Target reading pace is 120-140 WPM.
          </div>

          <div className="summary-actions">
            <button className="btn-home" onClick={() => {
              void computeDashStats(selectedUserId)
              void computeInProgress(selectedUserId)
              setStage('home')
            }}>
              🏠 Home
            </button>
            <button className="btn-again" onClick={() => void startSession(sessionSubject)}>
              {isBusy ? <span className="loading-dots"><span /><span /><span /></span> : '🔄 Read Again'}
            </button>
          </div>
        </div>
      )
    }

    const { correct, completed, avgTime, reveals, accuracy } = summary
    const trophy = accuracy >= 90 ? '🏆' : accuracy >= 70 ? '🥇' : accuracy >= 50 ? '🥈' : '🥉'
    const message = accuracy >= 90 ? 'Outstanding performance!' : accuracy >= 70 ? 'Great work today!' : accuracy >= 50 ? 'Good effort, keep going!' : 'Every practice makes you better!'
    const hitTarget = accuracy >= SESSION_TARGET_ACCURACY

    return (
      <div className="summary-screen">
        <div className="summary-hero">
          <span className="summary-trophy">{trophy}</span>
          <h2>Session Complete!</h2>
          <p>{message}</p>
          {hitTarget && (
            <div className="summary-target-badge">🎯 Target Achieved! ({SESSION_TARGET_ACCURACY}%+)</div>
          )}
        </div>

        <div className="summary-stats">
          <div className="summary-stat-card">
            <span className="summary-stat-icon">🎯</span>
            <div className="summary-stat-value" style={{ color: getAccuracyColor(accuracy) }}>
              {accuracy}%
            </div>
            <div className="summary-stat-label">Accuracy</div>
          </div>
          <div className="summary-stat-card">
            <span className="summary-stat-icon">✅</span>
            <div className="summary-stat-value">{correct}/{completed}</div>
            <div className="summary-stat-label">Correct</div>
          </div>
          <div className="summary-stat-card">
            <span className="summary-stat-icon">⏱️</span>
            <div className="summary-stat-value">{avgTime}s</div>
            <div className="summary-stat-label">Avg / Question</div>
          </div>
          <div className="summary-stat-card">
            <span className="summary-stat-icon">👁️</span>
            <div className="summary-stat-value">{reveals}</div>
            <div className="summary-stat-label">Answers Revealed</div>
          </div>
        </div>

        <div className="summary-actions">
          <button className="btn-home" onClick={() => {
            void computeDashStats(selectedUserId)
            void computeInProgress(selectedUserId)
            setStage('home')
          }}>
            🏠 Home
          </button>
          <button className="btn-again" onClick={() => void startSession(sessionSubject)}>
            {isBusy ? <span className="loading-dots"><span /><span /><span /></span> : '🔄 Practice Again'}
          </button>
        </div>
      </div>
    )
  }

  return null
}

export default App
