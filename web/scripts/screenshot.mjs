// Скриншот страницы в headless Chromium (Playwright) для PR и README:
//   node scripts/screenshot.mjs "http://localhost:5173/#/pult" out.png 1280 720
import { chromium } from '@playwright/test'
const [url, out, w = '1280', h = '720'] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()))
await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)
await page.screenshot({ path: out })
await browser.close()
