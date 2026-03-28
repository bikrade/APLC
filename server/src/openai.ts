import type { GeneratedReadingStory, OpenAICallStat, Question, QuestionType, ReadingQuizItem, ReadingVocabularyItem } from './types'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_AZURE_OPENAI_API_VERSION = '2024-10-21'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 15000))
const READING_RETRY_COUNT = Math.max(0, Number(process.env.READING_AI_RETRY_COUNT || 2))
const READING_RETRY_BASE_DELAY_MS = Math.max(100, Number(process.env.READING_AI_RETRY_BASE_DELAY_MS || 1200))
const READING_RETRY_MAX_DELAY_MS = Math.max(READING_RETRY_BASE_DELAY_MS, Number(process.env.READING_AI_RETRY_MAX_DELAY_MS || 4000))
const READING_REQUEST_MAX_TOKENS = 2600
const READING_REQUEST_TEMPERATURE = 0.8

const callStats: OpenAICallStat[] = []

function isOpenAIMockEnabled(): boolean {
  return process.env.OPENAI_MOCK_RESPONSES === 'true'
}

function hashSeed(value: string): number {
  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash
}

function buildMockReadingStoryContent(sessionId: string): string {
  const places = ['Harbor Reach', 'Copper Bay', 'Mistral Point', 'Moonwater Quay']
  const titles = ['Signal Lantern', 'Storm Ledger', 'Harbor Compass', 'Tide Archive']
  const names = ['Adi', 'Mira', 'Leela', 'Tarin']
  const helpers = ['Jonah', 'Isha', 'Kiran', 'Meera']
  const seed = hashSeed(sessionId)
  const sessionMarker = (seed % 46656).toString(36).toUpperCase().padStart(3, '0')
  const place = places[seed % places.length] ?? places[0]!
  const object = titles[(seed >> 3) % titles.length] ?? titles[0]!
  const main = names[(seed >> 5) % names.length] ?? names[0]!
  const helper = helpers[(seed >> 7) % helpers.length] ?? helpers[0]!
  const title = `${main} and the ${object} of ${place}`

  const pages = Array.from({ length: 4 }, (_, index) => {
    const stage = index + 1
    return [
      `${main} arrived at ${place} just before sunrise and noticed that the old ${object.toLowerCase()} beside the harbor wall had stopped moving again, with route marker ${sessionMarker} scratched into its brass frame.`,
      `The town depended on that device to compare tide marks, rain notes, and wind changes before boats were allowed onto the water, so every missed signal made the morning feel tense.`,
      `${helper} joined ${main} with a notebook full of recent observations, and together they studied the scratched brass ring, the fogged glass cover, and the careful symbols left by earlier watchkeepers.`,
      `On this page of the story, they test one idea, reject a weaker guess, and build a stronger explanation from evidence instead of wishful thinking.`,
      `They compare fresh measurements to older records, notice a pattern that other people ignored, and realize the broken reading is connected to a hidden catch inside the frame rather than to the weather itself.`,
      `Each new clue matters because the harbor stores, the lower walkway, and the fishing crews all need enough warning time to move equipment before the next storm surge reaches the docks.`,
      `${main} writes down the sequence carefully, because remembering the order of events will help explain why the repair works and why the town should trust the signal again.`,
      `By the end of stage ${stage}, the problem is clearer, the risk feels more immediate, and the evidence is strong enough that a careful reader can trace exactly how the characters are thinking.`,
      `To test the mechanism properly, they repeat the comparison at midday, then again when the wind changes direction, and every repetition helps them separate dependable clues from noise.`,
      `Several adults ask impatient questions, but ${main} slows the conversation down, points to the written records, and explains why a reliable signal must be based on patterns that can be checked by anyone.`,
      `That insistence on clear proof changes the mood around the harbor, because people stop treating the ${object.toLowerCase()} as a relic and begin to see it as a tool that can help the whole town act early.`,
      `${helper} notices one more detail in the margin of an older page, and that final note connects the damaged latch, the tide schedule, and the warning routine into one complete explanation.`,
      `When the next weather shift arrives, the restored signal gives the community enough time to move supplies, guide younger children away from the lower steps, and prepare the docks without panic.`,
      `The success matters not because the characters guessed well, but because they paid attention, checked their assumptions, and turned careful observations into a shared plan that other people could trust.`
    ].join(' ')
  })

  return JSON.stringify({
    title,
    pages,
    summaryPrompt: 'In about 100 words, explain the core summary of the story you just read.',
    summaryGuidance: `Include the setting in ${place}, the problem with the ${object.toLowerCase()}, the evidence ${main} and ${helper} studied, and how their reasoning helped protect the harbor.`,
    keywordGroups: [
      [main.toLowerCase()],
      [helper.toLowerCase()],
      [place.toLowerCase()],
      [object.toLowerCase()],
      ['harbor', 'dock', 'boats'],
      ['signal', 'warning', 'alert'],
      ['evidence', 'records', 'notes'],
      ['repair', 'restore', 'fix'],
    ],
    vocabularyFocus: [
      { term: 'observations', studentFriendlyMeaning: 'careful things people notice and record', contextClue: `${helper} brings observations from the harbor to compare with older notes.` },
      { term: 'sequence', studentFriendlyMeaning: 'the order in which things happen', contextClue: `${main} writes the sequence down so the repair can be explained clearly.` },
      { term: 'immediate', studentFriendlyMeaning: 'happening right away or very soon', contextClue: 'The risk feels immediate because the storm surge could reach the docks soon.' },
      { term: 'reasoning', studentFriendlyMeaning: 'careful thinking based on facts and clues', contextClue: 'Their reasoning improves when they compare new evidence with older records.' },
    ],
    quizItems: [
      { id: 'reading-quiz-1', prompt: `Why did ${main} and ${helper} study the notebook and the device together?`, options: ['To decorate the harbor wall', 'To find evidence for why the signal had failed', 'To race the fishing crews', 'To replace the weather entirely'], correctOption: 1 },
      { id: 'reading-quiz-2', prompt: 'What setting is most important in the story?', options: ['A forest trail', 'A school library', `${place}`, 'A mountain cave'], correctOption: 2 },
      { id: 'reading-quiz-3', prompt: 'Which theme fits the story best?', options: ['Luck solves problems faster than evidence', 'Careful evidence and teamwork build trust', 'Silence is the best response to danger', 'Old tools should always be ignored'], correctOption: 1 },
      { id: 'reading-quiz-4', prompt: 'Why does the story mention the order of events several times?', options: ['To confuse the reader', 'To prove that sequence helps explain the repair and the warning', 'To make the story longer', 'To hide the main problem'], correctOption: 1 },
    ],
  })
}

