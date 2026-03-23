import type { Question, QuestionType, Subject } from './types'

const FRACTION_PAIRS: [number, number, number, number][] = [
  [1, 2, 3, 4],
  [2, 3, 3, 5],
  [3, 4, 4, 5],
  [5, 6, 2, 7],
  [7, 8, 3, 10],
]

function roundTo(value: number, places = 4): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function clampDifficultyLevel(level: number): number {
  return Math.min(5, Math.max(1, Math.round(level)))
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function parseQuestionNumber(id: string): number {
  const match = id.match(/q-(\d+)/i)
  return match ? Number(match[1]) : 1
}

type MathPromptStyle = 'equation' | 'context' | 'reasoning' | 'assessment'

const DEFAULT_MATH_PROMPT_CYCLE: MathPromptStyle[] = ['context', 'equation', 'reasoning', 'assessment']

function getMathPromptStyle(id: string, difficultyLevel: number): MathPromptStyle {
  const level = clampDifficultyLevel(difficultyLevel)
  const questionNumber = parseQuestionNumber(id)
  const promptStyleCycle: Record<number, MathPromptStyle[]> = {
    1: ['equation', 'context', 'equation', 'context'],
    2: ['equation', 'context', 'reasoning', 'context'],
    3: ['context', 'equation', 'reasoning', 'assessment'],
    4: ['reasoning', 'context', 'assessment', 'equation'],
    5: ['assessment', 'reasoning', 'context', 'assessment'],
  }
  const cycle = promptStyleCycle[level] ?? DEFAULT_MATH_PROMPT_CYCLE
  return cycle[(questionNumber - 1) % cycle.length] ?? 'context'
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundTo(value, 2))
}

function formatFraction(numerator: number, denominator: number): string {
  return `${numerator}/${denominator}`
}

function buildMultiplicationDecimalPrompt(style: MathPromptStyle, a: number, b: number): string {
  if (style === 'equation') {
    return `${a} × ${b}`
  }
  if (style === 'reasoning') {
    return `Which product should Adi get if he models ${a} × ${b} with an area model on a test?`
  }
  if (style === 'assessment') {
    return `A ratio table scales a smoothie recipe by ${formatNumber(b)}. One batch uses ${formatNumber(a)} liters of milk. How many liters are needed in total?`
  }
  return `Each science sample weighs ${formatNumber(a)} grams. If Adi prepares ${formatNumber(b)} samples, what is the total mass?`
}

function buildMultiplicationFractionPrompt(style: MathPromptStyle, n1: number, d1: number, n2: number, d2: number): string {
  const left = formatFraction(n1, d1)
  const right = formatFraction(n2, d2)
  if (style === 'equation') {
    return `${left} × ${right}`
  }
  if (style === 'reasoning') {
    return `Adi says the correct operation for taking ${left} of ${right} of a meter is multiplication. What decimal answer should he get?`
  }
  if (style === 'assessment') {
    return `In a design task, ${left} of a board is painted blue and then ${right} of that blue section gets a pattern. What decimal part of the whole board has the pattern?`
  }
  return `A recipe uses ${left} cup of yogurt per mini batch. Adi makes ${right} of a mini batch. How many cups of yogurt are needed? Give the answer as a decimal.`
}

function buildMultiplicationPercentagePrompt(style: MathPromptStyle, percent: number, base: number): string {
  if (style === 'equation') {
    return `${percent}% of ${base}`
  }
  if (style === 'reasoning') {
    return `Adi knows that finding ${percent}% of ${base} means multiplying ${base} by a decimal. What is the result?`
  }
  if (style === 'assessment') {
    return `A test score report shows that ${percent}% of ${base} points came from the calculator-free section. How many points is that?`
  }
  return `During a reading challenge, Adi completes ${percent}% of a ${base}-page target. How many pages is that?`
}

function buildMultiplicationMixedPrompt(style: MathPromptStyle, decimal: number, n: number, d: number): string {
  const fraction = formatFraction(n, d)
  if (style === 'equation') {
    return `${decimal} × ${fraction}`
  }
  if (style === 'reasoning') {
    return `Adi is checking whether ${decimal} × ${fraction} makes sense in a ratio problem. What decimal answer should he write?`
  }
  if (style === 'assessment') {
    return `A scale drawing uses ${fraction} of the full width, and the full width is ${formatNumber(decimal)} meters. What is the actual width shown?`
  }
  return `Each snack pack weighs ${formatNumber(decimal)} kilogram, and Adi prepares ${fraction} of the full set. What is the total weight?`
}

