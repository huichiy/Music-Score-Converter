// Cloudflare Worker that proxies the app's OCR requests to Google Gemini,
// attaching the API key on the server side so it never ships to browsers.
//
// The app speaks the OpenAI chat-completions shape (so other adapters can
// reuse the same Custom adapter). This worker translates OpenAI → Gemini.
//
// Because the key is shared and free-tier, the worker is deliberately narrow:
// only allowed Origins, only Gemini 3.6 Flash, a capped output size and a
// capped request body. See README.md for the Cloudflare rate-limiting rule
// that complements this (an Origin header can be forged outside a browser).
//
// Deploy:
//   1. cd worker/
//   2. wrangler secret put GEMINI_API_KEY   (paste your Google AI Studio key)
//   3. wrangler deploy                      (re-run after ANY change here or in wrangler.toml)
//   4. Set VITE_OCR_WORKER_URL=<worker url> in your build .env

export interface Env {
  GEMINI_API_KEY: string
  /**
   * Comma-separated allowed Origin headers (wrangler.toml [vars]). When set,
   * a request from any other Origin — or with none — gets 403. Unset, empty
   * or "*" means open, which is only meant for local `wrangler dev`.
   */
  ALLOWED_ORIGINS?: string
}

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >
}

interface OpenAIRequest {
  model?: string
  messages: OpenAIChatMessage[]
  max_tokens?: number
  temperature?: number
}

interface GeminiPart {
  text?: string
  inline_data?: { mime_type: string; data: string }
}

// The old 2.5 Flash is routed to the weaker 3.5-flash-lite from 2026-12-01; 3.6 Flash
// transcribed a sample exactly where 3.5-flash-lite made errors.
export const DEFAULT_MODEL = 'gemini-3.6-flash'
/**
 * Models a client may ask for. The shared key is free-tier: it has NO Pro
 * quota, so Pro here would only ever 429 — and an unchecked model string
 * would also be interpolated straight into the upstream URL. Never add Pro.
 */
export const ALLOWED_MODELS = [DEFAULT_MODEL]
/**
 * Gemini counts thinking tokens against this. 8192 truncated a dense page after
 * 9-10 of its 40 bars; a test at 40000 returned 36-39 of them.
 */
export const MAX_OUTPUT_TOKENS = 32768
/** Request body cap. A 5 MB image is ~7 MB as base64; this leaves headroom, not a free-for-all. */
export const MAX_BODY_BYTES = 15 * 1024 * 1024

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (exported so scripts/test-ocr-fixes.ts can exercise them)
// ──────────────────────────────────────────────────────────────────────────

/** The allowed Origins, or null when the worker is open (not configured, or "*"). */
export function parseAllowedOrigins(env: Env): string[] | null {
  const list = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  return list.length === 0 || list.includes('*') ? null : list
}

export function originAllowed(req: Request, env: Env): boolean {
  const allowed = parseAllowedOrigins(env)
  if (allowed === null) return true
  return allowed.includes(req.headers.get('origin') || '')
}

/** Only models on the allowlist; anything else (including Pro) falls back to Flash. */
export function pickModel(requested: unknown): string {
  return typeof requested === 'string' && ALLOWED_MODELS.includes(requested) ? requested : DEFAULT_MODEL
}

export function clampMaxTokens(requested: unknown): number {
  const n = Math.floor(Number(requested))
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_OUTPUT_TOKENS) : MAX_OUTPUT_TOKENS
}

export type Translated =
  | { ok: true; text: string }
  | { ok: false; status: number; message: string }

// Same wording as src/lib/vision/utils.ts — the app shows these as-is
const EMPTY_MSG = '模型没有返回内容——请重试，或换一张更清晰的图片'
const TRUNCATED_MSG = '识别结果被截断（输出长度超限）——请用「框选区域」只框住一部分再识别，识别结果会自动接在后面'
const blockedMsg = (why: string) => `识别被模型拒绝或被安全过滤拦截（${why}）——请换一张图片或换个模型再试`

/**
 * Gemini generateContent reply → the text, or an error to send back. Joins
 * every text part (not just the first); an empty, blocked or truncated reply is
 * an error rather than a fake "（无输出）" result.
 */
