// Google Gemini Generative Language API — request shape is unique (not OpenAI-compatible)
// so we don't reuse the OpenAI helper here.

import type { OcrMode, VisionAdapter } from '../types'
import { DEFAULT_MODELS } from '../types'
import { systemPromptFor, userPromptFor } from '../prompts'
import {
  blobToBase64, extractGeminiText, unwrapModeError, withTimeout, httpErrorMessage, OWN_KEY_429_MSG,
} from '../utils'

export function createGeminiAdapter(apiKey: string, model = DEFAULT_MODELS.gemini): VisionAdapter {
  return {
    name: `Gemini ${model.replace(/^gemini-/, '')}`,
    transcribe(file: File | Blob, mode: OcrMode, signal?: AbortSignal): Promise<string> {
      return withTimeout(async (sig) => {
        const base64 = await blobToBase64(file)
        const mediaType = (file as File).type || 'image/png'
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: sig,
          body: JSON.stringify({
            // Gemini doesn't have a separate "system" role; we prepend the system
            // prompt as the first user message instead.
            contents: [{
              parts: [
                { text: `${systemPromptFor(mode)}\n\n${userPromptFor(mode)}` },
                { inline_data: { mime_type: mediaType, data: base64 } },
              ],
            }],
            // 32768: thinking tokens count against maxOutputTokens. 8192 truncated a
            // dense page after 9-10 of its 40 bars; with this cap all 39 came back.
            generationConfig: { temperature: 0, maxOutputTokens: 32768 },
          }),
        })

        if (!res.ok) throw new Error(await httpErrorMessage(res, 'Gemini', OWN_KEY_429_MSG))

        // Joins every text part; empty / blocked / truncated replies throw a friendly error
        return unwrapModeError(extractGeminiText(await res.json()))
      }, { signal })
    },
  }
}
