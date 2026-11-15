// Tests for the OCR / Worker / storage audit fixes.
// Run via: npx tsx scripts/test-ocr-fixes.ts
//
// Self-contained (own tiny assert helper) so it can run beside the older suites
// without touching them. Pure logic only: response extractors, normalize/merge,
// Worker request handling (global fetch is stubbed), blocked-localStorage
// behaviour, cropper geometry, part matching, export scale.

import { MODEL_OPTIONS, DEFAULT_MODELS } from '../src/lib/vision/types'
import {
  sanitizeOcrConfig, buildAdapter, loadOcrConfig, saveOcrConfig, clearOcrConfig,
} from '../src/lib/vision/index'
import {
  normalizeOcrText, mergeOcrResults, ocrMergeBase, resolveOcrImageType,
  extractGeminiText, extractAnthropicText, extractOpenAIText, extractOcrError,
} from '../src/lib/vision/utils'
import { parseFromText } from '../src/lib/editor'
import { computeCropRect, fitDisplaySize, scaleRect } from '../src/lib/cropTools'
import { loadMeasuresPerLine, saveMeasuresPerLine, DEFAULT_MEASURES_PER_LINE } from '../src/lib/layoutPrefs'
import { loadMyPart, saveMyPart, clearMyPart, matchPartIndex, isGenericPartName } from '../src/lib/partMatch'
import { clampExportScale } from '../src/lib/downloader'
import worker, {
  parseAllowedOrigins, originAllowed, pickModel, clampMaxTokens, geminiToText, readBodyLimited,
  MAX_OUTPUT_TOKENS, type Env,
} from '../worker/src/index'
import type { MeasureArray } from '../src/types/score'

// ── tiny harness ───────────────────────────────────────────────────────────

