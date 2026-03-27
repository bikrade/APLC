import type { GeneratedReadingStory, OpenAICallStat, Question, QuestionType, ReadingQuizItem, ReadingVocabularyItem } from './types'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'

const callStats: OpenAICallStat[] = []

function isOpenAIDebugLoggingEnabled(): boolean {
  return process.env.OPENAI_DEBUG_LOGS === 'true'
}

export function flushCallStats(): OpenAICallStat[] {
  return callStats.splice(0)
}

function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL
  if (!apiKey) {
    throw new Error('OpenAI is not configured. Missing OPENAI_API_KEY.')
  }
  return { apiKey, model }
}

async function chatCompletion(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  label: string = 'chat',
): Promise<string> {
  const cfg = getOpenAIConfig()
  const startMs = Date.now()
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, max_tokens: maxTokens, temperature }),
  })
  const latencyMs = Date.now() - startMs
  if (!response.ok) {
    const body = await response.text()
    console.error(`[OpenAI:${label}] FAILED ${response.status} (${latencyMs}ms)`, body.slice(0, 200))
    throw new Error(`OpenAI request failed (${response.status}): ${body}`)
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

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
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

Write fresh, high-quality fiction for an 11-13 year old reader. Capture qualities often admired in excellent middle-grade books: atmosphere, discovery, moral courage, resourcefulness, emotional sincerity, vivid setting, narrative momentum, and thoughtful themes.

As a quality benchmark only, aim for the level of craft, seriousness, readability, and imaginative or intellectual richness that readers often value in books such as:
- The Hobbit
- The Golden Compass
- The Mysterious Benedict Society
- Artemis Fowl
- Island of the Blue Dolphins
- Roll of Thunder, Hear My Cry
- The Witch of Blackbird Pond
- Where the Mountain Meets the Moon
- Bomb: The Race to Build—and Steal—the World's Most Dangerous Weapon
- I Am Malala

Use those titles only as a grounding reference for quality, depth, atmosphere, curiosity, courage, and age-appropriate sophistication. Blend the broad strengths of multiple references instead of drifting toward any one book's voice or setup.

Do NOT imitate, paraphrase, reference, echo, or mention any specific real book, author, series, plot, or copyrighted character. Invent everything from scratch in your own wording.
Do NOT produce "fan fiction," near-matches, homage plots, or prose that feels recognizably tied to any one listed work. Blend the broad literary qualities, not the copyrighted expression.

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
    3200,
    0.95,
    'reading-story',
  )

  return parseReadingStoryFromContent(content)
}
