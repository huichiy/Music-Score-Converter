// Anthropic Claude — browser calls need the dangerous-direct-browser-access
// header (Anthropic explicitly allows BYOK from browsers when this header is set).

import type { OcrMode, VisionAdapter } from '../types'
import { DEFAULT_MODELS } from '../types'
import { systemPromptFor, userPromptFor } from '../prompts'
import { blobToBase64, extractAnthropicText, unwrapModeError } from '../utils'

export function createAnthropicAdapter(apiKey: string, model = DEFAULT_MODELS.anthropic): VisionAdapter {
  return {
    name: `Anthropic ${model.replace(/^claude-/, 'Claude ')}`,
    async transcribe(file: File | Blob, mode: OcrMode): Promise<string> {
      const base64 = await blobToBase64(file)
      const mediaType = (file as File).type || 'image/png'

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          // 4096 = safe cap across Claude vision models; 2048 truncated long scores
          max_tokens: 4096,
          temperature: 0,
          system: systemPromptFor(mode),
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: userPromptFor(mode) },
            ],
          }],
        }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const msg = (errBody as { error?: { message?: string } }).error?.message || `Anthropic 调用失败：HTTP ${res.status}`
        throw new Error(msg)
      }

      // Joins every text block; empty / refused / truncated replies throw a friendly error
      return unwrapModeError(extractAnthropicText(await res.json()))
    },
  }
}
