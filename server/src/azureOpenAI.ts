import type { Question, QuestionType } from './types'

const DEFAULT_API_VERSION = '2024-10-21'

function normalizeEndpoint(endpoint: string): string {
  return endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint
}

function getAzureConfig() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT
  const apiKey = process.env.AZURE_OPENAI_API_KEY
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION
  if (!endpoint || !apiKey || !deployment) {
    throw new Error('Azure OpenAI is not configured. Missing endpoint, key, or deployment.')
  }
  return { endpoint: normalizeEndpoint(endpoint), apiKey, deployment, apiVersion }
}

function buildUrl(cfg: ReturnType<typeof getAzureConfig>): string {
  return `${cfg.endpoint}/openai/deployments/${cfg.deployment}/chat/completions?api-version=${cfg.apiVersion}`
}

async function chatCompletion(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  const cfg = getAzureConfig()
  const response = await fetch(buildUrl(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': cfg.apiKey },
    body: JSON.stringify({ messages, max_tokens: maxTokens, temperature }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Azure OpenAI request failed (${response.status}): ${body}`)
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('Azure OpenAI returned an empty response.')
  }
  return content
}

export function isAzureConfigured(): boolean {
  return Boolean(
    process.env.AZURE_OPENAI_ENDPOINT &&
      process.env.AZURE_OPENAI_API_KEY &&
      process.env.AZURE_OPENAI_DEPLOYMENT,
  )
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
  )

  const steps = content
    .split('\n')
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)

  if (steps.length === 0) {
    throw new Error('Azure OpenAI response did not include parseable hint steps.')
  }
  return steps
}

const VALID_TYPES = new Set<QuestionType>(['decimal', 'fraction', 'percentage', 'mixed'])

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
  )

  // Strip markdown code fences if present
  const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    throw new Error('Azure OpenAI returned non-JSON response for question generation.')
  }

  if (!Array.isArray(raw)) {
    throw new Error('Azure OpenAI response is not an array.')
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
    })
  }

  if (questions.length < count) {
    throw new Error(
      `Azure OpenAI generated only ${questions.length} valid questions out of ${count} requested.`,
    )
  }
  return questions
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
  )
}
