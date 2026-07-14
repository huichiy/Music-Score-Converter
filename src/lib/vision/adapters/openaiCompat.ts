// Shared OpenAI-compatible chat-completions implementation.
// Covers: Groq, OpenAI, and any custom endpoint that speaks the same protocol
// (Together, OpenRouter, LM Studio, vLLM, our own Cloudflare Worker, etc.).

import type { OcrMode, VisionAdapter } from '../types'
import { systemPromptFor, userPromptFor } from '../prompts'
import { blobToBase64, unwrapModeError } from '../utils'

interface OpenAICompatOpts {
  name: string
  endpoint: string         // e.g. https://api.groq.com/openai/v1/chat/completions
  apiKey: string
  model: string
  extraHeaders?: Record<string, string>
}

export function createOpenAICompatAdapter(opts: OpenAICompatOpts): VisionAdapter {
  return {
    name: opts.name,
    async transcribe(file: File | Blob, mode: OcrMode): Promise<string> {
      const base64 = await blobToBase64(file)
      const mediaType = (file as File).type || 'image/png'

      const res = await fetch(opts.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
          ...(opts.extraHeaders || {}),
        },
        body: JSON.stringify({
          model: opts.model,
          // 8192: a dense score needs ~1-2k output tokens, and the default path
          // (Worker → Gemini 2.5 Flash) counts THINKING tokens against this
          // budget — 2048 used to truncate long scores after a few measures
          max_tokens: 8192,
          temperature: 0,
          messages: [
            { role: 'system', content: systemPromptFor(mode) },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
                { type: 'text', text: userPromptFor(mode) },
              ],
            },
          ],
        }),
      })

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error('识别额度不足或请求太频繁（HTTP 429）——默认渠道只支持 Gemini 2.5 Flash；要用更强的模型请在「OCR 设置」填自己的 API key，或稍后再试')
        }
        const errBody = await res.json().catch(() => ({}))
        const msg = (errBody as { error?: { message?: string } }).error?.message || `${opts.name} 调用失败：HTTP ${res.status}`
        throw new Error(msg)
      }

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      const text = data.choices?.[0]?.message?.content?.trim() || '（无输出）'
      return unwrapModeError(text)
    },
  }
}