function getMockChatCompletionContent(messages: Array<{ role: string; content: string }>, label: string): string {
  if (label === 'reading-story') {
    const sessionPrompt = messages.find((message) => message.role === 'user')?.content ?? ''
    const sessionId = sessionPrompt.match(/Session seed:\s*(.+)/)?.[1]?.trim() ?? 'mock-session'
    return buildMockReadingStoryContent(sessionId)
  }

  if (label === 'hints') {
    return ['Estimate the scale of the numbers first.', 'Choose the operation that matches the relationship.', 'Check whether the result is reasonable for the question.'].join('\n')
  }

  if (label === 'explanation') {
    return 'Check the operation carefully, then use the relationship in the question to confirm whether your answer is reasonable.'
  }

  if (label === 'questions') {
    return JSON.stringify([])
  }

  return 'Mock AI response'
}

function isOpenAIDebugLoggingEnabled(): boolean {
  return process.env.OPENAI_DEBUG_LOGS === 'true'
}

export function flushCallStats(): OpenAICallStat[] {
  return callStats.splice(0)
}

type ProviderConfig =
  | {
      provider: 'openai'
      apiKey: string
      model: string
      url: string
      headers: Record<string, string>
      bodyExtras: Record<string, string>
    }
  | {
      provider: 'azure-openai'
      apiKey: string
      model: string
      url: string
      headers: Record<string, string>
      bodyExtras: Record<string, never>
    }

function normalizeEndpoint(endpoint: string): string {
  return endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint
}

