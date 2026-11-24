// Tests for the second OCR / Worker / PDF audit round.
// Run via: npx tsx scripts/test-audit2-ocr.ts
//
// Pure logic only (no network: fetch and FileReader are stubbed). The React
// parts (second crop, cancel button, backdrop drags, legacy pdf.js) are checked
// in a real browser, not here.

import { readFileSync } from 'node:fs'
import { MODEL_OPTIONS, DEFAULT_MODELS } from '../src/lib/vision/types'
import { sanitizeOcrConfig, buildAdapter } from '../src/lib/vision/index'
import { normalizeOcrText, mergeOcrResults, withTimeout, OCR_TIMEOUT_MS, OCR_TIMEOUT_MSG } from '../src/lib/vision/utils'
import { JIANPU_OCR_PROMPT, WESTERN_TO_JIANPU_PROMPT } from '../src/lib/vision/prompts'
import { createGeminiAdapter } from '../src/lib/vision/adapters/gemini'
import { createAnthropicAdapter } from '../src/lib/vision/adapters/anthropic'
import { createGroqAdapter } from '../src/lib/vision/adapters/groq'
import { createOpenAIAdapter } from '../src/lib/vision/adapters/openai'
import { createCustomAdapter } from '../src/lib/vision/adapters/custom'
import { createWorkerAdapter } from '../src/lib/vision/adapters/worker'
import { rememberCropSource, cropSourceOf } from '../src/lib/cropTools'
import { parseFromText } from '../src/lib/editor'
import worker, {
  pickModel, clampMaxTokens, DEFAULT_MODEL, ALLOWED_MODELS, MAX_OUTPUT_TOKENS, type Env,
} from '../worker/src/index'
import type { VisionAdapter } from '../src/lib/vision/types'

// ── tiny harness ───────────────────────────────────────────────────────────

