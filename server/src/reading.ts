import { generateReadingStoryAI, isOpenAIConfigured } from './openai'
import type { GeneratedReadingStory, Question, QuestionState, ReadingQuizItem, SessionRecord } from './types'

const READING_TARGET_MIN_WPM = 120
const READING_TARGET_MAX_WPM = 140
const READING_TARGET_WPM = 130
const READING_QUIZ_THRESHOLD_WPM = 150
const READING_WARNING_THRESHOLD_WPM = 180

type StoryBlueprint = {
  place: string
  titleObject: string
  mainName: string
  friendName: string
  elderName: string
  elderRole: string
  helperName: string
  helperRole: string
  problem: string
  dataTool: string
  fixObject: string
  warningAction: string
  lesson: string
  riskArea: string
}

type ReadingStory = {
  title: string
  pages: string[]
  summaryPrompt: string
  summaryGuidance: string
  keywordGroups: string[][]
  quizItems: ReadingQuizItem[]
}

export type ReadingGenerationProfile = {
  challengeTier: 'core' | 'stretch' | 'advanced'
  performanceSummary: string
}

const STORY_BLUEPRINTS: StoryBlueprint[] = [
  {
    place: 'Harbor Lane',
    titleObject: 'Monsoon Clock',
    mainName: 'Mira',
    friendName: 'Dev',
    elderName: 'Suresh',
    elderRole: 'repairer',
    helperName: 'Anika',
    helperRole: 'canal manager',
    problem: 'late storm warnings',
    dataTool: 'tide notes and rain marks',
    fixObject: 'signal clock',
    warningAction: 'ring the warning bell',
    lesson: 'people must observe patterns together and act early',
    riskArea: 'lower market',
  },
  {
    place: 'Riverstone Crossing',
    titleObject: 'Flood Beacon',
    mainName: 'Leela',
    friendName: 'Kabir',
    elderName: 'Naren',
    elderRole: 'workshop keeper',
    helperName: 'Priya',
    helperRole: 'bridge supervisor',
    problem: 'rising river surprises',
    dataTool: 'water logs and wind flags',
    fixObject: 'beacon dial',
    warningAction: 'raise the signal flag',
    lesson: 'careful records become useful only when a community trusts them',
    riskArea: 'riverside stalls',
  },
  {
    place: 'Cedar Wharf',
    titleObject: 'Harbor Gauge',
    mainName: 'Tara',
    friendName: 'Ishan',
    elderName: 'Balan',
    elderRole: 'instrument maker',
    helperName: 'Meera',
    helperRole: 'dock captain',
    problem: 'unsafe harbor preparation',
    dataTool: 'pressure sketches and tide boards',
    fixObject: 'gauge wheel',
    warningAction: 'sound the brass chime',
    lesson: 'good tools help only when people combine evidence with teamwork',
    riskArea: 'dock warehouses',
  },
  {
    place: 'Lotus Bay',
    titleObject: 'Rain Compass',
    mainName: 'Asha',
    friendName: 'Rohan',
    elderName: 'Farid',
    elderRole: 'clock restorer',
    helperName: 'Lina',
    helperRole: 'harbor planner',
    problem: 'flooded walkways during storms',
    dataTool: 'rain jar records and canal charts',
    fixObject: 'compass mechanism',
    warningAction: 'tap the tower gong',
    lesson: 'understanding grows when observations are shared clearly',
    riskArea: 'harbor walkway',
  },
]

const TITLE_PREFIXES = ['Hidden', 'Restored', 'Old', 'Forgotten', 'Watchful']
const WEATHER_CUES = ['thick inland wind', 'restless sea air', 'early tide surge', 'sharp pressure drop', 'heavy afternoon humidity']
const NOTE_OBJECTS = ['field journals', 'weather cards', 'observation charts', 'handwritten survey pages', 'signal notebooks']
const PREP_ACTIONS = ['lifted supplies', 'secured boats', 'closed gates early', 'cleared walkways', 'moved market crates']
const TITLE_PATTERNS = [
  'When {place} Learned to Read the Sky',
  'The Day {place} Trusted the {object}',
  'The Warning Above {place}',
  '{main} and the {prefix} {object}',
  'The Signal That Saved {place}',
  '{place} and the Storm Bell',
  'How {main} Reawakened the {object}',
  'Before the Water Reached {riskArea}',
]

