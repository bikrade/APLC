export type Subject = 'Multiplication' | 'Division' | 'Reading'
export type SessionMode = 'guided' | 'quiz'
export type QuestionType = 'decimal' | 'fraction' | 'percentage' | 'mixed' | 'reading_page' | 'reading_summary' | 'reading_quiz'
export type QuestionKind = 'math' | 'reading-page' | 'reading-summary' | 'reading-quiz'
export type ReadingStorySource = 'ai' | 'fallback'
export type ReadingGenerationStatus = 'queued' | 'planning' | 'writing' | 'ready' | 'failed'

export interface ReadingQuizItem {
  id: string
  prompt: string
  options: string[]
  correctOption: number
}

export interface ReadingVocabularyItem {
  term: string
  studentFriendlyMeaning: string
  contextClue: string
}

export interface GeneratedReadingStory {
  title: string
  pages: string[]
  summaryPrompt: string
  summaryGuidance: string
  keywordGroups: string[][]
  quizItems: ReadingQuizItem[]
  vocabularyFocus: ReadingVocabularyItem[]
}

export interface Question {
  id: string
  prompt: string
  type: QuestionType
  kind?: QuestionKind
  templateId?: string
  title?: string
  content?: string
  wordCount?: number
  quizItems?: ReadingQuizItem[]
  readingKeywordGroups?: string[][]
  vocabularyFocus?: ReadingVocabularyItem[]
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
  usedHelp: boolean
  usedReveal: boolean
  elapsedMs: number
  startedAt?: number
  attemptCount?: number
  firstAttemptCorrect?: boolean
  misconceptionTag?: string
  selectedOptions?: number[]
  readingScore?: number
  comprehensionScore?: number
  speedScore?: number
  readingWpm?: number
  vocabularyScore?: number
  vocabularyTermsUsed?: number
  vocabularyTermsExplained?: number
}

export interface SessionRecord {
  id: string
  userId: string
  subject: Subject
  sessionMode?: SessionMode
  status: 'active' | 'completed'
  startedAt: string
  lastActivityAt?: string
  completedAt?: string
  currentIndex: number
  questions: Question[]
  answers: QuestionState[]
  totalTokensUsed: number
  adaptiveDifficultyLevel?: number
  adaptiveMomentum?: number
  adaptiveQuestionsSinceChange?: number
  recentTemplateIds?: string[]
  readingChallengeTier?: 'core' | 'stretch' | 'advanced'
  readingPerformanceSummary?: string
  readingPriorTitles?: string[]
  readingStorySource?: ReadingStorySource
  readingStoryFallbackReason?: string
  readingGenerationStatus?: ReadingGenerationStatus
  readingGenerationErrorCode?: string
  readingGenerationErrorMessage?: string
  readingGenerationRequestId?: string
  readingGenerationStartedAt?: string
  readingGenerationCompletedAt?: string
  readingGenerationChunkCount?: number
  readingGenerationChunksCompleted?: number
}

export interface UserProfile {
  id: string
  name: string
  learningFocus: string | string[]
  timezone: string
  notes: string
  grade?: string
  curriculum?: string
  preferredSessionLengthMinutes?: number
  dailyHabitTargetMinutes?: number
  readingTargetWpm?: number
  strengths?: string[]
  watchouts?: string[]
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