let pass = 0
let fail = 0

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`) }
}

function describe(name: string, fn: () => void | Promise<void>) {
  pending.push(async () => { console.log(`\n── ${name} ──`); await fn() })
}
const pending: Array<() => Promise<void>> = []

async function rejectMsg(p: Promise<unknown>): Promise<string | null> {
  try { await p } catch (e) { return (e as Error).message }
  return null
}

// ── stubs: FileReader + fetch ──────────────────────────────────────────────

interface Sent { url: string; headers: Record<string, string>; body: Record<string, unknown>; signal?: AbortSignal }

/** Run `fn` with a canned fetch; returns what was sent. `status` ≠ 200 returns an error body. */
async function withFetch<T>(
  respond: { status?: number; json?: unknown; hang?: boolean },
  fn: (sent: Sent) => Promise<T>,
): Promise<T> {
  const realFetch = globalThis.fetch
  const realReader = (globalThis as { FileReader?: unknown }).FileReader
  const sent: Sent = { url: '', headers: {}, body: {} }
  ;(globalThis as { FileReader?: unknown }).FileReader = class {
    result = 'data:image/png;base64,AAAA'
    onload: (() => void) | null = null
    readAsDataURL() { queueMicrotask(() => this.onload?.()) }
  }
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string; signal?: AbortSignal }) => {
    sent.url = String(url); sent.headers = init.headers; sent.body = JSON.parse(init.body); sent.signal = init.signal
    if (respond.hang) {
      return await new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }
    return new Response(JSON.stringify(respond.json ?? {}), { status: respond.status ?? 200 })
  }) as unknown as typeof fetch
  try { return await fn(sent) } finally {
    globalThis.fetch = realFetch
    ;(globalThis as { FileReader?: unknown }).FileReader = realReader
  }
}

const IMG = new Blob(['x'], { type: 'image/png' })
const okOpenAI = { choices: [{ message: { content: '| 1 ||' }, finish_reason: 'stop' }] }
const okGemini = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '| 1 ||' }] } }] }
const okAnthropic = { content: [{ type: 'text', text: '| 1 ||' }], stop_reason: 'end_turn' }

// ── 1. models ──────────────────────────────────────────────────────────────

describe('item 1: retired models are gone, current ones offered', () => {
  const ids = (p: keyof typeof MODEL_OPTIONS) => MODEL_OPTIONS[p].map(m => m.id)
  eq('groq offers only qwen3.8', ids('groq'), ['qwen/qwen3.8-27b'])
  eq('groq label + preview note', [MODEL_OPTIONS.groq[0].label, MODEL_OPTIONS.groq[0].note], ['Qwen 3.8 27B', '预览版，可能随时下线'])
  eq('groq default', DEFAULT_MODELS.groq, 'qwen/qwen3.8-27b')
  eq('openai offers luna / terra / sol', ids('openai'), ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-sol'])
  eq('openai default + custom default', [DEFAULT_MODELS.openai, DEFAULT_MODELS.custom], ['gpt-6-luna', 'gpt-6-luna'])
  eq('gemini offers 3.6 / 3.8 / 3.5-lite', ids('gemini'), ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'])
  eq('gemini notes', MODEL_OPTIONS.gemini.map(m => m.note), ['默认', '更强，高峰期可能繁忙', '最快，准确度较低'])
  eq('auto lists only 3.6 flash', ids('auto'), ['gemini-3.6-flash'])
  eq('auto + gemini default', [DEFAULT_MODELS.auto, DEFAULT_MODELS.gemini], ['gemini-3.6-flash', 'gemini-3.6-flash'])
  const all = Object.values(MODEL_OPTIONS).flat().map(m => m.id).join(' ')
  eq('no 2.5 / 4o / llama-4 id left in any list', /gemini-2\.5|gpt-4o|llama-4/.test(all), false)
  eq('anthropic untouched', ids('anthropic'), ['claude-sonnet-5-5', 'claude-haiku-5-5'])
})

describe('item 1: saved retired ids are dropped', () => {
  const drop = (provider: 'auto' | 'gemini' | 'openai' | 'groq', model: string) => sanitizeOcrConfig({ provider, model, apiKey: 'k' }).model ?? null
  eq('gemini-2.5-flash (gemini)', drop('gemini', 'gemini-2.5-flash'), null)
  eq('gemini-2.5-pro (gemini)', drop('gemini', 'gemini-2.5-pro'), null)
  eq('gemini-2.5-flash (auto)', drop('auto', 'gemini-2.5-flash'), null)
  eq('gpt-4o-mini', drop('openai', 'gpt-4o-mini'), null)
  eq('gpt-4o', drop('openai', 'gpt-4o'), null)
  eq('llama 4 scout', drop('groq', 'meta-llama/llama-4-scout-17b-16e-instruct'), null)
  eq('current gemini id kept', drop('gemini', 'gemini-3.8-flash'), 'gemini-3.8-flash')
  eq('current openai id kept', drop('openai', 'gpt-6.2-sol'), 'gpt-6.2-sol')
  eq('custom still free text', sanitizeOcrConfig({ provider: 'custom', model: 'gpt-4o-mini', apiKey: 'k', customUrl: 'https://x' }).model, 'gpt-4o-mini')
})

describe('item 1/2: request bodies per provider', async () => {
  await withFetch({ json: okOpenAI }, async (sent) => {
    await createGroqAdapter('k').transcribe(IMG, 'jianpu')
    eq('groq: endpoint', sent.url, 'https://api.groq.com/openai/v1/chat/completions')
    eq('groq: model', sent.body.model, 'qwen/qwen3.8-27b')
    eq('groq: reasoning hidden', sent.body.reasoning_format, 'hidden')
    eq('groq keeps max_tokens 8192 + temperature 0', [sent.body.max_tokens, sent.body.temperature], [8192, 0])
    eq('groq: no reasoning_effort', 'reasoning_effort' in sent.body, false)

    await createOpenAIAdapter('k').transcribe(IMG, 'jianpu')
    eq('openai: model default', sent.body.model, 'gpt-6-luna')
    eq('openai: max_completion_tokens 25000', sent.body.max_completion_tokens, 25000)
    eq('openai: no max_tokens', 'max_tokens' in sent.body, false)
    eq('openai: no temperature', 'temperature' in sent.body, false)
    eq('openai: reasoning_effort low', sent.body.reasoning_effort, 'low')
    eq('openai: no reasoning_format', 'reasoning_format' in sent.body, false)

    await createCustomAdapter('https://openrouter.ai/api/v1/chat/completions', 'k').transcribe(IMG, 'jianpu')
    eq('custom: default model', sent.body.model, 'gpt-6-luna')
    eq('custom: max_tokens 8192 + temperature 0 exactly as before', [sent.body.max_tokens, sent.body.temperature], [8192, 0])
    eq('custom: nothing provider-specific', ['max_completion_tokens', 'reasoning_effort', 'reasoning_format'].some(k => k in sent.body), false)

    await createWorkerAdapter('https://w.workers.dev').transcribe(IMG, 'jianpu')
    eq('worker path: model', sent.body.model, 'gemini-3.6-flash')
    eq('worker path: 32768 output tokens', sent.body.max_tokens, 32768)
    eq('worker path: temperature 0', sent.body.temperature, 0)

    const viaBuild = buildAdapter({ provider: 'auto' }, { workerUrl: 'https://w.workers.dev' })
    await viaBuild.transcribe(IMG, 'jianpu')
    eq('buildAdapter(auto) uses the worker adapter body', [sent.body.max_tokens, sent.url], [32768, 'https://w.workers.dev'])
  })

  await withFetch({ json: okGemini }, async (sent) => {
    await createGeminiAdapter('k').transcribe(IMG, 'jianpu')
    const cfg = sent.body.generationConfig as { maxOutputTokens: number; temperature: number }
    eq('gemini: default model in the URL', sent.url.includes('/models/gemini-3.6-flash:generateContent'), true)
    eq('gemini: 32768 output tokens', cfg.maxOutputTokens, 32768)
  })

  await withFetch({ json: okAnthropic }, async (sent) => {
    await createAnthropicAdapter('k').transcribe(IMG, 'jianpu')
    eq('anthropic keeps 16000', sent.body.max_tokens, 16000)
  })
})

describe('item 1: no "1500 req/day" style quota claims left', () => {
  const files = [
    'src/lib/vision/types.ts', 'src/lib/vision/prompts.ts', 'src/lib/vision/utils.ts', 'src/components/OcrSettings.tsx',
    'src/lib/vision/adapters/gemini.ts', 'src/lib/vision/adapters/openaiCompat.ts', 'worker/src/index.ts', 'worker/README.md',
  ]
  for (const f of files) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    eq(`${f}: no 1500`, /1500|1,500/.test(text), false)
    eq(`${f}: no gemini-2.5`, /gemini-2\.5|Gemini 2\.5/.test(text), false)
  }
})

// ── 4. error texts ─────────────────────────────────────────────────────────

describe('item 4: error wording follows the channel', async () => {
  const own = '你的 API key 额度不足或请求太频繁（HTTP 429）'
  const make: Array<[string, () => VisionAdapter, unknown]> = [
    ['groq', () => createGroqAdapter('k'), okOpenAI],
    ['openai', () => createOpenAIAdapter('k'), okOpenAI],
    ['custom', () => createCustomAdapter('https://x.example/v1/chat/completions', 'k'), okOpenAI],
    ['gemini', () => createGeminiAdapter('k'), okGemini],
  ]
  for (const [name, mk] of make) {
    const msg = await withFetch({ status: 429, json: { error: { message: 'raw' } } }, () => rejectMsg(mk().transcribe(IMG, 'jianpu')))
    eq(`${name}: 429 is about the user's own key`, msg, own)
  }
  const wmsg = await withFetch({ status: 429, json: {} }, () => rejectMsg(createWorkerAdapter('https://w.workers.dev').transcribe(IMG, 'jianpu')))
  eq('worker path: 429 keeps the default-channel wording', [wmsg?.includes('OCR 设置'), wmsg?.includes('你的 API key')], [true, false])

  for (const status of [503, 524]) {
    const busy = `识别模型正忙（HTTP ${status}），请过一会儿再试`
    const all: Array<[string, () => VisionAdapter]> = [
      ...make.map(([n, mk]) => [n, mk] as [string, () => VisionAdapter]),
      ['worker', () => createWorkerAdapter('https://w.workers.dev')],
      ['anthropic', () => createAnthropicAdapter('k')],
    ]
    for (const [name, mk] of all) {
      const msg = await withFetch({ status, json: { error: { message: 'x' } } }, () => rejectMsg(mk().transcribe(IMG, 'jianpu')))
      eq(`${name}: ${status} → busy`, msg, busy)
    }
  }
  const other = await withFetch({ status: 400, json: { error: { message: 'bad image' } } }, () => rejectMsg(createGroqAdapter('k').transcribe(IMG, 'jianpu')))
  eq('other statuses still show the provider message', other, 'bad image')
})

