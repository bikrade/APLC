import type { OpenAICallStat, Question, QuestionType } from './types'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'

const callStats: OpenAICallStat[] = []

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
  console.log(
    `[OpenAI:${label}] ✓ ${latencyMs}ms | model=${data.model ?? cfg.model} | tokens: prompt=${usage?.prompt_tokens ?? '?'} completion=${usage?.completion_tokens ?? '?'} total=${usage?.total_tokens ?? '?'} | finish=${data.choices?.[0]?.finish_reason ?? '?'} | id=${data.id ?? '?'}`,
  )
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
  const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

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

export async function generateQuestionSetAI(count: number): Promise<Question[]> {
  const content = await chatCompletion(
    [
      {
        role: 'system',
        content: `You are a Grade 6 math question generator for an IB student practising arithmetic.
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
- decimal: multiply two numbers with 1 decimal place each, e.g. 3.5 × 2.8
- fraction: multiply two simple fractions, e.g. 2/3 × 4/5, answer as a decimal
- percentage: compute a percentage of a whole number, e.g. 35% of 80
- mixed: multiply a decimal by a fraction, e.g. 4.2 × 3/5
- All answers must be correct numbers (not strings)
- helpSteps must have exactly 3 items
- Vary the difficulty appropriately for a Grade 6 student`,
      },
      {
        role: 'user',
        content: `Generate ${count} Grade 6 arithmetic practice questions now.`,
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