function buildDivisionDecimalPrompt(style: MathPromptStyle, dividend: number, divisor: number): string {
  if (style === 'equation') {
    return `${dividend} ÷ ${divisor}`
  }
  if (style === 'reasoning') {
    return `Adi wants to check his quotient for ${dividend} ÷ ${divisor} by thinking about the matching multiplication fact. What answer should he get?`
  }
  if (style === 'assessment') {
    return `A test-prep ratio table shows ${formatNumber(dividend)} liters shared equally into containers of ${formatNumber(divisor)} liters each. How many containers are filled?`
  }
  return `Adi has ${formatNumber(dividend)} liters of juice and pours it equally into cups holding ${formatNumber(divisor)} liters each. How many cups can he fill?`
}

function buildDivisionFractionPrompt(style: MathPromptStyle, n1: number, d1: number, n2: number, d2: number): string {
  const left = formatFraction(n1, d1)
  const right = formatFraction(n2, d2)
  if (style === 'equation') {
    return `${left} ÷ ${right}`
  }
  if (style === 'reasoning') {
    return `Adi rewrites ${left} ÷ ${right} as multiplication by the reciprocal. What decimal answer should he get?`
  }
  if (style === 'assessment') {
    return `A ribbon measuring ${left} meter is cut into pieces that are each ${right} meter long. How many pieces can Adi make? Give the answer as a decimal if needed.`
  }
  return `In a recipe task, Adi has ${left} cup of sauce and uses ${right} cup for each wrap. How many wraps can he make?`
}

function buildDivisionPercentagePrompt(style: MathPromptStyle, dividend: number, percent: number): string {
  if (style === 'equation') {
    return `${dividend} ÷ ${percent}%`
  }
  if (style === 'reasoning') {
    return `Adi knows that dividing ${dividend} by ${percent}% means dividing by ${percent / 100}. What full amount should he get?`
  }
  if (style === 'assessment') {
    return `A score of ${dividend} points is ${percent}% of the full marks on an assessment. What was the full-mark total?`
  }
  return `Adi scored ${dividend} points, which is ${percent}% of the full target. What was the full target score?`
}

function buildDivisionMixedPrompt(style: MathPromptStyle, dividend: number, n: number, d: number): string {
  const fraction = formatFraction(n, d)
  if (style === 'equation') {
    return `${dividend} ÷ ${fraction}`
  }
  if (style === 'reasoning') {
    return `Adi changes ${dividend} ÷ ${fraction} into multiplication by the reciprocal. What quotient should he get?`
  }
  if (style === 'assessment') {
    return `A total of ${formatNumber(dividend)} kilograms of trail mix is packed into bags that each weigh ${fraction} kilogram. How many bags can be filled?`
  }
  return `Adi shares ${formatNumber(dividend)} kilograms of trail mix into packets that each weigh ${fraction} kilogram. How many packets can he make?`
}

function buildMultiplicationDecimalQuestion(id: string, difficultyLevel: number): Question {
  const level = clampDifficultyLevel(difficultyLevel)
  const places = level >= 4 ? 2 : 1
  const rangeMap: Record<number, { min: number; max: number }> = {
    1: { min: 10, max: 35 },
    2: { min: 18, max: 50 },
    3: { min: 25, max: 70 },
    4: { min: 35, max: 95 },
    5: { min: 55, max: 140 },
  }
  const ranges = rangeMap[level] ?? { min: 25, max: 70 }
  const a = roundTo(randomInt(ranges.min, ranges.max) / 10, places)
  const b = roundTo(randomInt(ranges.min, ranges.max) / 10, places)
  const answer = roundTo(a * b)
  const prompt = buildMultiplicationDecimalPrompt(getMathPromptStyle(id, difficultyLevel), a, b)
  return {
    id,
    prompt,
    type: 'decimal',
    answer,
    tolerance: 0.01,
    helpSteps: [
      `Equation to solve: ${a} × ${b}.`,
      `Ignore decimals first: ${a * 10} × ${b * 10}`,
      'Multiply as whole numbers.',
      'Add decimal places back to the final answer.',
    ],
    explanation: `This situation matches ${a} × ${b}, so the total is ${answer}.`,
  }
}

