import type { VisionAdapter } from '../types'
import { createOpenAICompatAdapter } from './openaiCompat'

/** Generic OpenAI-compatible endpoint. Used by BYOK with self-hosted models,
 *  OpenRouter, Together, or anyone speaking the OpenAI chat-completions shape. */
export function createCustomAdapter(url: string, apiKey: string, model = 'gpt-4o-mini'): VisionAdapter {
  return createOpenAICompatAdapter({
    name: `Custom (${new URL(url).host})`,
    endpoint: url,
    apiKey,
    model,
  })
}