type OpenAIRequestError = Error & {
  retryable?: boolean
  statusCode?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function createRetryableError(message: string, statusCode?: number): OpenAIRequestError {
  const error = new Error(message) as OpenAIRequestError
  error.retryable = true
  if (statusCode !== undefined) {
    error.statusCode = statusCode
  }
  return error
}

function isRetryableOpenAIError(error: unknown): error is OpenAIRequestError {
  if (!(error instanceof Error)) {
    return false
  }

  const typedError = error as OpenAIRequestError
  if (typedError.retryable) {
    return true
  }

  if (typeof typedError.statusCode === 'number') {
    return [408, 409, 429, 500, 502, 503, 504].includes(typedError.statusCode)
  }

  const message = error.message.toLowerCase()
  return message.includes('timed out') || message.includes('fetch failed') || message.includes('network') || message.includes('econnreset')
}

function getRetryDelaysMs(label: string): number[] {
  if (label !== 'reading-story') {
    return []
  }

  return Array.from({ length: READING_RETRY_COUNT }, (_, index) => {
    const delay = READING_RETRY_BASE_DELAY_MS * (2 ** index)
    return Math.min(delay, READING_RETRY_MAX_DELAY_MS)
  })
}

async function chatCompletionOnce(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  label: string,
  timeoutMs: number,
): Promise<string> {
  const cfg = getOpenAIConfig()
  const startMs = Date.now()
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(cfg.url, {
      method: 'POST',
      headers: cfg.headers,
      body: JSON.stringify({ messages, max_tokens: maxTokens, temperature, ...cfg.bodyExtras }),
      signal: controller.signal,
    })
  } catch (error) {
    const latencyMs = Date.now() - startMs
    if (controller.signal.aborted) {
      console.error(`[OpenAI:${label}] TIMEOUT (${latencyMs}ms)`)
      throw createRetryableError(`OpenAI request timed out after ${timeoutMs}ms.`)
    }
    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }

  const latencyMs = Date.now() - startMs
  if (!response.ok) {
    const body = await response.text()
    const message = `OpenAI request failed (${response.status}): ${body}`
    console.error(`[OpenAI:${label}] FAILED ${response.status} (${latencyMs}ms)`, body.slice(0, 200))
    if ([408, 409, 429, 500, 502, 503, 504].includes(response.status)) {
      throw createRetryableError(message, response.status)
    }
    throw new Error(message)
  }
  const data = (await response.json()) as {
    id?: string
    model?: string
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  const usage = data.usage
  if (isOpenAIDebugLoggingEnabled()) {
    console.log(
      `[OpenAI:${label}] ✓ ${latencyMs}ms | model=${data.model ?? cfg.model} | tokens: prompt=${usage?.prompt_tokens ?? '?'} completion=${usage?.completion_tokens ?? '?'} total=${usage?.total_tokens ?? '?'} | finish=${data.choices?.[0]?.finish_reason ?? '?'} | id=${data.id ?? '?'}`,
    )
  }
  callStats.push({
    label,
    latencyMs,
    model: data.model ?? cfg.model,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    finishReason: data.choices?.[0]?.finish_reason ?? 'unknown',
    requestId: data.id ?? '',
  })
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('OpenAI returned an empty response.')
  }
  return content
}

function getOpenAIConfig(): ProviderConfig {
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT
  const azureApiKey = process.env.AZURE_OPENAI_API_KEY
  const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT
  if (azureEndpoint && azureApiKey && azureDeployment) {
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_OPENAI_API_VERSION
    return {
      provider: 'azure-openai',
      apiKey: azureApiKey,
      model: azureDeployment,
      url: `${normalizeEndpoint(azureEndpoint)}/openai/deployments/${azureDeployment}/chat/completions?api-version=${apiVersion}`,
      headers: {
        'Content-Type': 'application/json',
        'api-key': azureApiKey,
      },
      bodyExtras: {},
    }
  }

  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL
  if (!apiKey) {
    throw new Error('OpenAI is not configured. Missing OPENAI_API_KEY or Azure OpenAI settings.')
  }
  return {
    provider: 'openai',
    apiKey,
    model,
    url: OPENAI_API_URL,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    bodyExtras: { model },
  }
}