function getFractionPairsForLevel(level: number): [number, number, number, number][] {
  if (level <= 2) {
    return [
      [1, 2, 1, 3],
      [2, 3, 1, 2],
      [3, 4, 2, 3],
      [1, 4, 3, 4],
    ]
  }
  if (level === 3) {
    return FRACTION_PAIRS
  }
  return [
    [5, 6, 3, 4],
    [7, 8, 5, 6],
    [4, 5, 3, 7],
    [5, 9, 7, 10],
    [7, 12, 5, 8],
  ]
}

function buildMultiplicationFractionQuestion(id: string, difficultyLevel: number): Question {
  const level = clampDifficultyLevel(difficultyLevel)
  const pairPool = getFractionPairsForLevel(level)
  const pair = pairPool[Math.floor(Math.random() * pairPool.length)] ?? [1, 2, 1, 2]
  const [n1, d1, n2, d2] = pair
  const factorOne = roundTo(n1 / d1, 4)
  const factorTwo = roundTo(n2 / d2, 4)
  const answer = roundTo(factorOne * factorTwo)
  const prompt = buildMultiplicationFractionPrompt(getMathPromptStyle(id, difficultyLevel), n1, d1, n2, d2)
  return {
    id,
    prompt,
    type: 'fraction',
    answer,
    tolerance: 0.01,
    helpSteps: [
      `Equation to solve: ${n1}/${d1} × ${n2}/${d2}.`,
      `Multiply numerators: ${n1} × ${n2}`,
      `Multiply denominators: ${d1} × ${d2}`,
      'Simplify if possible, then convert to decimal if needed.',
    ],
    explanation: `This situation matches ${n1}/${d1} × ${n2}/${d2}, which equals ${answer}.`,
  }
}

function buildMultiplicationPercentageQuestion(id: string, difficultyLevel: number): Question {
  const level = clampDifficultyLevel(difficultyLevel)
  const percentChoices = level <= 2
    ? [10, 20, 25, 50]
    : level === 3
      ? [10, 20, 25, 30, 40, 50, 60, 75]
      : [12, 15, 18, 24, 35, 45, 65, 75]
  const percent = percentChoices[Math.floor(Math.random() * percentChoices.length)] ?? 25
  const base = level <= 2
    ? randomInt(5, 18) * 5
    : level === 3
      ? randomInt(7, 24) * 5
      : randomInt(12, 40) * 3
  const answer = roundTo((percent / 100) * base)
  const prompt = buildMultiplicationPercentagePrompt(getMathPromptStyle(id, difficultyLevel), percent, base)
  return {
    id,
    prompt,
    type: 'percentage',
    answer,
    tolerance: 0.01,
    helpSteps: [
      `Equation to solve: ${percent}% of ${base}.`,
      `Convert percentage to decimal: ${percent}% = ${percent / 100}`,
      `Multiply ${percent / 100} × ${base}`,
      'Write the final product.',
    ],
    explanation: `This situation matches ${percent}% of ${base}, so the answer is ${answer}.`,
  }
}

function buildMultiplicationMixedQuestion(id: string, difficultyLevel: number): Question {
  const level = clampDifficultyLevel(difficultyLevel)
  const decimal = roundTo(randomInt(level <= 2 ? 18 : 24, level >= 4 ? 110 : 80) / 10, level >= 4 ? 2 : 1)
  const n = randomInt(1 + (level >= 4 ? 1 : 0), level >= 4 ? 8 : 5)
  const d = randomInt(level <= 2 ? 2 : 3, level >= 4 ? 10 : 6)
  const fractionValue = roundTo(n / d, 4)
  const answer = roundTo(decimal * fractionValue)
  const prompt = buildMultiplicationMixedPrompt(getMathPromptStyle(id, difficultyLevel), decimal, n, d)
  return {
    id,
    prompt,
    type: 'mixed',
    answer,
    tolerance: 0.01,
    helpSteps: [
      `Equation to solve: ${decimal} × ${n}/${d}.`,
      `Convert ${n}/${d} to decimal: ${roundTo(n / d, 3)}`,
      `Multiply ${decimal} by ${roundTo(n / d, 3)}`,
      'Round reasonably if needed.',
    ],
    explanation: `This situation matches ${decimal} × ${n}/${d}, which equals ${answer}.`,
  }
}

