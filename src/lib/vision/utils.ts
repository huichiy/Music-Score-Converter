// Shared helpers used by every adapter.

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
  // Checked before "empty": Gemini 2.5 can burn the whole budget on thinking
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

// Same four keys as parseFromText's header detection (editor.ts). Tolerant of
// case and leading space because the model's output can drift.
const HEADER_LINE_RE = /^\s*(?:Title|Key|Time|Tempo)\s*:/i

/**
 * Normalize raw OCR model output into Route B text (docs/JIANPU_FORMAT.md):
 * - strip markdown code fences
 * - full-width punctuation/digits/space → half-width (｜ ： ． ， ＃ and ０-９)
 * - body lines only: look-alike glyphs → Route B — curly/prime apostrophes
 *   ’ ‘ ′ → ' (high octave), full-width/em/en dashes － — – → - (extension),
 *   full-width parens （ ） → ( ) (slurs)
 * - body lines only: legacy dialect fallback `_` → `/` (underscore has no
 *   meaning in Route B). A header line such as `Title: my_song` is free text
 *   and is left alone.
 * - deliberately does NOT touch `1.` — the dot is the dotted-quarter suffix and
 *   cannot be safely disambiguated from a legacy low-octave dot; the prompts
 *   forbid the dot dialect instead.
 */
export function normalizeOcrText(raw: string): string {
  let s = raw.replace(/```[a-zA-Z]*\n?/g, '')
  const charMap: Record<string, string> = {
    '｜': '|', '：': ':', '．': '.', '，': ',', '＃': '#', '　': ' ',
  }
  s = s.replace(/[｜：．，＃　]/g, (c) => charMap[c])
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30))
  return s.split('\n').map((line) => {
    if (HEADER_LINE_RE.test(line)) return line.trimEnd()
    return line
      .replace(/[’‘′]/g, "'")
      .replace(/[－—–−]/g, '-')
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/_/g, '/')
      .trimEnd()
  }).join('\n').trim()
}

const HEADER_FIELDS = {
  Title: /Title:\s*(.+?)\s*$/,
  Key: /Key:\s*([A-G][b#]?)/,
  Time: /Time:\s*(\d+\/\d+)/,
  Tempo: /Tempo:\s*(\d+)/,
} as const
type HeaderField = keyof typeof HEADER_FIELDS

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

function readHeaderFields(lines: string[]): Partial<Record<HeaderField, string>> {
  const out: Partial<Record<HeaderField, string>> = {}
  for (const ln of lines) {
    for (const f of Object.keys(HEADER_FIELDS) as HeaderField[]) {
      const m = ln.match(HEADER_FIELDS[f])
      if (m && out[f] === undefined) out[f] = m[1]
    }
  }
  return out
}

/**
 * Accumulate OCR results: each 框选 crop is a separate request, but the result
 * box is meant to hold the whole part. `next`'s body goes on a new line after
 * `prev`. Its header lines are dropped where `prev` already has that field
 * (a Key: line in the middle of the body would be read as junk notes); a field
 * only `next` has (say, the crop that happened to include the title) is
 * folded into `prev`'s header instead of being lost.
 */
export function mergeOcrResults(prev: string | null | undefined, next: string): string {
  if (!prev || !prev.trim()) return next
  const a = splitHeader(prev)
  const b = splitHeader(next)
  if (!b.body) return prev

  const have = readHeaderFields(a.header)
  const extra = readHeaderFields(b.header)
  const header = [...a.header]
  if (extra.Title !== undefined && have.Title === undefined) header.unshift(`Title: ${extra.Title}`)
  const missing = (['Key', 'Time', 'Tempo'] as const)
    .filter(f => extra[f] !== undefined && have[f] === undefined)
    .map(f => `${f}: ${extra[f]}`)
  if (missing.length > 0) header.push(missing.join('   '))

  const body = [a.body, b.body].filter(Boolean).join('\n')
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
