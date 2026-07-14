// Cloudflare Worker that proxies the app's OCR requests to Google Gemini,
// attaching the API key on the server side so it never ships to browsers.
//
// The app speaks the OpenAI chat-completions shape (so other adapters can
// reuse the same Custom adapter). This worker translates OpenAI → Gemini.
//
// Deploy:
//   1. cd worker/
//   2. wrangler secret put GEMINI_API_KEY   (paste your Google AI Studio key)
//   3. wrangler deploy
//   4. Set VITE_OCR_WORKER_URL=<worker url> in your build .env

export interface Env {
  GEMINI_API_KEY: string
  /** Optional comma-separated list of allowed Origin headers. Defaults to "*". */
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
  model: string
  messages: OpenAIChatMessage[]
  max_tokens?: number
  temperature?: number
}

interface GeminiPart {
  text?: string
  inline_data?: { mime_type: string; data: string }
}

function corsHeaders(req: Request, env: Env): HeadersInit {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim())
  const origin = req.headers.get('origin') || ''
  const allowOrigin = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : 'null')
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(req, env) })
    }
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(req, env) })
    }
    if (!env.GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: { message: 'Worker not configured: GEMINI_API_KEY secret missing' } }),
        { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders(req, env) } },
      )
    }

    let body: OpenAIRequest
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: { message: 'Invalid JSON body' } }),
        { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders(req, env) } },
      )
    }

    // Translate OpenAI chat format → Gemini generateContent format
    const parts: GeminiPart[] = []
    let systemText = ''
    for (const msg of body.messages) {
      if (msg.role === 'system') {
        systemText += (typeof msg.content === 'string' ? msg.content : '') + '\n'
        continue
      }
      if (msg.role !== 'user') continue
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content })
      } else {
        for (const c of msg.content) {
          if (c.type === 'text') parts.push({ text: c.text })
          else if (c.type === 'image_url') {
            // OpenAI sends a data URL — split header from data
            const url = c.image_url.url
            const m = url.match(/^data:([^;]+);base64,(.+)$/)
            if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } })
          }
        }
      }
    }
    if (systemText) parts.unshift({ text: systemText.trim() })

    const model = body.model || 'gemini-2.5-flash'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`

    let upstream: Response
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: body.temperature ?? 0,
            // 8192 default: Gemini 2.5 thinking tokens count against this
            // budget; 2048 truncated long scores (clients also send 8192)
            maxOutputTokens: body.max_tokens ?? 8192,
          },
        }),
      })
    } catch (e) {
      return new Response(
        JSON.stringify({ error: { message: `Upstream fetch failed: ${(e as Error).message}` } }),
        { status: 502, headers: { 'content-type': 'application/json', ...corsHeaders(req, env) } },
      )
    }

    if (!upstream.ok) {
      const errText = await upstream.text()
      return new Response(
        JSON.stringify({ error: { message: `Gemini ${upstream.status}: ${errText.slice(0, 400)}` } }),
        { status: upstream.status, headers: { 'content-type': 'application/json', ...corsHeaders(req, env) } },
      )
    }

    const upstreamData = await upstream.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = upstreamData.candidates?.[0]?.content?.parts?.[0]?.text || '（无输出）'

    // Wrap in OpenAI chat-completions shape so the app's Custom adapter can consume it directly.
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: text } }],
      }),
      { headers: { 'content-type': 'application/json', ...corsHeaders(req, env) } },
    )
  },
}