function buildDivisionDecimalQuestion(id: string, difficultyLevel: number): Question {
  const level = clampDifficultyLevel(difficultyLevel)
  const places = level >= 4 ? 2 : 1
  const divisor = roundTo(randomInt(level <= 2 ? 10 : 15, level >= 4 ? 80 : 60) / 10, places)
  const quotient = roundTo(randomInt(level <= 2 ? 12 : 18, level >= 4 ? 100 : 70) / 10, places)
  const dividend = roundTo(divisor * quotient, 2)
  const prompt = buildDivisionDecimalPrompt(getMathPromptStyle(id, difficultyLevel), dividend, divisor)
  return {
    id,
    prompt,
    type: 'decimal',
    answer: quotient,
    tolerance: 0.01,
    helpSteps: [
      `Equation to solve: ${dividend} ÷ ${divisor}.`,
      `Think of the matching multiplication fact: ${divisor} × ? = ${dividend}`,
      `Work out how many groups of ${divisor} fit into ${dividend}.`,
      'Place the decimal point carefully in the quotient.',
    ],
    explanation: `This situation matches ${dividend} ÷ ${divisor}, so the answer is ${quotient}.`,
  }
}

function buildDivisionFractionQuestion(id: string, difficultyLevel: number): Question {
  const pairPool = getFractionPairsForLevel(clampDifficultyLevel(difficultyLevel))
  const pair = pairPool[Math.floor(Math.random() * pairPool.length)] ?? [1, 2, 1, 2]
  const [n1, d1, n2, d2] = pair
  const leftValue = roundTo(n1 / d1, 4)
  const rightValue = roundTo(n2 / d2, 4)
  const answer = roundTo(leftValue / rightValue)
  const prompt = buildDivisionFractionPrompt(getMathPromptStyle(id, difficultyLevel), n1, d1, n2, d2)
  return {
    id,
    prompt,
    type: 'fraction',
    answer,
    tolerance: 0.01,
    helpSteps: [
      `Equation to solve: ${n1}/${d1} ÷ ${n2}/${d2}.`,
      `Keep ${n1}/${d1} the same.`,
      `Flip ${n2}/${d2} to ${d2}/${n2} and multiply.`,
      'Convert the result to a decimal if needed.',
    ],
    explanation: `This situation matches ${n1}/${d1} ÷ ${n2}/${d2}, which equals ${answer}.`,
  }
}

function buildDivisionPercentageQuestion(id: string, difficultyLevel: number): Question {
  const level = clampDifficultyLevel(difficultyLevel)
  const percentChoices = level <= 2
    ? [10, 20, 25, 50]
    : level === 3
      ? [10, 20, 25, 40, 50]
      : [12, 15, 18, 24, 30, 45, 60]
  const percent = percentChoices[Math.floor(Math.random() * percentChoices.length)] ?? 25
  const quotient = level <= 2
    ? randomInt(2, 12) * 5
    : level === 3
      ? randomInt(3, 18) * 5
      : randomInt(4, 20) * 6
  const dividend = roundTo((percent / 100) * quotient)
  const prompt = buildDivisionPercentagePrompt(getMathPromptStyle(id, difficultyLevel), dividend, percent)
  return {
    id,
    prompt,
    type: 'percentage',
    answer: quotient,
    tolerance: 0.01,
    helpSteps: [
      `Equation to solve: ${dividend} ÷ ${percent}%.`,
      `Convert ${percent}% to a decimal: ${percent / 100}.`,
      `Think: ${dividend} ÷ ${percent / 100}.`,
      'Check by multiplying your answer by the decimal divisor.',
    ],
    explanation: `This situation matches ${dividend} ÷ ${percent}%, so the answer is ${quotient}.`,
  }
}

