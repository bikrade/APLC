import { expect, test } from '@playwright/test'

async function enterLocalApp(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByText('SELECT STUDENT')).toBeVisible()
  await page.getByRole('button', { name: /let's learn/i }).click()
  await expect(page.getByText('Choose a Subject')).toBeVisible()
}

async function saveAndReturnHome(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: /save progress and go to home/i }).click()
  await page.getByRole('button', { name: /save & exit/i }).click()
  await expect(page.getByText('Choose a Subject')).toBeVisible()
}

async function startFreshGuidedSession(page: import('@playwright/test').Page, subject: 'Multiplication' | 'Division' | 'Reading') {
  const card = page.locator('.subject-card').filter({ hasText: subject })
  const resetButton = card.getByRole('button', { name: /reset and start fresh/i })
  if (await resetButton.isVisible()) {
    await resetButton.click()
  } else {
    await card.getByRole('button', { name: /^guided$/i }).click()
    await card.getByRole('button', { name: /start guided/i }).click()
  }
}

async function getSessionSignature(page: import('@playwright/test').Page, subject: 'Multiplication' | 'Division' | 'Reading'): Promise<string> {
  await expect(page.locator('.question-counter')).toContainText(subject === 'Reading' ? /Question 1 of 7/i : /Question 1 of 12/i)
  if (subject === 'Reading') {
    await expect(page.locator('.reading-page-title')).toBeVisible()
    await expect(page.locator('.reading-page-paragraph').first()).toBeVisible()
    const title = (await page.locator('.reading-page-title').innerText()).trim()
    const body = (await page.locator('.reading-page-paragraph').first().innerText()).trim()
    return `${title}|${body.slice(0, 180)}`
  }

  const prompt = (await page.locator('.question-prompt').innerText()).trim()
  expect(prompt.length).toBeGreaterThan(0)
  return prompt
}

test.describe.configure({ mode: 'serial' })

test('multiplication wrong-answer flow requires retry or reveal before continuing', async ({ page }) => {
  await enterLocalApp(page)

  const multiplicationCard = page.locator('.subject-card').filter({ hasText: 'Multiplication' })
  await multiplicationCard.getByRole('button', { name: /start guided/i }).click()

  await expect(page.getByText(/Question 1 of 12/i)).toBeVisible()
  await page.getByPlaceholder(/e\.g\. 0\.6 or 3\/5/i).fill('9999')
  await page.getByRole('button', { name: /check answer/i }).click()

  await expect(page.getByText(/Not quite right/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /see next question/i })).toBeHidden()

  await page.getByRole('button', { name: /retry/i }).click()
  await expect(page.getByRole('button', { name: /retry/i })).toBeHidden()

  await page.getByRole('button', { name: /^show$/i }).click()
  await expect(page.getByRole('button', { name: /see next question/i })).toBeVisible()
})

test('division quiz mode advances after an answer without showing right-or-wrong feedback', async ({ page }) => {
  await enterLocalApp(page)

  const divisionCard = page.locator('.subject-card').filter({ hasText: 'Division' })
  await divisionCard.getByRole('button', { name: /^quiz$/i }).click()
  await divisionCard.getByRole('button', { name: /start quiz/i }).click()

  await expect(page.getByText(/Question 1 of 12/i)).toBeVisible()
  await page.getByPlaceholder(/e\.g\. 0\.6 or 3\/5/i).fill('9999')
  await page.getByRole('button', { name: /submit & next/i }).click()

  await expect(page.getByText(/Question 2 of 12/i)).toBeVisible()
  await expect(page.getByText(/Not quite right/i)).toBeHidden()
  await expect(page.getByRole('button', { name: /retry/i })).toBeHidden()
})

test('division session launches in the same shared wizard shell', async ({ page }) => {
  await enterLocalApp(page)

  const divisionCard = page.locator('.subject-card').filter({ hasText: 'Division' })
  await divisionCard.getByRole('button', { name: /continue quiz/i }).click()

  await expect(page.locator('.question-counter')).toContainText(/Question [12] of 12/i)
  await expect(page.locator('.question-badge-row')).toContainText(/quiz/i)
  const promptText = (await page.locator('.question-prompt').innerText()).trim()
  expect(promptText.length).toBeGreaterThan(0)
  // Prompt may be either a numeric equation or a word problem template.
  expect(promptText.includes('÷') || promptText.includes('/')).toBeTruthy()
  await expect(page.getByText(/Time/i)).toBeVisible()
})

test('reading flow can switch fast readers into the quiz-based comprehension check', async ({ page }) => {
  await enterLocalApp(page)

  const readingCard = page.locator('.subject-card').filter({ hasText: 'Reading' })
  await readingCard.getByRole('button', { name: /start guided/i }).click()
  await expect(page.locator('.meta-story-source.ai')).toContainText(/Fresh AI story generated/i)
  await expect(page.locator('.session-warning-banner')).toHaveCount(0)

  await expect(page.getByText(/Question 1 of 7/i)).toBeVisible()

  for (let pageIndex = 1; pageIndex <= 5; pageIndex += 1) {
    await page.getByRole('button', { name: /next page/i }).click()
    await expect(page.getByText(new RegExp(`Question ${pageIndex + 1} of 7`, 'i'))).toBeVisible()
  }

  await page.getByRole('button', { name: /next page/i }).click()

  await expect(page.getByText(/Question 7 of 7/i)).toBeVisible()
  await expect(page.locator('.reading-page-title')).toContainText(/Comprehension Check/i)
  const quizItems = page.locator('.reading-quiz-item')
  const quizCount = await quizItems.count()
  for (let index = 0; index < quizCount; index += 1) {
    await quizItems.nth(index).locator('.reading-quiz-option').first().click()
  }
  await page.getByRole('button', { name: /submit quiz/i }).click()

  await expect(page.getByText(/Reading Session Complete!/i)).toBeVisible()
  await expect(page.getByText(/Average WPM/i)).toBeVisible()
  await expect(page.getByText(/Target reading pace is 130 WPM, and speed score is based on how close you were to that target\./i)).toBeVisible()
  await expect(page.getByText(/Overall Reading/i)).toBeVisible()
})

test('all subject cards generate fresh content for guided start and reset-and-fresh flows', async ({ page }) => {
  await enterLocalApp(page)

  for (const subject of ['Multiplication', 'Division', 'Reading'] as const) {
    await startFreshGuidedSession(page, subject)
    const firstSignature = await getSessionSignature(page, subject)
    await saveAndReturnHome(page)

    await startFreshGuidedSession(page, subject)
    const secondSignature = await getSessionSignature(page, subject)

    expect(secondSignature).not.toBe(firstSignature)
    await saveAndReturnHome(page)
  }
})
