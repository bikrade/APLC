import katex from 'katex'

export function renderMath(text: string): string {
  if (!text) return text

  let result = text.replace(/\\\[(.+?)\\\]|\$\$(.+?)\$\$/gs, (_match, p1, p2) => {
    const latex = (p1 ?? p2).trim()
    try {
      return katex.renderToString(latex, { displayMode: true, throwOnError: false })
    } catch {
      return latex
    }
  })

  result = result.replace(/\\\((.+?)\\\)|\$([^$\n]+?)\$/gs, (_match, p1, p2) => {
    const latex = (p1 ?? p2).trim()
    try {
      return katex.renderToString(latex, { displayMode: false, throwOnError: false })
    } catch {
      return latex
    }
  })

  return result
}

export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function getQuestionTypeBadge(type: string): string {
  const map: Record<string, string> = {
    decimal: '🔢 Decimal',
    fraction: '½ Fraction',
    percentage: '% Percentage',
    mixed: '🔀 Mixed',
    reading_page: '📄 Story Page',
    reading_summary: '📝 Summary',
    reading_quiz: '🧠 Quiz',
  }
  return map[type] ?? type
}

export function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 80) return '#58cc02'
  if (accuracy >= 60) return '#ffc800'
  return '#ff4b4b'
}