let pass = 0
let fail = 0

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`) }
}

function throwsMsg(fn: () => unknown): string | null {
  try { fn() } catch (e) { return (e as Error).message }
  return null
}

function describe(name: string, fn: () => void | Promise<void>) {
  pending.push(async () => { console.log(`\n── ${name} ──`); await fn() })
}
const pending: Array<() => Promise<void>> = []

// ── 1. retired models ──────────────────────────────────────────────────────

describe('model lists: retired ids are gone, current ones offered', () => {
  const ids = (p: keyof typeof MODEL_OPTIONS) => MODEL_OPTIONS[p].map(m => m.id)
  eq('anthropic offers sonnet 5.5 + haiku 5.5', ids('anthropic'), ['claude-sonnet-5-5', 'claude-haiku-5-5'])
  eq('anthropic default is sonnet 5.5', DEFAULT_MODELS.anthropic, 'claude-sonnet-5-5')
  eq('no claude-3-5-* anywhere', Object.values(MODEL_OPTIONS).flat().some(m => m.id.startsWith('claude-3')), false)
  eq('gemini keeps 2.5 flash', ids('gemini').includes('gemini-2.5-flash'), true)
  eq('gemini no longer offers 2.0 flash', ids('gemini').includes('gemini-2.0-flash'), false)
  eq('custom has no fixed list (free-text input)', ids('custom'), [])
})

describe('sanitizeOcrConfig drops stale saved ids', () => {
  eq('stale claude-3-5-sonnet dropped', sanitizeOcrConfig({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', apiKey: 'k' }).model ?? null, null)
  eq('stale claude-3-5-haiku dropped', sanitizeOcrConfig({ provider: 'anthropic', model: 'claude-3-5-haiku-20241022', apiKey: 'k' }).model ?? null, null)
  eq('stale gemini-2.0-flash dropped', sanitizeOcrConfig({ provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'k' }).model ?? null, null)
  eq('api key survives the drop', sanitizeOcrConfig({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', apiKey: 'k' }).apiKey, 'k')
  eq('current anthropic id kept', sanitizeOcrConfig({ provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: 'k' }).model, 'claude-haiku-5-5')
  eq('custom keeps OpenRouter-style id', sanitizeOcrConfig({ provider: 'custom', model: 'openai/gpt-4o-mini', apiKey: 'k', customUrl: 'https://x' }).model, 'openai/gpt-4o-mini')
})

// ── 12. buildAdapter ───────────────────────────────────────────────────────

describe('buildAdapter: unknown provider and custom URL', () => {
  const bogus = { provider: 'mistral' } as unknown as Parameters<typeof buildAdapter>[0]
  eq('unknown provider → friendly 未配置 OCR', (throwsMsg(() => buildAdapter(bogus, {})) ?? '').startsWith('未配置 OCR'), true)
  eq('auto with nothing configured → 未配置 OCR', (throwsMsg(() => buildAdapter({ provider: 'auto' }, {})) ?? '').startsWith('未配置 OCR'), true)
  eq('custom with a garbage URL → clear message', (throwsMsg(() => buildAdapter({ provider: 'custom', apiKey: 'k', customUrl: 'not a url' }, {})) ?? '').includes('URL'), true)
  eq('custom with a good URL builds', throwsMsg(() => buildAdapter({ provider: 'custom', apiKey: 'k', customUrl: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini' }, {})), null)
})

describe('OCR image type allowlist', () => {
  eq('png ok', resolveOcrImageType('a.png', 'image/png'), 'image/png')
  eq('jpeg ok', resolveOcrImageType('a.jpg', 'image/jpeg'), 'image/jpeg')
  eq('image/jpg alias', resolveOcrImageType('a.jpg', 'image/jpg'), 'image/jpeg')
  eq('webp ok', resolveOcrImageType('a.webp', 'image/webp'), 'image/webp')
  eq('gif ok', resolveOcrImageType('a.gif', 'image/gif'), 'image/gif')
  eq('HEIC rejected', resolveOcrImageType('IMG_1.HEIC', 'image/heic'), null)
  eq('SVG rejected', resolveOcrImageType('a.svg', 'image/svg+xml'), null)
  eq('BMP rejected', resolveOcrImageType('a.bmp', 'image/bmp'), null)
  eq('empty type falls back to extension', resolveOcrImageType('Scan.JPEG', ''), 'image/jpeg')
  eq('empty type + unknown extension rejected', resolveOcrImageType('notes.txt', ''), null)
})

// ── 3. blocked localStorage ────────────────────────────────────────────────

describe('blocked localStorage (getter throws) never escapes', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError: Access is denied') },
  })
  try {
    eq('loadMeasuresPerLine → default', throwsMsg(() => loadMeasuresPerLine()), null)
    eq('loadMeasuresPerLine value', loadMeasuresPerLine(), DEFAULT_MEASURES_PER_LINE)
    eq('saveMeasuresPerLine silent', throwsMsg(() => saveMeasuresPerLine(3)), null)
    eq('loadMyPart → null', loadMyPart(), null)
    eq('saveMyPart silent', throwsMsg(() => saveMyPart('笛子')), null)
    eq('clearMyPart silent', throwsMsg(() => clearMyPart()), null)
    eq('loadOcrConfig → default', loadOcrConfig(), { provider: 'auto' })
    eq('saveOcrConfig silent, reports not persisted', saveOcrConfig({ provider: 'gemini', apiKey: 'k' }), false)
    eq('config still applies this session', loadOcrConfig().apiKey, 'k')
    eq('clearOcrConfig silent', throwsMsg(() => clearOcrConfig()), null)
    eq('after clear → default again', loadOcrConfig(), { provider: 'auto' })
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

describe('working localStorage still round-trips', () => {
  const store = new Map<string, string>()
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    },
  })
  try {
    saveMeasuresPerLine(6)
    eq('measures per line persisted', loadMeasuresPerLine(), 6)
    store.set('jianpu.measuresPerLine.v1', '99')
    eq('tampered value → default', loadMeasuresPerLine(), DEFAULT_MEASURES_PER_LINE)

    eq('save reports persisted', saveOcrConfig({ provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-5-5' }), true)
    eq('config round-trips', loadOcrConfig(), { provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-5-5' })
    store.set('jianpu.ocr.config.v1', JSON.stringify({ provider: 'anthropic', apiKey: 'k', model: 'claude-3-5-sonnet-20241022' }))
    eq('stale saved model dropped on load', loadOcrConfig().model ?? null, null)
    store.set('jianpu.ocr.config.v1', JSON.stringify({ provider: 'toString' }))
    eq('inherited-key provider name is not a provider', loadOcrConfig(), { provider: 'auto' })
    store.set('jianpu.ocr.config.v1', 'not json')
    eq('corrupt JSON → default', loadOcrConfig(), { provider: 'auto' })
    clearOcrConfig()
    eq('cleared', loadOcrConfig(), { provider: 'auto' })

    // 13. auto-generated names are never remembered
    saveMyPart('Part 2')
    eq('"Part 2" not remembered', loadMyPart(), null)
    saveMyPart('大提琴')
    eq('real instrument remembered', loadMyPart(), '大提琴')
    store.set('jianpu.myPart.v1', 'Part 3')
    eq('a stale generic name saved by an older build is ignored', loadMyPart(), null)
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

// ── 13. part matching ──────────────────────────────────────────────────────

describe('generic part names and prefix-first matching', () => {
  for (const n of ['Part 1', 'part 12', 'Track 3', 'P2', 'MusicXML Part', '声部 2', '音轨3']) {
    eq(`generic: ${n}`, isGenericPartName(n), true)
  }
  for (const n of ['Flute', 'Alto Flute', '二胡 II', 'Voice', 'Piano', 'Cello 大提琴']) {
    eq(`not generic: ${n}`, isGenericPartName(n), false)
  }
  eq('"Flute" prefers "Flute 2" over "Alto Flute"', matchPartIndex(['Alto Flute', 'Flute 2'], 'Flute'), 1)
  eq('prefix works the other way round too', matchPartIndex(['Piccolo', 'Flute 2'], 'Flute 2 (solo)'), 1)
  eq('"Flute" is not a prefix of "Fluted"', matchPartIndex(['Fluted', 'Flute 2'], 'Flute'), 1)
  eq('substring still the last resort', matchPartIndex(['Alto Flute'], 'Flute'), 0)
  eq('exact still beats prefix', matchPartIndex(['Flute 2', 'Flute'], 'Flute'), 1)
  eq('CJK prefix', matchPartIndex(['笛子', '二胡高音'], '二胡'), 1)
})

// ── 4. normalizeOcrText ────────────────────────────────────────────────────

describe('normalizeOcrText: look-alike glyphs, body lines only', () => {
  eq('curly apostrophes → high octave', normalizeOcrText('| 1’ 2‘ 3′ 4 |'), "| 1' 2' 3' 4 |")
  eq('fullwidth hyphen → extension dash', normalizeOcrText('| 1－ 2 3 4 |'), '| 1- 2 3 4 |')
  eq('em dash', normalizeOcrText('| 5 — — — |'), '| 5 - - - |')
  eq('en dash', normalizeOcrText('| 5 – – – |'), '| 5 - - - |')
  eq('fullwidth parens → slur', normalizeOcrText('| （1 2） 3 4 |'), '| (1 2) 3 4 |')
  eq('underscore → slash in the body', normalizeOcrText('| 1_ 2__ 3 4 |'), '| 1/ 2// 3 4 |')
  eq('Title keeps its underscore', normalizeOcrText('Title: my_song\nKey: C   Time: 4/4\n| 1_ 2 3 4 ||'), 'Title: my_song\nKey: C   Time: 4/4\n| 1/ 2 3 4 ||')
  eq('Title is not rewritten by the glyph maps', normalizeOcrText('Title: 月亮（变奏）\n| 1 |'), 'Title: 月亮（变奏）\n| 1 |')
  eq('fullwidth colon in a header still fixed', normalizeOcrText('Key： C   Time: 4/4\n| 1 |'), 'Key: C   Time: 4/4\n| 1 |')
  eq('dotted quarter untouched', normalizeOcrText('| 1. 2/ 3 4 |'), '| 1. 2/ 3 4 |')

  // End to end: what the audit repro printed as lost notes now parse correctly
  const parsed = parseFromText(normalizeOcrText("Key: C   Time: 4/4\n| 1’ 2’ 3 4 ||"))
  const m0 = parsed.measures[0] as MeasureArray
  eq('1’ parses as high octave', [m0[0].octave, m0[1].octave, m0[2].octave], [1, 1, 0])
  const dash = parseFromText(normalizeOcrText('Key: C   Time: 4/4\n| 1－ 2－ ||'))
  eq('1－ parses as half note', (dash.measures[0] as MeasureArray).map(n => n.type), ['half', 'half'])
  const slur = parseFromText(normalizeOcrText('Key: C   Time: 4/4\n| （1 2） 3 4 ||'))
  const sm = slur.measures[0] as MeasureArray
  eq('fullwidth parens parse as a slur', [sm[0].slurStart, sm[1].slurStop], [true, true])
  eq('Title with underscore survives parse', parseFromText(normalizeOcrText('Title: my_song\nKey: C   Time: 4/4\n| 1 2 3 4 ||')).titleStr, 'my_song')
})

// ── 5. accumulating crops ──────────────────────────────────────────────────

describe('mergeOcrResults accumulates crops', () => {
  const a = 'Title: 小星星\nKey: C   Time: 4/4   Tempo: 100\n| 1 1 5 5 | 6 6 5- ||'
  const b = 'Key: C   Time: 4/4   Tempo: 100\n| 4 4 3 3 | 2 2 1- ||'
  eq('nothing before → the new text as is', mergeOcrResults(null, a), a)
  eq('blank before → the new text as is', mergeOcrResults('  \n ', a), a)
  eq('duplicate headers dropped, body appended on a new line', mergeOcrResults(a, b),
    'Title: 小星星\nKey: C   Time: 4/4   Tempo: 100\n| 1 1 5 5 | 6 6 5- ||\n| 4 4 3 3 | 2 2 1- ||')
  eq('empty new body → previous unchanged', mergeOcrResults(a, 'Key: C   Time: 4/4'), a)
  eq('a field only the new crop has is folded into the header',
    mergeOcrResults('Key: C   Time: 4/4\n| 1 2 3 4 ||', 'Title: 月亮\nTempo: 90\n| 5 6 7 1\' ||'),
    'Title: 月亮\nKey: C   Time: 4/4\nTempo: 90\n| 1 2 3 4 ||\n| 5 6 7 1\' ||')
  eq('headerless previous + headerless next', mergeOcrResults('| 1 2 3 4 ||', '| 5 6 7 1 ||'), '| 1 2 3 4 ||\n| 5 6 7 1 ||')
  eq('headerless previous picks up the next crop\'s Key', mergeOcrResults('| 1 2 3 4 ||', 'Key: G   Time: 3/4\n| 5 6 7 |'), 'Key: G   Time: 3/4\n| 1 2 3 4 ||\n| 5 6 7 |')

  // The merged text is one parseable score with no stray header text in the body
  const parsed = parseFromText(mergeOcrResults(a, b))
  eq('both crops parse: 4 measures', parsed.measures.length, 4)
  eq('title kept', parsed.titleStr, '小星星')
  eq('tempo kept', parsed.tempoStr, '100')
  const merged = mergeOcrResults(a, b)
  eq('exactly one Key: line', merged.split('\n').filter(l => l.startsWith('Key:')).length, 1)
})

describe('retrying the same picture replaces instead of duplicating', () => {
  const pic1 = {}, pic2 = {}
  const first = mergeOcrResults(null, 'Key: C\n| 1 2 3 4 ||')
  const rec = { source: pic1, base: null, produced: first }
  eq('same picture, untouched result → merge against the old base', ocrMergeBase(first, rec, pic1), null)
  eq('same picture but the user edited the box → append', ocrMergeBase(first + ' 5', rec, pic1), first + ' 5')
  eq('different picture → append', ocrMergeBase(first, rec, pic2), first)
  eq('no record → current text', ocrMergeBase(first, null, pic1), first)
  const second = mergeOcrResults(ocrMergeBase(first, rec, pic1), 'Key: C\n| 1 2 3 5 ||')
  eq('the retry replaced the first answer', second, 'Key: C\n| 1 2 3 5 ||')
})

// ── 9. empty / blocked / truncated model answers ───────────────────────────

describe('response extractors: join parts, friendly errors', () => {
  const gem = (parts: Array<{ text?: string; thought?: boolean }>, finishReason?: string) =>
    ({ candidates: [{ content: { parts }, finishReason }] })

  eq('gemini joins all parts', extractGeminiText(gem([{ text: 'Key: C\n| 1 2 ' }, { text: '3 4 ||' }], 'STOP')), 'Key: C\n| 1 2 3 4 ||')
  eq('gemini skips thought parts', extractGeminiText(gem([{ text: 'planning…', thought: true }, { text: '| 1 ||' }], 'STOP')), '| 1 ||')
  eq('gemini with no finishReason is fine', extractGeminiText(gem([{ text: '| 1 ||' }])), '| 1 ||')
  eq('gemini empty text → friendly error', (throwsMsg(() => extractGeminiText(gem([{ text: '  ' }], 'STOP'))) ?? '').includes('没有返回内容'), true)
  eq('gemini no parts at all → empty error', (throwsMsg(() => extractGeminiText({ candidates: [{ finishReason: 'STOP' }] })) ?? '').includes('没有返回内容'), true)
  eq('gemini no candidates → empty error', (throwsMsg(() => extractGeminiText({})) ?? '').includes('没有返回内容'), true)
  eq('gemini MAX_TOKENS → truncated error', (throwsMsg(() => extractGeminiText(gem([{ text: '| 1 2' }], 'MAX_TOKENS'))) ?? '').includes('截断'), true)
  eq('gemini MAX_TOKENS with no text (thinking ate the budget) → truncated', (throwsMsg(() => extractGeminiText(gem([], 'MAX_TOKENS'))) ?? '').includes('截断'), true)
  eq('gemini SAFETY → blocked error', (throwsMsg(() => extractGeminiText(gem([{ text: 'x' }], 'SAFETY'))) ?? '').includes('SAFETY'), true)
  eq('gemini RECITATION → blocked error', (throwsMsg(() => extractGeminiText(gem([], 'RECITATION'))) ?? '').includes('拦截'), true)
  eq('gemini prompt blocked, no candidates → blocked error', (throwsMsg(() => extractGeminiText({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })) ?? '').includes('PROHIBITED_CONTENT'), true)
  eq('never the old placeholder', (throwsMsg(() => extractGeminiText({})) ?? '').includes('无输出'), false)

  eq('anthropic joins text blocks', extractAnthropicText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], stop_reason: 'end_turn' }), 'a\nb')
  eq('anthropic ignores non-text blocks', extractAnthropicText({ content: [{ type: 'tool_use' }, { type: 'text', text: '| 1 ||' }] }), '| 1 ||')
  eq('anthropic max_tokens → truncated', (throwsMsg(() => extractAnthropicText({ content: [{ type: 'text', text: '| 1' }], stop_reason: 'max_tokens' })) ?? '').includes('截断'), true)
  eq('anthropic refusal → blocked', (throwsMsg(() => extractAnthropicText({ content: [], stop_reason: 'refusal' })) ?? '').includes('拦截'), true)
  eq('anthropic empty content → empty error', (throwsMsg(() => extractAnthropicText({ content: [] })) ?? '').includes('没有返回内容'), true)

  eq('openai string content', extractOpenAIText({ choices: [{ message: { content: ' | 1 || ' }, finish_reason: 'stop' }] }), '| 1 ||')
  eq('openai parts-array content joined', extractOpenAIText({ choices: [{ message: { content: [{ type: 'text', text: '| 1 ' }, { type: 'text', text: '2 ||' }] } }] }), '| 1 2 ||')
  eq('openai finish_reason length → truncated', (throwsMsg(() => extractOpenAIText({ choices: [{ message: { content: '| 1' }, finish_reason: 'length' }] })) ?? '').includes('截断'), true)
  eq('openai content_filter → blocked', (throwsMsg(() => extractOpenAIText({ choices: [{ message: { content: null }, finish_reason: 'content_filter' }] })) ?? '').includes('拦截'), true)
  eq('openai refusal field → blocked', (throwsMsg(() => extractOpenAIText({ choices: [{ message: { content: null, refusal: 'no' } }] })) ?? '').includes('拦截'), true)
  eq('openai empty → empty error', (throwsMsg(() => extractOpenAIText({ choices: [] })) ?? '').includes('没有返回内容'), true)

  eq('error sentinel is still detected after extraction', extractOcrError(normalizeOcrText(extractGeminiText(gem([{ text: '[错误：图片不是简谱]' }], 'STOP')))), '图片不是简谱')
})

// ── 7. cropper geometry ────────────────────────────────────────────────────

describe('cropper preview fits the container, crop mapping stays exact', () => {
  const page = { w: 1191, h: 1684 }   // A4 @ 2.0x
  eq('phone: width-limited, aspect preserved', fitDisplaySize(page, 318, 586, 420), { w: 318, h: 450 })
  eq('never upscales a small image', fitDisplaySize({ w: 200, h: 100 }, 640, 600), { w: 200, h: 100 })
  eq('tall page on a desktop: height-limited but kept ≥ minW', fitDisplaySize(page, 640, 546, 420), { w: 420, h: 594 })
  eq('height limit applies above minW', fitDisplaySize({ w: 1000, h: 2000 }, 640, 500, 100), { w: 250, h: 500 })
  eq('minW never exceeds the width fit (narrow phone)', fitDisplaySize(page, 300, 200, 420), { w: 300, h: 424 })
  eq('empty source → zero', fitDisplaySize({ w: 0, h: 0 }, 640, 600), { w: 0, h: 0 })
  eq('no room yet → zero', fitDisplaySize(page, 0, 600), { w: 0, h: 0 })

  const sel = { x: 6, y: 6, w: 306, h: 80 }
  const phone = fitDisplaySize(page, 318, 586, 420)
  const desk = fitDisplaySize(page, 640, 900, 420)
  const moved = scaleRect(sel, phone, desk)
  const k = desk.w / phone.w
  eq('scaleRect carries the box over proportionally', [Math.round(moved.x), Math.round(moved.w)], [Math.round(6 * k), Math.round(306 * k)])
  // Same box, two preview sizes → (almost) the same source rectangle
  const a = computeCropRect(sel, phone, page)
  const b = computeCropRect(moved, desk, page)
  eq('crop rect identical across re-fits (±1px rounding)', [Math.abs(a.x - b.x) <= 1, Math.abs(a.y - b.y) <= 1, Math.abs(a.w - b.w) <= 2, Math.abs(a.h - b.h) <= 2], [true, true, true, true])
  eq('scaleRect with no previous size is a no-op', scaleRect(sel, { w: 0, h: 0 }, desk), sel)
  eq('existing mapping still exact (2x)', computeCropRect({ x: 0, y: 0, w: 300, h: 30 }, { w: 300, h: 150 }, { w: 600, h: 300 }), { x: 0, y: 0, w: 600, h: 60 })
})

// ── 11. export scale ───────────────────────────────────────────────────────

describe('export scale stays under the iOS canvas limit', () => {
  eq('normal score keeps 2x', clampExportScale(800, 1200), 2)
  const big = clampExportScale(2400, 6000)
  eq('huge score is reduced', big < 2, true)
  eq('and lands within the pixel cap', 2400 * big * 6000 * big <= 16_000_001, true)
  eq('exactly-at-cap case', clampExportScale(4000, 4000, 2, 16_000_000), 1)
  eq('degenerate size → desired scale', clampExportScale(0, 0), 2)
})

// ── 2. Worker ──────────────────────────────────────────────────────────────

const GOOD_ORIGIN = 'https://huichiy.github.io'
const ENV: Env = { GEMINI_API_KEY: 'test-key', ALLOWED_ORIGINS: `${GOOD_ORIGIN},http://localhost:5173,http://localhost:7790` }
const IMG = 'data:image/png;base64,iVBORw0KGgo='