function hashSeed(value: string): number {
  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function buildStoryTitle(blueprint: StoryBlueprint, prefix: string, seed: number): string {
  const pattern = TITLE_PATTERNS[(seed >> 10) % TITLE_PATTERNS.length] ?? TITLE_PATTERNS[0]!
  return pattern
    .replace('{place}', blueprint.place)
    .replace('{object}', blueprint.titleObject)
    .replace('{main}', blueprint.mainName)
    .replace('{prefix}', prefix)
    .replace('{riskArea}', blueprint.riskArea)
}

function buildFallbackStory(sessionId: string): ReadingStory {
  const seed = hashSeed(sessionId)
  const blueprint = STORY_BLUEPRINTS[seed % STORY_BLUEPRINTS.length] ?? STORY_BLUEPRINTS[0]!
  const titlePrefix = TITLE_PREFIXES[(seed >> 2) % TITLE_PREFIXES.length] ?? TITLE_PREFIXES[0]!
  const weatherCue = WEATHER_CUES[(seed >> 4) % WEATHER_CUES.length] ?? WEATHER_CUES[0]!
  const noteObject = NOTE_OBJECTS[(seed >> 6) % NOTE_OBJECTS.length] ?? NOTE_OBJECTS[0]!
  const prepAction = PREP_ACTIONS[(seed >> 8) % PREP_ACTIONS.length] ?? PREP_ACTIONS[0]!
  const title = buildStoryTitle(blueprint, titlePrefix, seed)
  const pages = [
    `${blueprint.mainName} spent many afternoons in ${blueprint.elderName}'s workshop in ${blueprint.place}, where broken instruments and careful notebooks filled every shelf. One evening, ${blueprint.mainName} discovered an old ${blueprint.fixObject} called the ${title}. ${blueprint.elderName}, the town's ${blueprint.elderRole}, explained that people once used it to respond to ${blueprint.problem}. The device never predicted weather by magic. It helped the town notice patterns through ${blueprint.dataTool}. That idea stayed with ${blueprint.mainName}: a good warning system worked only if people learned how to read it together.`,
    `The next day ${blueprint.mainName} showed the discovery to ${blueprint.friendName}, who loved diagrams and mechanical puzzles. Together they studied ${noteObject} describing how the ${title} combined weather clues into one signal the whole town could understand. The notes said the tool had once helped protect the ${blueprint.riskArea} when storms arrived quickly. Inside a neglected tower room, the friends found missing instructions about the parts that had to work together and the exact moment the town should ${blueprint.warningAction}. Suddenly the mystery became a practical project.`,
    `For the next week, ${blueprint.mainName} and ${blueprint.friendName} built a routine of testing small parts, recording daily changes, and comparing fresh observations against the town's older notes. ${blueprint.elderName} quietly guided them without taking over, and the two students slowly understood how the instrument translated scattered details into one clear warning. They realized the real challenge was bigger than repairing metal. If the town did not trust shared evidence, the restored ${title} would fail even if every gear moved perfectly.`,
    `As storm season approached, the air shifted with ${weatherCue}, and local crews noticed unusual changes. ${blueprint.mainName} and ${blueprint.friendName} presented their findings to ${blueprint.helperName}, the ${blueprint.helperRole}, and to several adults who first doubted the project. Instead of asking for blind trust, they showed records, explained patterns, and demonstrated how the tool worked. When conditions finally matched the warning signs, ${blueprint.helperName} agreed that the town should ${blueprint.warningAction}. Because people had seen the evidence, they acted faster and prepared the ${blueprint.riskArea} before the weather turned dangerous.`,
    `The storm still arrived with force, but the town was ready. People ${prepAction}, routes were cleared, and the most vulnerable area stayed far safer than usual. The next morning, adults returned to the tower to understand the restored ${title} more carefully. What mattered most was not the old device alone, but the habit it rebuilt. ${blueprint.lesson.charAt(0).toUpperCase()}${blueprint.lesson.slice(1)}. ${blueprint.mainName} realized that the project had not only repaired a forgotten tool. It had taught the town how to notice, think, and respond as one community again.`,
  ]

  const quizItems: ReadingQuizItem[] = [
    {
      id: 'reading-quiz-1',
      prompt: `Why did people in ${blueprint.place} once rely on the ${title}?`,
      options: [
        'It magically controlled the storm clouds above the town',
        `It helped combine clues from ${blueprint.dataTool} into one shared warning`,
        'It announced when the market should open each morning',
        `It measured how many repairs ${blueprint.elderName} could finish in a day`,
      ],
      correctOption: 1,
    },
    {
      id: 'reading-quiz-2',
      prompt: `What did ${blueprint.mainName} and ${blueprint.friendName} learn while restoring the ${title}?`,
      options: [
        'That one person can solve emergencies faster without evidence',
        'That the town should ignore older notebooks and rely only on guessing',
        'That fixing the device mattered, but trust and shared observation mattered too',
        `That the ${blueprint.riskArea} never actually had any flood risk`,
      ],
      correctOption: 2,
    },
    {
      id: 'reading-quiz-3',
      prompt: `What changed the adults' minds before the storm?`,
      options: [
        `${blueprint.mainName} demanded that everyone obey immediately`,
        `${blueprint.mainName} and ${blueprint.friendName} showed records, patterns, and a clear explanation`,
        `${blueprint.helperName} hid the storm forecast until the last minute`,
        `The ${title} suddenly fixed itself without anyone's help`,
      ],
      correctOption: 1,
    },
    {
      id: 'reading-quiz-4',
      prompt: 'What is the strongest lesson of the story?',
      options: [
        'Tools matter most when people use them to compete with one another',
        'Storm preparation works best when it starts after the danger arrives',
        blueprint.lesson.charAt(0).toUpperCase() + blueprint.lesson.slice(1),
        'Old instruments should be displayed, not used, once they are repaired',
      ],
      correctOption: 2,
    },
  ]

  return {
    title,
    pages,
    summaryPrompt: 'In about 100 words, explain the core summary of the story you just read.',
    summaryGuidance: `Focus on ${blueprint.mainName}, the problem with ${blueprint.problem}, how the ${blueprint.titleObject} was restored, and what the town learned from it.`,
    keywordGroups: [
      [blueprint.mainName.toLowerCase()],
      [blueprint.friendName.toLowerCase()],
      [blueprint.titleObject.toLowerCase(), title.toLowerCase()],
      [blueprint.place.toLowerCase()],
      [blueprint.problem.toLowerCase()],
      [blueprint.dataTool.toLowerCase().split(' and ')[0] ?? blueprint.dataTool.toLowerCase(), 'records', 'notes', 'patterns'],
      [blueprint.helperName.toLowerCase(), blueprint.helperRole.toLowerCase()],
      [blueprint.warningAction.toLowerCase(), 'warning', 'signal'],
      [blueprint.riskArea.toLowerCase(), 'storm', 'flood', 'danger'],
      ['together', 'community', 'trust', 'shared', 'teamwork'],
    ],
    quizItems,
  }
}

function createSummaryQuestion(id: string, story: ReadingStory): Question {
  return {
    id,
    prompt: story.summaryPrompt,
    type: 'reading_summary',
    kind: 'reading-summary',
    title: `${story.title} · Final Reflection`,
    content: story.summaryGuidance,
    wordCount: 100,
    quizItems: story.quizItems,
    readingKeywordGroups: story.keywordGroups,
    answer: 0,
    tolerance: 0,
    helpSteps: [],
    explanation: '',
    generated: true,
  }
}

function getStoryMetadata(questions: Question[]): { title: string; quizItems: ReadingQuizItem[]; keywordGroups: string[][]; guidance: string } {
  const baseQuestion = questions.find((question) => question.kind === 'reading-summary' || question.kind === 'reading-quiz')
  return {
    title: baseQuestion?.title?.split(' · ')[0] ?? 'Reading Story',
    quizItems: baseQuestion?.quizItems ?? [],
    keywordGroups: baseQuestion?.readingKeywordGroups ?? [],
    guidance: baseQuestion?.content ?? 'Focus on the main character, the problem, how it was solved, and what changed because of it.',
  }
}

export function createReadingQuestionSet(sessionId: string): Question[] {
  const story = buildFallbackStory(sessionId)
  const pages = story.pages.map((content, index) => ({
    id: `q-${index + 1}`,
    prompt: `Read page ${index + 1} of ${story.pages.length}`,
    type: 'reading_page' as const,
    kind: 'reading-page' as const,
    title: story.title,
    content,
    wordCount: countWords(content),
    answer: 0,
    tolerance: 0,
    helpSteps: [],
    explanation: 'Page completed.',
    generated: true,
  }))
  return [...pages, createSummaryQuestion(`q-${story.pages.length + 1}`, story)]
}

function extractReadingSessionSignal(session: SessionRecord): { readingScore: number; comprehensionScore: number; readingWpm: number } | null {
  const assessedAnswer = session.answers.find((answer) => answer.completed && typeof answer.readingScore === 'number')
  if (!assessedAnswer || typeof assessedAnswer.readingWpm !== 'number') return null
  return {
    readingScore: assessedAnswer.readingScore ?? 0,
    comprehensionScore: assessedAnswer.comprehensionScore ?? 0,
    readingWpm: assessedAnswer.readingWpm,
  }
}

export function buildReadingGenerationProfile(allSessions: SessionRecord[]): ReadingGenerationProfile {
  const recentSignals = allSessions
    .filter((session) => session.subject === 'Reading' && session.status === 'completed')
    .sort((a, b) => new Date(b.completedAt ?? b.startedAt).getTime() - new Date(a.completedAt ?? a.startedAt).getTime())
    .map(extractReadingSessionSignal)
    .filter((signal): signal is { readingScore: number; comprehensionScore: number; readingWpm: number } => signal !== null)
    .slice(0, 4)

  if (recentSignals.length === 0) {
    return {
      challengeTier: 'core',
      performanceSummary: 'Adi is reading at an upper-elementary / early middle-grade level. Keep the story vivid, emotionally clear, and highly engaging, with enough challenge to grow inference and vocabulary without overwhelming him.',
    }
  }

  const avgWpm = recentSignals.reduce((sum, signal) => sum + signal.readingWpm, 0) / recentSignals.length
  const avgReadingScore = recentSignals.reduce((sum, signal) => sum + signal.readingScore, 0) / recentSignals.length
  const avgComprehension = recentSignals.reduce((sum, signal) => sum + signal.comprehensionScore, 0) / recentSignals.length

  if (avgWpm >= 150 && avgReadingScore >= 8.5 && avgComprehension >= 8.5) {
    return {
      challengeTier: 'advanced',
      performanceSummary: `Adi has recently been reading very quickly (${Math.round(avgWpm)} WPM) while still showing strong understanding (${avgComprehension.toFixed(1)}/10 comprehension, ${avgReadingScore.toFixed(1)}/10 overall). Increase the depth, nuance, inference load, and sentence sophistication gradually so the passage still feels rewarding but requires closer reading.`,
    }
  }

  if (avgWpm >= 130 && avgReadingScore >= 7.5 && avgComprehension >= 7.5) {
    return {
      challengeTier: 'stretch',
      performanceSummary: `Adi is handling current reading material confidently (${Math.round(avgWpm)} WPM, ${avgComprehension.toFixed(1)}/10 comprehension). Raise the challenge slightly with richer description, subtler motives, and a bit more inferential thinking, while keeping the story highly readable and engaging.`,
    }
  }

  return {
    challengeTier: 'core',
    performanceSummary: `Adi benefits from strong middle-grade readability with clear emotional stakes and concrete plot movement. Keep the language polished and literary, but make the key events and relationships easy to follow so comprehension stays supported.`,
  }
}

function getPriorReadingTitles(allSessions: SessionRecord[]): string[] {
  return allSessions
    .filter((session) => session.subject === 'Reading')
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .map((session) => session.questions.find((question) => question.kind === 'reading-page')?.title?.trim())
    .filter((title): title is string => Boolean(title))
    .filter((title, index, titles) => titles.indexOf(title) === index)
    .slice(0, 8)
}

function toQuestionSet(story: GeneratedReadingStory): Question[] {
  const pages = story.pages.map((content, index) => ({
    id: `q-${index + 1}`,
    prompt: `Read page ${index + 1} of ${story.pages.length}`,
    type: 'reading_page' as const,
    kind: 'reading-page' as const,
    title: story.title,
    content,
    wordCount: countWords(content),
    answer: 0,
    tolerance: 0,
    helpSteps: [],
    explanation: 'Page completed.',
    generated: true,
  }))

  return [...pages, createSummaryQuestion(`q-${story.pages.length + 1}`, story)]
}

export async function createReadingQuestionSetAsync(
  sessionId: string,
  options?: {
    challengeTier?: 'core' | 'stretch' | 'advanced'
    performanceSummary?: string
    priorTitles?: string[]
  },
): Promise<Question[]> {
  if (isOpenAIConfigured()) {
    try {
      const story = await generateReadingStoryAI({
        sessionId,
        challengeTier: options?.challengeTier ?? 'core',
        performanceSummary: options?.performanceSummary ?? 'Write an engaging original middle-grade story with strong clarity and emotional depth.',
        priorTitles: options?.priorTitles ?? [],
      })
      return toQuestionSet(story)
    } catch (error) {
      console.warn('OpenAI reading story generation failed, using fallback generator:', error)
    }
  }

  return createReadingQuestionSet(sessionId)
}

export function getReadingGenerationInputs(allSessions: SessionRecord[]): ReadingGenerationProfile & { priorTitles: string[] } {
  const profile = buildReadingGenerationProfile(allSessions)
  return {
    ...profile,
    priorTitles: getPriorReadingTitles(allSessions),
  }
}

export function createReadingAssessmentQuestion(id: string, questions: Question[], answers: QuestionState[]): Question {
  const averageWpm = computeReadingWpm(questions, answers)
  const metadata = getStoryMetadata(questions)
  if (averageWpm >= READING_QUIZ_THRESHOLD_WPM) {
    const warning = averageWpm >= READING_WARNING_THRESHOLD_WPM
      ? `You moved through the text at ${averageWpm} WPM, which is very fast for this passage. Let’s slow down and prove the meaning stayed with you.`
      : `You read at ${averageWpm} WPM, so we’ll switch to a quick comprehension quiz instead of a written summary.`
    return {
      id,
      prompt: 'Answer the quick comprehension check from the story you just read.',
      type: 'reading_quiz',
      kind: 'reading-quiz',
      title: `${metadata.title} · Comprehension Check`,
      content: warning,
      quizItems: metadata.quizItems,
      readingKeywordGroups: metadata.keywordGroups,
      answer: 0,
      tolerance: 0,
      helpSteps: [],
      explanation: '',
      generated: true,
    }
  }

  return {
    id,
    prompt: 'In about 100 words, explain the core summary of the story you just read.',
    type: 'reading_summary',
    kind: 'reading-summary',
    title: `${metadata.title} · Final Reflection`,
    content: metadata.guidance,
    wordCount: 100,
    quizItems: metadata.quizItems,
    readingKeywordGroups: metadata.keywordGroups,
    answer: 0,
    tolerance: 0,
    helpSteps: [],
    explanation: '',
    generated: true,
  }
}

export function getReadingQuestionCount(): number {
  return 6
}

export function computeReadingWpm(questions: Question[], answers: QuestionState[]): number {
  const readingPages = questions.filter((question) => question.kind === 'reading-page')
  const totalWords = readingPages.reduce((sum, question) => sum + (question.wordCount ?? 0), 0)
  const totalReadingMs = answers
    .filter((answer, index) => questions[index]?.kind === 'reading-page' && answer.completed)
    .reduce((sum, answer) => sum + answer.elapsedMs, 0)

  if (totalWords === 0 || totalReadingMs <= 0) return 0
  return Math.min(250, Math.round(totalWords / (totalReadingMs / 60000)))
}

function computeSpeedScore(wpm: number): number {
  if (wpm <= 0) return 0
  return Math.max(0, Math.min(10, Math.floor((wpm / READING_TARGET_WPM) * 10)))
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
}

function countSentences(value: string): number {
  return value.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length
}

function computeSummaryRubric(summaryText: string, keywordGroups: string[][]): {
  score: number
  coveredGroups: number
  structureScore: number
  detailScore: number
  explanation: string
} {
  const normalized = summaryText.toLowerCase()
  const wordCount = countWords(summaryText)
  const coveredGroups = keywordGroups.filter((group) =>
    group.some((keyword) => normalized.includes(keyword.toLowerCase())),
  ).length

  const normalizedLoose = normalizeText(summaryText)
  const sentenceCount = countSentences(summaryText)
  const detailAnchors = ['because', 'so', 'but', 'then', 'after', 'before', 'finally', 'when', 'while']
  const detailHits = detailAnchors.filter((token) => normalizedLoose.includes(` ${token} `)).length

  let ideaCoverageScore = 0
  if (coveredGroups >= 8) ideaCoverageScore = 10
  else if (coveredGroups >= 7) ideaCoverageScore = 9
  else if (coveredGroups >= 6) ideaCoverageScore = 8
  else if (coveredGroups >= 5) ideaCoverageScore = 7
  else if (coveredGroups >= 4) ideaCoverageScore = 6
  else if (coveredGroups >= 3) ideaCoverageScore = 4
  else if (coveredGroups >= 2) ideaCoverageScore = 2

  let structureScore = 0
  if (wordCount >= 70 && wordCount <= 130) structureScore += 2
  else if (wordCount >= 50 && wordCount <= 140) structureScore += 1
  if (sentenceCount >= 3) structureScore += 1
  if (sentenceCount >= 4) structureScore += 1

  let detailScore = 0
  if (detailHits >= 2) detailScore += 1
  if (coveredGroups >= 5 && detailHits >= 3) detailScore += 1

  const rawScore = Math.round((ideaCoverageScore * 0.7) + (Math.min(4, structureScore + detailScore) * 0.75))
  const score = Math.max(0, Math.min(10, rawScore))

  const explanation =
    coveredGroups >= 7 && structureScore >= 2
      ? 'The summary captured the main arc and organized the ideas clearly.'
      : coveredGroups >= 5
        ? 'The summary captured part of the story, but it still needs a clearer beginning, problem, and outcome.'
        : 'The summary is too thin to show the full story arc yet.'

  return {
    score,
    coveredGroups,
    structureScore,
    detailScore,
    explanation,
  }
}

function computeQuizComprehensionScore(selectedOptions: number[], quizItems: ReadingQuizItem[]): { score: number; correctCount: number; totalCount: number } {
  const totalCount = quizItems.length
  const correctCount = quizItems.reduce((sum, item, index) =>
    sum + (selectedOptions[index] === item.correctOption ? 1 : 0), 0)
  const scoreScale = [0, 4, 6, 8, 10]
  return {
    score: scoreScale[correctCount] ?? 0,
    correctCount,
    totalCount,
  }
}

function buildSpeedMessage(averageWpm: number): string {
  if (averageWpm >= READING_WARNING_THRESHOLD_WPM) {
    return `Your reading pace was ${averageWpm} WPM. That is very fast for this text, so slow down a little and make sure you are truly absorbing the meaning.`
  }
  if (averageWpm > READING_TARGET_MAX_WPM) {
    return `Your reading pace was ${averageWpm} WPM, which is above the target pace of ${READING_TARGET_WPM} WPM. That gives you a full 10/10 speed score, so the goal is keeping that pace without losing meaning.`
  }
  if (averageWpm >= READING_TARGET_MIN_WPM && averageWpm <= READING_TARGET_MAX_WPM) {
    return `Your reading pace was ${averageWpm} WPM, right around the target pace of ${READING_TARGET_WPM} WPM. Speed is scored as a percentage of that target, so this lands close to a full score.`
  }
  if (averageWpm > 0) {
    return `Your reading pace was ${averageWpm} WPM, below the target pace of ${READING_TARGET_WPM} WPM. Speed is scored by the percentage of target pace, so ${averageWpm} WPM earns ${computeSpeedScore(averageWpm)}/10.`
  }
  return 'We could not calculate a reading speed yet.'
}

export function getReadingAssessmentMode(questions: Question[], answers: QuestionState[]): 'summary' | 'quiz' {
  return computeReadingWpm(questions, answers) >= READING_QUIZ_THRESHOLD_WPM ? 'quiz' : 'summary'
}

export function evaluateReadingSummary(
  questions: Question[],
  answers: QuestionState[],
  summaryText: string,
): {
  mode: 'summary'
  comprehensionScore: number
  speedScore: number
  overallScore: number
  averageWpm: number
  explanation: string
  warning: string | null
} {
  const averageWpm = computeReadingWpm(questions, answers)
  const metadata = getStoryMetadata(questions)
  const rubric = computeSummaryRubric(summaryText, metadata.keywordGroups)
  const comprehensionScore = rubric.score
  const speedScore = computeSpeedScore(averageWpm)
  const overallScore = Math.max(0, Math.min(10, Math.round((comprehensionScore * 0.7) + (speedScore * 0.3))))
  const speedMessage = buildSpeedMessage(averageWpm)
  const warning = averageWpm >= READING_WARNING_THRESHOLD_WPM
    ? 'You are reading extremely quickly. Make sure speed is not replacing careful understanding.'
    : null

  const comprehensionMessage =
    comprehensionScore >= 8
      ? `Comprehension was ${comprehensionScore}/10 because the summary captured the main character, the central problem, and how the story changed by the end. ${rubric.explanation}`
      : comprehensionScore >= 6
        ? `Comprehension was ${comprehensionScore}/10 because the summary caught part of the story, but it missed some important middle details or cause-and-effect links. ${rubric.explanation} Add one or two stronger details from the middle next time.`
        : `Comprehension was ${comprehensionScore}/10 because the summary was too thin to show the full story arc yet. ${rubric.explanation} Next time, name the main character, the main problem, and what changed by the end.`

  return {
    mode: 'summary',
    comprehensionScore,
    speedScore,
    overallScore,
    averageWpm,
    warning,
    explanation: `${comprehensionMessage} ${speedMessage} Overall reading score: ${overallScore}/10.`,
  }
}

export function evaluateReadingQuiz(
  questions: Question[],
  answers: QuestionState[],
  selectedOptions: number[],
): {
  mode: 'quiz'
  comprehensionScore: number
  speedScore: number
  overallScore: number
  averageWpm: number
  explanation: string
  warning: string | null
} {
  const averageWpm = computeReadingWpm(questions, answers)
  const metadata = getStoryMetadata(questions)
  const speedScore = computeSpeedScore(averageWpm)
  const quizResult = computeQuizComprehensionScore(selectedOptions, metadata.quizItems)
  const overallScore = Math.max(0, Math.min(10, Math.round((quizResult.score * 0.75) + (speedScore * 0.25))))
  const speedMessage = buildSpeedMessage(averageWpm)
  const warning = averageWpm >= READING_WARNING_THRESHOLD_WPM
    ? 'You are reading extremely quickly. Make sure you are slowing down enough to understand what the passage is saying.'
    : null

  const comprehensionMessage =
    quizResult.correctCount === quizResult.totalCount
      ? `Comprehension was ${quizResult.score}/10 because you answered every comprehension check correctly, which shows the meaning stayed with you.`
      : quizResult.correctCount >= Math.max(3, quizResult.totalCount - 1)
        ? `Comprehension was ${quizResult.score}/10 because you understood most of the key ideas from the passage, even though a few details slipped.`
        : `Comprehension was ${quizResult.score}/10 because too many key details were missed on the final check. Slower and more careful reading would help the meaning stick.`

  return {
    mode: 'quiz',
    comprehensionScore: quizResult.score,
    speedScore,
    overallScore,
    averageWpm,
    warning,
    explanation: `${comprehensionMessage} ${speedMessage} You got ${quizResult.correctCount}/${quizResult.totalCount} quiz questions correct. Overall reading score: ${overallScore}/10.`,
  }
}

export {
  READING_TARGET_MIN_WPM,
  READING_TARGET_MAX_WPM,
  READING_TARGET_WPM,
  READING_QUIZ_THRESHOLD_WPM,
  READING_WARNING_THRESHOLD_WPM,
}
