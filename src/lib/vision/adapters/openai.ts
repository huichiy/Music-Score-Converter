import type { VisionAdapter } from '../types'
import { DEFAULT_MODELS } from '../types'
import { createOpenAICompatAdapter } from './openaiCompat'

export function createOpenAIAdapter(apiKey: string, model = DEFAULT_MODELS.openai): VisionAdapter {
  return createOpenAICompatAdapter({
    name: `OpenAI ${model}`,
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey,
    model,
    // GPT-6 models are reasoning models: they take max_completion_tokens (thinking
    // counts against it — 25000 leaves room for a dense page), no sampling
    // parameters, and a reasoning_effort. `low` is enough for transcription.
    tokenLimit: { field: 'max_completion_tokens', value: 25000 },
    temperature: null,
    extraBody: { reasoning_effort: 'low' },
  })
}
