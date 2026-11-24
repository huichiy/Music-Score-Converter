// Anthropic Claude — browser calls need the dangerous-direct-browser-access
// header (Anthropic explicitly allows BYOK from browsers when this header is set).

import type { OcrMode, VisionAdapter } from '../types'
import { DEFAULT_MODELS } from '../types'
import { systemPromptFor, userPromptFor } from '../prompts'
import { blobToBase64, extractAnthropicText, unwrapModeError, withTimeout, httpErrorMessage } from '../utils'

export function createAnthropicAdapter(apiKey: string, model = DEFAULT_MODELS.anthropic): VisionAdapter {
  return {
    name: `Anthropic ${model.replace(/^claude-/, 'Claude ')}`,
    transcribe(file: File | Blob, mode: OcrMode, signal?: AbortSignal): Promise<string> {
      return withTimeout(async (sig) => {
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
          signal: sig,
          body: JSON.stringify({
            model,
            // Sonnet / Haiku 5.5 think by default and thinking counts against this
            // cap (the Gemini lesson): 4096 risks truncating a dense score.
            // No `temperature`: these models reject any non-default sampling value
            // with a 400, so `temperature: 0` broke every BYOK Claude call.
            max_tokens: 16000,
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

        // Anthropic's own 429 text says which limit was hit, so it is shown as is
        if (!res.ok) throw new Error(await httpErrorMessage(res, 'Anthropic'))

        // Joins every text block; empty / refused / truncated replies throw a friendly error
        return unwrapModeError(extractAnthropicText(await res.json()))
      }, { signal })
    },
  }
}