function buildDivisionMixedQuestion(id: string, difficultyLevel: number): Question {
  const level = clampDifficultyLevel(difficultyLevel)
  const quotient = roundTo(randomInt(level <= 2 ? 12 : 18, level >= 4 ? 95 : 70) / 10, level >= 4 ? 2 : 1)
  const n = randomInt(level <= 2 ? 1 : 2, level >= 4 ? 8 : 5)
  const d = randomInt(level <= 2 ? 2 : 3, level >= 4 ? 10 : 6)
  const divisor = n / d
  const dividend = roundTo(quotient * divisor, 3)
  const prompt = buildDivisionMixedPrompt(getMathPromptStyle(id, difficultyLevel), dividend, n, d)
  return {
    id,
    prompt,
    type: 'mixed',
    answer: quotient,
    tolerance: 0.01,
    helpSteps: [
      `Equation to solve: ${dividend} ÷ ${n}/${d}.`,
      `Change ÷ ${n}/${d} into × ${d}/${n}.`,
      `Multiply ${dividend} by ${roundTo(d / n, 3)}.`,
      'Round reasonably if needed.',
    ],
    explanation: `This situation matches ${dividend} ÷ ${n}/${d}, which equals ${quotient}.`,
  }
}

function buildQuestion(id: string, type: QuestionType, subject: Subject, difficultyLevel = 3): Question {
  if (subject === 'Reading') {
    throw new Error('Reading questions are generated at the session level.')
  }

  if (subject === 'Division') {
    if (type === 'decimal') return buildDivisionDecimalQuestion(id, difficultyLevel)
    if (type === 'fraction') return buildDivisionFractionQuestion(id, difficultyLevel)
    if (type === 'percentage') return buildDivisionPercentageQuestion(id, difficultyLevel)
    return buildDivisionMixedQuestion(id, difficultyLevel)
  }

  if (type === 'decimal') return buildMultiplicationDecimalQuestion(id, difficultyLevel)
  if (type === 'fraction') return buildMultiplicationFractionQuestion(id, difficultyLevel)
  if (type === 'percentage') return buildMultiplicationPercentageQuestion(id, difficultyLevel)
  return buildMultiplicationMixedQuestion(id, difficultyLevel)
}

export function getQuestionTypeForIndex(index: number): QuestionType {
  const types: QuestionType[] = ['decimal', 'fraction', 'percentage', 'mixed']
  return types[index % types.length] ?? 'mixed'
}

export function createQuestionPlaceholder(id: string, type: QuestionType): Question {
  const kind =
    type === 'reading_page'
      ? 'reading-page'
      : type === 'reading_summary'
        ? 'reading-summary'
        : type === 'reading_quiz'
          ? 'reading-quiz'
        : 'math'
  return {
    id,
    prompt: '',
    type,
    kind,
    answer: 0,
    tolerance: 0.01,
    helpSteps: [],
    explanation: '',
    generated: false,
  }
}

export function generateQuestionByType(id: string, type: QuestionType, subject: Subject, difficultyLevel = 3): Question {
  return {
    ...buildQuestion(id, type, subject, difficultyLevel),
    generated: true,
  }
}

export function generateQuestionSet(count: number, subject: Subject): Question[] {
  return Array.from({ length: count }, (_, index) => {
    const type = getQuestionTypeForIndex(index)
    return generateQuestionByType(`q-${index + 1}`, type, subject)
  })
}

export function isAnswerCorrect(
  input: number,
  expected: number,
  tolerance: number,
): boolean {
  return Math.abs(input - expected) <= tolerance
}

export function parseAnswer(value: string): number | null {
  const trimmed = value.trim()

  // Plain number (decimal or integer): "0.6", "3", "-1.5"
  const plain = Number(trimmed)
  if (!Number.isNaN(plain) && Number.isFinite(plain)) {
    return plain
  }

  // Fraction string: "3/5", "6 / 20", "-1/4"
  const fractionMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1])
    const denominator = Number(fractionMatch[2])
    if (!Number.isNaN(numerator) && !Number.isNaN(denominator) && denominator !== 0) {
      return numerator / denominator
    }
  }

  return null
}
