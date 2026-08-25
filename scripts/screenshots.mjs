// Capture marketing screenshots for the README.
// Run via: node scripts/screenshots.mjs  (dev server must already be on :7790)

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

const VIEWPORT_DESKTOP = { width: 1440, height: 900 }
const VIEWPORT_MOBILE = { width: 390, height: 844 }
const VIEWPORT_TALL = { width: 1440, height: 1400 }   // landing + below-the-fold sections
const URL = 'http://localhost:7790'

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

async function setTheme(page, dark) {
  await page.evaluate((d) => {
    document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light')
  }, dark)
}

async function shot(page, name) {
  const path = join(OUT, name)
  await page.screenshot({ path, fullPage: false })
  console.log('  ✓', path)
}

async function fullPageShot(page, name) {
  const path = join(OUT, name)
  await page.screenshot({ path, fullPage: true })
  console.log('  ✓', path)
}

;(async () => {
  // Autoplay must be allowed so the playback shot can capture a real mid-play
  // state (Tone.start() otherwise refuses in headless and nothing highlights).
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ viewport: VIEWPORT_DESKTOP, deviceScaleFactor: 2 })
  const page = await context.newPage()

  // ─── 1. Landing — light theme, hero ─────────────────────────────
  console.log('Landing (light, hero)...')
  await page.goto(URL, { waitUntil: 'networkidle' })
  await setTheme(page, false)
  await delay(300)
  await shot(page, '01-landing-light.png')

  // ─── 2. Landing — dark theme, hero ──────────────────────────────
  console.log('Landing (dark, hero)...')
  await setTheme(page, true)
  await delay(300)
  await shot(page, '02-landing-dark.png')

  // ─── 3. Full landing — light, tall viewport to capture intro sections ──
  console.log('Landing (light, full page)...')
  await page.setViewportSize(VIEWPORT_TALL)
  await setTheme(page, false)
  await delay(300)
  await fullPageShot(page, '03-landing-full.png')

  // Back to desktop size
  await page.setViewportSize(VIEWPORT_DESKTOP)

  // ─── 4. Tool layer + sample score (light) ───────────────────────
  console.log('Tool + sample score (light)...')
  await setTheme(page, false)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const sample = btns.find(b => b.textContent?.includes('试试示例'))
    sample?.click()
  })
  await delay(1500)
  await shot(page, '04-tool-light.png')

  // ─── 5. Tool layer + sample score (dark) ────────────────────────
  console.log('Tool + sample score (dark)...')
  await setTheme(page, true)
  await delay(500)
  await shot(page, '05-tool-dark.png')

  // ─── 5b. Playback mid-play — highlighted note + progress underway ──
  // Captured while actually playing: the sounding note carries
  // .jn-note-playing and the progress bar has advanced, which shows the
  // feature far better than an idle transport strip would.
  console.log('Playback mid-play (light)...')
  await setTheme(page, false)
  await delay(300)
  {
    const playBtn = page.locator('button').filter({ hasText: /^▶$/ }).first()
    await playBtn.click()
    try {
      // Wait for playback to actually start (play() awaits the lazy Tone import)
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')].find(x => ['▶', '❙❙'].includes(x.textContent))
        return b && b.textContent === '❙❙'
      }, null, { timeout: 15000 })
      // Let it run a couple of beats so the highlight and progress are visibly underway
      await delay(2500)
      const painted = await page.evaluate(() => !!document.querySelector('.jn-note-playing'))
      if (!painted) console.warn('  ! no .jn-note-playing found — capturing anyway')
      await shot(page, '11-playback-light.png')
      // Stop so later shots start from a clean state
      await page.evaluate(() => {
        const stop = [...document.querySelectorAll('button')].find(b => b.textContent === '■' && !b.disabled)
        stop?.click()
      })
      await delay(300)
    } catch {
      console.warn('  ! playback did not start (audio blocked?) — skipping 11-playback-light.png')
    }
  }

  // ─── 6. Text editor with live preview + cursor sync ─────────────
  console.log('Text editor (dark)...')
  await page.evaluate(() => {
    // Open Route B by clicking the ≡ button in toolbar
    const btns = Array.from(document.querySelectorAll('button'))
    const editTextBtn = btns.find(b => b.title?.includes('文本') || b.getAttribute('aria-label')?.includes('文本'))
    editTextBtn?.click()
  })
  await delay(1000)
  await shot(page, '06-text-editor-dark.png')

  // Close text editor for next shots
  await page.keyboard.press('Escape')
  await delay(300)

  // ─── 7. Text editor with format drawer open ─────────────────────
  console.log('Text editor with format drawer (light)...')
  await setTheme(page, false)
  await delay(300)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const editTextBtn = btns.find(b => b.title?.includes('文本') || b.getAttribute('aria-label')?.includes('文本'))
    editTextBtn?.click()
  })
  await delay(500)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const formatBtn = btns.find(b => b.textContent?.includes('格式'))
    formatBtn?.click()
  })
  await delay(500)
  await shot(page, '07-text-editor-format-light.png')

  // Close
  await page.keyboard.press('Escape')
  await delay(300)

  // ─── 8. OCR Settings modal (BYOK) ───────────────────────────────
  console.log('OCR Settings modal (light)...')
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const ocrToggle = btns.find(b => b.textContent?.includes('OCR'))
    ocrToggle?.click()
  })
  await delay(200)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const settingsBtn = btns.find(b => b.textContent?.includes('模型'))
    settingsBtn?.click()
  })
  await delay(500)
  await shot(page, '08-ocr-settings-light.png')

  // Switch to gemini to show BYOK fields
  await page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('input[type="radio"][name="provider"]'))
    radios[2]?.click()  // gemini
  })
  await delay(300)
  await shot(page, '09-ocr-settings-byok-light.png')

  await page.keyboard.press('Escape')
  await delay(300)

  // ─── 10. Mobile layout ──────────────────────────────────────────
  console.log('Mobile landing...')
  await page.setViewportSize(VIEWPORT_MOBILE)
  await page.goto(URL, { waitUntil: 'networkidle' })
  await setTheme(page, false)
  await delay(500)
  await shot(page, '10-mobile-landing.png')

  await browser.close()
  console.log('Done.')
})().catch((e) => { console.error(e); process.exit(1) })
