import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('home screen has no serious accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('SELECT STUDENT')).toBeVisible()

  const accessibilityScanResults = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze()

  const seriousViolations = accessibilityScanResults.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  )

  expect(seriousViolations).toEqual([])
})