async function chatCompletion(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  label: string = 'chat',
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<string> {
  if (isOpenAIMockEnabled()) {
    const content = getMockChatCompletionContent(messages, label)
    callStats.push({
      label,
      latencyMs: 1,
      model: 'mock-openai',
      promptTokens: 320,
      completionTokens: Math.max(64, Math.min(maxTokens, 640)),
      totalTokens: 960,
      finishReason: 'stop',
      requestId: `mock-${label}`,
    })
    return content
  }

  const retryDelaysMs = getRetryDelaysMs(label)
  let attempt = 0

  while (true) {
    try {
      return await chatCompletionOnce(messages, maxTokens, temperature, label, timeoutMs)
    } catch (error) {
      if (!isRetryableOpenAIError(error) || attempt >= retryDelaysMs.length) {
        throw error
      }

      const delayMs = retryDelaysMs[attempt] ?? READING_RETRY_BASE_DELAY_MS
      console.warn(
        `[OpenAI:${label}] retrying after attempt ${attempt + 1} failed: ${error.message}. Waiting ${delayMs}ms before retry ${attempt + 2}.`,
      )
      attempt += 1
      await sleep(delayMs)
    }
  }
}

export function isOpenAIConfigured(): boolean {
  return Boolean(
    isOpenAIMockEnabled() || process.env.OPENAI_API_KEY || (
      process.env.AZURE_OPENAI_ENDPOINT &&
      process.env.AZURE_OPENAI_API_KEY &&
      process.env.AZURE_OPENAI_DEPLOYMENT
    ),
  )
}

function stripMarkdownFence(content: string): string {
  return content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

const READING_PAGE_COUNT = 6
const READING_PAGE_WORD_MIN = 200
const READING_PAGE_WORD_MAX = 250
const READING_STORY_MIN_WORDS = READING_PAGE_COUNT * READING_PAGE_WORD_MIN
const READING_STORY_MAX_WORDS = READING_PAGE_COUNT * READING_PAGE_WORD_MAX

export async function generateHintSteps(prompt: string): Promise<string[]> {
  const content = await chatCompletion(
    [
      {
        role: 'system',
        content:
          'You are a Grade 6 math tutor. Return exactly 3 concise hint steps in plain text, one step per line, no final answer.',
      },
      { role: 'user', content: `Question: ${prompt}` },
    ],
    160,
    0.3,
    'hints',
  )

  const steps = content
    .split('\n')
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)

  if (steps.length === 0) {
    throw new Error('OpenAI response did not include parseable hint steps.')
  }
  return steps
}

const VALID_TYPES = new Set<QuestionType>(['decimal', 'fraction', 'percentage', 'mixed'])

function parseQuestionsFromContent(content: string, count: number): Question[] {
  const cleaned = stripMarkdownFence(content)

  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    throw new Error('OpenAI returned non-JSON response for question generation.')
  }

  if (!Array.isArray(raw)) {
    throw new Error('OpenAI response is not an array.')
  }

  const questions: Question[] = []
  for (let i = 0; i < raw.length && questions.length < count; i++) {
    const item = raw[i] as Record<string, unknown>
    const type = String(item.type ?? 'mixed')
    const answer = Number(item.answer)
    const prompt = String(item.prompt ?? '')
    const explanation = String(item.explanation ?? '')
    const helpSteps = Array.isArray(item.helpSteps)
      ? (item.helpSteps as unknown[]).map(String).slice(0, 3)
      : []

    if (!prompt || !Number.isFinite(answer)) continue
    while (helpSteps.length < 3) helpSteps.push('Think about the steps carefully.')

    questions.push({
      id: `q-${questions.length + 1}`,
      prompt,
      type: VALID_TYPES.has(type as QuestionType) ? (type as QuestionType) : 'mixed',
      answer,
      tolerance: 0.01,
      helpSteps,
      explanation: explanation || `The answer is ${answer}.`,
      generated: true,
    })
  }

  if (questions.length < count) {
    throw new Error(
      `OpenAI generated only ${questions.length} valid questions out of ${count} requested.`,
    )
  }

  return questions
}

