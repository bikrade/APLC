import { expect, test } from '@playwright/test'

async function enterLocalApp(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByText('SELECT STUDENT')).toBeVisible()
  await page.getByRole('button', { name: /let's learn/i }).click()
  await expect(page.getByText('Choose a Subject')).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test('multiplication wrong-answer flow shows retry', async ({ page }) => {
  await enterLocalApp(page)

  const multiplicationCard = page.locator('.subject-card').filter({ hasText: 'Multiplication' })
  await multiplicationCard.getByRole('button', { name: /start session/i }).click()

  await expect(page.getByText(/Question 1 of 12/i)).toBeVisible()
  await page.getByPlaceholder(/e\.g\. 0\.6 or 3\/5/i).fill('9999')
  await page.getByRole('button', { name: /check answer/i }).click()

  await expect(page.getByText(/Not quite right/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /move on/i })).toBeVisible()

  await page.getByRole('button', { name: /retry/i }).click()
  await expect(page.getByRole('button', { name: /retry/i })).toBeHidden()
})

test('division session launches in the same shared wizard shell', async ({ page }) => {
  await enterLocalApp(page)

  const divisionCard = page.locator('.subject-card').filter({ hasText: 'Division' })
  await divisionCard.getByRole('button', { name: /start session/i }).click()

  await expect(page.getByText(/Question 1 of 12/i)).toBeVisible()
  await expect(page.locator('.question-prompt')).toContainText('÷')
  await expect(page.getByText(/Time/i)).toBeVisible()
})

test('reading flow advances pages and ends on the reading summary report', async ({ page }) => {
  await enterLocalApp(page)

  const readingCard = page.locator('.subject-card').filter({ hasText: 'Reading' })
  await readingCard.getByRole('button', { name: /start session/i }).click()

  await expect(page.getByText(/Question 1 of 6/i)).toBeVisible()

  for (let pageIndex = 1; pageIndex <= 5; pageIndex += 1) {
    await page.getByRole('button', { name: /next page/i }).click()
    await expect(page.getByText(/Awesome, keep reading\./i)).toBeVisible()
    if (pageIndex < 5) {
      await expect(page.getByText(new RegExp(`Question ${pageIndex + 1} of 6`, 'i'))).toBeVisible()
    }
  }

  await expect(page.getByText(/Question 6 of 6/i)).toBeVisible()
  await page.getByRole('textbox').fill(
    'Mira and Dev restored the Monsoon Clock, studied the notebooks and patterns, and helped the town act early before the storm flooded the market. The story shows that reading carefully, noticing patterns, and working together can protect the whole community.',
  )
  await page.getByRole('button', { name: /submit summary/i }).click()

  await expect(page.getByText(/Reading Session Complete!/i)).toBeVisible()
  await expect(page.getByText(/Average WPM/i)).toBeVisible()
  await expect(page.getByText(/Target reading pace is 120-140 WPM\./i)).toBeVisible()
  await expect(page.getByText(/Overall Reading/i)).toBeVisible()
})
