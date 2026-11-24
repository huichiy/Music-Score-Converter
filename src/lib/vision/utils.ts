// Shared helpers used by every adapter.

import { HEADER_LINE_RE, parseHeaderLine, type HeaderFields } from '../textHeader'

/** Convert a File/Blob to a base64 string (no data: prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/** Inspect a known "image is wrong type" sentinel and rethrow as a friendlier error. */
export function unwrapModeError(text: string): string {
  if (text.startsWith('[错误：') || text.startsWith('[Error:')) {
    throw new Error(text.replace(/^\[错误：|^\[Error:\s*/, '').replace(/\]$/, ''))
  }
  return text
}

// ──────────────────────────────────────────────────────────────────────────
// Time limit + HTTP errors
// ──────────────────────────────────────────────────────────────────────────

/** A request that has not answered after this long is given up on (a dense page can think for a minute or two). */
export const OCR_TIMEOUT_MS = 180_000
export const OCR_TIMEOUT_MSG = '识别超时（3 分钟），请重试或用「框选区域」只框一部分'

/**
 * Run one adapter call under the time limit. `run` gets an AbortSignal to hand
 * to fetch; it fires on timeout and when the caller's own `signal` (the 取消
 * button) fires. The limit covers the whole call, reply body included — a
 * server that sends headers and then stalls must not hang the UI either.
 */
export function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  opts: { signal?: AbortSignal; ms?: number } = {},
): Promise<T> {
  const outer = opts.signal
  if (outer?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
  const ctrl = new AbortController()
  const onOuterAbort = () => ctrl.abort()
  outer?.addEventListener('abort', onOuterAbort)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first: the fetch's own AbortError settles a tick later and must not win the race
      reject(new Error(OCR_TIMEOUT_MSG))
      ctrl.abort()
    }, opts.ms ?? OCR_TIMEOUT_MS)
  })
  return Promise.race([run(ctrl.signal), timedOut]).finally(() => {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  })
}

/** 429 for the user's OWN key (OpenAI / Groq / Gemini / custom). */
export const OWN_KEY_429_MSG = '你的 API key 额度不足或请求太频繁（HTTP 429）'
/** 429 on the built-in channel: the shared free quota ran out, the user can bring their own key. */
export const DEFAULT_CHANNEL_429_MSG = '识别额度已用完或请求太频繁（HTTP 429），请稍后再试，或在「OCR 设置」填自己的 API key'
/** 503 / 524: the model is overloaded or timed out upstream — not the user's fault, retrying helps. */
export const isBusyStatus = (status: number) => status === 503 || status === 524
export const busyMsg = (status: number) => `识别模型正忙（HTTP ${status}），请过一会儿再试`

/**
 * The message for a non-2xx reply. 503 / 524 say the model is busy and 429 uses
 * `rateLimit` when the adapter has wording for it; anything else shows the
 * provider's own error text (or HTTP n).
 */
export async function httpErrorMessage(res: Response, name: string, rateLimit?: string): Promise<string> {
  if (isBusyStatus(res.status)) return busyMsg(res.status)
  if (res.status === 429 && rateLimit) return rateLimit
  const errBody = await res.json().catch(() => ({}))
  return (errBody as { error?: { message?: string } }).error?.message || `${name} 调用失败：HTTP ${res.status}`
}

// ──────────────────────────────────────────────────────────────────────────
// Reading a provider's response. Every adapter funnels through one of the
// three extractors below so an empty, blocked or cut-off answer becomes a
// friendly error — never a fake "result" that lands in the result box.
// ──────────────────────────────────────────────────────────────────────────

const EMPTY_MSG = '模型没有返回内容——请重试，或换一张更清晰的图片'
const TRUNCATED_MSG = '识别结果被截断（输出长度超限）——请用「框选区域」只框住一部分再识别，识别结果会自动接在后面'
const blockedMsg = (why: string) => `识别被模型拒绝或被安全过滤拦截（${why}）——请换一张图片或换个模型再试`

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
  }>
  promptFeedback?: { blockReason?: string }
}