function parseReadingStoryFromContent(content: string): GeneratedReadingStory {
  const cleaned = stripMarkdownFence(content)

  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    throw new Error('OpenAI returned non-JSON response for reading generation.')
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('OpenAI reading response is not an object.')
  }

  const item = raw as Record<string, unknown>
  const title = String(item.title ?? '').trim()
  const summaryPrompt = String(item.summaryPrompt ?? 'In about 100 words, explain the core summary of the story you just read.').trim()
  const summaryGuidance = String(item.summaryGuidance ?? '').trim()
  const pages = Array.isArray(item.pages) ? item.pages.map(String).map((page) => page.trim()).filter(Boolean) : []
  const keywordGroups = Array.isArray(item.keywordGroups)
    ? item.keywordGroups
      .map((group) => Array.isArray(group) ? group.map(String).map((keyword) => keyword.trim().toLowerCase()).filter(Boolean) : [])
      .filter((group) => group.length > 0)
    : []
  const vocabularyFocus = Array.isArray(item.vocabularyFocus)
    ? item.vocabularyFocus
      .map((entry): ReadingVocabularyItem | null => {
        const candidate = entry as Record<string, unknown>
        const term = String(candidate.term ?? '').trim()
        const studentFriendlyMeaning = String(candidate.studentFriendlyMeaning ?? '').trim()
        const contextClue = String(candidate.contextClue ?? '').trim()
        if (!term || !studentFriendlyMeaning || !contextClue) {
          return null
        }
        return {
          term,
          studentFriendlyMeaning,
          contextClue,
        }
      })
      .filter((entry): entry is ReadingVocabularyItem => entry !== null)
    : []
  const quizItems = Array.isArray(item.quizItems)
    ? item.quizItems
      .map((quizItem, index): ReadingQuizItem | null => {
        const candidate = quizItem as Record<string, unknown>
        const prompt = String(candidate.prompt ?? '').trim()
        const options = Array.isArray(candidate.options) ? candidate.options.map(String).map((option) => option.trim()).filter(Boolean) : []
        const correctOption = Number(candidate.correctOption)
        if (!prompt || options.length !== 4 || !Number.isInteger(correctOption) || correctOption < 0 || correctOption > 3) {
          return null
        }
        return {
          id: String(candidate.id ?? `reading-quiz-${index + 1}`),
          prompt,
          options,
          correctOption,
        }
      })
      .filter((quizItem): quizItem is ReadingQuizItem => quizItem !== null)
    : []

  const totalWords = pages.reduce((sum, page) => sum + countWords(page), 0)

  if (!title) throw new Error('OpenAI reading response is missing a title.')
  if (pages.length < 4 || pages.length > 8) throw new Error(`OpenAI reading response must include 4 to 8 story chunks, received ${pages.length}.`)
  if (totalWords < READING_STORY_MIN_WORDS) {
    throw new Error(`OpenAI reading response is too short for the target session length (${totalWords} words).`)
  }
  if (!summaryGuidance) throw new Error('OpenAI reading response is missing summary guidance.')
  if (keywordGroups.length < 8) throw new Error('OpenAI reading response needs at least 8 keyword groups.')
  if (vocabularyFocus.length < 4) throw new Error('OpenAI reading response needs at least 4 vocabulary focus items.')
  if (quizItems.length !== 4) throw new Error(`OpenAI reading response must include 4 quiz items, received ${quizItems.length}.`)

  return {
    title,
    pages,
    summaryPrompt,
    summaryGuidance,
    keywordGroups,
    vocabularyFocus,
    quizItems,
  }
}

export async function generateQuestionSetAI(count: number): Promise<Question[]> {
  const content = await chatCompletion(
    [
      {
        role: 'system',
        content: `You are a Grade 6 math question generator for an IB student practising multiplication and division in ways that resemble real assessments.
Generate exactly ${count} questions, rotating evenly through these types: decimal, fraction, percentage, mixed.

Return ONLY a JSON array (no markdown fences, no commentary). Each element must have:
{
  "prompt": "<human-readable question, e.g. '2.5 × 3.4'>",
  "type": "decimal" | "fraction" | "percentage" | "mixed",
  "answer": <correct numeric answer as a number>,
  "tolerance": 0.01,
  "helpSteps": ["<step1>", "<step2>", "<step3>"],
  "explanation": "<one-sentence explanation of the solution>"
}

Rules:
- The set should feel varied, not monotonous. Mix bare numerical items, short word problems, reasoning-style prompts, ratio-table or scale contexts, and real-life assessment-style setups.
- Keep every question answerable with a single numeric answer.
- This set is for Adi specifically: a Grade 6 IB learner who needs the most support in multiplication, division, decimals, fractions, percentages, ratios, and proportion-style scaling.
- Emphasize decimals, fractions, percentages, proportions, and ratio-flavored contexts because those are the learner's weak areas.
- Avoid repeating the same sentence pattern or only giving prompts in the form "a × b".
- decimal: use multiplication or division with decimals that fit Grade 6 work, often in measurement, money, scale, or rate contexts.
- fraction: use multiplication or division with simple fractions, often in recipe, area, sharing, or part-of-a-part contexts.
- percentage: use percent-of, percent as a rate, or percentage-based comparison contexts that still produce a numeric answer.
- mixed: combine decimals with fractions or ratio/proportion contexts, e.g. scaling, grouping, or unit-rate style questions.
- Include a healthy assessment blend: some pure fluency items, some applied word problems, some reasoning prompts, and some test-style interpretation items. Do not let one format dominate.
- Frequently connect representations: decimal <-> fraction <-> percentage <-> ratio, but keep the final response numeric.
- Target common misconceptions on purpose across the set: decimal place-value mistakes, multiplying instead of dividing, dividing instead of multiplying, forgetting to convert percentages to decimals, and errors with reciprocal use in fraction division.
- Prefer numbers that reward strategy and understanding over tedious arithmetic. Make the arithmetic challenging but not messy for its own sake.
- Build a gentle progression inside the set: begin with 1-2 accessible confidence-building questions, then increase complexity, then include a few more demanding questions later in the set.
- Include both one-step and two-step thinking, but keep the wording concise enough that reading load does not hide the math.
- Use contexts a student would realistically see in school assessments: price/unit cost, recipes, scale drawings, measurement, grouped quantities, sharing, rates, and proportion tables.
- Avoid fluffy stories, irrelevant detail, or long narratives. The language should support the math, not distract from it.
- Avoid repeating the same context, same numbers, or same operation pattern in back-to-back questions.
- At least some items should require deciding what operation to use from context, not just carrying out a visible expression.
- Some later questions should require estimation sense or reasonableness checking, but still end with a precise numeric answer.
- Hints should teach a method a teacher would approve of, not just restate the question.
- Explanations should name the underlying strategy briefly, such as scaling, unit rate, reciprocal, part of a whole, or percent conversion.
- All answers must be correct numbers (not strings)
- helpSteps must have exactly 3 items
- Vary the difficulty appropriately for a Grade 6 student`,
      },
      {
        role: 'user',
        content: `Generate ${count} Grade 6 multiplication and division practice questions now with strong variation in form and authentic assessment style.`,
      },
    ],
    2000,
    0.7,
    'questions',
  )

  return parseQuestionsFromContent(content, count)
}