// ── 5. timeout + cancel ────────────────────────────────────────────────────

describe('item 5: every adapter call has a 3 minute timeout', async () => {
  eq('constant', OCR_TIMEOUT_MS, 180_000)
  eq('message', OCR_TIMEOUT_MSG, '识别超时（3 分钟），请重试或用「框选区域」只框一部分')

  eq('withTimeout passes a result through', await withTimeout(async () => 'ok', { ms: 50 }), 'ok')
  let seen: AbortSignal | undefined
  const slow = await rejectMsg(withTimeout((signal) => { seen = signal; return new Promise<string>(() => {}) }, { ms: 20 }))
  eq('withTimeout rejects with the timeout text', slow, OCR_TIMEOUT_MSG)
  eq('…and aborts the request it started', seen?.aborted, true)

  const outer = new AbortController()
  const p = rejectMsg(withTimeout((signal) => new Promise<string>((_, rej) => signal.addEventListener('abort', () => rej(new Error('cancelled')))), { signal: outer.signal, ms: 5000 }))
  outer.abort()
  eq('an outer abort (the 取消 button) ends the call', await p, 'cancelled')
  const pre = new AbortController(); pre.abort()
  eq('already-aborted signal fails fast', (await rejectMsg(withTimeout(() => new Promise<string>(() => {}), { signal: pre.signal, ms: 5000 }))) !== null, true)

  // Each adapter: capture the delay it asks for, then fire it at once.
  const realSetTimeout = globalThis.setTimeout
  const delays: number[] = []
  globalThis.setTimeout = ((cb: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms === 180_000) { delays.push(ms); return realSetTimeout(cb, 5) }
    return realSetTimeout(cb, ms, ...rest)
  }) as unknown as typeof setTimeout
  try {
    const adapters: Array<[string, () => VisionAdapter]> = [
      ['gemini', () => createGeminiAdapter('k')], ['anthropic', () => createAnthropicAdapter('k')],
      ['groq', () => createGroqAdapter('k')], ['openai', () => createOpenAIAdapter('k')],
      ['custom', () => createCustomAdapter('https://x.example/v1/chat/completions', 'k')],
      ['worker', () => createWorkerAdapter('https://w.workers.dev')],
    ]
    for (const [name, mk] of adapters) {
      const before = delays.length
      const msg = await withFetch({ hang: true }, () => rejectMsg(mk().transcribe(IMG, 'jianpu')))
      eq(`${name}: asks for 180 s and surfaces the timeout text`, [delays.length - before, msg], [1, OCR_TIMEOUT_MSG])
    }
  } finally {
    globalThis.setTimeout = realSetTimeout
  }

  await withFetch({ hang: true }, async (sent) => {
    const c = new AbortController()
    const p = rejectMsg(createGroqAdapter('k').transcribe(IMG, 'jianpu', c.signal))
    await new Promise(r => setTimeout(r, 20))   // let it reach fetch
    eq('the request carries an AbortSignal', sent.signal instanceof AbortSignal, true)
    c.abort()
    eq('the caller\'s signal (取消) aborts the request', [await p !== null, sent.signal?.aborted], [true, true])
  })
})

