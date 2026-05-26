import type { VisionAdapter } from '../types'
import { DEFAULT_MODELS } from '../types'
import { createOpenAICompatAdapter } from './openaiCompat'

export function createOpenAIAdapter(apiKey: string, model = DEFAULT_MODELS.openai): VisionAdapter {
  return createOpenAICompatAdapter({
    name: `OpenAI ${model}`,
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey,
    model,
  })
}
