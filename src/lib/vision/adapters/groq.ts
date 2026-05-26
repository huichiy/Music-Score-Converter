import type { VisionAdapter } from '../types'
import { DEFAULT_MODELS } from '../types'
import { createOpenAICompatAdapter } from './openaiCompat'

export function createGroqAdapter(apiKey: string, model = DEFAULT_MODELS.groq): VisionAdapter {
  return createOpenAICompatAdapter({
    name: `Groq ${model.split('/').pop() ?? model}`,
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey,
    model,
  })
}
