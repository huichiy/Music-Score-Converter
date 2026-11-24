// Shared OpenAI-compatible chat-completions implementation.
// Covers: Groq, OpenAI, and any custom endpoint that speaks the same protocol
// (Together, OpenRouter, LM Studio, vLLM, our own Cloudflare Worker, etc.).

import type { OcrMode, VisionAdapter } from '../types'
import { systemPromptFor, userPromptFor } from '../prompts'
import {
  blobToBase64, extractOpenAIText, unwrapModeError, withTimeout, httpErrorMessage,
  OWN_KEY_429_MSG, DEFAULT_CHANNEL_429_MSG,
} from '../utils'

interface OpenAICompatOpts {
  name: string
  endpoint: string         // e.g. https://api.groq.com/openai/v1/chat/completions
  apiKey: string
  model: string
  extraHeaders?: Record<string, string>
  /** True for our own Worker: a 429 there means the shared free quota, not the user's key. */
  viaWorker?: boolean
  /**
   * Output cap. Default `max_tokens: 8192` — a dense score needs ~1-2k output
   * tokens, but thinking models count their thinking against the cap too.
   * OpenAI deprecates `max_tokens` in favour of `max_completion_tokens`.
   */
  tokenLimit?: { field: 'max_tokens' | 'max_completion_tokens'; value: number }
  /** Default 0. `null` omits it (OpenAI's reasoning models take no sampling parameters). */
  temperature?: number | null
  /** Provider-specific body fields (Groq `reasoning_format`, OpenAI `reasoning_effort`). */
  extraBody?: Record<string, unknown>
}

export function createOpenAICompatAdapter(opts: OpenAICompatOpts): VisionAdapter {
  const limit = opts.tokenLimit ?? { field: 'max_tokens', value: 8192 }
  const temperature = opts.temperature === undefined ? 0 : opts.temperature
  return {
    name: opts.name,
    transcribe(file: File | Blob, mode: OcrMode, signal?: AbortSignal): Promise<string> {
      return withTimeout(async (sig) => {
        const base64 = await blobToBase64(file)
        const mediaType = (file as File).type || 'image/png'

        const res = await fetch(opts.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
            ...(opts.extraHeaders || {}),
          },
          signal: sig,
          body: JSON.stringify({
            model: opts.model,
            [limit.field]: limit.value,
            ...(temperature === null ? {} : { temperature }),
            ...(opts.extraBody || {}),
            messages: [
              { role: 'system', content: systemPromptFor(mode) },
              {
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
                  { type: 'text', text: userPromptFor(mode) },
                ],
              },
            ],
          }),
        })

        if (!res.ok) {
          throw new Error(await httpErrorMessage(res, opts.name, opts.viaWorker ? DEFAULT_CHANNEL_429_MSG : OWN_KEY_429_MSG))
        }

        // finish_reason length / content_filter and empty replies throw a friendly error
        return unwrapModeError(extractOpenAIText(await res.json()))
      }, { signal })
    },
  }
}
