import type { VisionAdapter } from '../types'
import { DEFAULT_MODELS } from '../types'
import { createOpenAICompatAdapter } from './openaiCompat'

/** Generic OpenAI-compatible endpoint. Used by BYOK with self-hosted models,
 *  OpenRouter, Together, or anyone speaking the OpenAI chat-completions shape.
 *  Plain `max_tokens` + `temperature: 0`: the lowest common denominator. */
export function createCustomAdapter(url: string, apiKey: string, model = DEFAULT_MODELS.custom): VisionAdapter {
  return createOpenAICompatAdapter({
    name: `Custom (${new URL(url).host})`,
    endpoint: url,
    apiKey,
    model,
  })
}
