import { generateReadingStoryAI, isOpenAIConfigured } from './openai'
import type { GeneratedReadingStory, Question, QuestionState, ReadingQuizItem, ReadingStorySource, ReadingVocabularyItem, SessionRecord } from './types'

const READING_TARGET_MIN_WPM = 120
const READING_TARGET_MAX_WPM = 140
const READING_TARGET_WPM = 130
const READING_QUIZ_THRESHOLD_WPM = 150
const READING_WARNING_THRESHOLD_WPM = 180
const READING_PAGE_COUNT = 6
const READING_PAGE_WORD_MIN = 200
const READING_PAGE_WORD_MAX = 250
const READING_AI_TIMEOUT_MS = Math.max(1000, Number(process.env.READING_AI_TIMEOUT_MS || 25000))

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
  vocabularyFocus: ReadingVocabularyItem[]
}

export type ReadingQuestionSetResult = {
  questions: Question[]
  storySource: ReadingStorySource
  fallbackReason?: string
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

function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const matches = trimmed.match(/[^.!?]+(?:[.!?]+["')\]]*)|[^.!?]+$/g)
  return (matches ?? [trimmed]).map((sentence) => sentence.trim()).filter(Boolean)
}

function formatReadingPageContent(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''

  const sentences = splitIntoSentences(trimmed)
  if (sentences.length < 3) {
    return trimmed
  }

  const totalWords = countWords(trimmed)
  const paragraphCount = sentences.length >= 9 || totalWords >= 230 ? 3 : 2
  const targetWordsPerParagraph = Math.max(1, Math.round(totalWords / paragraphCount))
  const paragraphs: string[] = []
  let currentParagraph: string[] = []
  let currentWords = 0

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index] ?? ''
    const sentenceWords = countWords(sentence)
    const remainingSentences = sentences.length - index - 1
    const remainingParagraphs = paragraphCount - paragraphs.length - 1
    const enoughSentencesLeft = remainingSentences >= remainingParagraphs

    currentParagraph.push(sentence)
    currentWords += sentenceWords

    const shouldBreak = paragraphs.length < paragraphCount - 1
      && currentParagraph.length >= 2
      && currentWords >= targetWordsPerParagraph
      && enoughSentencesLeft

    if (shouldBreak) {
      paragraphs.push(currentParagraph.join(' ').trim())
      currentParagraph = []
      currentWords = 0
    }
  }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(' ').trim())
  }

  return paragraphs.join('\n\n')
}

