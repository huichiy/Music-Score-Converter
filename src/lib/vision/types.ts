// Provider-agnostic vision adapter contract.
//
// Each provider (Groq, Gemini, Anthropic, OpenAI, or a custom OpenAI-compatible
// endpoint such as our Cloudflare Worker) implements VisionAdapter and the
// useOcr hook picks one at call time based on OcrConfig.

export type OcrMode = 'jianpu' | 'western'

export interface VisionAdapter {
  /** Display name used in error messages, e.g. "Groq qwen3.8-27b". */
  readonly name: string
  /**
   * Send the image through the provider's vision model and return the raw text.
   * Every call is capped at OCR_TIMEOUT_MS; `signal` lets the caller (the 取消
   * button) end it earlier.
   */
  transcribe(file: File | Blob, mode: OcrMode, signal?: AbortSignal): Promise<string>
}

export type OcrProvider =
  | 'auto'        // hit the built-in Cloudflare Worker proxy (default for production)
  | 'groq'        // BYOK Groq (Qwen vision)
  | 'gemini'      // BYOK Google Gemini
  | 'anthropic'   // BYOK Anthropic Claude
  | 'openai'      // BYOK OpenAI GPT-6
  | 'custom'      // any OpenAI-compatible endpoint (URL + key)

export interface OcrConfig {
  provider: OcrProvider
  /** Optional model id override. Each provider has a sensible default. */
  model?: string
  /** API key — required for everything except `auto` (worker has its own key) and dev-only `groq` (env). */
  apiKey?: string
  /** Required for `custom`. Should point at a chat-completions endpoint. */
  customUrl?: string
}

/** Default model per provider — kept in one place so the Settings UI and adapters stay in sync. */
export const DEFAULT_MODELS: Record<OcrProvider, string> = {
  auto:      'gemini-3.6-flash',                   // worker resolves this anyway
  groq:      'qwen/qwen3.8-27b',
  gemini:    'gemini-3.6-flash',
  anthropic: 'claude-sonnet-5-5',
  openai:    'gpt-6-luna',
  custom:    'gpt-6-luna',
}

/** Models we let the user pick in the Settings UI. Each list is provider-specific. */
export const MODEL_OPTIONS: Record<OcrProvider, { id: string; label: string; note?: string }[]> = {
  // 默认渠道走共享的免费档 Gemini key——免费档没有 Pro 配额，放 Pro 必 429；
  // 3.8 Flash 高峰期常忙，共享 key 也不放。想用的用户走 BYOK gemini（自己的 key）。
  auto: [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', note: '默认 · 速度+准确度平衡' },
  ],
  // Both Llama 4 models are shut down; Qwen 3.8 is the only generally listed image model (preview).
  groq: [
    { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', note: '预览版，可能随时下线' },
  ],
  gemini: [
    { id: 'gemini-3.6-flash',      label: 'Gemini 3.6 Flash',      note: '默认' },
    { id: 'gemini-3.8-flash',      label: 'Gemini 3.8 Flash',      note: '更强，高峰期可能繁忙' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', note: '最快，准确度较低' },
  ],
  anthropic: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: '中文表现极佳' },
    { id: 'claude-haiku-5-5',  label: 'Claude Haiku 5.5',  note: '便宜，速度快' },
  ],
  openai: [
    { id: 'gpt-6-luna',    label: 'GPT-6 Luna',     note: '默认 · 便宜' },
    { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra',  note: '视觉更强' },
    { id: 'gpt-6.2-sol',   label: 'GPT-6.2 Sol',    note: '完整版' },
  ],
  // Custom endpoints (OpenRouter, Together, self-hosted…) use arbitrary model
  // ids such as `openai/gpt-6-luna`, so the Settings UI shows a free-text
  // input instead of a list.
  custom: [],
}

/** Where we store the user's BYOK config in the browser. Keys never leave this device. */
export const OCR_CONFIG_KEY = 'jianpu.ocr.config.v1'
