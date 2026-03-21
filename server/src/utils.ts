import type { Question, QuestionType, Subject } from './types'
import { createReadingQuestion } from './reading'

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

function buildMultiplicationDecimalQuestion(id: string): Question {
  const a = roundTo((Math.floor(Math.random() * 70) + 10) / 10, 1)
  const b = roundTo((Math.floor(Math.random() * 70) + 10) / 10, 1)
  const answer = roundTo(a * b)
  return {
    id,
    prompt: `${a} × ${b}`,
    type: 'decimal',
    answer,
    tolerance: 0.01,
    helpSteps: [
      `Ignore decimals first: ${a * 10} × ${b * 10}`,
      'Multiply as whole numbers.',
      'Add decimal places back to the final answer.',
    ],
    explanation: `Multiply ${a} and ${b} to get ${answer}.`,
  }
}

function buildMultiplicationFractionQuestion(id: string): Question {
  const pair = FRACTION_PAIRS[Math.floor(Math.random() * FRACTION_PAIRS.length)] ?? [1, 2, 1, 2]
  const [n1, d1, n2, d2] = pair
  const answer = roundTo((n1 / d1) * (n2 / d2))
  return {
    id,
    prompt: `${n1}/${d1} × ${n2}/${d2}`,
    type: 'fraction',
    answer,
    tolerance: 0.01,
    helpSteps: [
      `Multiply numerators: ${n1} × ${n2}`,
      `Multiply denominators: ${d1} × ${d2}`,
      'Simplify if possible, then convert to decimal if needed.',
    ],
    explanation: `${n1}/${d1} × ${n2}/${d2} = ${answer}`,
  }
}

function buildMultiplicationPercentageQuestion(id: string): Question {
  const percent = (Math.floor(Math.random() * 8) + 2) * 10
  const base = (Math.floor(Math.random() * 16) + 5) * 5
  const answer = roundTo((percent / 100) * base)
  return {
    id,
    prompt: `${percent}% of ${base}`,
    type: 'percentage',
    answer,
    tolerance: 0.01,
    helpSteps: [
      `Convert percentage to decimal: ${percent}% = ${percent / 100}`,
      `Multiply ${percent / 100} × ${base}`,
      'Write the final product.',
    ],
    explanation: `${percent}% of ${base} = ${answer}.`,
  }
}

function buildMultiplicationMixedQuestion(id: string): Question {
  const decimal = roundTo((Math.floor(Math.random() * 60) + 20) / 10, 1)
  const n = Math.floor(Math.random() * 4) + 1
  const d = Math.floor(Math.random() * 4) + 2
  const answer = roundTo(decimal * (n / d))
  return {
    id,
    prompt: `${decimal} × ${n}/${d}`,
    type: 'mixed',
    answer,
    tolerance: 0.01,
    helpSteps: [
      `Convert ${n}/${d} to decimal: ${roundTo(n / d, 3)}`,
      `Multiply ${decimal} by ${roundTo(n / d, 3)}`,
      'Round reasonably if needed.',
    ],
    explanation: `${decimal} × ${n}/${d} = ${answer}.`,
  }
}

function buildDivisionDecimalQuestion(id: string): Question {
  const divisor = roundTo((Math.floor(Math.random() * 50) + 10) / 10, 1)
  const quotient = roundTo((Math.floor(Math.random() * 40) + 10) / 10, 1)
  const dividend = roundTo(divisor * quotient, 2)
  return {
    id,
    prompt: `${dividend} ÷ ${divisor}`,
    type: 'decimal',
    answer: quotient,
    tolerance: 0.01,
    helpSteps: [
      `Think of the matching multiplication fact: ${divisor} × ? = ${dividend}`,
      `Work out how many groups of ${divisor} fit into ${dividend}.`,
      'Place the decimal point carefully in the quotient.',
    ],
    explanation: `${dividend} ÷ ${divisor} = ${quotient}.`,
  }
}

function buildDivisionFractionQuestion(id: string): Question {
  const pair = FRACTION_PAIRS[Math.floor(Math.random() * FRACTION_PAIRS.length)] ?? [1, 2, 1, 2]
  const [n1, d1, n2, d2] = pair
  const answer = roundTo((n1 / d1) / (n2 / d2))
  return {
    id,
    prompt: `${n1}/${d1} ÷ ${n2}/${d2}`,
    type: 'fraction',
    answer,
    tolerance: 0.01,
    helpSteps: [
      `Keep ${n1}/${d1} the same.`,
      `Flip ${n2}/${d2} to ${d2}/${n2} and multiply.`,
      'Convert the result to a decimal if needed.',
    ],
    explanation: `${n1}/${d1} ÷ ${n2}/${d2} = ${answer}.`,
  }
}

function buildDivisionPercentageQuestion(id: string): Question {
  const percent = [10, 20, 25, 50][Math.floor(Math.random() * 4)] ?? 25
  const quotient = (Math.floor(Math.random() * 12) + 2) * 5
  const dividend = roundTo((percent / 100) * quotient)
  return {
    id,
    prompt: `${dividend} ÷ ${percent}%`,
    type: 'percentage',
    answer: quotient,
    tolerance: 0.01,
    helpSteps: [
      `Convert ${percent}% to a decimal: ${percent / 100}.`,
      `Think: ${dividend} ÷ ${percent / 100}.`,
      'Check by multiplying your answer by the decimal divisor.',
    ],
    explanation: `${dividend} ÷ ${percent}% = ${quotient}.`,
  }
}

function buildDivisionMixedQuestion(id: string): Question {
  const quotient = roundTo((Math.floor(Math.random() * 40) + 10) / 10, 1)
  const n = Math.floor(Math.random() * 4) + 1
  const d = Math.floor(Math.random() * 4) + 2
  const divisor = n / d
  const dividend = roundTo(quotient * divisor, 3)
  return {
    id,
    prompt: `${dividend} ÷ ${n}/${d}`,
    type: 'mixed',
    answer: quotient,
    tolerance: 0.01,
    helpSteps: [
      `Change ÷ ${n}/${d} into × ${d}/${n}.`,
      `Multiply ${dividend} by ${roundTo(d / n, 3)}.`,
      'Round reasonably if needed.',
    ],
    explanation: `${dividend} ÷ ${n}/${d} = ${quotient}.`,
  }
}

function buildQuestion(id: string, type: QuestionType, subject: Subject): Question {
  if (subject === 'Reading') {
    const questionIndex = Number(id.replace('q-', '')) - 1
    return createReadingQuestion(id, Math.max(0, questionIndex))
  }

  if (subject === 'Division') {
    if (type === 'decimal') return buildDivisionDecimalQuestion(id)
    if (type === 'fraction') return buildDivisionFractionQuestion(id)
    if (type === 'percentage') return buildDivisionPercentageQuestion(id)
    return buildDivisionMixedQuestion(id)
  }

  if (type === 'decimal') return buildMultiplicationDecimalQuestion(id)
  if (type === 'fraction') return buildMultiplicationFractionQuestion(id)
  if (type === 'percentage') return buildMultiplicationPercentageQuestion(id)
  return buildMultiplicationMixedQuestion(id)
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

export function generateQuestionByType(id: string, type: QuestionType, subject: Subject): Question {
  return {
    ...buildQuestion(id, type, subject),
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