export async function generateExplanation(
  prompt: string,
  userAnswer: number,
  correctAnswer: number,
  isCorrect: boolean,
): Promise<string> {
  return chatCompletion(
    [
      {
        role: 'system',
        content: `You are a supportive Grade 6 math tutor. Given a Grade 6 arithmetic question, the student's answer, and the correct answer, provide a concise 1–2 sentence explanation.
${isCorrect ? 'The student answered correctly — briefly congratulate them and reinforce the method.' : 'The student answered incorrectly — explain where they likely went wrong and show the correct approach. Be encouraging, never discouraging.'}`,
      },
      {
        role: 'user',
        content: `Question: ${prompt}\nStudent's answer: ${userAnswer}\nCorrect answer: ${correctAnswer}`,
      },
    ],
    150,
    0.3,
    'explanation',
  )
}

export async function generateReadingStoryAI(input: {
  sessionId: string
  challengeTier: 'core' | 'stretch' | 'advanced'
  performanceSummary: string
  priorTitles: string[]
  timeoutMs?: number
}): Promise<GeneratedReadingStory> {
  const challengeNotes = {
    core: 'Use strong Grade 7 IB middle-school readability, clear plot movement, emotionally vivid scenes, and mostly direct inference.',
    stretch: 'Raise the sophistication slightly with denser description, more layered motives, stronger inferential reading, and richer Grade 7 IB vocabulary that remains inferable from context.',
    advanced: 'Write at the high end of Grade 7 IB middle-grade difficulty with deeper thematic texture, more nuanced emotional shifts, more subtext, and longer but still readable sentence structures.',
  }[input.challengeTier]

  const content = await chatCompletion(
    [
      {
        role: 'system',
        content: `You are an expert middle-grade fiction writer and reading-assessment designer creating ORIGINAL reading passages for one child learner.

Write fresh, high-quality fiction for an 11-13 year old reader with atmosphere, discovery, moral courage, resourcefulness, emotional sincerity, vivid setting, narrative momentum, and thoughtful themes.

Do NOT imitate, paraphrase, reference, echo, or mention any specific real book, author, series, plot, or copyrighted character. Invent everything from scratch in your own wording.

Return ONLY a JSON object with this exact shape:
{
  "title": "Fresh original title",
  "pages": ["story chunk 1", "story chunk 2", "story chunk 3", "story chunk 4"],
  "summaryPrompt": "In about 100 words, explain the core summary of the story you just read.",
  "summaryGuidance": "Specific guidance for what the student should include.",
  "keywordGroups": [["keyword1", "keyword2"], ...],
  "vocabularyFocus": [
    { "term": "...", "studentFriendlyMeaning": "...", "contextClue": "..." },
    { "term": "...", "studentFriendlyMeaning": "...", "contextClue": "..." },
    { "term": "...", "studentFriendlyMeaning": "...", "contextClue": "..." },
    { "term": "...", "studentFriendlyMeaning": "...", "contextClue": "..." }
  ],
  "quizItems": [
    { "id": "reading-quiz-1", "prompt": "...", "options": ["...", "...", "...", "..."], "correctOption": 0 },
    { "id": "reading-quiz-2", "prompt": "...", "options": ["...", "...", "...", "..."], "correctOption": 1 },
    { "id": "reading-quiz-3", "prompt": "...", "options": ["...", "...", "...", "..."], "correctOption": 2 },
    { "id": "reading-quiz-4", "prompt": "...", "options": ["...", "...", "...", "..."], "correctOption": 3 }
  ]
}

Story requirements:
- The full story should be long enough for a serious 6-page reading session with pages that feel like a real middle-grade book: about ${READING_PAGE_WORD_MIN}-${READING_PAGE_WORD_MAX} words per final page after repagination.
- That means roughly ${READING_STORY_MIN_WORDS}-${READING_STORY_MAX_WORDS} total words overall. Stay inside that range unless there is a compelling narrative reason to be only slightly above it.
- Return the story in 4 to 8 natural chunks inside the pages array. Chunk lengths do not need to match. The app will repaginate the story into exactly 6 reading pages.
- The title must be fresh and not resemble any prior title supplied by the user.
- The protagonist should feel age-appropriate for upper elementary / middle school.
- The story should have a clear central problem, rising tension, and a meaningful resolution.
- The prose should feel literary and engaging, not generic, flat, or template-like.
- Avoid repetitive sentence openings and avoid formulaic chapter endings.
- Make the summaryGuidance specific to the actual story.
- Provide 8-12 keywordGroups, all lowercase, each group containing alternative terms/phrases that a student summary might mention.
- Provide 4 vocabularyFocus items chosen from words or short phrases that genuinely appear in the story and can help a strong Grade 7 IB reader grow academic or literary vocabulary.
- Each vocabularyFocus item must include a studentFriendlyMeaning and a contextClue that explains how the surrounding sentence helps reveal the meaning.
- Choose words that are useful and transferable, not obscure decoration.
- The 4 quizItems must check both literal understanding and inference, not just trivial recall.
- Every quiz question must have exactly 4 plausible options with only one correct answer.
- Build the reading like a strong teacher-made comprehension passage, not just a creative story. The text should support assessment of sequencing, cause and effect, character motivation, evidence-based inference, vocabulary in context, and theme.
- Keep the reading load manageable for a strong Grade 7 IB learner: mostly clear syntax, purposeful paragraphing, and only a small number of richer vocabulary words that can be understood from context.
- Do not make comprehension depend on obscure vocabulary or cultural background knowledge.
- Include enough concrete details that a student can cite or recall evidence from the text without guessing.
- Spread comprehension demands across the 4 quizItems: include a mix of literal retrieval, inference, author's purpose or theme, and word-or-phrase-in-context where natural.
- Avoid trick questions, ambiguous distractors, negatives like "Which is NOT...", and answer choices that are too obviously wrong.
- Distractors should reflect believable student misunderstandings, such as mixing up timeline events, overgeneralizing a detail, or missing a motivation shift.
- The summaryPrompt and summaryGuidance should push for the key summary structure a teacher would want: setting, main problem, important actions, and resolution, not tiny details.
- Prefer emotionally coherent stories with one clear through-line over stories that are clever but confusing.
- Make sure each chunk boundary feels natural and does not break the story in a confusing place.

Difficulty guidance:
- ${challengeNotes}`,
      },
      {
        role: 'user',
        content: `Session seed: ${input.sessionId}
Challenge tier: ${input.challengeTier}
Current reading profile: ${input.performanceSummary}
Avoid reusing or resembling these earlier titles: ${input.priorTitles.length > 0 ? input.priorTitles.join(' | ') : 'none yet'}

Generate a fresh original reading story now.`,
      },
    ],
    READING_REQUEST_MAX_TOKENS,
    READING_REQUEST_TEMPERATURE,
    'reading-story',
    input.timeoutMs,
  )

  return parseReadingStoryFromContent(content)
}
