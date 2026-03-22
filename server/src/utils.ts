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

function shouldUseWordProblem(id: string, difficultyLevel: number): boolean {
  const level = clampDifficultyLevel(difficultyLevel)
  const questionNumber = parseQuestionNumber(id)
  if (level <= 3) return false
  if (level === 4) return questionNumber % 3 === 0
  return questionNumber % 2 === 0
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundTo(value, 2))
}

function buildMultiplicationWordProblem(type: QuestionType, a: number, b: number): string {
  if (type === 'decimal') {
    return `A craft kit uses ${formatNumber(a)} meters of ribbon for each bookmark. If Adi makes ${formatNumber(b)} bookmarks, how many meters of ribbon does he use in all?`
  }
  if (type === 'fraction') {
    return `A recipe uses ${formatNumber(a)} cup of yogurt in one batch. If Adi makes ${formatNumber(b)} of the batch size, how much yogurt is needed altogether?`
  }
  if (type === 'percentage') {
    return `During a reading challenge, Adi finishes ${formatNumber(a)} of a ${formatNumber(b)}-page target. How many pages is that?`
  }
  return `Adi packs snack bags that each weigh ${formatNumber(a)} kilogram. He prepares ${formatNumber(b)} of a full bag set. What is the total weight of the snack bags?`
}

function buildDivisionWordProblem(type: QuestionType, dividend: number, divisor: number): string {
  if (type === 'decimal') {
    return `Adi has ${formatNumber(dividend)} liters of juice and pours it equally into cups holding ${formatNumber(divisor)} liters each. How many cups can he fill?`
  }
  if (type === 'fraction') {
    return `A ribbon measuring ${formatNumber(dividend)} meter is cut into pieces that are each ${formatNumber(divisor)} meter long. How many pieces can Adi make?`
  }
  if (type === 'percentage') {
    return `Adi scored ${formatNumber(dividend)} points, which is ${formatNumber(divisor)} of the full target. What was the full target score?`
  }
  return `Adi shares ${formatNumber(dividend)} kilograms of trail mix into packets that each weigh ${formatNumber(divisor)} kilogram. How many packets can he make?`
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
  const prompt = shouldUseWordProblem(id, difficultyLevel)
    ? buildMultiplicationWordProblem('decimal', a, b)
    : `${a} × ${b}`
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
  const prompt = shouldUseWordProblem(id, difficultyLevel)
    ? buildMultiplicationWordProblem('fraction', factorOne, factorTwo)
    : `${n1}/${d1} × ${n2}/${d2}`
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
  const prompt = shouldUseWordProblem(id, difficultyLevel)
    ? buildMultiplicationWordProblem('percentage', percent / 100, base)
    : `${percent}% of ${base}`
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
  const prompt = shouldUseWordProblem(id, difficultyLevel)
    ? buildMultiplicationWordProblem('mixed', decimal, fractionValue)
    : `${decimal} × ${n}/${d}`
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
  const prompt = shouldUseWordProblem(id, difficultyLevel)
    ? buildDivisionWordProblem('decimal', dividend, divisor)
    : `${dividend} ÷ ${divisor}`
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
  const prompt = shouldUseWordProblem(id, difficultyLevel)
    ? buildDivisionWordProblem('fraction', leftValue, rightValue)
    : `${n1}/${d1} ÷ ${n2}/${d2}`
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
  const prompt = shouldUseWordProblem(id, difficultyLevel)
    ? buildDivisionWordProblem('percentage', dividend, percent / 100)
    : `${dividend} ÷ ${percent}%`
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
  const prompt = shouldUseWordProblem(id, difficultyLevel)
    ? buildDivisionWordProblem('mixed', dividend, roundTo(divisor, 4))
    : `${dividend} ÷ ${n}/${d}`
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
