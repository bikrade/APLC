import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import 'katex/dist/katex.min.css'
import './App.css'
import { formatMs, getAccuracyColor, getQuestionTypeBadge, renderMath } from './lib/sessionUi'
import { releaseInfo } from './generated/releaseInfo'

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
type ThemeMode = 'light' | 'dark'
type User = { id: string; name: string }
type AuthUser = { email: string; name: string; picture?: string; userId: string }
type Subject = 'Multiplication' | 'Division' | 'Reading'
type SessionMode = 'guided' | 'quiz'
type AuthConfig = { googleConfigured: boolean; googleClientId?: string | null }
type LaunchState = { subject: Subject; mode: 'start' | 'resume' } | null

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
    subjectSessionBreakdown: Record<Subject, number>
  }
}

type SubjectInsight = {
  subject: Subject
  trend: 'improving' | 'steady' | 'declining'
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
  activityDays: Array<{
    date: string
    practiceMs: number
  }>
  dailyPractice?: {
    targetMs: number
    todayMs: number
    yesterdayMs: number
  }
  latestCompletedBySubject?: Record<Subject, LastCompletedSession | null>
  learningCoach?: LearningCoach
}

type LastCompletedSession = {
  sessionId: string
  completedAt: string
  sessionMode: SessionMode
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
  dueLabel?: string
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
  bestNextStep?: {
    subject: Subject
    title: string
    reason: string
    cta: string
  }
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

type InProgressSession = {
  sessionId: string
  startedAt: string
  questionsAnswered: number
  totalQuestions: number
  accuracy: number
  subject: Subject
  sessionMode: SessionMode
}

type AdaptiveNotification = {
  kind: 'difficulty-up' | 'difficulty-down' | 'reading-warning'
  title: string
  message: string
}

type ReadingQuizItem = {
  id: string
  prompt: string
  options: string[]
}

type ReadingVocabularyItem = {
  term: string
  studentFriendlyMeaning: string
  contextClue: string
}

type Question = {
  id: string
  prompt: string
  type: string
  kind?: 'math' | 'reading-page' | 'reading-summary' | 'reading-quiz'
  title?: string
  content?: string
  wordCount?: number
  quizItems?: ReadingQuizItem[]
  vocabularyFocus?: ReadingVocabularyItem[]
  index: number
}

type AnswerState = {
  questionId: string
  questionIndex: number
  userAnswer?: number
  userTextAnswer?: string
  isCorrect?: boolean
  completed: boolean
  usedHelp: boolean
  usedReveal: boolean
  elapsedMs: number
  attemptCount?: number
  firstAttemptCorrect?: boolean
  selectedOptions?: number[]
  readingScore?: number
  comprehensionScore?: number
  speedScore?: number
  readingWpm?: number
  vocabularyScore?: number
  vocabularyTermsUsed?: number
  vocabularyTermsExplained?: number
}

type StartSessionResponse = {
  sessionId: string
  subject: Subject
  sessionMode: SessionMode
  questionCount: number
  questions: Question[]
  answers: AnswerState[]
  currentIndex: number
  completedAt?: string
  totalTokensUsed?: number
  difficultyLevel?: number
}

type SubmitAnswerResponse = {
  isCorrect: boolean
  explanation: string
  currentIndex: number
  status: 'active' | 'completed'
  answers: AnswerState[]
  questions: Question[]
  completedAt?: string
  totalTokensUsed?: number
  difficultyLevel?: number
  adaptiveNotification?: AdaptiveNotification | null
}

type HelpResponse = {
  helpSteps: string[]
  helpSource?: 'openai' | 'rule-based'
  totalTokensUsed?: number
  difficultyLevel?: number
}

type RevealResponse = {
  correctAnswer: number
  explanation: string
  currentIndex: number
  status: 'active' | 'completed'
  answers: AnswerState[]
  questions: Question[]
  completedAt?: string
  difficultyLevel?: number
  adaptiveNotification?: AdaptiveNotification | null
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const BUILD_TIME_GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const AUTH_TOKEN_KEY = 'aplc_auth_token'
const THEME_STORAGE_KEY = 'aplc_theme'
const SESSION_TARGET_ACCURACY = 80 // target % for the session

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

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

function ThemeToggleButton({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const label = nextTheme === 'dark' ? 'Switch to dark theme' : 'Switch to light theme'

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={label}
      title={label}
    >
      <span className="theme-toggle-icon" aria-hidden="true">{nextTheme === 'dark' ? '🌙' : '☀️'}</span>
      <span className="theme-toggle-label">{nextTheme === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
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

function formatScoreTimestamp(isoDate?: string): string {
  if (!isoDate) return ''
  return new Date(isoDate).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getSubjectTrendMeta(trend: SubjectInsight['trend']): { label: string; icon: string } {
  if (trend === 'improving') {
    return { label: 'Improving', icon: '↗' }
  }
  if (trend === 'declining') {
    return { label: 'Declining', icon: '↘' }
  }
  return { label: 'Steady', icon: '' }
}

function getMasteryStageMeta(stage: MasteryStage): { label: string; className: string } {
  if (stage === 'mastered') return { label: 'Mastered', className: 'mastered' }
  if (stage === 'fragile') return { label: 'Fragile', className: 'fragile' }
  return { label: 'Developing', className: 'developing' }
}

function getSessionModeMeta(mode: SessionMode): { label: string; shortLabel: string; description: string } {
  if (mode === 'quiz') {
    return {
      label: 'Quiz',
      shortLabel: 'Quiz',
      description: 'Results only at the end.',
    }
  }
  return {
    label: 'Guided Session',
    shortLabel: 'Guided',
    description: 'Live feedback, adaptive coaching, and support as you go.',
  }
}

function formatPracticeMinutes(ms: number): string {
  if (ms <= 0) return '0 min'
  const minutes = Math.round(ms / 60000)
  return `${minutes} min`
}

function getDailyHabitTierCopy(targetMs: number): string {
  const targetMinutes = Math.max(1, Math.round(targetMs / 60000))
  return `${targetMinutes} min keeps the habit alive · 30 min strong day · 45+ min stretch`
}

function getSessionCoachSummary(
  subject: Subject,
  answers: AnswerState[],
  _questions: Question[],
  readingSummary: {
    averageWpm: number
    overallScore: number
    comprehensionScore: number
    speedScore: number
    vocabularyScore?: number
    assessmentMode: 'summary' | 'quiz'
  },
): { celebration: string; growthNote: string; nextStep: string } {
  if (subject === 'Reading') {
    if (readingSummary.comprehensionScore >= 8 && readingSummary.averageWpm >= 120) {
      return {
        celebration: 'You kept both meaning and momentum together in this reading session.',
        growthNote: 'That combination is exactly what strong readers build over time: pace with real understanding.',
        nextStep: readingSummary.averageWpm >= 180
          ? 'Next time, keep the same quality but slow down just enough to notice the small clues before the ending.'
          : 'Next time, keep the same care and aim for another steady read near your target pace.',
      }
    }
    if (readingSummary.comprehensionScore < 7) {
      return {
        celebration: 'You stayed with a full story and finished the reflection, which still matters a lot.',
        growthNote: `Your comprehension score was ${readingSummary.comprehensionScore}/10 because some important story details or links between events were missing from your answer.`,
        nextStep: readingSummary.averageWpm < 130
          ? `On the next session, pause after each page, say the main idea aloud, and try to build from ${readingSummary.averageWpm} WPM toward 130 WPM.`
          : 'On the next reading session, pause after each page and say the main idea aloud before moving on.',
      }
    }
    return {
      celebration: 'You completed the story thoughtfully and gave the app a real signal to coach from.',
      growthNote: readingSummary.vocabularyScore !== undefined && readingSummary.vocabularyScore < 6
        ? `Your vocabulary use score was ${readingSummary.vocabularyScore}/10, so the next jump is using one or two of the story words accurately when you explain the ending.`
        : readingSummary.averageWpm < 130
        ? `Your speed score is ${readingSummary.speedScore}/10 because speed is measured against a 130 WPM target. ${readingSummary.averageWpm} WPM is a solid start, and now the goal is to raise it without losing meaning.`
        : 'Your reading is developing, and the next step is making the pace and the understanding feel equally steady.',
      nextStep: readingSummary.averageWpm < 130
        ? 'On the next session, keep your eyes moving line by line, avoid long pauses, and aim for a smoother pace toward 130 WPM.'
        : readingSummary.vocabularyScore !== undefined && readingSummary.vocabularyScore < 6
          ? 'On the next session, choose one vocabulary word from the story and use it clearly when you explain the problem or ending.'
          : 'On the next session, aim for calm pace and one strong summary that names the problem, the turning point, and the outcome.',
    }
  }

  const completed = answers.filter((answer) => answer.completed)
  const correct = completed.filter((answer) => answer.isCorrect).length
  const reveals = completed.filter((answer) => answer.usedReveal).length
  const accuracy = completed.length > 0 ? Math.round((correct / completed.length) * 100) : 0
  const firstAttemptRate = completed.length > 0
    ? Math.round((completed.filter((answer) => answer.firstAttemptCorrect ?? (answer.isCorrect && (answer.attemptCount ?? 1) <= 1 && !answer.usedHelp && !answer.usedReveal)).length / completed.length) * 100)
    : 0

  if (accuracy >= 85 && reveals <= 1) {
    return {
      celebration: `You worked through this ${subject.toLowerCase()} set with strong independence.`,
      growthNote: 'That usually means your method is getting more reliable, not just your final answers.',
      nextStep: `On the next ${subject.toLowerCase()} session, keep the same calm checking and see if you can hold that first-try quality.`,
    }
  }
  if (firstAttemptRate < 60) {
    return {
      celebration: 'You stayed in the session even when several questions pushed back, which is real learning behavior.',
      growthNote: 'The biggest growth move now is slowing the first attempt down so fewer answers need repair.',
      nextStep: `Next time, take one extra breath before submitting each ${subject.toLowerCase()} answer and use Hint before Show when stuck.`,
    }
  }
  return {
    celebration: `You finished a full ${subject.toLowerCase()} practice block and kept building your learning data.`,
    growthNote: 'Your progress is moving, and the next jump will come from more first-try confidence.',
    nextStep: `Next session, focus especially on the first 3 ${subject.toLowerCase()} questions and try to answer them cleanly on the first attempt.`,
  }
}

function getReadingCheckpointPrompt(pageIndex: number): { title: string; prompt: string } | null {
  if (pageIndex === 1) {
    return {
      title: 'Pause And Notice',
      prompt: 'What changed on this page, and which clue feels most important so far?',
    }
  }
  if (pageIndex === 3) {
    return {
      title: 'Think Ahead',
      prompt: 'What does the character want most right now, and what might get in the way next?',
    }
  }
  return null
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
      subjectSessionBreakdown: {
        Multiplication: 0,
        Division: 0,
        Reading: 0,
      },
    },
  }
}

/* ── Activity Heatmap Component ────────────────────────────── */
type HeatmapWindow = 3 | 6 | 12

function getQuarterStartMonth(now: Date): number {
  return Math.floor(now.getMonth() / 3) * 3
}

function getQuarterWindowRange(windowSize: HeatmapWindow, now: Date): { startDate: Date; endDate: Date } {
  const quarterStartMonth = getQuarterStartMonth(now)
  const currentQuarterStart = new Date(now.getFullYear(), quarterStartMonth, 1)

  if (windowSize === 3) {
    return {
      startDate: currentQuarterStart,
      endDate: new Date(now.getFullYear(), quarterStartMonth + 3, 0),
    }
  }

  if (windowSize === 6) {
    return {
      startDate: currentQuarterStart,
      endDate: new Date(now.getFullYear(), quarterStartMonth + 6, 0),
    }
  }

  return {
    startDate: new Date(now.getFullYear(), quarterStartMonth - 3, 1),
    endDate: new Date(now.getFullYear(), quarterStartMonth + 9, 0),
  }
}

function getWeekCountForWindow(windowSize: HeatmapWindow, now: Date): number {
  const { startDate, endDate } = getQuarterWindowRange(windowSize, now)
  const startGridDate = new Date(startDate)
  startGridDate.setDate(startDate.getDate() - startDate.getDay())
  const endGridDate = new Date(endDate)
  endGridDate.setDate(endDate.getDate() + (6 - endDate.getDay()))
  return Math.ceil((endGridDate.getTime() - startGridDate.getTime() + 86400000) / (7 * 86400000))
}

function ActivityHeatmap({ activityDays }: { activityDays: Array<{ date: string; practiceMs: number }> }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const cellSize = 12
  const cellGap = 4
  const dayLabelWidth = 42
  const now = useMemo(() => new Date(), [])

  const windowSize = useMemo<HeatmapWindow>(() => {
    if (containerWidth <= 0) return 3

    const availableWidth = Math.max(containerWidth - dayLabelWidth - 24, 0)
    for (const option of [12, 6, 3] as HeatmapWindow[]) {
      const weekCount = getWeekCountForWindow(option, now)
      const requiredWidth = weekCount * cellSize + Math.max(weekCount - 1, 0) * cellGap
      if (requiredWidth <= availableWidth) return option
    }
    return 3
  }, [containerWidth, now])

  const { startDate, endDate } = useMemo(() => getQuarterWindowRange(windowSize, now), [windowSize, now])
  const startGridDate = new Date(startDate)
  startGridDate.setDate(startDate.getDate() - startDate.getDay())
  const endGridDate = new Date(endDate)
  endGridDate.setDate(endDate.getDate() + (6 - endDate.getDay()))

  useLayoutEffect(() => {
    const updateWidth = (): void => {
      setContainerWidth(containerRef.current?.clientWidth ?? 0)
    }

    updateWidth()
    const observer = typeof ResizeObserver !== 'undefined' && containerRef.current
      ? new ResizeObserver(updateWidth)
      : null

    if (observer && containerRef.current) {
      observer.observe(containerRef.current)
    } else {
      window.addEventListener('resize', updateWidth)
    }

    return () => {
      observer?.disconnect()
      if (!observer) {
        window.removeEventListener('resize', updateWidth)
      }
    }
  }, [])

  const practiceByDate = useMemo(() => new Map(activityDays.map((entry) => [entry.date, entry.practiceMs])), [activityDays])

  const cells: { date: string; level: number; inRange: boolean; practiceMs: number }[] = []
  for (let date = new Date(startGridDate); date <= endGridDate; date.setDate(date.getDate() + 1)) {
    const iso = date.toISOString().slice(0, 10)
    const practiceMs = practiceByDate.get(iso) ?? 0
    let level = 0
    if (practiceMs >= 60 * 60 * 1000) level = 4
    else if (practiceMs >= 30 * 60 * 1000) level = 2
    else if (practiceMs > 0) level = 1
    cells.push({
      date: iso,
      level,
      practiceMs,
      inRange: date >= startDate && date <= endDate,
    })
  }

  const weeks: { date: string; level: number; inRange: boolean; practiceMs: number }[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  const visibleMonths = Array.from({ length: windowSize }, (_, index) =>
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
                    title={cell.inRange ? `${cell.date}: ${formatPracticeMinutes(cell.practiceMs)}` : ''}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="heatmap-legend">
        <span>Less</span>
        {[0, 1, 2, 4].map((l) => (
          <div key={l} className="heatmap-legend-cell heatmap-cell" data-level={l} />
        ))}
        <span>60+ min</span>
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
      <span className="score-fraction-correct">{correctCount}</span>
      <span className="score-fraction-separator">/</span>
      <span className="score-fraction-total">{answeredCount}</span>
    </div>
  )
}

function App() {
  const googleButtonRef = useRef<HTMLDivElement>(null)
  const releasePopoverRef = useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme())
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
  const [sessionMode, setSessionMode] = useState<SessionMode>('guided')
  const [difficultyLevel, setDifficultyLevel] = useState(3)
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<AnswerState[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [viewIndex, setViewIndex] = useState(0)
  const [questionStartedAt, setQuestionStartedAt] = useState<number | null>(null)
  const [pausedElapsed, setPausedElapsed] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [answerInput, setAnswerInput] = useState('')
  const [readingQuizAnswers, setReadingQuizAnswers] = useState<number[]>([])
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
  const [adaptivePopup, setAdaptivePopup] = useState<AdaptiveNotification | null>(null)
  const [inputState, setInputState] = useState<'idle' | 'correct' | 'incorrect'>('idle')
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)
  const [totalTokensUsed, setTotalTokensUsed] = useState(0)
  const [launchState, setLaunchState] = useState<LaunchState>(null)
  const [readingSessionIntroTitle, setReadingSessionIntroTitle] = useState('')
  const [summaryCompletedAt, setSummaryCompletedAt] = useState<string | null>(null)
  const [sessionModePreferences, setSessionModePreferences] = useState<Record<Subject, SessionMode>>({
    Multiplication: 'guided',
    Division: 'guided',
    Reading: 'guided',
  })
  const answerInputRef = useRef<HTMLInputElement>(null)
  const answerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const isGoogleAuthEnabled = Boolean(googleClientId)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

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
  const isReadingQuiz = currentQuestion?.kind === 'reading-quiz'

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

  useEffect(() => {
    if (!showReleaseNotes) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!releasePopoverRef.current?.contains(event.target as Node)) {
        setShowReleaseNotes(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [showReleaseNotes])

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

  useEffect(() => {
    if (isReadingSummary) {
      setAnswerInput(currentAnswerState?.userTextAnswer ?? '')
      return
    }
    if (isReadingQuiz) {
      const expectedLength = currentQuestion?.quizItems?.length ?? 0
      const existingAnswers = currentAnswerState?.selectedOptions ?? []
      setReadingQuizAnswers(
        expectedLength > 0
          ? Array.from({ length: expectedLength }, (_, index) => existingAnswers[index] ?? -1)
          : [],
      )
      return
    }
    if (!isReadingPage) {
      setReadingQuizAnswers([])
    }
  }, [currentAnswerState?.selectedOptions, currentAnswerState?.userTextAnswer, currentQuestion?.quizItems, isReadingPage, isReadingQuiz, isReadingSummary])

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
  const startSession = async (subject: Subject, mode: SessionMode): Promise<void> => {
    setError('')
    setIsBusy(true)
    try {
      const res = await apiFetch('/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId, questionCount: 12, subject, sessionMode: mode }),
      })
      if (!res.ok) throw new Error('Failed to start session')
      const data = (await res.json()) as StartSessionResponse
      setSessionId(data.sessionId)
      setSessionSubject(data.subject)
      setSessionMode(data.sessionMode)
      setDifficultyLevel(data.difficultyLevel ?? 3)
      setQuestions(data.questions)
      setAnswers(data.answers)
      setCurrentIndex(data.currentIndex)
      setViewIndex(0)
      setAnswerInput('')
      setReadingQuizAnswers([])
      setHintSteps([])
      setFeedback('')
      setIsCorrect(null)
      setHelpSource(null)
      setInputState('idle')
      setShowExitConfirm(false)
      setSummaryCompletedAt(null)
      setTotalTokensUsed(data.totalTokensUsed ?? 0)
      if (subject === 'Reading') {
        const introTitle = data.questions[0]?.title ?? ''
        setReadingSessionIntroTitle(introTitle)
        window.setTimeout(() => setReadingSessionIntroTitle(''), 2600)
      } else {
        setReadingSessionIntroTitle('')
      }
      setStage('session')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Session start failed')
    } finally {
      setLaunchState(null)
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
        sessionMode: SessionMode
        status: string
        currentIndex: number
        questions: Question[]
        answers: AnswerState[]
        completedAt?: string
        totalTokensUsed?: number
        difficultyLevel?: number
      }
      setSessionId(data.sessionId)
      setSessionSubject(data.subject)
      setSessionMode(data.sessionMode)
      setDifficultyLevel(data.difficultyLevel ?? 3)
      setQuestions(data.questions)
      setAnswers(data.answers)
      setCurrentIndex(data.currentIndex)
      setViewIndex(data.currentIndex)
      setAnswerInput('')
      setReadingQuizAnswers([])
      setHintSteps([])
      setFeedback('')
      setIsCorrect(null)
      setHelpSource(null)
      setInputState('idle')
      setShowExitConfirm(false)
      setTotalTokensUsed(data.totalTokensUsed ?? 0)
      setSummaryCompletedAt(data.completedAt ?? null)
      setReadingSessionIntroTitle('')
      setStage('session')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed')
    } finally {
      setLaunchState(null)
      setIsBusy(false)
    }
  }

  const viewSavedScorePage = async (savedSessionId: string): Promise<void> => {
    setError('')
    setIsBusy(true)
    try {
      const res = await apiFetch(`/session/${selectedUserId}/${savedSessionId}`)
      if (!res.ok) throw new Error('Failed to load saved score page')
      const data = (await res.json()) as {
        sessionId: string
        subject: Subject
        sessionMode: SessionMode
        status: 'active' | 'completed'
        currentIndex: number
        questions: Question[]
        answers: AnswerState[]
        completedAt?: string
        totalTokensUsed?: number
        difficultyLevel?: number
      }
      if (data.status !== 'completed') {
        throw new Error('This session is not completed yet.')
      }
      setSessionId(data.sessionId)
      setSessionSubject(data.subject)
      setSessionMode(data.sessionMode)
      setDifficultyLevel(data.difficultyLevel ?? 3)
      setQuestions(data.questions)
      setAnswers(data.answers)
      setCurrentIndex(data.currentIndex)
      setViewIndex(data.currentIndex)
      setAnswerInput('')
      setReadingQuizAnswers([])
      setHintSteps([])
      setFeedback('')
      setIsCorrect(null)
      setHelpSource(null)
      setInputState('idle')
      setShowExitConfirm(false)
      setTotalTokensUsed(data.totalTokensUsed ?? 0)
      setSummaryCompletedAt(data.completedAt ?? null)
      setReadingSessionIntroTitle('')
      setStage('summary')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the saved score page')
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
    setSummaryCompletedAt(null)
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
      setLaunchState({ subject, mode: 'resume' })
      void resumeSession(latestInProgressSession.sessionId)
      return
    }
    setLaunchState({ subject, mode: 'start' })
    void startSession(subject, sessionModePreferences[subject])
  }

  const openLastScorePage = (subject: Subject): void => {
    const lastCompletedSession = dashStats?.latestCompletedBySubject?.[subject]
    if (!lastCompletedSession) return
    void viewSavedScorePage(lastCompletedSession.sessionId)
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
      if (data.difficultyLevel !== undefined) setDifficultyLevel(data.difficultyLevel)
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

  const showAdaptivePopup = useCallback((notification?: AdaptiveNotification | null) => {
    if (!notification) return
    setAdaptivePopup(notification)
    window.setTimeout(() => setAdaptivePopup(null), notification.kind === 'reading-warning' ? 3200 : 2800)
  }, [])

  const advanceQuizFlow = useCallback((nextIndex: number, status: 'active' | 'completed', delayMs = 0) => {
    const advance = () => {
      setFeedback('')
      setIsCorrect(null)
      setAnswerInput('')
      setReadingQuizAnswers([])
      setInputState('idle')
      setHintSteps([])
      setPausedElapsed(0)
      setQuestionStartedAt(Date.now())
      if (status === 'completed') {
        setStage('summary')
      } else {
        setViewIndex(nextIndex)
      }
    }

    if (delayMs > 0) {
      window.setTimeout(advance, delayMs)
      return
    }
    advance()
  }, [])

  /* ── Submit Answer ──────────────────────────────────────────── */
  const submitAnswer = async (): Promise<void> => {
    if (!sessionId || viewIndex !== currentIndex) return
    if (!isReadingPage && !isReadingQuiz && !answerInput.trim()) return
    if (isReadingQuiz && readingQuizAnswers.some((value) => value < 0)) return
    setIsBusy(true)
    setError('')
    try {
      const res = await apiFetch(`/session/${selectedUserId}/${sessionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionIndex: viewIndex,
          answer: answerInput,
          elapsedMs,
          readingQuizAnswers: isReadingQuiz ? readingQuizAnswers : undefined,
        }),
      })
      const data = (await res.json()) as SubmitAnswerResponse | { error: string }
      if (!res.ok) throw new Error('error' in data ? data.error : 'Failed to submit answer')
      const payload = data as SubmitAnswerResponse
      setAnswers(payload.answers)
      setQuestions(payload.questions)
      setCurrentIndex(payload.currentIndex)
      setIsCorrect(payload.isCorrect)
      if (payload.completedAt !== undefined) setSummaryCompletedAt(payload.completedAt)
      if (payload.totalTokensUsed !== undefined) setTotalTokensUsed(payload.totalTokensUsed)
      if (payload.difficultyLevel !== undefined) setDifficultyLevel(payload.difficultyLevel)
      showAdaptivePopup(payload.adaptiveNotification)

      if (isReadingPage) {
        fireReadingAdvanceAnimation()
        setFeedback('')
        setIsCorrect(null)
        setAnswerInput('')
        setReadingQuizAnswers([])
        setHintSteps([])
        setInputState('idle')
        setPausedElapsed(0)
        setQuestionStartedAt(Date.now())
        setViewIndex(payload.currentIndex)
      } else if (isReadingSummary || isReadingQuiz) {
        setFeedback('')
        setIsCorrect(null)
        setHintSteps([])
        setInputState('idle')
      } else if (sessionMode === 'quiz') {
        advanceQuizFlow(payload.currentIndex, payload.status)
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
        if (isReadingSession) {
          setTimeout(() => setStage('summary'), 150)
        } else if (sessionMode !== 'quiz') {
          setTimeout(() => setStage('summary'), payload.isCorrect ? 2500 : 500)
        }
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
        body: JSON.stringify({ questionIndex: viewIndex, elapsedMs }),
      })
      if (!res.ok) throw new Error('Failed to reveal answer')
      const data = (await res.json()) as RevealResponse
      setAnswers(data.answers)
      setQuestions(data.questions)
      setCurrentIndex(data.currentIndex)
      setIsCorrect(false)
      if (data.completedAt !== undefined) setSummaryCompletedAt(data.completedAt)
      setFeedback(`The answer is ${data.correctAnswer}. ${data.explanation}`)
      setInputState('incorrect')
      setHintSteps([])
      if (data.difficultyLevel !== undefined) setDifficultyLevel(data.difficultyLevel)
      showAdaptivePopup(data.adaptiveNotification)
      if (sessionMode === 'quiz') {
        advanceQuizFlow(data.currentIndex, data.status, 1800)
      }
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
    setReadingQuizAnswers([])
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
    const finalAnswer = answers.find((_answer, index) => questions[index]?.kind === 'reading-summary')
      ?? answers.find((_answer, index) => questions[index]?.kind === 'reading-quiz')
    const assessmentMode: 'summary' | 'quiz' = questions.find((_question, index) => answers[index] === finalAnswer)?.kind === 'reading-quiz'
      ? 'quiz'
      : 'summary'
    const averageWpm = finalAnswer?.readingWpm ?? 0
    return {
      pagesRead: readingPages.length,
      totalWords,
      averageWpm,
      overallScore: finalAnswer?.readingScore ?? 0,
      comprehensionScore: finalAnswer?.comprehensionScore ?? 0,
      speedScore: finalAnswer?.speedScore ?? 0,
      vocabularyScore: finalAnswer?.vocabularyScore,
      vocabularyTermsUsed: finalAnswer?.vocabularyTermsUsed ?? 0,
      vocabularyTermsExplained: finalAnswer?.vocabularyTermsExplained ?? 0,
      assessmentMode,
      warning: averageWpm >= 180
        ? 'This pace was extremely fast for the passage. Next time, slow down enough to really absorb the meaning.'
        : '',
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
        <div className="login-theme-toggle">
          <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
        </div>
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
    const readingLaunchInProgress = launchState?.subject === 'Reading' && launchState.mode === 'start'
    const learningCoach = dashStats?.learningCoach
    const dailyPractice = dashStats?.dailyPractice
    const dailyTargetMs = dailyPractice?.targetMs ?? 60 * 60 * 1000
    const todayProgress = Math.min(100, Math.round(((dailyPractice?.todayMs ?? 0) / dailyTargetMs) * 100))
    const yesterdayProgress = Math.min(100, Math.round(((dailyPractice?.yesterdayMs ?? 0) / dailyTargetMs) * 100))

    return (
      <div className="dashboard-screen">
        {/* Nav */}
        <nav className="dashboard-nav">
          <div className="nav-brand-wrap">
            <div className="nav-brand">
              <img src="/adi_avatar.png" alt="Adi" className="nav-brand-avatar" />
              APLC
            </div>
            <div className="nav-release" ref={releasePopoverRef}>
              <button
                type="button"
                className={`nav-release-button ${showReleaseNotes ? 'open' : ''}`}
                onClick={() => setShowReleaseNotes((current) => !current)}
                aria-expanded={showReleaseNotes}
                aria-haspopup="dialog"
              >
                <span className="nav-release-label">{releaseInfo.displayLabel}</span>
                <span className="nav-release-separator">•</span>
                <span className="nav-release-sha">{releaseInfo.shortSha}</span>
              </button>
              {showReleaseNotes && (
                <div className="nav-release-popover" role="dialog" aria-label="Latest release notes">
                  <p className="nav-release-kicker">Current release</p>
                  <p className="nav-release-title">{releaseInfo.headline}</p>
                  <p className="nav-release-meta">
                    {releaseInfo.displayLabel} · {releaseInfo.shortSha} · {releaseInfo.releaseDate}
                  </p>
                  <div className="nav-release-divider" />
                  <p className="nav-release-section-title">Latest changes</p>
                  <ul className="nav-release-list">
                    {releaseInfo.changes.map((change) => (
                      <li key={change.sha} className="nav-release-item">
                        <span className="nav-release-item-summary">{change.summary}</span>
                        <span className="nav-release-item-meta">{change.sha}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
          <div className="nav-user">
            {streak > 0 && (
              <div className="nav-streak">🔥 {streak} day streak</div>
            )}
            <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
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
          {streak > 0 && (
            <div className="mobile-streak-banner" aria-label={`Current streak ${streak} days`}>
              🔥 {streak} day streak
            </div>
          )}

          <div className="dashboard-top-grid">
            {dailyPractice && (
              <div className="daily-practice-panel">
                <div className="daily-practice-header">
                  <div>
                    <p className="daily-practice-kicker">Daily Practice Goal</p>
                    <h3 className="panel-title">⏳ Build today&apos;s habit</h3>
                    <p className="daily-practice-tier-copy">{getDailyHabitTierCopy(dailyTargetMs)}</p>
                  </div>
                  <p className="daily-practice-summary">
                    Today: {formatPracticeMinutes(dailyPractice.todayMs)} · Yesterday: {formatPracticeMinutes(dailyPractice.yesterdayMs)}
                  </p>
                </div>
                <div className="daily-practice-bars">
                  <div className="daily-practice-row">
                    <div className="daily-practice-labels">
                      <span>Today so far</span>
                      <span>{formatPracticeMinutes(dailyPractice.todayMs)}</span>
                    </div>
                    <div className="daily-practice-track">
                      <div className="daily-practice-fill today" style={{ width: `${todayProgress}%` }} />
                    </div>
                  </div>
                  <div className="daily-practice-row">
                    <div className="daily-practice-labels">
                      <span>Yesterday</span>
                      <span>{formatPracticeMinutes(dailyPractice.yesterdayMs)}</span>
                    </div>
                    <div className="daily-practice-track">
                      <div className="daily-practice-fill yesterday" style={{ width: `${yesterdayProgress}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <ActivityHeatmap activityDays={activityDays} />
          </div>

          {learningCoach?.bestNextStep && (
            <div className="best-next-step-panel">
              <div className="best-next-step-copy">
                <p className="best-next-step-kicker">Best Next Step</p>
                <h3 className="panel-title">🎯 {learningCoach.bestNextStep.title}</h3>
                <p className="best-next-step-reason">{learningCoach.bestNextStep.reason}</p>
              </div>
              <p className="best-next-step-cta">{learningCoach.bestNextStep.cta}</p>
            </div>
          )}

          {/* Subject Selection — primary action, shown near top */}
          <div className="subjects-section">
            <h3 className="panel-title">📚 Choose a Subject</h3>
            {readingLaunchInProgress && (
              <div className="reading-launch-banner" role="status" aria-live="polite">
                <div className="reading-launch-spinner">
                  <span className="loading-dots"><span /><span /><span /></span>
                </div>
                <div>
                  <p className="reading-launch-title">Preparing a fresh reading story</p>
                  <p className="reading-launch-copy">Your next passage is loading now. Stay with me for a moment.</p>
                </div>
              </div>
            )}
            <div className="subjects-grid">
              {ACTIVE_SUBJECTS.map((subject) => {
                const latestInProgressSession = latestInProgressBySubject[subject.id]
                const lastCompletedSession = dashStats?.latestCompletedBySubject?.[subject.id]
                const unfinishedForSubject = inProgressSessions.filter((session) => session.subject === subject.id)
                const isLaunchingThisSubject = launchState?.subject === subject.id
                const isBlockingHomeLaunch = isBusy && launchState !== null
                const lockedSessionMode = latestInProgressSession?.sessionMode
                const displayedSessionMode = lockedSessionMode ?? sessionModePreferences[subject.id]
                return (
                  <div key={subject.id} className="subject-card active">
                    <div className="subject-badge">Active</div>
                    <div className={`subject-card-icon ${subject.iconClass}`}>{subject.icon}</div>
                    <p className="subject-card-name">{subject.id}</p>
                    <p className="subject-card-desc">{subject.description}</p>
                    <div className="session-mode-picker">
                      <p className="session-mode-picker-title">Session Mode</p>
                      <div className="session-mode-options">
                        {(['guided', 'quiz'] as SessionMode[]).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            className={`session-mode-option ${displayedSessionMode === mode ? 'selected' : ''}`}
                            onClick={() => setSessionModePreferences((current) => ({ ...current, [subject.id]: mode }))}
                            disabled={Boolean(lockedSessionMode && lockedSessionMode !== mode)}
                            aria-disabled={Boolean(lockedSessionMode && lockedSessionMode !== mode)}
                          >
                            <span>{getSessionModeMeta(mode).shortLabel}</span>
                          </button>
                        ))}
                      </div>
                      <p className="session-mode-picker-copy">{getSessionModeMeta(displayedSessionMode).description}</p>
                    </div>
                    {latestInProgressSession && (
                      <div className="subject-session-stack">
                        <div className="subject-session-stack-title">Session In Progress</div>
                        <div className="subject-session-item">
                          <div className="subject-session-copy">
                            <p className="subject-session-title">{subject.id}</p>
                            <p className="subject-session-meta">
                              {getSessionModeMeta(latestInProgressSession.sessionMode).shortLabel} · {' '}
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
                      className={`btn-start-subject ${isBlockingHomeLaunch && !isLaunchingThisSubject ? 'quiet-disabled' : ''}`}
                      onClick={() => requestStartSession(subject.id)}
                      disabled={isBusy}
                    >
                      {isLaunchingThisSubject ? (
                        <>
                          <span className="loading-dots"><span /><span /><span /></span>
                          <span>
                            {launchState?.mode === 'resume'
                              ? 'Opening Session...'
                              : subject.id === 'Reading'
                                ? 'Preparing Story...'
                                : 'Starting Session...'}
                          </span>
                        </>
                      ) : latestInProgressSession
                        ? `Continue ${getSessionModeMeta(latestInProgressSession.sessionMode).shortLabel} →`
                        : `Start ${getSessionModeMeta(displayedSessionMode).shortLabel} →`}
                    </button>
                    {lastCompletedSession && (
                      <button
                        type="button"
                        className="subject-score-link"
                        onClick={() => openLastScorePage(subject.id)}
                        disabled={isBusy}
                      >
                        <span>Last score page</span>
                        <span>{formatRelativeTime(lastCompletedSession.completedAt)}</span>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {learningCoach && (
            <div className="coach-grid coach-grid-lower">
              <div className="coach-panel">
                <h3 className="panel-title">🧠 Skill Mastery</h3>
                <div className="mastery-grid">
                  {learningCoach.masteryBySubject.map((subject) => (
                    <div key={subject.subject} className="mastery-card">
                      <div className="mastery-card-header">
                        <div>
                          <p className="mastery-card-title">{subject.subject}</p>
                          <p className="mastery-card-summary">{subject.summary}</p>
                        </div>
                        <span className={`mastery-stage-pill ${getMasteryStageMeta(subject.overallStage).className}`}>
                          {getMasteryStageMeta(subject.overallStage).label}
                        </span>
                      </div>
                      <div className="mastery-skill-list">
                        {subject.skills.map((skill) => (
                          <div key={skill.key} className="mastery-skill-row">
                            <div>
                              <p className="mastery-skill-label">{skill.label}</p>
                              <p className="mastery-skill-meta">{skill.evidenceCount} signals{skill.accuracy !== null ? ` · ${skill.accuracy}%` : ''}</p>
                            </div>
                            <span className={`mastery-stage-chip ${getMasteryStageMeta(skill.stage).className}`}>
                              {getMasteryStageMeta(skill.stage).label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Insights */}
          {insights?.hasEnoughData && (
            <div className="insights-panel">
              <h3 className="panel-title">💡 Detailed Insigt</h3>
              <p className="insights-summary">{insights.message}</p>
              <div className="insights-overview">
                <div className="insights-overview-stat">
                  <span className="insights-overview-value">{insights.overall.completedSessions}</span>
                  <span className="insights-overview-label">Completed Sessions</span>
                  <span className="insights-overview-subtext">
                    Multiplication {insights.overall.subjectSessionBreakdown.Multiplication} · Division {insights.overall.subjectSessionBreakdown.Division} · Reading {insights.overall.subjectSessionBreakdown.Reading}
                  </span>
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
              {(insights.recommendedFocus.length > 0 || learningCoach?.bestNextStep) && (
                <div className="insight-box recommendations">
                  <p className="insight-box-title">🎯 Next Best Focus</p>
                  {learningCoach?.bestNextStep && (
                    <p className="insight-box-copy">
                      {learningCoach.bestNextStep.title}. {learningCoach.bestNextStep.cta}
                    </p>
                  )}
                  {insights.recommendedFocus.length > 0 && (
                    <ul className="insight-list">
                      {insights.recommendedFocus.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {insights.bySubject.length > 0 && (
                <div className="subject-insights-grid">
                  {insights.bySubject.map((subjectInsight) => {
                    const trendMeta = getSubjectTrendMeta(subjectInsight.trend)

                    return (
                      <div key={subjectInsight.subject} className={`subject-insight-card trend-${subjectInsight.trend}`}>
                        <div className="subject-insight-header">
                          <div>
                            <p className="subject-insight-name">{subjectInsight.subject}</p>
                            <p className="subject-insight-headline">{subjectInsight.headline}</p>
                          </div>
                          <div className="subject-insight-meta">
                            <span className="subject-insight-sessions">
                              {subjectInsight.sessionsCompleted} session{subjectInsight.sessionsCompleted === 1 ? '' : 's'}
                            </span>
                            <span className={`subject-insight-trend trend-${subjectInsight.trend}`}>
                              <span className="subject-insight-trend-icon" aria-hidden="true">{trendMeta.icon}</span>
                              <span>{trendMeta.label}</span>
                            </span>
                          </div>
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
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {!insights?.hasEnoughData && (
            <div className="insights-panel">
              <h3 className="panel-title">💡 Detailed Insigt</h3>
              <p className="no-data-msg">
                📊 Complete at least 3 sessions to unlock personalized insights about your strengths and areas to improve!
              </p>
            </div>
          )}

          {learningCoach && (
            <div className="coach-panel parent-review-panel">
              <h3 className="panel-title">👨‍👩‍👦 Parent Review</h3>
              <div className="parent-review-habits">
                <div className="parent-review-habits-copy">
                  <p className="parent-review-habits-kicker">Learning Habits</p>
                  <p className="parent-review-habits-text">A compact weekly snapshot of first-try confidence, independence, and working pace.</p>
                </div>
                <div className="habit-signal-list compact">
                  {learningCoach.habitSignals.map((signal) => (
                    <div key={signal.label} className={`habit-signal tone-${signal.tone}`}>
                      <span className="habit-signal-label">{signal.label}</span>
                      <span className="habit-signal-value">{signal.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="parent-review-grid">
                <div className="insight-box strengths">
                  <p className="insight-box-title">What To Feel Good About</p>
                  <ul className="insight-list">
                    {learningCoach.parentReview.celebration.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div className="insight-box improvements">
                  <p className="insight-box-title">What To Watch</p>
                  <ul className="insight-list">
                    {learningCoach.parentReview.watchlist.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div className="insight-box recommendations">
                  <p className="insight-box-title">How To Support Him</p>
                  <ul className="insight-list">
                    {learningCoach.parentReview.supportMoves.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  /* ── Render: Session ────────────────────────────────────── */
  if (stage === 'session' && currentQuestion) {
    const isCurrentQuestion = viewIndex === currentIndex
    const isCompleted = currentAnswerState?.completed ?? false
    const canContinueAfterFeedback = isCorrect === true || Boolean(currentAnswerState?.usedReveal || viewIndex < currentIndex)
    const isViewingPast = viewIndex < currentIndex
    const readingCheckpoint = isReadingPage ? getReadingCheckpointPrompt(viewIndex) : null

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
          <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
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
            <div className="question-badge-row">
              <div className={`question-type-badge mode-${sessionMode}`}>
                {getSessionModeMeta(sessionMode).shortLabel}
              </div>
              {!isReadingSession && (
                <div className="question-difficulty-chip">
                  Adaptive Level {difficultyLevel}/5
                </div>
              )}
              <div className={`question-type-badge ${currentQuestion.type}`}>
                {getQuestionTypeBadge(currentQuestion.type)}
              </div>
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
                aria-label="Save progress and go to Home"
              >
                <span className="btn-home-card-icon" aria-hidden="true">🏠</span>
                <span className="btn-home-card-copy">
                  <span className="btn-home-card-label">Home</span>
                  <span className="btn-home-card-hint">Tap here to save and go back</span>
                </span>
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
                  <div className="reading-target-chip">Target pace: 130 WPM</div>
                </div>
                <div className="reading-page-content">
                  {currentQuestion.content}
                </div>
                {currentQuestion.vocabularyFocus && currentQuestion.vocabularyFocus.length > 0 && (
                  <div className="reading-vocabulary-card">
                    <p className="reading-vocabulary-kicker">Word To Notice</p>
                    {currentQuestion.vocabularyFocus.map((item) => (
                      <div key={item.term} className="reading-vocabulary-item compact">
                        <p className="reading-vocabulary-term">{item.term}</p>
                        <p className="reading-vocabulary-meaning">{item.studentFriendlyMeaning}</p>
                        <p className="reading-vocabulary-clue">{item.contextClue}</p>
                      </div>
                    ))}
                  </div>
                )}
                {readingCheckpoint && isCurrentQuestion && (
                  <div className="reading-coach-card">
                    <p className="reading-coach-kicker">{readingCheckpoint.title}</p>
                    <p className="reading-coach-prompt">{readingCheckpoint.prompt}</p>
                  </div>
                )}
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
                {currentQuestion.vocabularyFocus && currentQuestion.vocabularyFocus.length > 0 && (
                  <div className="reading-vocabulary-card summary">
                    <p className="reading-vocabulary-kicker">Vocabulary Builder</p>
                    <p className="reading-vocabulary-intro">Try to use one of these words correctly in your summary or say its meaning aloud before you submit.</p>
                    <div className="reading-vocabulary-list">
                      {currentQuestion.vocabularyFocus.map((item) => (
                        <div key={item.term} className="reading-vocabulary-item">
                          <p className="reading-vocabulary-term">{item.term}</p>
                          <p className="reading-vocabulary-meaning">{item.studentFriendlyMeaning}</p>
                          <p className="reading-vocabulary-clue">{item.contextClue}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isReadingQuiz && (
              <div className="reading-page-panel">
                <div className="reading-page-header">
                  <div>
                    <p className="reading-page-title">{currentQuestion.title}</p>
                    <p className="reading-page-meta">Answer each multiple choice question before submitting.</p>
                  </div>
                  <div className="reading-target-chip">Fast-read check</div>
                </div>
                {currentQuestion.content && (
                  <div className="reading-warning-panel">{currentQuestion.content}</div>
                )}
                {currentQuestion.vocabularyFocus && currentQuestion.vocabularyFocus.length > 0 && (
                  <div className="reading-vocabulary-card summary">
                    <p className="reading-vocabulary-kicker">Vocabulary Builder</p>
                    <p className="reading-vocabulary-intro">Before you submit, pick one word and explain its meaning from context in your own words.</p>
                    <div className="reading-vocabulary-list">
                      {currentQuestion.vocabularyFocus.map((item) => (
                        <div key={item.term} className="reading-vocabulary-item">
                          <p className="reading-vocabulary-term">{item.term}</p>
                          <p className="reading-vocabulary-meaning">{item.studentFriendlyMeaning}</p>
                          <p className="reading-vocabulary-clue">{item.contextClue}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="reading-quiz-list">
                  {currentQuestion.quizItems?.map((item, itemIndex) => (
                    <div key={item.id} className="reading-quiz-item">
                      <p className="reading-quiz-question">{itemIndex + 1}. {item.prompt}</p>
                      <div className="reading-quiz-options">
                        {item.options.map((option, optionIndex) => (
                          <button
                            key={`${item.id}-${optionIndex}`}
                            type="button"
                            className={`reading-quiz-option ${readingQuizAnswers[itemIndex] === optionIndex ? 'selected' : ''}`}
                            onClick={() => {
                              setReadingQuizAnswers((current) => {
                                const next = current.length > 0 ? [...current] : Array.from({ length: currentQuestion.quizItems?.length ?? 0 }, () => -1)
                                next[itemIndex] = optionIndex
                                return next
                              })
                            }}
                            disabled={!isCurrentQuestion || isCompleted}
                          >
                            <span className="reading-quiz-option-marker">{String.fromCharCode(65 + optionIndex)}</span>
                            <span>{option}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Answer Input */}
            {!isReadingPage && !isReadingQuiz && (
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
                  disabled={isBusy || (!isReadingPage && !isReadingQuiz && !answerInput.trim()) || (isReadingQuiz && readingQuizAnswers.some((value) => value < 0))}
                >
                  {isBusy
                    ? <span className="loading-dots"><span /><span /><span /></span>
                    : isReadingPage
                      ? 'Next Page →'
                      : isReadingSummary
                        ? 'Submit Summary'
                        : isReadingQuiz
                          ? 'Submit Quiz'
                          : sessionMode === 'quiz'
                            ? 'Submit & Next →'
                            : 'Check Answer'}
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
                  {sessionMode === 'quiz' ? '👁️' : isCorrect ? '✓' : '✗'}
                </div>
                <p className="feedback-title">
                  {sessionMode === 'quiz'
                    ? 'Answer shown — keep moving through the quiz.'
                    : isCorrect
                      ? 'Correct! Well done! 🎉'
                      : 'Not quite right — keep going! 💪'}
                </p>
              </div>
              <div className="feedback-message">
                <MathText text={feedback} />
              </div>
              <div className="feedback-actions">
                {!isCorrect && isCurrentQuestion && sessionMode !== 'quiz' && (
                  <button className="btn-retry" onClick={retryQuestion}>
                    Retry
                  </button>
                )}
                {canContinueAfterFeedback && sessionMode !== 'quiz' && (
                  <button className="btn-continue" onClick={continueToNext}>
                    {isCorrect ? 'Continue →' : 'See Next Question →'}
                  </button>
                )}
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

        {adaptivePopup && (
          <div className={`adaptive-popup-overlay ${adaptivePopup.kind}`}>
            <div className={`adaptive-popup-card ${adaptivePopup.kind}`}>
              <p className="adaptive-popup-title">{adaptivePopup.title}</p>
              <p className="adaptive-popup-message">{adaptivePopup.message}</p>
            </div>
          </div>
        )}
        {readingSessionIntroTitle && sessionSubject === 'Reading' && (
          <div className="reading-session-intro-overlay" role="status" aria-live="polite">
            <div className="reading-session-intro-card">
              <p className="reading-session-intro-kicker">Today&apos;s Story</p>
              <p className="reading-session-intro-title">{readingSessionIntroTitle}</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ── Render: Summary ────────────────────────────────────── */
  if (stage === 'summary') {
    const sessionCoach = getSessionCoachSummary(sessionSubject, answers, questions, readingSummary)
    if (sessionSubject === 'Reading') {
      const targetHit = readingSummary.averageWpm >= 120 && readingSummary.averageWpm <= 140
      return (
        <div className="summary-screen">
          <div className="summary-toolbar">
            <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
          </div>
          <div className="summary-hero">
            <span className="summary-trophy">📖</span>
            <h2>Reading Session Complete!</h2>
            {summaryCompletedAt && <p className="summary-timestamp">Saved score · {formatScoreTimestamp(summaryCompletedAt)}</p>}
            <p>
              {readingSummary.assessmentMode === 'quiz'
                ? 'You finished the story and completed a comprehension check.'
                : 'You finished the story and reflected on its core meaning.'}
            </p>
            <div className="summary-target-badge">
              {getSessionModeMeta(sessionMode).shortLabel} · {' '}
              {targetHit
                ? `On target at ${readingSummary.averageWpm} WPM`
                : readingSummary.averageWpm > 180
                  ? `Fast pace: ${readingSummary.averageWpm} WPM`
                  : `Target pace: 130 WPM`}
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
            <div className="summary-stat-card">
              <span className="summary-stat-icon">🗣️</span>
              <div className="summary-stat-value">{readingSummary.vocabularyScore !== undefined ? `${readingSummary.vocabularyScore}/10` : 'N/A'}</div>
              <div className="summary-stat-label">Vocabulary Use</div>
            </div>
          </div>

          <div className="reading-summary-note">
            You read about {readingSummary.totalWords.toLocaleString()} words across {readingSummary.pagesRead} pages.
            {' '}Target reading pace is 130 WPM, and speed score is based on how close you were to that target.
            {readingSummary.assessmentMode === 'quiz' && ' Because the pace was high, the final check switched to multiple choice.'}
            {readingSummary.vocabularyScore !== undefined
              ? ` Vocabulary use scored ${readingSummary.vocabularyScore}/10, with ${readingSummary.vocabularyTermsUsed} target words used and ${readingSummary.vocabularyTermsExplained} explained clearly.`
              : ' Vocabulary use was not scored in this session because the final check switched to quiz mode.'}
            {readingSummary.warning && ` ${readingSummary.warning}`}
          </div>

          <div className="session-coach-summary">
            <div className="coach-summary-card">
              <p className="coach-summary-label">Celebrate</p>
              <p className="coach-summary-copy">{sessionCoach.celebration}</p>
            </div>
            <div className="coach-summary-card">
              <p className="coach-summary-label">Grow Next</p>
              <p className="coach-summary-copy">{sessionCoach.growthNote}</p>
            </div>
            <div className="coach-summary-card">
              <p className="coach-summary-label">Tomorrow</p>
              <p className="coach-summary-copy">{sessionCoach.nextStep}</p>
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
            <button className="btn-again" onClick={() => void startSession(sessionSubject, sessionMode)}>
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
        <div className="summary-toolbar">
          <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
        </div>
        <div className="summary-hero">
          <span className="summary-trophy">{trophy}</span>
          <h2>Session Complete!</h2>
          {summaryCompletedAt && <p className="summary-timestamp">Saved score · {formatScoreTimestamp(summaryCompletedAt)}</p>}
          <p>{message}</p>
          {hitTarget && (
            <div className="summary-target-badge">🎯 Target Achieved! ({SESSION_TARGET_ACCURACY}%+)</div>
          )}
          <div className="summary-target-badge subtle">{getSessionModeMeta(sessionMode).label}</div>
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

        <div className="session-coach-summary">
          <div className="coach-summary-card">
            <p className="coach-summary-label">Celebrate</p>
            <p className="coach-summary-copy">{sessionCoach.celebration}</p>
          </div>
          <div className="coach-summary-card">
            <p className="coach-summary-label">Grow Next</p>
            <p className="coach-summary-copy">{sessionCoach.growthNote}</p>
          </div>
          <div className="coach-summary-card">
            <p className="coach-summary-label">Tomorrow</p>
            <p className="coach-summary-copy">{sessionCoach.nextStep}</p>
          </div>
        </div>

        {sessionMode === 'quiz' && (
          <div className="quiz-results-panel">
            <h3 className="panel-title">📝 Quiz Review</h3>
            <div className="quiz-results-list">
              {questions.map((question, index) => {
                const answer = answers[index]
                const answerLabel = answer?.usedReveal
                  ? 'Answer shown'
                  : answer?.isCorrect
                    ? 'Correct'
                    : 'Incorrect'
                return (
                  <div key={question.id} className="quiz-result-card">
                    <div className="quiz-result-header">
                      <span className="quiz-result-number">Q{index + 1}</span>
                      <span className={`quiz-result-status ${answer?.usedReveal ? 'revealed' : answer?.isCorrect ? 'correct' : 'incorrect'}`}>
                        {answerLabel}
                      </span>
                    </div>
                    <div className="quiz-result-prompt">
                      <MathText text={question.prompt} />
                    </div>
                    <p className="quiz-result-meta">
                      Your answer: {answer?.userAnswer !== undefined ? String(answer.userAnswer) : answer?.usedReveal ? 'Answer was shown during the quiz' : 'Not submitted'}
                      {!answer?.isCorrect && !answer?.usedReveal && ' · Review this one again in the next guided session.'}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="summary-actions">
          <button className="btn-home" onClick={() => {
            void computeDashStats(selectedUserId)
            void computeInProgress(selectedUserId)
            setStage('home')
          }}>
            🏠 Home
          </button>
          <button className="btn-again" onClick={() => void startSession(sessionSubject, sessionMode)}>
            {isBusy ? <span className="loading-dots"><span /><span /><span /></span> : '🔄 Practice Again'}
          </button>
        </div>
      </div>
    )
  }

  return null
}

export default App
