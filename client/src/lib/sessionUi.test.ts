import { describe, expect, it } from 'vitest'
import { formatMs, getAccuracyColor, getQuestionTypeBadge, renderMath } from './sessionUi'

describe('sessionUi helpers', () => {
  it('formats milliseconds as mm:ss', () => {
    expect(formatMs(0)).toBe('00:00')
    expect(formatMs(65_000)).toBe('01:05')
  })

  it('maps question badges', () => {
    expect(getQuestionTypeBadge('decimal')).toContain('Decimal')
    expect(getQuestionTypeBadge('reading_summary')).toContain('Summary')
    expect(getQuestionTypeBadge('custom')).toBe('custom')
  })

  it('returns color bands for accuracy', () => {
    expect(getAccuracyColor(85)).toBe('#58cc02')
    expect(getAccuracyColor(65)).toBe('#ffc800')
    expect(getAccuracyColor(40)).toBe('#ff4b4b')
  })

  it('renders inline math to HTML', () => {
    const rendered = renderMath('Solve \\(\\frac{1}{2} + \\frac{1}{4}\\)')
    expect(rendered).toContain('katex')
    expect(rendered).toContain('mfrac')
  })
})