// ── 2/3. worker ────────────────────────────────────────────────────────────

const GOOD_ORIGIN = 'https://huichiy.github.io'
const ENV: Env = { GEMINI_API_KEY: 'test-key', ALLOWED_ORIGINS: GOOD_ORIGIN }
const PNG = 'data:image/png;base64,iVBORw0KGgo='

function post(body: unknown) {
  return new Request('https://worker.test/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: GOOD_ORIGIN },
    body: JSON.stringify(body),
  })
}

async function callWorker(body: unknown, upstream: { status?: number; json?: unknown; text?: string } = { json: okGemini }) {
  const realFetch = globalThis.fetch
  const box: { sent: { url: string; body: { generationConfig: { maxOutputTokens: number }; contents: Array<{ parts: unknown[] }> } } | null } = { sent: null }
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    box.sent = { url, body: JSON.parse(init.body) }
    return new Response(upstream.text ?? JSON.stringify(upstream.json ?? {}), { status: upstream.status ?? 200 })
  }) as unknown as typeof fetch
  try {
    const res = await worker.fetch(post(body), ENV)
    return { res, sent: box.sent, json: await res.clone().json().catch(() => null) as { error?: { message: string } } | null }
  } finally { globalThis.fetch = realFetch }
}

const img = { type: 'image_url', image_url: { url: PNG } }
const chat = (content: unknown, extra: Record<string, unknown> = {}) => ({
  model: 'gemini-3.6-flash', max_tokens: 32768, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content }], ...extra,
})