function rebalanceStoryPages(rawPages: string[], targetPageCount = READING_PAGE_COUNT): string[] {
  const sourceText = rawPages.map((page) => page.trim()).filter(Boolean).join('\n\n')
  if (!sourceText) return []

  const paragraphs = sourceText.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
  const units = paragraphs.flatMap((paragraph) => {
    const sentences = splitIntoSentences(paragraph)
    return sentences.length > 0 ? sentences : [paragraph]
  })

  if (units.length === 0) return []

  const unitWordCounts = units.map((unit) => countWords(unit))
  const suffixWordTotals = new Array<number>(units.length + 1).fill(0)
  for (let index = units.length - 1; index >= 0; index -= 1) {
    suffixWordTotals[index] = (suffixWordTotals[index + 1] ?? 0) + (unitWordCounts[index] ?? 0)
  }

  const pages: string[] = []
  let cursor = 0

  for (let pageIndex = 0; pageIndex < targetPageCount && cursor < units.length; pageIndex += 1) {
    const remainingPages = targetPageCount - pageIndex

    if (remainingPages === 1) {
      pages.push(units.slice(cursor).join(' ').trim())
      cursor = units.length
      break
    }

    const pageUnits: string[] = []
    let pageWords = 0

    while (cursor < units.length) {
      const unit = units[cursor] ?? ''
      const unitWords = unitWordCounts[cursor] ?? 0
      const remainingWords = suffixWordTotals[cursor] ?? unitWords
      const wordsAfterTaking = remainingWords - unitWords
      const minWordsForRest = READING_PAGE_WORD_MIN * (remainingPages - 1)
      const targetWordsForCurrent = Math.min(
        READING_PAGE_WORD_MAX,
        Math.max(READING_PAGE_WORD_MIN, Math.round(remainingWords / remainingPages)),
      )
      const projectedWords = pageWords + unitWords
      const mustTake = pageUnits.length === 0 || pageWords < READING_PAGE_WORD_MIN
      const keepsEnoughForRest = wordsAfterTaking >= minWordsForRest
      const helpsTarget = Math.abs(projectedWords - targetWordsForCurrent) <= Math.abs(pageWords - targetWordsForCurrent)
      const withinMax = projectedWords <= READING_PAGE_WORD_MAX

      if (!mustTake && (!keepsEnoughForRest || !withinMax || !helpsTarget)) {
        break
      }

      pageUnits.push(unit)
      pageWords = projectedWords
      cursor += 1

      if (pageWords >= targetWordsForCurrent && (suffixWordTotals[cursor] ?? 0) >= minWordsForRest) {
        break
      }
    }

    while (cursor < units.length && pageWords < READING_PAGE_WORD_MIN) {
      const unit = units[cursor] ?? ''
      const unitWords = unitWordCounts[cursor] ?? 0
      const minWordsForRest = READING_PAGE_WORD_MIN * (remainingPages - 1)
      if ((suffixWordTotals[cursor + 1] ?? 0) < minWordsForRest || pageWords + unitWords > READING_PAGE_WORD_MAX) {
        break
      }
      pageUnits.push(unit)
      pageWords += unitWords
      cursor += 1
    }

    if (pageUnits.length > 0) {
      pages.push(pageUnits.join(' ').trim())
    }
  }

  if (cursor < units.length) {
    const overflow = units.slice(cursor).join(' ').trim()
    if (pages.length === 0) {
      pages.push(overflow)
    } else {
      pages[pages.length - 1] = `${pages[pages.length - 1]} ${overflow}`.trim()
    }
  }

  while (pages.length > targetPageCount) {
    const overflow = pages.pop()
    if (!overflow) break
    pages[pages.length - 1] = `${pages[pages.length - 1]} ${overflow}`.trim()
  }

  while (pages.length < targetPageCount) {
    let splitIndex = -1
    let largestSentenceCount = 0

    for (let index = 0; index < pages.length; index += 1) {
      const sentences = splitIntoSentences(pages[index] ?? '')
      if (sentences.length > largestSentenceCount) {
        largestSentenceCount = sentences.length
        splitIndex = index
      }
    }

    if (splitIndex < 0 || largestSentenceCount < 2) {
      break
    }

    const sentences = splitIntoSentences(pages[splitIndex] ?? '')
    const midpoint = Math.ceil(sentences.length / 2)
    const firstHalf = sentences.slice(0, midpoint).join(' ').trim()
    const secondHalf = sentences.slice(midpoint).join(' ').trim()
    pages.splice(splitIndex, 1, firstHalf, secondHalf)
  }

  return pages.map((page) => formatReadingPageContent(page)).filter(Boolean)
}

