import type { VisionAdapter } from '../types'
import { DEFAULT_MODELS } from '../types'
import { createOpenAICompatAdapter } from './openaiCompat'

/**
 * The built-in 默认 channel: our Cloudflare Worker, which holds the shared Gemini
 * key (so the Authorization header is a dummy the Worker ignores). 32768 output
 * tokens, the Worker's own cap — Gemini counts thinking against it and 8192
 * cut a dense page off after a quarter of its bars.
 */
export function createWorkerAdapter(url: string, model = DEFAULT_MODELS.auto): VisionAdapter {
  return createOpenAICompatAdapter({
    name: 'Gemini（默认渠道）',
    endpoint: url,
    apiKey: 'auto',
    model,
    viaWorker: true,
    tokenLimit: { field: 'max_tokens', value: 32768 },
  })
}