/** Join every text part of a Gemini reply; throw a friendly error when it is unusable. */
export function extractGeminiText(data: GeminiResponse): string {
  const cand = data.candidates?.[0]
  if (!cand) {
    const why = data.promptFeedback?.blockReason
    throw new Error(why ? blockedMsg(why) : EMPTY_MSG)
  }
  // Thought parts are the model's scratchpad, not transcription
  const text = (cand.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('').trim()
  const reason = cand.finishReason
  // Checked before "empty": a thinking model can burn the whole budget on thinking
  if (reason === 'MAX_TOKENS') throw new Error(TRUNCATED_MSG)
  if (reason && reason !== 'STOP' && reason !== 'FINISH_REASON_UNSPECIFIED') throw new Error(blockedMsg(reason))
  if (!text) throw new Error(EMPTY_MSG)
  return text
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
  stop_reason?: string | null
}

/** Join every text block of an Anthropic reply; throw a friendly error when it is unusable. */
export function extractAnthropicText(data: AnthropicResponse): string {
  const text = (data.content ?? [])
    .filter(b => (b.type === undefined || b.type === 'text') && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('\n')
    .trim()
  if (data.stop_reason === 'max_tokens') throw new Error(TRUNCATED_MSG)
  if (data.stop_reason === 'refusal') throw new Error(blockedMsg('refusal'))
  if (!text) throw new Error(EMPTY_MSG)
  return text
}

interface OpenAIResponse {
  choices?: Array<{
    finish_reason?: string | null
    message?: { content?: string | Array<{ type?: string; text?: string }> | null; refusal?: string | null }
  }>
}

/** Read an OpenAI chat-completions reply (Groq, OpenAI, custom endpoints, our Worker). */
export function extractOpenAIText(data: OpenAIResponse): string {
  const choice = data.choices?.[0]
  const content = choice?.message?.content
  const text = (typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map(p => p.text ?? '').join('') : ''
  ).trim()
  if (choice?.finish_reason === 'length') throw new Error(TRUNCATED_MSG)
  if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) throw new Error(blockedMsg('content_filter'))
  if (!text) throw new Error(EMPTY_MSG)
  return text
}

// ──────────────────────────────────────────────────────────────────────────
// Input images
// ──────────────────────────────────────────────────────────────────────────

/** Image types every vision provider we support accepts. HEIC / BMP / SVG are not on it. */
export const OCR_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

const EXT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
}

/**
 * The supported media type of an upload, or null when it can't be sent to OCR.
 * Some browsers hand over an empty `type` (drag from certain apps), so an
 * unknown type falls back to the file extension; a real but unsupported type
 * (e.g. image/heic from an iPhone) is rejected outright.
 */
export function resolveOcrImageType(name: string, type: string): string | null {
  const t = type.toLowerCase()
  if (t === 'image/jpg') return 'image/jpeg'
  if (OCR_IMAGE_TYPES.includes(t)) return t
  if (t) return null
  const ext = name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase()
  return (ext && EXT_TYPES[ext]) || null
}

// ──────────────────────────────────────────────────────────────────────────
// OCR text: normalize → merge
// ──────────────────────────────────────────────────────────────────────────

// Header detection is the text editor's own (textHeader.ts): a line one of them
// calls a header is never read as notes by the other. Case-insensitive, and
// both `:` and `：` count.
const TITLE_LINE_RE = /^\s*Title\s*[:：]/i

const FULL_WIDTH_ASCII_RE = /[！-～]/g
const toHalfWidth = (c: string) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
const FULL_WIDTH_DIGIT_RE = /[０-９]/g

/**
 * Normalize raw OCR model output into Route B text (docs/JIANPU_FORMAT.md):
 * - strip markdown code fences
 * - body lines: EVERY full-width ASCII character (U+FF01–U+FF5E: ／ ｛ ｝ ［ ］
 *   ＠ ＆ ＜ ＞ ！ ｜ ： ． ， ＃ （ ） ０-９ …) and the ideographic space →
 *   half-width, and the wave marks ～ 〜 → `~` (tuplet). Vision models happily
 *   answer in full-width when the picture is Chinese.
 * - body lines: look-alike glyphs → Route B — curly/prime apostrophes ’ ‘ ′ →
 *   ' (high octave), em/en dashes — – − → - (extension)
 * - body lines: legacy dialect fallback `_` → `/` (underscore has no meaning in
 *   Route B)
 * - Key / Time / Tempo lines hold nothing but ASCII-ish tokens, so they get the
 *   same full-width → half-width mapping (`Time： ４／４`, `Key： Ｆ＃`)
 * - Title lines are free text: only the colon after `Title` and full-width
 *   digits change; `Title: my_song`, `月亮（变奏）！` are left exactly as printed
 * - deliberately does NOT touch `1.` — the dot is the dotted-quarter suffix and
 *   cannot be safely disambiguated from a legacy low-octave dot; the prompts
 *   forbid the dot dialect instead.
 */