describe('item 2/3: worker model + cap', async () => {
  eq('default model', DEFAULT_MODEL, 'gemini-3.6-flash')
  eq('only that model is allowed', ALLOWED_MODELS, ['gemini-3.6-flash'])
  eq('3.6 kept', pickModel('gemini-3.6-flash'), 'gemini-3.6-flash')
  eq('retired 2.5 flash falls back', pickModel('gemini-2.5-flash'), 'gemini-3.6-flash')
  eq('3.8 flash is not on the shared key', pickModel('gemini-3.8-flash'), 'gemini-3.6-flash')
  eq('Pro still never', pickModel('gemini-3.6-pro'), 'gemini-3.6-flash')
  eq('cap is 32768', MAX_OUTPUT_TOKENS, 32768)
  eq('clamp above', clampMaxTokens(999999), 32768)
  eq('clamp keeps 32768', clampMaxTokens(32768), 32768)
  eq('clamp keeps a smaller ask', clampMaxTokens(8192), 8192)
  const r = await callWorker(chat([img, { type: 'text', text: 'go' }], { max_tokens: 999999 }))
  eq('upstream gets the clamped cap + the new model', [r.sent?.body.generationConfig.maxOutputTokens, r.sent?.url.includes('/models/gemini-3.6-flash:generateContent')], [32768, true])
})

describe('item 3: malformed content parts are ignored, not a crash', async () => {
  const good = await callWorker(chat([null, 5, 'str', { type: 'image_url' }, { type: 'image_url', image_url: null }, { type: 'image_url', image_url: { url: 7 } }, { type: 'text' }, { type: 'text', text: 4 }, img, { type: 'text', text: 'go' }]))
  eq('good parts survive → 200', good.res.status, 200)
  eq('only the system text, the image and the text reach Gemini', (good.sent?.body.contents[0].parts ?? []).length, 3)
  const onlyBad = await callWorker(chat([null, { type: 'image_url' }]))
  eq('only malformed parts → a clean 400 (with CORS headers)', [onlyBad.res.status, onlyBad.res.headers.get('access-control-allow-origin')], [400, GOOD_ORIGIN])
  const badMsgs = await callWorker({ messages: [null, 3, { role: 'user', content: [img] }] })
  eq('null / non-object messages are skipped', badMsgs.res.status, 200)
})

describe('item 3: upstream errors become friendly, status kept', async () => {
  const tooMany = await callWorker(chat([img]), { status: 429, text: '{"error":"quota"}' })
  eq('429', [tooMany.res.status, tooMany.json?.error?.message], [429, '识别额度已用完或请求太频繁，请稍后再试，或在「OCR 设置」填自己的 API key'])
  for (const s of [503, 524]) {
    const busy = await callWorker(chat([img]), { status: s, text: 'overloaded' })
    eq(`${s}`, [busy.res.status, busy.json?.error?.message], [s, '识别模型正忙，请过一会儿再试'])
  }
  const other = await callWorker(chat([img]), { status: 500, text: 'boom' })
  eq('other statuses keep the raw upstream text', [other.res.status, other.json?.error?.message], [500, 'Gemini 500: boom'])
})