function chatBody(extra: Record<string, unknown> = {}, image = IMG) {
  return JSON.stringify({
    model: 'gemini-2.5-flash',
    max_tokens: 8192,
    messages: [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: 'go' }] },
    ],
    ...extra,
  })
}

function post(body: string, origin: string | null = GOOD_ORIGIN, headers: Record<string, string> = {}) {
  return new Request('https://worker.test/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...headers },
    body,
  })
}

/** Run the worker against a stubbed Gemini; returns the response and what was sent upstream. */
async function callWorker(req: Request, env: Env, upstream: unknown = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '| 1 2 3 4 ||' }] } }] }) {
  const realFetch = globalThis.fetch
  const sent: { url?: string; headers?: Record<string, string>; body?: { generationConfig: { maxOutputTokens: number; temperature: number }; contents: Array<{ parts: unknown[] }> } } = {}
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.url = url; sent.headers = init.headers; sent.body = JSON.parse(init.body)
    return new Response(JSON.stringify(upstream), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  try {
    const res = await worker.fetch(req, env)
    return { res, sent, json: await res.clone().json().catch(() => null) as { error?: { message: string }; choices?: Array<{ message: { content: string } }> } | null }
  } finally {
    globalThis.fetch = realFetch
  }
}

describe('worker: Origin check', async () => {
  eq('configured list parsed', parseAllowedOrigins(ENV)?.length, 3)
  eq('unset → open', parseAllowedOrigins({ GEMINI_API_KEY: 'k' }), null)
  eq('empty string → open', parseAllowedOrigins({ GEMINI_API_KEY: 'k', ALLOWED_ORIGINS: ' ' }), null)
  eq('"*" → open', parseAllowedOrigins({ GEMINI_API_KEY: 'k', ALLOWED_ORIGINS: '*' }), null)
  eq('listed origin allowed', originAllowed(post('{}'), ENV), true)
  eq('other origin refused', originAllowed(post('{}', 'https://evil.example'), ENV), false)
  eq('missing origin refused', originAllowed(post('{}', null), ENV), false)

  const ok = await callWorker(post(chatBody()), ENV)
  eq('allowed origin → 200', ok.res.status, 200)
  eq('allowed origin gets its own origin echoed', ok.res.headers.get('access-control-allow-origin'), GOOD_ORIGIN)
  eq('reply is OpenAI-shaped', ok.json?.choices?.[0].message.content, '| 1 2 3 4 ||')

  const evil = await callWorker(post(chatBody(), 'https://evil.example'), ENV)
  eq('disallowed origin → 403', evil.res.status, 403)
  eq('…and nothing was forwarded upstream', evil.sent.url, undefined)
  eq('…and CORS does not grant it', evil.res.headers.get('access-control-allow-origin'), 'null')

  const none = await callWorker(post(chatBody(), null), ENV)
  eq('missing origin → 403', none.res.status, 403)
  eq('…nothing forwarded', none.sent.url, undefined)

  const pre = await callWorker(new Request('https://worker.test/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), ENV)
  eq('preflight from a disallowed origin → 403', pre.res.status, 403)
  const pre2 = await callWorker(new Request('https://worker.test/', { method: 'OPTIONS', headers: { origin: GOOD_ORIGIN } }), ENV)
  eq('preflight from an allowed origin passes', pre2.res.status, 200)

  const open = await callWorker(post(chatBody(), null), { GEMINI_API_KEY: 'k' })
  eq('unconfigured worker stays open (local dev)', open.res.status, 200)
})

describe('worker: model allowlist, token clamp, request shape', async () => {
  eq('flash kept', pickModel('gemini-2.5-flash'), 'gemini-2.5-flash')
  eq('Pro forced to flash', pickModel('gemini-2.5-pro'), 'gemini-2.5-flash')
  eq('garbage forced to flash', pickModel('../../evil'), 'gemini-2.5-flash')
  eq('missing → flash', pickModel(undefined), 'gemini-2.5-flash')
  eq('clamp: above cap', clampMaxTokens(100000), MAX_OUTPUT_TOKENS)
  eq('clamp: within cap', clampMaxTokens(4096), 4096)
  eq('clamp: missing', clampMaxTokens(undefined), MAX_OUTPUT_TOKENS)
  eq('clamp: nonsense', clampMaxTokens('lots'), MAX_OUTPUT_TOKENS)
  eq('clamp: negative', clampMaxTokens(-5), MAX_OUTPUT_TOKENS)
  eq('clamp: fractional', clampMaxTokens(100.9), 100)

  const pro = await callWorker(post(chatBody({ model: 'gemini-2.5-pro', max_tokens: 999999 })), ENV)
  eq('Pro request is sent upstream as Flash', pro.sent.url?.includes('/models/gemini-2.5-flash:generateContent'), true)
  eq('upstream max tokens clamped', pro.sent.body?.generationConfig.maxOutputTokens, 8192)
  eq('API key travels in a header, not the URL', [pro.sent.headers?.['x-goog-api-key'], pro.sent.url?.includes('test-key')], ['test-key', false])
  eq('system prompt becomes the first part', (pro.sent.body?.contents[0].parts[0] as { text: string }).text, 'SYS')
  eq('image forwarded as inline_data', JSON.stringify(pro.sent.body?.contents[0].parts).includes('inline_data'), true)

  const inject = await callWorker(post(chatBody({ model: 'gemini-2.5-flash/../../v1/x' })), ENV)
  eq('path-injection model string is neutralised', inject.sent.url?.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'), true)

  const noImg = await callWorker(post(JSON.stringify({ messages: [{ role: 'user', content: 'write me a poem' }] })), ENV)
  eq('no image → 400, nothing forwarded', [noImg.res.status, noImg.sent.url], [400, undefined])
  const pdfImg = await callWorker(post(chatBody({}, 'data:application/pdf;base64,AAAA')), ENV)
  eq('non-image data URL → 400', pdfImg.res.status, 400)
  const noMsgs = await callWorker(post(JSON.stringify({ model: 'x' })), ENV)
  eq('missing messages → 400 (not a 500)', noMsgs.res.status, 400)
  const badJson = await callWorker(post('{nope'), ENV)
  eq('invalid JSON → 400', badJson.res.status, 400)
  const get = await callWorker(new Request('https://worker.test/', { method: 'GET', headers: { origin: GOOD_ORIGIN } }), ENV)
  eq('GET → 405', get.res.status, 405)
  const nokey = await callWorker(post(chatBody()), { ALLOWED_ORIGINS: ENV.ALLOWED_ORIGINS } as Env)
  eq('missing secret → 500', nokey.res.status, 500)
})

describe('worker: body size cap', async () => {
  const bigImg = 'data:image/png;base64,' + 'A'.repeat(16 * 1024 * 1024)
  const big = await callWorker(post(chatBody({}, bigImg)), ENV)
  eq('16 MB body → 413', big.res.status, 413)
  eq('…nothing forwarded', big.sent.url, undefined)

  const forged = await callWorker(post(chatBody(), GOOD_ORIGIN, { 'content-length': String(20 * 1024 * 1024) }), ENV)
  eq('declared Content-Length over the cap → 413', forged.res.status, 413)

  const okBig = await callWorker(post(chatBody({}, 'data:image/png;base64,' + 'A'.repeat(6 * 1024 * 1024))), ENV)
  eq('a ~6 MB body is fine', okBig.res.status, 200)

  eq('readBodyLimited under the limit', await readBodyLimited(post('hello'), 100), 'hello')
  eq('readBodyLimited over the limit', await readBodyLimited(post('x'.repeat(200)), 100), null)
  eq('readBodyLimited decodes multi-byte text', await readBodyLimited(post('简谱'), 100), '简谱')
})

describe('worker: empty / blocked / truncated Gemini answers', async () => {
  const run = (upstream: unknown) => callWorker(post(chatBody()), ENV, upstream)

  const joined = await run({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Key: C\n| 1 2 ' }, { text: '3 4 ||' }] } }] })
  eq('all text parts joined', joined.json?.choices?.[0].message.content, 'Key: C\n| 1 2 3 4 ||')

  const empty = await run({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '' }] } }] })
  eq('empty → error status, not a result', empty.res.status >= 400, true)
  eq('empty → Chinese message', empty.json?.error?.message.includes('没有返回内容'), true)
  eq('empty → never the old placeholder', JSON.stringify(empty.json).includes('无输出'), false)

  const trunc = await run({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '| 1 2' }] } }] })
  eq('truncated → error with a message', [trunc.res.status >= 400, trunc.json?.error?.message.includes('截断')], [true, true])

  const blocked = await run({ candidates: [{ finishReason: 'SAFETY' }] })
  eq('blocked → error with a message', [blocked.res.status >= 400, blocked.json?.error?.message.includes('SAFETY')], [true, true])

  const noCand = await run({ promptFeedback: { blockReason: 'OTHER' } })
  eq('prompt blocked → error', [noCand.res.status >= 400, noCand.json?.error?.message.includes('OTHER')], [true, true])

  eq('geminiToText ok', geminiToText({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'a' }] } }] }), { ok: true, text: 'a' })
})

// ── run ────────────────────────────────────────────────────────────────────

for (const t of pending) await t()
console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
