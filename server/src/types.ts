export type Subject = 'Multiplication' | 'Division' | 'Reading'
export type QuestionType = 'decimal' | 'fraction' | 'percentage' | 'mixed' | 'reading_page' | 'reading_summary'
export type QuestionKind = 'math' | 'reading-page' | 'reading-summary'

export interface Question {
  id: string
  prompt: string
  type: QuestionType
  kind?: QuestionKind
  title?: string
  content?: string
  wordCount?: number
  answer: number
  tolerance: number
  helpSteps: string[]
  explanation: string
  generated?: boolean
}

export interface QuestionState {
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
  startedAt?: number
  readingScore?: number
  comprehensionScore?: number
  speedScore?: number
  readingWpm?: number
}

export interface SessionRecord {
  id: string
  userId: string
  subject: Subject
  status: 'active' | 'completed'
  startedAt: string
  completedAt?: string
  currentIndex: number
  questions: Question[]
  answers: QuestionState[]
  totalTokensUsed: number
}

export interface UserProfile {
  id: string
  name: string
  learningFocus: string
  timezone: string
  notes: string
}

export interface OpenAICallStat {
  label: string
  latencyMs: number
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  finishReason: string
  requestId: string
}