// ── 11. merge ──────────────────────────────────────────────────────────────

describe('item 11: merging crops never fuses two bars', () => {
  const body = (s: string) => `Key: C   Time: 4/4\n${s}`
  eq('previous ends mid-bar → " |" inserted', mergeOcrResults(body('| 1 2 3 4 | 5 6 7 1'), body('4 3 2 1 ||')), 'Key: C   Time: 4/4\n| 1 2 3 4 | 5 6 7 1 |\n4 3 2 1 ||')
  for (const end of ['|', '||', ':|', '||&dc', '||&fine', ':|&x']) {
    eq(`previous ends with ${end} → left alone`, mergeOcrResults(`| 1 2 3 4 ${end}`, '| 5 6 7 1 ||'), `| 1 2 3 4 ${end}\n| 5 6 7 1 ||`)
  }
  for (const start of ['|', '||', '|:', ':|']) {
    eq(`next starts with ${start} → left alone`, mergeOcrResults('| 1 2 3 4 | 5', `${start} 6 7 1 ||`), `| 1 2 3 4 | 5\n${start} 6 7 1 ||`)
  }
  eq('barline glued to the last note counts', mergeOcrResults('| 1 2 3 4|', '5 6 7 1 ||'), '| 1 2 3 4|\n5 6 7 1 ||')
  eq('a hairpin end is not a barline', mergeOcrResults('| 1 2 3 !', '4 ||'), '| 1 2 3 ! |\n4 ||')
  eq('empty previous body → nothing inserted', mergeOcrResults('Key: C', '| 1 2 ||'), 'Key: C\n| 1 2 ||')
  const fused = parseFromText(mergeOcrResults('Key: C   Time: 4/4\n| 1 2 3 4 | 5 6 7 1', '4 3 2 1 | 2 2 2 2 ||'))
  eq('parses as 4 measures, not 3', fused.measures.length, 4)
})

describe('item 11: headers are read with the text editor\'s reader', () => {
  eq('lower-case + full-width colon headers are headers', mergeOcrResults('| 1 ||', 'title： 月亮\ntime : 3/4\n| 2 ||'), 'Title: 月亮\nTime: 3/4\n| 1 ||\n| 2 ||')
  eq('1=Bb is read as Bb', mergeOcrResults('| 1 ||', 'Key: 1=Bb\n| 2 ||'), 'Key: Bb\n| 1 ||\n| 2 ||')
  eq('a title that mentions Tempo/Key stays a title', mergeOcrResults('| 1 ||', 'Title: Tempo: 60 Key: G study\n| 2 ||'), 'Title: Tempo: 60 Key: G study\n| 1 ||\n| 2 ||')
  eq('a field the first crop has is not overwritten', mergeOcrResults('Key: G\n| 1 ||', 'Key: F   Tempo: 90\n| 2 ||'), 'Key: G\nTempo: 90\n| 1 ||\n| 2 ||')
  eq('a header line can carry several fields, all read', mergeOcrResults('| 1 ||', 'Key: D   Time: 6/8   Tempo: 72\n| 2 ||'), 'Key: D   Time: 6/8   Tempo: 72\n| 1 ||\n| 2 ||')
})

// ── 12. normalize ──────────────────────────────────────────────────────────

