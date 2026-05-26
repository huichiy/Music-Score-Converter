// Google Gemini Generative Language API — request shape is unique (not OpenAI-compatible)
// so we don't reuse the OpenAI helper here.

import type { OcrMode, VisionAdapter } from '../types'
import { DEFAULT_MODELS } from '../types'
import { systemPromptFor, userPromptFor } from '../prompts'
import { blobToBase64, unwrapModeError } from '../utils'

export function createGeminiAdapter(apiKey: string, model = DEFAULT_MODELS.gemini): VisionAdapter {
  return {
    name: `Gemini ${model.replace(/^gemini-/, '')}`,
    async transcribe(file: File | Blob, mode: OcrMode): Promise<string> {
      const base64 = await blobToBase64(file)
      const mediaType = (file as File).type || 'image/png'
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // Gemini doesn't have a separate "system" role; we prepend the system
          // prompt as the first user message instead.
          contents: [{
            parts: [
              { text: `${systemPromptFor(mode)}\n\n${userPromptFor(mode)}` },
              { inline_data: { mime_type: mediaType, data: base64 } },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 2048 },
        }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const msg = (errBody as { error?: { message?: string } }).error?.message || `Gemini 调用失败：HTTP ${res.status}`
        throw new Error(msg)
      }

      const data = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '（无输出）'
      return unwrapModeError(text)
    },
  }
}