function distributeVocabularyAcrossPages(vocabularyFocus: ReadingVocabularyItem[], pageCount: number): ReadingVocabularyItem[][] {
  const distributed = Array.from({ length: pageCount }, () => [] as ReadingVocabularyItem[])
  if (vocabularyFocus.length === 0 || pageCount <= 0) return distributed

  vocabularyFocus.forEach((item, index) => {
    const targetIndex = Math.min(pageCount - 1, Math.floor(((index + 1) * pageCount) / (vocabularyFocus.length + 1)))
    distributed[targetIndex]?.push(item)
  })

  return distributed
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
    `${blueprint.mainName} spent many afternoons in ${blueprint.elderName}'s workshop in ${blueprint.place}, where broken instruments, bent brass hands, and careful notebooks filled every shelf from floor to ceiling. On most days the room smelled like oil, dust, and rain-soaked rope drifting in from the harbor, and ${blueprint.mainName} liked the feeling that every object had once mattered to someone. One evening, while searching a high cabinet for a missing screwdriver, ${blueprint.mainName} discovered an old ${blueprint.fixObject} called the ${title}. Its frame was scratched, its glass had clouded with age, and one side panel hung open as if someone had walked away in the middle of a repair. ${blueprint.elderName}, the town's ${blueprint.elderRole}, explained that people once used it to respond to ${blueprint.problem}. The device never predicted weather by magic. It helped the town notice patterns through ${blueprint.dataTool}. As ${blueprint.elderName} spoke, ${blueprint.mainName} imagined earlier families looking up at the signal and changing plans before trouble arrived. That idea stayed firmly in mind: a good warning system worked only if people learned how to read it together and trusted one another enough to act in time. Before leaving that evening, ${blueprint.mainName} copied the faded labels from the instrument into a notebook, convinced that even tiny clues might matter later.`,
    `The next day ${blueprint.mainName} showed the discovery to ${blueprint.friendName}, who loved diagrams, coded notes, and mechanical puzzles with hidden logic. Together they carried the instrument to a quiet table and studied ${noteObject} describing how the ${title} combined weather clues into one signal the whole town could understand. The notes said the tool had once helped protect the ${blueprint.riskArea} when storms arrived quickly, especially on days when the sky looked harmless until the last minute. Inside a neglected tower room, the friends found missing instructions about the parts that had to work together and the exact moment the town should ${blueprint.warningAction}. Some pages were smeared, some measurements were half erased, and one folded sketch had been tucked inside a loose wall panel as if someone meant to return for it later. That discovery made the mystery feel urgent instead of merely interesting. By the time the sun dropped behind the rooftops, the project no longer seemed like a curiosity from the past. It felt like a responsibility waiting for someone patient enough to finish it. They left carrying copies of the clearest notes and a short list of missing parts to search for in the workshop bins.`,
    `For the next week, ${blueprint.mainName} and ${blueprint.friendName} built a routine of testing small parts, recording daily changes, and comparing fresh observations against the town's older notes. They climbed the tower at dawn, checked shadows and wind direction before school, and returned in the late afternoon to compare what they had seen with measurements from earlier seasons. ${blueprint.elderName} quietly guided them without taking over, asking questions instead of handing them answers, and the two students slowly understood how the instrument translated scattered details into one clear warning. They learned that one dial mattered only when read beside another, that a single clue could mislead, and that the old builders had designed the whole system to force careful thinking. They also realized the real challenge was bigger than repairing metal. If the town did not trust shared evidence, the restored ${title} would fail even if every gear moved perfectly. The friends began practicing how they would explain the system to adults who wanted quick certainty instead of patient proof, because restoring the machine and restoring confidence were becoming the same problem. Some evenings they rehearsed their explanation aloud, stopping each time a sentence sounded impressive but not clear enough to earn trust.`,
    `Not every trial went well. One afternoon, the restored dial pointed toward a warning when the sky cleared instead of darkening, and a few adults laughed at the whole effort as they crossed the square below. ${blueprint.mainName} felt the embarrassment burn all the way into the evening, especially after hearing one shopkeeper mutter that children liked complicated stories more than careful work. But ${blueprint.friendName} insisted they review every note before giving up. Together they spread their papers across the workshop floor and retraced each assumption, each copied number, and each change they had made to the frame. At last they discovered that one older chart had been copied during a season when the canal walls were under repair, which changed how the wind and water affected the signal. Correcting that mistake taught them something more important than pride: evidence had to be checked carefully, especially when a wrong conclusion could make people stop listening. Instead of quitting, the friends wrote a clearer set of comparison notes for themselves, marking which observations were dependable and which had to be tested again before they could be shared with anyone else. That new chart, written in their own words and arranged line by line, became the first version of the guide they truly trusted.`,
    `As storm season approached, the air shifted with ${weatherCue}, and local crews began noticing unusual changes that matched the pattern the friends had been tracing for days. ${blueprint.mainName} and ${blueprint.friendName} presented their findings to ${blueprint.helperName}, the ${blueprint.helperRole}, and to several adults who had first doubted the project. This time they did not rush. They laid out the records in order, showed where old notes and new measurements agreed, and demonstrated how the instrument worked when the clues were read together instead of one at a time. Instead of asking for blind trust, they invited questions and answered them with evidence. When conditions finally matched the warning signs, ${blueprint.helperName} agreed that the town should ${blueprint.warningAction}. Workers spread the message block by block, families repeated the signal to neighbors, and people who had doubted the students earlier found themselves following the plan the pair had explained. Because the town had seen the records and understood the reason for the warning, people acted faster and prepared the ${blueprint.riskArea} before the weather turned dangerous. Even those who still felt uncertain could repeat the pattern back to someone else, which showed that the explanation was working.`,
    `The storm still arrived with force, but the town was ready long before the first hard rain struck the roofs. People ${prepAction}, routes were cleared, and the most vulnerable area stayed far safer than usual because the warning had come early enough to matter. Through the night, ${blueprint.mainName} listened to the weather thud against shutters and wondered how differently the evening might have gone if the signal had remained forgotten in dust. The next morning, adults returned to the tower to understand the restored ${title} more carefully, not as a relic but as a tool that had become trustworthy again through disciplined observation. What mattered most was not the old device alone, but the habit it rebuilt. ${blueprint.lesson.charAt(0).toUpperCase()}${blueprint.lesson.slice(1)}. ${blueprint.mainName} realized that the project had not only repaired a forgotten tool. It had taught the town how to notice, think, explain, and respond as one community again. Even after the streets dried, people kept copies of the new notes, and the students' work became part of how ${blueprint.place} prepared for the seasons ahead instead of something impressive that would be admired and then forgotten. Weeks later, the new guide the friends had written was placed beside the original notebooks so future readers could see how the town had learned to trust the signal again.`,
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

  const vocabularyFocus: ReadingVocabularyItem[] = [
    {
      term: 'translated',
      studentFriendlyMeaning: 'turned many clues into one clear message people could understand',
      contextClue: `In the story, the instrument translated scattered details into one warning signal for ${blueprint.place}.`,
    },
    {
      term: 'neglected',
      studentFriendlyMeaning: 'left uncared for or not given enough attention',
      contextClue: `The tower room was neglected, which is why the instructions and equipment had been left in poor condition.`,
    },
    {
      term: 'vulnerable',
      studentFriendlyMeaning: 'more likely to be hurt or damaged',
      contextClue: `The ${blueprint.riskArea} was vulnerable because storms could damage it faster than safer parts of town.`,
    },
    {
      term: 'evidence',
      studentFriendlyMeaning: 'facts or details that help prove something is true',
      contextClue: `The adults changed their minds after seeing the records and evidence behind the warning system.`,
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
    vocabularyFocus,
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
    vocabularyFocus: story.vocabularyFocus,
    answer: 0,
    tolerance: 0,
    helpSteps: [],
    explanation: '',
    generated: true,
  }
}

function getStoryMetadata(questions: Question[]): { title: string; quizItems: ReadingQuizItem[]; keywordGroups: string[][]; guidance: string; vocabularyFocus: ReadingVocabularyItem[] } {
  const baseQuestion = questions.find((question) => question.kind === 'reading-summary' || question.kind === 'reading-quiz')
  return {
    title: baseQuestion?.title?.split(' · ')[0] ?? 'Reading Story',
    quizItems: baseQuestion?.quizItems ?? [],
    keywordGroups: baseQuestion?.readingKeywordGroups ?? [],
    guidance: baseQuestion?.content ?? 'Focus on the main character, the problem, how it was solved, and what changed because of it.',
    vocabularyFocus: baseQuestion?.vocabularyFocus ?? [],
  }
}

export function createReadingQuestionSet(sessionId: string): Question[] {
  const story = buildFallbackStory(sessionId)
  const rebalancedPages = rebalanceStoryPages(story.pages)
  const vocabularyByPage = distributeVocabularyAcrossPages(story.vocabularyFocus, rebalancedPages.length)
  const pages = rebalancedPages.map((content, index) => ({
    id: `q-${index + 1}`,
    prompt: `Read page ${index + 1} of ${rebalancedPages.length}`,
    type: 'reading_page' as const,
    kind: 'reading-page' as const,
    title: story.title,
    content,
    wordCount: countWords(content),
    ...(vocabularyByPage[index] && vocabularyByPage[index]!.length > 0 ? { vocabularyFocus: vocabularyByPage[index] } : {}),
    answer: 0,
    tolerance: 0,
    helpSteps: [],
    explanation: 'Page completed.',
    generated: true,
  }))
  return [...pages, createSummaryQuestion(`q-${story.pages.length + 1}`, story)]
}

function createFallbackReadingQuestionSet(sessionId: string, fallbackReason?: string): ReadingQuestionSetResult {
  return {
    questions: createReadingQuestionSet(sessionId),
    storySource: 'fallback',
    ...(fallbackReason ? { fallbackReason } : {}),
  }
}

export function readingPageWordTargets() {
  return {
    min: READING_PAGE_WORD_MIN,
    max: READING_PAGE_WORD_MAX,
    pageCount: READING_PAGE_COUNT,
  }
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
  const rebalancedPages = rebalanceStoryPages(story.pages)
  const vocabularyByPage = distributeVocabularyAcrossPages(story.vocabularyFocus, rebalancedPages.length)
  const pages = rebalancedPages.map((content, index) => ({
    id: `q-${index + 1}`,
    prompt: `Read page ${index + 1} of ${rebalancedPages.length}`,
    type: 'reading_page' as const,
    kind: 'reading-page' as const,
    title: story.title,
    content,
    wordCount: countWords(content),
    ...(vocabularyByPage[index] && vocabularyByPage[index]!.length > 0 ? { vocabularyFocus: vocabularyByPage[index] } : {}),
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
): Promise<ReadingQuestionSetResult> {
  if (isOpenAIConfigured()) {
    try {
      const story = await generateReadingStoryAI({
        sessionId,
        challengeTier: options?.challengeTier ?? 'core',
        performanceSummary: options?.performanceSummary ?? 'Write an engaging original middle-grade story with strong clarity and emotional depth.',
        priorTitles: options?.priorTitles ?? [],
        timeoutMs: READING_AI_TIMEOUT_MS,
      })
      return {
        questions: toQuestionSet(story),
        storySource: 'ai',
      }
    } catch (error) {
      console.warn('OpenAI reading story generation failed, using fallback generator:', error)
      return createFallbackReadingQuestionSet(
        sessionId,
        error instanceof Error ? error.message : 'AI story generation failed.',
      )
    }
  }

  return createFallbackReadingQuestionSet(sessionId, 'AI story generation is not configured for this environment.')
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
      vocabularyFocus: metadata.vocabularyFocus,
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
  return READING_PAGE_COUNT + 1
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

const VOCAB_STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'almost', 'along', 'also', 'although', 'always', 'among', 'around', 'because',
  'before', 'being', 'between', 'could', 'every', 'first', 'found', 'from', 'into', 'just', 'might', 'other', 'people',
  'really', 'should', 'since', 'still', 'their', 'there', 'these', 'thing', 'those', 'through', 'under', 'using', 'very',
  'where', 'which', 'while', 'would',
])

function tokenizeNormalized(value: string): string[] {
  return normalizeText(value).split(/\s+/).filter(Boolean)
}

function extractMeaningTokens(value: string): string[] {
  return Array.from(new Set(tokenizeNormalized(value).filter((token) => token.length >= 4 && !VOCAB_STOPWORDS.has(token))))
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

function computeVocabularyRubric(summaryText: string, vocabularyFocus: ReadingVocabularyItem[]): {
  score: number
  termsUsed: number
  termsExplained: number
} {
  if (vocabularyFocus.length === 0) {
    return {
      score: 0,
      termsUsed: 0,
      termsExplained: 0,
    }
  }

  const summaryTokens = new Set(tokenizeNormalized(summaryText))
  let termsUsed = 0
  let termsExplained = 0

  vocabularyFocus.forEach((item) => {
    const termTokens = tokenizeNormalized(item.term)
    const termUsed = termTokens.length > 0 && termTokens.every((token) => summaryTokens.has(token))
    if (termUsed) {
      termsUsed += 1
    }

    const meaningTokens = Array.from(new Set([
      ...extractMeaningTokens(item.studentFriendlyMeaning),
      ...extractMeaningTokens(item.contextClue),
    ].filter((token) => !termTokens.includes(token))))
    const explanationHits = meaningTokens.filter((token) => summaryTokens.has(token)).length
    if (explanationHits >= 2 || (termUsed && explanationHits >= 1)) {
      termsExplained += 1
    }
  })

  let usageScore = 0
  if (termsUsed >= 3) usageScore = 10
  else if (termsUsed === 2) usageScore = 8
  else if (termsUsed === 1) usageScore = 5

  let explanationScore = 0
  if (termsExplained >= 3) explanationScore = 10
  else if (termsExplained === 2) explanationScore = 8
  else if (termsExplained === 1) explanationScore = 6

  return {
    score: Math.max(0, Math.min(10, Math.round((usageScore * 0.4) + (explanationScore * 0.6)))),
    termsUsed,
    termsExplained,
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
  vocabularyScore: number
  vocabularyTermsUsed: number
  vocabularyTermsExplained: number
  overallScore: number
  averageWpm: number
  explanation: string
  warning: string | null
} {
  const averageWpm = computeReadingWpm(questions, answers)
  const metadata = getStoryMetadata(questions)
  const rubric = computeSummaryRubric(summaryText, metadata.keywordGroups)
  const vocabularyRubric = computeVocabularyRubric(summaryText, metadata.vocabularyFocus)
  const comprehensionScore = rubric.score
  const speedScore = computeSpeedScore(averageWpm)
  const overallScore = Math.max(0, Math.min(10, Math.round((comprehensionScore * 0.55) + (speedScore * 0.25) + (vocabularyRubric.score * 0.2))))
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

  const vocabularyMessage =
    vocabularyRubric.score >= 8
      ? `Vocabulary use was ${vocabularyRubric.score}/10 because you used or explained ${vocabularyRubric.termsExplained} target word${vocabularyRubric.termsExplained === 1 ? '' : 's'} accurately.`
      : vocabularyRubric.score >= 5
        ? `Vocabulary use was ${vocabularyRubric.score}/10 because you used ${vocabularyRubric.termsUsed} target word${vocabularyRubric.termsUsed === 1 ? '' : 's'} and explained ${vocabularyRubric.termsExplained}. Next time, work one story word into your summary and show its meaning through the sentence.`
        : `Vocabulary use was ${vocabularyRubric.score}/10 because the summary did not yet clearly use or explain the target story words. Next time, choose one vocabulary word from the story and explain it in your own sentence.`

  return {
    mode: 'summary',
    comprehensionScore,
    speedScore,
    vocabularyScore: vocabularyRubric.score,
    vocabularyTermsUsed: vocabularyRubric.termsUsed,
    vocabularyTermsExplained: vocabularyRubric.termsExplained,
    overallScore,
    averageWpm,
    warning,
    explanation: `${comprehensionMessage} ${vocabularyMessage} ${speedMessage} Overall reading score: ${overallScore}/10.`,
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