describe('item 12: full-width ASCII on body lines', () => {
  eq('／ → /', normalizeOcrText('| 1／ 2／／ 3 4 |'), '| 1/ 2// 3 4 |')
  eq('～ and 〜 → ~', normalizeOcrText('| ～３ 1/ 2/ 3/ 〜３ 1/ 2/ 3/ |'), '| ~3 1/ 2/ 3/ ~3 1/ 2/ 3/ |')
  eq('｛｝ volta', normalizeOcrText('｜ ｛１｝ 5 6 ｜'), '| {1} 5 6 |')
  eq('［］ multi-rest and articulation', normalizeOcrText('［４］ ｜ １［＞］ ２ ｜'), '[4] | 1[>] 2 |')
  eq('＠ time signature', normalizeOcrText('｜ ＠３／４ 1 2 3 ｜'), '| @3/4 1 2 3 |')
  eq('＆ dynamics', normalizeOcrText('｜ ＆ｍｆ 1 2 ｜'), '| &mf 1 2 |')
  eq('＜ ＞ ！ hairpins', normalizeOcrText('｜ ＜ 1 2 ！ ＞ 3 ｜'), '| < 1 2 ! > 3 |')
  eq('chord ：', normalizeOcrText('｜ ５：３ ｜'), '| 5:3 |')
  eq('legacy rules still apply', normalizeOcrText('| （1’ 2－） 3 |'), "| (1' 2-) 3 |")
  eq('underscore dialect still → /', normalizeOcrText('| 1_ 2__ |'), '| 1/ 2// |')
  eq('a full-width underscore is the same dialect', normalizeOcrText('| 1＿ |'), '| 1/ |')
  eq('dotted quarter untouched', normalizeOcrText('| 1． 2 |'), '| 1. 2 |')
  const parsed = parseFromText(normalizeOcrText('Key: C   Time: 4/4\n｜ ｛１｝ ～３ 1／ 2／ 3／ 4 ｜'))
  eq('a full-width body parses', parsed.measures.length, 1)
})

describe('item 12: header lines keep their own rules, Title is left alone', () => {
  eq('Key/Time/Tempo: ： and digits', normalizeOcrText('Key： C   Time： ４／４   Tempo： １２０\n| 1 |'), 'Key: C   Time: 4/4   Tempo: 120\n| 1 |')
  eq('Key with a full-width sharp', normalizeOcrText('Key： Ｆ＃\n| 1 |'), 'Key: F#\n| 1 |')
  eq('Title: only the separator and digits change', normalizeOcrText('Title： 月亮！（变奏），Op．２／～\n| 1 |'), 'Title: 月亮！（变奏），Op．2／～\n| 1 |')
  eq('Title keeps a colon inside its text', normalizeOcrText('Title: 注：快板\n| 1 |'), 'Title: 注：快板\n| 1 |')
  eq('Title keeps underscores', normalizeOcrText('Title: my_song\n| 1_ |'), 'Title: my_song\n| 1/ |')
})

// ── 13. prompts ────────────────────────────────────────────────────────────

describe('item 13: prompts', () => {
  for (const [name, p] of [['jianpu', JIANPU_OCR_PROMPT], ['western', WESTERN_TO_JIANPU_PROMPT]] as const) {
    eq(`${name}: Key is a plain letter, not 1=Bb`, [p.includes('Bb'), p.includes('F#'), p.includes('1=Bb')], [true, true, true])
    eq(`${name}: odd-sized tuplet groups are ~3:2`, p.includes('~3:2'), true)
    eq(`${name}: tokens are separated by spaces`, name === 'jianpu' ? p.includes('一律用空格隔开') : p.includes('always separated by spaces'), true)
    eq(`${name}: still no underscores`, p.includes('_'), false)
  }
})

// ── 6. crop source ─────────────────────────────────────────────────────────

describe('item 6: a crop remembers the picture it came from', () => {
  const whole = new File(['w'], 'score.png', { type: 'image/png' })
  const crop1 = new File(['1'], 'score_crop.png', { type: 'image/png' })
  const crop2 = new File(['2'], 'score_crop.png', { type: 'image/png' })
  eq('a file nobody cropped is its own source', cropSourceOf(whole), whole)
  rememberCropSource(crop1, whole)
  eq('a crop points at the whole picture', cropSourceOf(crop1), whole)
  rememberCropSource(crop2, crop1)
  eq('a crop of a crop still points at the original', cropSourceOf(crop2), whole)
  eq('the original is unchanged', cropSourceOf(whole), whole)
})

// ── run ────────────────────────────────────────────────────────────────────

for (const t of pending) await t()
console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
