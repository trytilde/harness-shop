#!/usr/bin/env node
// One-off helper that drives the running dev server with Playwright and
// writes README screenshots to docs/screenshots/. Run after `make dev`:
//   node scripts/capture-screenshots.mjs

import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.HARNESS_BASE_URL ?? 'http://localhost:3100'
const OUT = resolve('docs/screenshots')
mkdirSync(OUT, { recursive: true })

const shoot = async (page, name) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  // small settle delay so layout transitions/animations finish
  await page.waitForTimeout(400)
  const path = resolve(OUT, `${name}.png`)
  await page.screenshot({ path, fullPage: false })
  console.log('saved', path)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()

try {
  // 1. Home
  await page.goto(BASE)
  await shoot(page, '01-home')

  // 2. Settings dialog
  await page.getByRole('button', { name: /settings/i }).first().click()
  await page.waitForTimeout(300)
  await shoot(page, '02-settings')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 3. Create-experiment dialog (only renders if connections gate is satisfied;
  //    if not, fall back to the connect gate)
  const createBtn = page.getByRole('button', { name: /create experiment/i }).first()
  if (await createBtn.count()) {
    await createBtn.click()
    await page.waitForTimeout(500)
    await shoot(page, '03-create-experiment')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }

  // 4. Existing experiment — pick the most recent row in the table.
  await page.goto(BASE)
  await page.waitForTimeout(400)
  const firstRow = page.locator('table tbody tr').first()
  if (await firstRow.count()) {
    await firstRow.click()
    await page.waitForTimeout(1500)
    await shoot(page, '04-experiment-chat')

    // Switch to Diffs tab
    const diffsTab = page.getByRole('button', { name: /^diffs$/i }).first()
    if (await diffsTab.count()) {
      await diffsTab.click()
      await page.waitForTimeout(1200)
      await shoot(page, '05-experiment-diffs')
    }

    // Switch to Runs tab
    const runsTab = page.getByRole('button', { name: /^runs$/i }).first()
    if (await runsTab.count()) {
      await runsTab.click()
      await page.waitForTimeout(800)
      await shoot(page, '06-experiment-runs')
    }
  }
} finally {
  await browser.close()
}
console.log('Screenshots ->', OUT)