export function normalizeOcrText(raw: string): string {
  const s = raw.replace(/```[a-zA-Z]*\n?/g, '')
  return s.split('\n').map((line) => {
    if (TITLE_LINE_RE.test(line)) {
      return line.replace(/^(\s*Title\s*)：/i, '$1:').replace(FULL_WIDTH_DIGIT_RE, toHalfWidth).trimEnd()
    }
    const ascii = line.replace(FULL_WIDTH_ASCII_RE, toHalfWidth).replace(/　/g, ' ')
    if (HEADER_LINE_RE.test(ascii)) return ascii.trimEnd()
    return ascii
      .replace(/[～〜]/g, '~')
      .replace(/[’‘′]/g, "'")
      .replace(/[—–−]/g, '-')
      .replace(/_/g, '/')
      .trimEnd()
  }).join('\n').trim()
}

/** Split Route B text into header lines + body, mirroring parseFromText (headers = within the first 4 lines). */
function splitHeader(text: string): { header: string[]; body: string } {
  const lines = text.split('\n')
  const header: string[] = []
  let end = 0
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    if (HEADER_LINE_RE.test(lines[i])) { header.push(lines[i]); end = i + 1 }
    else if (lines[i].trim() === '') continue
    else break
  }
  return { header, body: lines.slice(end).join('\n').trim() }
}

/** The fields on a set of header lines; the first line to give a field wins. */
function readHeaderFields(lines: string[]): HeaderFields {
  const out: HeaderFields = {}
  for (const ln of lines) {
    const f = parseHeaderLine(ln)
    if (!f) continue
    out.title ??= f.title
    out.key ??= f.key
    out.time ??= f.time
    out.tempo ??= f.tempo
  }
  return out
}

// A bar ends / starts with one of | || |: :| ||&tag (the tokens editor.ts tokenizes).
const ENDS_WITH_BARLINE_RE = /(?:\|\|?|\|:|:\|)(?:&[^\s|]*)?$/
const STARTS_WITH_BARLINE_RE = /^(?:\|\|?|\|:|:\|)/

/**
 * Accumulate OCR results: each 框选 crop is a separate request, but the result
 * box is meant to hold the whole part. `next`'s body goes on a new line after
 * `prev`. Its header lines are dropped where `prev` already has that field
 * (a Key: line in the middle of the body would be read as junk notes); a field
 * only `next` has (say, the crop that happened to include the title) is
 * folded into `prev`'s header instead of being lost.
 *
 * A crop that ends mid-bar (the model left off the closing barline) followed by
 * one that starts without an opening barline would fuse into ONE bar — line
 * breaks mean nothing to the parser — so a ` |` closes the first.
 */
export function mergeOcrResults(prev: string | null | undefined, next: string): string {
  if (!prev || !prev.trim()) return next
  const a = splitHeader(prev)
  const b = splitHeader(next)
  if (!b.body) return prev

  const have = readHeaderFields(a.header)
  const extra = readHeaderFields(b.header)
  const header = [...a.header]
  if (extra.title !== undefined && have.title === undefined) header.unshift(`Title: ${extra.title}`)
  const missing = (['key', 'time', 'tempo'] as const)
    .filter(f => extra[f] !== undefined && have[f] === undefined)
    .map(f => `${f[0].toUpperCase()}${f.slice(1)}: ${extra[f]}`)
  if (missing.length > 0) header.push(missing.join('   '))

  const joined = a.body && !ENDS_WITH_BARLINE_RE.test(a.body) && !STARTS_WITH_BARLINE_RE.test(b.body)
    ? `${a.body} |`
    : a.body
  const body = [joined, b.body].filter(Boolean).join('\n')
  return [...header, body].join('\n')
}

/** What the last merge did: which picture, the text it merged into, and the text it produced. */
export interface MergeRecord { source: unknown; base: string | null; produced: string }

/**
 * Text to merge a new result into. Pressing 开始识别 again on the SAME picture
 * while the result box is still exactly what the last run produced is a retry,
 * not another crop — so it replaces that run's contribution instead of
 * appending a duplicate. Any manual edit (or a different picture) appends.
 */
export function ocrMergeBase(current: string | null, last: MergeRecord | null, source: unknown): string | null {
  return last && last.source === source && current === last.produced ? last.base : current
}

/**
 * If the text is an OCR error sentinel — `[错误：…]` or `[Error: …]` — return
 * the inner message; otherwise null. Accepts half-width colons too because
 * normalizeOcrText converts 全角 punctuation before this check runs.
 */
export function extractOcrError(text: string): string | null {
  const m = text.trim().match(/^\[(?:错误\s*[：:]|Error:)\s*([\s\S]*?)\]$/)
  return m ? m[1].trim() : null
}

/** Get an Error message regardless of error shape. */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try { return JSON.stringify(e) } catch { return String(e) }
}
