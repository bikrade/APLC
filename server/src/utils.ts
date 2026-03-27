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

function clampDivisionDifficultyLevel(level: number): number {
  return Math.min(5, Math.max(1, Math.round(level)))
}

function clampMultiplicationDifficultyLevel(level: number): number {
  return Math.min(7, Math.max(1, Math.round(level)))
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function parseQuestionNumber(id: string): number {
  const match = id.match(/q-(\d+)/i)
  return match ? Number(match[1]) : 1
}

type TemplateBuilder = (values: {
  a?: number
  b?: number
  dividend?: number
  divisor?: number
  percent?: number
  base?: number
  left?: string
  right?: string
  fraction?: string
  decimal?: number
}) => string

type PromptTemplate = {
  id: string
  build: TemplateBuilder
}

function hashStringToUint32(input: string): number {
  // FNV-1a 32-bit
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function pickTemplate(
  templates: PromptTemplate[],
  rng: () => number,
  recent: string[],
  windowSize = 30,
): PromptTemplate {
  if (templates.length === 0) {
    return { id: 'fallback', build: ({ a = 0, b = 0 }) => `${a} × ${b}` }
  }

  const window = recent.slice(-windowSize)
  const candidates = templates.filter((t) => !window.includes(t.id))
  const pool = candidates.length >= 1 ? candidates : templates
  const idx = Math.floor(rng() * pool.length)
  return pool[idx] ?? pool[0]!
}

export type QuestionGenerationContext = {
  sessionId?: string
  recentTemplateIds?: string[]
}

function getGenerationRngSeed(context: QuestionGenerationContext | undefined, subject: Subject, id: string, type: QuestionType): string {
  // Use sessionId when available so in-progress sessions have stable variety
  // (and can also avoid repeating templates across different question types).
  const sessionSeed = context?.sessionId ? `session:${context.sessionId}` : 'no-session'
  return `${sessionSeed}:${subject}:${type}:${id}`
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundTo(value, 2))
}

function formatFraction(numerator: number, denominator: number): string {
  return `${numerator}/${denominator}`
}

const MULTIPLICATION_DECIMAL_TEMPLATES: PromptTemplate[] = [
  { id: 'mul.dec.eq.1', build: ({ a = 0, b = 0 }) => `${a} × ${b}` },
  { id: 'mul.dec.eq.2', build: ({ a = 0, b = 0 }) => `Compute ${a} × ${b}.` },
  { id: 'mul.dec.science.samples', build: ({ a = 0, b = 0 }) => `Each science sample weighs ${formatNumber(a)} grams. Adi prepares ${formatNumber(b)} samples. What is the total mass?` },
  { id: 'mul.dec.art.paint', build: ({ a = 0, b = 0 }) => `A paint mix uses ${formatNumber(a)} liters per mural panel. Adi paints ${formatNumber(b)} panels. How many liters does he use?` },
  { id: 'mul.dec.smoothie.scale', build: ({ a = 0, b = 0 }) => `A smoothie recipe uses ${formatNumber(a)} cups of yogurt per batch. Adi makes ${formatNumber(b)} batches. How many cups are needed?` },
  { id: 'mul.dec.running.laps', build: ({ a = 0, b = 0 }) => `Adi runs ${formatNumber(a)} kilometers per lap. He runs ${formatNumber(b)} laps. What total distance does he run?` },
  { id: 'mul.dec.area.model', build: ({ a = 0, b = 0 }) => `Adi models ${a} × ${b} with an area model. What product should he get?` },
  { id: 'mul.dec.shipping.weight', build: ({ a = 0, b = 0 }) => `A package weighs ${formatNumber(a)} kg. Adi ships ${formatNumber(b)} identical packages. What is the total weight?` },
  { id: 'mul.dec.music.practice', build: ({ a = 0, b = 0 }) => `Adi practices for ${formatNumber(a)} hours each week. How many hours is that over ${formatNumber(b)} weeks?` },
  { id: 'mul.dec.battery.charge', build: ({ a = 0, b = 0 }) => `A gadget uses ${formatNumber(a)} watts. If it runs for ${formatNumber(b)} hours, how many watt-hours does it use?` },
  { id: 'mul.dec.craft.kits', build: ({ a = 0, b = 0 }) => `Each craft kit costs $${formatNumber(a)}. Adi buys ${formatNumber(b)} kits. What is the total cost?` },
  { id: 'mul.dec.measurement.repeat', build: ({ a = 0, b = 0 }) => `A lab reading is ${formatNumber(a)} cm. Adi repeats the measurement ${formatNumber(b)} times. What is the combined length?` },
]

const MULTIPLICATION_FRACTION_TEMPLATES: PromptTemplate[] = [
  { id: 'mul.fr.eq.1', build: ({ left = '', right = '' }) => `${left} × ${right}` },
  { id: 'mul.fr.eq.2', build: ({ left = '', right = '' }) => `Compute ${left} × ${right}. Give a decimal if needed.` },
  { id: 'mul.fr.of.of', build: ({ left = '', right = '' }) => `Adi takes ${left} of ${right} of a meter of ribbon. How many meters is that (as a decimal)?` },
  { id: 'mul.fr.recipe', build: ({ left = '', right = '' }) => `A recipe uses ${left} cup of sauce per mini batch. Adi makes ${right} of a mini batch. How many cups of sauce are needed?` },
  { id: 'mul.fr.design.paint', build: ({ left = '', right = '' }) => `${left} of a poster is colored blue. Then ${right} of that blue part gets patterns. What decimal part of the whole poster has patterns?` },
  { id: 'mul.fr.music', build: ({ left = '', right = '' }) => `Adi plays music for ${left} hour each practice block. He completes ${right} of the planned blocks. How many hours does he practice?` },
  { id: 'mul.fr.map', build: ({ left = '', right = '' }) => `A map shows ${right} of a trail. Adi walks ${left} of what the map shows. What decimal part of the whole trail does he walk?` },
  { id: 'mul.fr.area', build: ({ left = '', right = '' }) => `A garden is ${left} of a hectare. A new section is ${right} of the garden. What decimal fraction of a hectare is the new section?` },
  { id: 'mul.fr.sports', build: ({ left = '', right = '' }) => `Adi completes ${left} of his workout, and each workout is ${right} of an hour. How many hours does he work out?` },
  { id: 'mul.fr.reasoning', build: ({ left = '', right = '' }) => `Adi says multiplying makes sense for “${left} of ${right}”. What decimal answer should he get?` },
]

const MULTIPLICATION_PERCENT_TEMPLATES: PromptTemplate[] = [
  { id: 'mul.pct.eq.1', build: ({ percent = 0, base = 0 }) => `${percent}% of ${base}` },
  { id: 'mul.pct.eq.2', build: ({ percent = 0, base = 0 }) => `Find ${percent}% of ${base}.` },
  { id: 'mul.pct.discount', build: ({ percent = 0, base = 0 }) => `A game costs ${base} points. A coupon covers ${percent}% of the cost. How many points does the coupon cover?` },
  { id: 'mul.pct.reading.pages', build: ({ percent = 0, base = 0 }) => `During a reading challenge, Adi completes ${percent}% of a ${base}-page goal. How many pages is that?` },
  { id: 'mul.pct.test.section', build: ({ percent = 0, base = 0 }) => `A test has ${base} points. The calculator-free section is ${percent}% of the points. How many points is that section worth?` },
  { id: 'mul.pct_sports', build: ({ percent = 0, base = 0 }) => `Adi made ${percent}% of ${base} practice shots. How many shots did he make?` },
  { id: 'mul.pct_battery', build: ({ percent = 0, base = 0 }) => `A battery is at ${percent}% of ${base} mAh. How many mAh is that?` },
  { id: 'mul.pct_budget', build: ({ percent = 0, base = 0 }) => `Adi saves ${percent}% of ${base} dollars. How many dollars does he save?` },
  { id: 'mul.pct_distance', build: ({ percent = 0, base = 0 }) => `Adi has walked ${percent}% of a ${base}-meter route. How many meters has he walked?` },
  { id: 'mul.pct_error_check', build: ({ percent = 0, base = 0 }) => `Adi converts ${percent}% to a decimal and multiplies by ${base}. What result should he get?` },
]

const MULTIPLICATION_MIXED_TEMPLATES: PromptTemplate[] = [
  { id: 'mul.mix.eq.1', build: ({ decimal = 0, fraction = '' }) => `${decimal} × ${fraction}` },
  { id: 'mul.mix.eq.2', build: ({ decimal = 0, fraction = '' }) => `Compute ${decimal} × ${fraction}. Give a decimal.` },
  { id: 'mul.mix.scale_drawing', build: ({ decimal = 0, fraction = '' }) => `A scale drawing shows ${fraction} of the real width. The real width is ${formatNumber(decimal)} meters. What width does the drawing show?` },
  { id: 'mul.mix_snack_packs', build: ({ decimal = 0, fraction = '' }) => `Each snack pack weighs ${formatNumber(decimal)} kg. Adi packs ${fraction} of the full set. What is the total weight?` },
  { id: 'mul.mix_time', build: ({ decimal = 0, fraction = '' }) => `Adi reads for ${formatNumber(decimal)} hours per day. He reads for ${fraction} of the week. How many hours does he read?` },
  { id: 'mul.mix_measure', build: ({ decimal = 0, fraction = '' }) => `A board is ${formatNumber(decimal)} meters long. Adi uses ${fraction} of it. How many meters does he use?` },
  { id: 'mul.mix_ratio', build: ({ decimal = 0, fraction = '' }) => `A recipe is scaled by ${fraction}, and one batch needs ${formatNumber(decimal)} cups of flour. How many cups are needed after scaling?` },
  { id: 'mul.mix_area', build: ({ decimal = 0, fraction = '' }) => `A rectangle’s base is ${formatNumber(decimal)} cm and the height is ${fraction} of a cm. What is the area in square cm (as a decimal)?` },
  { id: 'mul.mix_reasoning', build: ({ decimal = 0, fraction = '' }) => `Adi checks whether ${formatNumber(decimal)} × ${fraction} makes sense. What decimal answer should he write?` },
  { id: 'mul.mix_budget', build: ({ decimal = 0, fraction = '' }) => `A ticket costs $${formatNumber(decimal)}. Adi pays ${fraction} of the ticket price now. How many dollars does he pay?` },
]

const DIVISION_DECIMAL_TEMPLATES: PromptTemplate[] = [
  { id: 'div.dec.eq.1', build: ({ dividend = 0, divisor = 0 }) => `${dividend} ÷ ${divisor}` },
  { id: 'div.dec.eq.2', build: ({ dividend = 0, divisor = 0 }) => `Compute ${dividend} ÷ ${divisor}.` },
  { id: 'div.dec.juice', build: ({ dividend = 0, divisor = 0 }) => `Adi has ${formatNumber(dividend)} liters of juice. Each cup holds ${formatNumber(divisor)} liters. How many cups can he fill?` },
  { id: 'div.dec.containers', build: ({ dividend = 0, divisor = 0 }) => `A lab has ${formatNumber(dividend)} liters to pour into containers of ${formatNumber(divisor)} liters each. How many containers are filled?` },
  { id: 'div.dec.distance', build: ({ dividend = 0, divisor = 0 }) => `Adi travels ${formatNumber(dividend)} km in ${formatNumber(divisor)} hours at a steady rate. What is the km per hour?` },
  { id: 'div.dec.money', build: ({ dividend = 0, divisor = 0 }) => `Adi splits $${formatNumber(dividend)} equally among ${formatNumber(divisor)} friends. How much does each friend get?` },
  { id: 'div.dec.parts', build: ({ dividend = 0, divisor = 0 }) => `A wire is ${formatNumber(dividend)} meters long. Each piece is ${formatNumber(divisor)} meters. How many pieces can Adi cut?` },
  { id: 'div.dec.check', build: ({ dividend = 0, divisor = 0 }) => `Adi checks ${dividend} ÷ ${divisor} by multiplying. What quotient should he get?` },
  { id: 'div.dec.rate_table', build: ({ dividend = 0, divisor = 0 }) => `A ratio table shows ${formatNumber(dividend)} liters shared into groups of ${formatNumber(divisor)} liters. How many groups is that?` },
  { id: 'div.dec_speed', build: ({ dividend = 0, divisor = 0 }) => `A video is ${formatNumber(dividend)} minutes. Adi watches it at ${formatNumber(divisor)}× speed. How many minutes does it take?` },
]

const DIVISION_FRACTION_TEMPLATES: PromptTemplate[] = [
  { id: 'div.fr.eq.1', build: ({ left = '', right = '' }) => `${left} ÷ ${right}` },
  { id: 'div.fr.eq.2', build: ({ left = '', right = '' }) => `Compute ${left} ÷ ${right}. Give a decimal if needed.` },
  { id: 'div.fr.ribbon', build: ({ left = '', right = '' }) => `A ribbon is ${left} meter long. Adi cuts pieces of ${right} meter. How many pieces can he make?` },
  { id: 'div.fr.recipe', build: ({ left = '', right = '' }) => `Adi has ${left} cup of sauce and uses ${right} cup per wrap. How many wraps can he make?` },
  { id: 'div.fr_reciprocal', build: ({ left = '', right = '' }) => `Adi rewrites ${left} ÷ ${right} as multiplying by the reciprocal. What decimal answer does he get?` },
  { id: 'div.fr_distance', build: ({ left = '', right = '' }) => `A hike is ${left} km. Each stage is ${right} km. How many stages is the hike?` },
  { id: 'div.fr_time', build: ({ left = '', right = '' }) => `A project takes ${left} hour total. Each mini-task takes ${right} hour. How many mini-tasks fit?` },
  { id: 'div.fr_storage', build: ({ left = '', right = '' }) => `A tank holds ${left} liters. Each bottle holds ${right} liters. How many bottles can be filled?` },
  { id: 'div.fr_unit_rate', build: ({ left = '', right = '' }) => `If Adi walks ${left} km in ${right} hour, what is the km per hour?` },
  { id: 'div.fr_reasoning', build: ({ left = '', right = '' }) => `Adi wants to be sure he set up the operation right: ${left} ÷ ${right}. What quotient should he get?` },
]

const DIVISION_PERCENT_TEMPLATES: PromptTemplate[] = [
  { id: 'div.pct.eq.1', build: ({ dividend = 0, percent = 0 }) => `${dividend} ÷ ${percent}%` },
  { id: 'div.pct.eq.2', build: ({ dividend = 0, percent = 0 }) => `If ${dividend} is ${percent}% of the total, what is the total?` },
  { id: 'div.pct_score', build: ({ dividend = 0, percent = 0 }) => `Adi scored ${dividend} points, which is ${percent}% of the full marks. What were the full marks?` },
  { id: 'div.pct_budget', build: ({ dividend = 0, percent = 0 }) => `Adi spent ${dividend} dollars, which is ${percent}% of his budget. What is his full budget?` },
  { id: 'div.pct_progress', build: ({ dividend = 0, percent = 0 }) => `Adi has finished ${dividend} pages, which is ${percent}% of a book. How many pages are in the book?` },
  { id: 'div.pct_distance', build: ({ dividend = 0, percent = 0 }) => `Adi ran ${dividend} km, which is ${percent}% of his weekly goal. What is the full weekly goal?` },
  { id: 'div.pct_science', build: ({ dividend = 0, percent = 0 }) => `${dividend} grams is ${percent}% of a sample’s mass. What is the full mass?` },
  { id: 'div.pct_reasoning', build: ({ dividend = 0, percent = 0 }) => `Adi divides by ${percent}% by dividing by ${percent / 100}. What full amount matches ${dividend} ÷ ${percent}%?` },
  { id: 'div.pct_points', build: ({ dividend = 0, percent = 0 }) => `Adi earned ${dividend} badges, which is ${percent}% of the badges available. How many badges are available?` },
  { id: 'div.pct_time', build: ({ dividend = 0, percent = 0 }) => `${dividend} minutes is ${percent}% of the full video. How long is the full video?` },
]

const DIVISION_MIXED_TEMPLATES: PromptTemplate[] = [
  { id: 'div.mix.eq.1', build: ({ dividend = 0, fraction = '' }) => `${dividend} ÷ ${fraction}` },
  { id: 'div.mix.eq.2', build: ({ dividend = 0, fraction = '' }) => `Compute ${formatNumber(dividend)} ÷ ${fraction}.` },
  { id: 'div.mix_trailmix', build: ({ dividend = 0, fraction = '' }) => `Adi has ${formatNumber(dividend)} kg of trail mix. Each bag holds ${fraction} kg. How many bags can he fill?` },
  { id: 'div.mix_paint', build: ({ dividend = 0, fraction = '' }) => `A paint tank has ${formatNumber(dividend)} liters. Each bottle is ${fraction} liter. How many bottles can be filled?` },
  { id: 'div.mix_time', build: ({ dividend = 0, fraction = '' }) => `Adi has ${formatNumber(dividend)} hours. Each task takes ${fraction} hour. How many tasks fit?` },
  { id: 'div.mix_distance', build: ({ dividend = 0, fraction = '' }) => `A route is ${formatNumber(dividend)} km. Each segment is ${fraction} km. How many segments are there?` },
  { id: 'div.mix_reciprocal', build: ({ dividend = 0, fraction = '' }) => `Adi changes ÷ ${fraction} into × (reciprocal). What quotient is ${formatNumber(dividend)} ÷ ${fraction}?` },
  { id: 'div.mix_shipping', build: ({ dividend = 0, fraction = '' }) => `A crate holds ${formatNumber(dividend)} kg. Each box is ${fraction} kg. How many boxes can be packed?` },
  { id: 'div.mix_measure', build: ({ dividend = 0, fraction = '' }) => `A rope is ${formatNumber(dividend)} meters. Each piece is ${fraction} meter. How many pieces can Adi cut?` },
  { id: 'div.mix_reasoning', build: ({ dividend = 0, fraction = '' }) => `Adi checks by reciprocal: ${formatNumber(dividend)} ÷ ${fraction}. What quotient should he get?` },
]

function buildMultiplicationDecimalQuestion(id: string, difficultyLevel: number): Question {
  const questionNumber = parseQuestionNumber(id)
  const level = clampMultiplicationDifficultyLevel(difficultyLevel)
  const places = level >= 6 ? 3 : level >= 4 ? 2 : 1
  const rangeMap: Record<number, { min: number; max: number }> = {
    1: { min: 10, max: 35 },
    2: { min: 18, max: 50 },
    3: { min: 25, max: 70 },
    4: { min: 35, max: 95 },
    5: { min: 55, max: 140 },
    6: { min: 80, max: 220 },
    7: { min: 120, max: 320 },
  }
  const ranges = rangeMap[level] ?? { min: 25, max: 70 }
  const a = roundTo(randomInt(ranges.min, ranges.max) / 10, places)
  const b = roundTo(randomInt(ranges.min, ranges.max) / 10, places)
  const answer = roundTo(a * b)
  const rng = mulberry32(hashStringToUint32(`mul:decimal:${difficultyLevel}:${questionNumber}:${a}:${b}`))
  const template = pickTemplate(MULTIPLICATION_DECIMAL_TEMPLATES, rng, [])
  const prompt = template.build({ a, b })
  return {
    id,
    prompt,
    type: 'decimal',
    templateId: template.id,
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

function buildMultiplicationFractionQuestion(id: string, difficultyLevel: number, context?: QuestionGenerationContext): Question {
  const level = clampMultiplicationDifficultyLevel(difficultyLevel)
  const pairPool = getFractionPairsForLevel(level)
  const pair = pairPool[Math.floor(Math.random() * pairPool.length)] ?? [1, 2, 1, 2]
  const [n1, d1, n2, d2] = pair
  const factorOne = roundTo(n1 / d1, 4)
  const factorTwo = roundTo(n2 / d2, 4)
  const answer = roundTo(factorOne * factorTwo)
  const left = formatFraction(n1, d1)
  const right = formatFraction(n2, d2)
  const seed = getGenerationRngSeed(context, 'Multiplication', id, 'fraction')
  const rng = mulberry32(hashStringToUint32(`${seed}:${difficultyLevel}:${left}:${right}`))
  const template = pickTemplate(MULTIPLICATION_FRACTION_TEMPLATES, rng, context?.recentTemplateIds ?? [])
  const prompt = template.build({ left, right })
  return {
    id,
    prompt,
    type: 'fraction',
    templateId: template.id,
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

function buildMultiplicationPercentageQuestion(id: string, difficultyLevel: number, context?: QuestionGenerationContext): Question {
  const level = clampMultiplicationDifficultyLevel(difficultyLevel)
  const percentChoices = level <= 2
    ? [10, 20, 25, 50]
    : level === 3
      ? [10, 20, 25, 30, 40, 50, 60, 75]
      : level <= 5
        ? [12, 15, 18, 24, 35, 45, 65, 75]
        : [7, 12, 15, 17, 18, 22, 24, 27, 35, 45, 62, 68, 75, 88]
  const percent = percentChoices[Math.floor(Math.random() * percentChoices.length)] ?? 25
  const base = level <= 2
    ? randomInt(5, 18) * 5
    : level === 3
      ? randomInt(7, 24) * 5
      : level <= 5
        ? randomInt(12, 40) * 3
        : randomInt(25, 120) * 2
  const answer = roundTo((percent / 100) * base)
  const seed = getGenerationRngSeed(context, 'Multiplication', id, 'percentage')
  const rng = mulberry32(hashStringToUint32(`${seed}:${difficultyLevel}:${percent}:${base}`))
  const template = pickTemplate(MULTIPLICATION_PERCENT_TEMPLATES, rng, context?.recentTemplateIds ?? [])
  const prompt = template.build({ percent, base })
  return {
    id,
    prompt,
    type: 'percentage',
    templateId: template.id,
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

function buildMultiplicationMixedQuestion(id: string, difficultyLevel: number, context?: QuestionGenerationContext): Question {
  const level = clampMultiplicationDifficultyLevel(difficultyLevel)
  const decimalPlaces = level >= 6 ? 2 : level >= 4 ? 2 : 1
  const decimal = roundTo(randomInt(level <= 2 ? 18 : 24, level >= 6 ? 180 : level >= 4 ? 110 : 80) / 10, decimalPlaces)
  const n = randomInt(1 + (level >= 4 ? 1 : 0), level >= 6 ? 12 : level >= 4 ? 8 : 5)
  const d = randomInt(level <= 2 ? 2 : 3, level >= 6 ? 14 : level >= 4 ? 10 : 6)
  const fractionValue = roundTo(n / d, 4)
  const answer = roundTo(decimal * fractionValue)
  const fraction = formatFraction(n, d)
  const seed = getGenerationRngSeed(context, 'Multiplication', id, 'mixed')
  const rng = mulberry32(hashStringToUint32(`${seed}:${difficultyLevel}:${decimal}:${fraction}`))
  const template = pickTemplate(MULTIPLICATION_MIXED_TEMPLATES, rng, context?.recentTemplateIds ?? [])
  const prompt = template.build({ decimal, fraction })
  return {
    id,
    prompt,
    type: 'mixed',
    templateId: template.id,
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

function buildDivisionDecimalQuestion(id: string, difficultyLevel: number, context?: QuestionGenerationContext): Question {
  const level = clampDivisionDifficultyLevel(difficultyLevel)
  const places = level >= 4 ? 2 : 1
  const divisor = roundTo(randomInt(level <= 2 ? 10 : 15, level >= 4 ? 80 : 60) / 10, places)
  const quotient = roundTo(randomInt(level <= 2 ? 12 : 18, level >= 4 ? 100 : 70) / 10, places)
  const dividend = roundTo(divisor * quotient, 2)
  const seed = getGenerationRngSeed(context, 'Division', id, 'decimal')
  const rng = mulberry32(hashStringToUint32(`${seed}:${difficultyLevel}:${dividend}:${divisor}`))
  const template = pickTemplate(DIVISION_DECIMAL_TEMPLATES, rng, context?.recentTemplateIds ?? [])
  const prompt = template.build({ dividend, divisor })
  return {
    id,
    prompt,
    type: 'decimal',
    templateId: template.id,
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

function buildDivisionFractionQuestion(id: string, difficultyLevel: number, context?: QuestionGenerationContext): Question {
  const pairPool = getFractionPairsForLevel(clampDivisionDifficultyLevel(difficultyLevel))
  const pair = pairPool[Math.floor(Math.random() * pairPool.length)] ?? [1, 2, 1, 2]
  const [n1, d1, n2, d2] = pair
  const leftValue = roundTo(n1 / d1, 4)
  const rightValue = roundTo(n2 / d2, 4)
  const answer = roundTo(leftValue / rightValue)
  const left = formatFraction(n1, d1)
  const right = formatFraction(n2, d2)
  const seed = getGenerationRngSeed(context, 'Division', id, 'fraction')
  const rng = mulberry32(hashStringToUint32(`${seed}:${difficultyLevel}:${left}:${right}`))
  const template = pickTemplate(DIVISION_FRACTION_TEMPLATES, rng, context?.recentTemplateIds ?? [])
  const prompt = template.build({ left, right })
  return {
    id,
    prompt,
    type: 'fraction',
    templateId: template.id,
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

function buildDivisionPercentageQuestion(id: string, difficultyLevel: number, context?: QuestionGenerationContext): Question {
  const level = clampDivisionDifficultyLevel(difficultyLevel)
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
  const seed = getGenerationRngSeed(context, 'Division', id, 'percentage')
  const rng = mulberry32(hashStringToUint32(`${seed}:${difficultyLevel}:${dividend}:${percent}`))
  const template = pickTemplate(DIVISION_PERCENT_TEMPLATES, rng, context?.recentTemplateIds ?? [])
  const prompt = template.build({ dividend, percent })
  return {
    id,
    prompt,
    type: 'percentage',
    templateId: template.id,
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

function buildDivisionMixedQuestion(id: string, difficultyLevel: number, context?: QuestionGenerationContext): Question {
  const level = clampDivisionDifficultyLevel(difficultyLevel)
  const quotient = roundTo(randomInt(level <= 2 ? 12 : 18, level >= 4 ? 95 : 70) / 10, level >= 4 ? 2 : 1)
  const n = randomInt(level <= 2 ? 1 : 2, level >= 4 ? 8 : 5)
  const d = randomInt(level <= 2 ? 2 : 3, level >= 4 ? 10 : 6)
  const divisor = n / d
  const dividend = roundTo(quotient * divisor, 3)
  const fraction = formatFraction(n, d)
  const seed = getGenerationRngSeed(context, 'Division', id, 'mixed')
  const rng = mulberry32(hashStringToUint32(`${seed}:${difficultyLevel}:${dividend}:${fraction}`))
  const template = pickTemplate(DIVISION_MIXED_TEMPLATES, rng, context?.recentTemplateIds ?? [])
  const prompt = template.build({ dividend, fraction })
  return {
    id,
    prompt,
    type: 'mixed',
    templateId: template.id,
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

function buildQuestion(
  id: string,
  type: QuestionType,
  subject: Subject,
  difficultyLevel = 3,
  context?: QuestionGenerationContext,
): Question {
  if (subject === 'Reading') {
    throw new Error('Reading questions are generated at the session level.')
  }

  if (subject === 'Division') {
    if (type === 'decimal') return buildDivisionDecimalQuestion(id, difficultyLevel, context)
    if (type === 'fraction') return buildDivisionFractionQuestion(id, difficultyLevel, context)
    if (type === 'percentage') return buildDivisionPercentageQuestion(id, difficultyLevel, context)
    return buildDivisionMixedQuestion(id, difficultyLevel, context)
  }

  if (type === 'decimal') return buildMultiplicationDecimalQuestion(id, difficultyLevel)
  if (type === 'fraction') return buildMultiplicationFractionQuestion(id, difficultyLevel, context)
  if (type === 'percentage') return buildMultiplicationPercentageQuestion(id, difficultyLevel, context)
  return buildMultiplicationMixedQuestion(id, difficultyLevel, context)
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

export function generateQuestionByType(
  id: string,
  type: QuestionType,
  subject: Subject,
  difficultyLevel = 3,
  context?: QuestionGenerationContext,
): Question {
  return {
    ...buildQuestion(id, type, subject, difficultyLevel, context),
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