export function geminiToText(data: {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
  promptFeedback?: { blockReason?: string }
}): Translated {
  const cand = data.candidates?.[0]
  if (!cand) {
    const why = data.promptFeedback?.blockReason
    return { ok: false, status: 502, message: why ? blockedMsg(why) : EMPTY_MSG }
  }
  const text = (cand.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('').trim()
  const reason = cand.finishReason
  if (reason === 'MAX_TOKENS') return { ok: false, status: 502, message: TRUNCATED_MSG }
  if (reason && reason !== 'STOP' && reason !== 'FINISH_REASON_UNSPECIFIED') {
    return { ok: false, status: 502, message: blockedMsg(reason) }
  }
  return text ? { ok: true, text } : { ok: false, status: 502, message: EMPTY_MSG }
}

/**
 * What to tell the app when Gemini answers with an error. The status is kept
 * (the app maps 503 / 524 itself); 429 and "busy" get a Chinese message the app
 * shows as is, anything else passes a slice of Gemini's own text through.
 */
export function upstreamErrorMessage(status: number, upstreamText: string): string {
  if (status === 429) return '识别额度已用完或请求太频繁，请稍后再试，或在「OCR 设置」填自己的 API key'
  if (status === 503 || status === 524) return '识别模型正忙，请过一会儿再试'
  return `Gemini ${status}: ${upstreamText.slice(0, 400)}`
}

/** Read a request body as text, giving up (null) as soon as it passes `limit` bytes. */
export async function readBodyLimited(req: Request, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) return null
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    // A missing or forged Content-Length can't sneak a huge chunked body past us
    if (total > limit) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { merged.set(c, off); off += c.byteLength }
  return new TextDecoder().decode(merged)
}

// ──────────────────────────────────────────────────────────────────────────

function corsHeaders(req: Request, env: Env): HeadersInit {
  const allowed = parseAllowedOrigins(env)
  const origin = req.headers.get('origin') || ''
  const allowOrigin = allowed === null ? '*' : (allowed.includes(origin) ? origin : 'null')
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

function errorResponse(req: Request, env: Env, status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { message } }),
    { status, headers: { 'content-type': 'application/json', ...corsHeaders(req, env) } },
  )
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Checked first, preflight included: a disallowed site never learns anything
    if (!originAllowed(req, env)) return errorResponse(req, env, 403, 'Origin not allowed')

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(req, env) })
    }
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(req, env) })
    }
    if (!env.GEMINI_API_KEY) {
      return errorResponse(req, env, 500, 'Worker not configured: GEMINI_API_KEY secret missing')
    }

    const raw = await readBodyLimited(req, MAX_BODY_BYTES)
    if (raw === null) return errorResponse(req, env, 413, 'Request body too large')

    let body: OpenAIRequest
    try {
      body = JSON.parse(raw)
    } catch {
      return errorResponse(req, env, 400, 'Invalid JSON body')
    }
    if (!body || !Array.isArray(body.messages)) {
      return errorResponse(req, env, 400, 'Invalid request: messages missing')
    }

    // Translate OpenAI chat format → Gemini generateContent format
    const parts: GeminiPart[] = []
    let systemText = ''
    let images = 0
    for (const msg of body.messages) {
      // Anything malformed is skipped rather than thrown on: an uncaught throw
      // reaches the browser as a CORS error with no message at all
      if (!msg || typeof msg !== 'object') continue
      if (msg.role === 'system') {
        systemText += (typeof msg.content === 'string' ? msg.content : '') + '\n'
        continue
      }
      if (msg.role !== 'user') continue
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content })
      } else if (Array.isArray(msg.content)) {
        for (const c of msg.content as unknown[]) {
          if (!c || typeof c !== 'object') continue
          const part = c as { type?: unknown; text?: unknown; image_url?: { url?: unknown } | null }
          if (part.type === 'text') {
            if (typeof part.text === 'string') parts.push({ text: part.text })
          } else if (part.type === 'image_url') {
            const url = part.image_url?.url
            if (typeof url !== 'string') continue
            // OpenAI sends a data URL — split header from data. Only the image
            // types the app can produce; this endpoint is for reading scores.
            const m = url.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/)
            if (m) { parts.push({ inline_data: { mime_type: m[1], data: m[2] } }); images++ }
          }
        }
      }
    }
    // Not an image-to-text call → not what this proxy is for (and not a free general-purpose LLM)
    if (images === 0) return errorResponse(req, env, 400, 'Request must include an image')
    if (systemText) parts.unshift({ text: systemText.trim() })

    const model = pickModel(body.model)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

    let upstream: Response
    try {
      upstream = await fetch(url, {
        method: 'POST',
        // Header, not ?key=: keeps the secret out of any logged URL or error text
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: body.temperature ?? 0,
            maxOutputTokens: clampMaxTokens(body.max_tokens),
          },
        }),
      })
    } catch (e) {
      return errorResponse(req, env, 502, `Upstream fetch failed: ${(e as Error).message}`)
    }

    if (!upstream.ok) {
      const errText = await upstream.text()
      return errorResponse(req, env, upstream.status, upstreamErrorMessage(upstream.status, errText))
    }

    let upstreamData: Parameters<typeof geminiToText>[0]
    try {
      upstreamData = await upstream.json()
    } catch {
      return errorResponse(req, env, 502, 'Upstream returned an unreadable response')
    }
    const result = geminiToText(upstreamData)
    if (!result.ok) return errorResponse(req, env, result.status, result.message)

    // Wrap in OpenAI chat-completions shape so the app's Custom adapter can consume it directly.
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }],
      }),
      { headers: { 'content-type': 'application/json', ...corsHeaders(req, env) } },
    )
  },
}
