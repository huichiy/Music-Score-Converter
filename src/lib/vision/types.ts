// Provider-agnostic vision adapter contract.
//
// Each provider (Groq, Gemini, Anthropic, OpenAI, or a custom OpenAI-compatible
// endpoint such as our Cloudflare Worker) implements VisionAdapter and the
// useOcr hook picks one at call time based on OcrConfig.

export type OcrMode = 'jianpu' | 'western'

export interface VisionAdapter {
  /** Display name used in error messages, e.g. "Groq Llama 4 Scout". */
  readonly name: string
  /** Send the image through the provider's vision model and return the raw text. */
  transcribe(file: File | Blob, mode: OcrMode): Promise<string>
}

export type OcrProvider =
  | 'auto'        // hit the built-in Cloudflare Worker proxy (default for production)
  | 'groq'        // BYOK Groq Llama 4 vision
  | 'gemini'      // BYOK Google Gemini
  | 'anthropic'   // BYOK Anthropic Claude
  | 'openai'      // BYOK OpenAI GPT-4o
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
  auto:      'gemini-2.5-flash',                   // worker resolves this anyway
  groq:      'meta-llama/llama-4-scout-17b-16e-instruct',
  gemini:    'gemini-2.5-flash',
  anthropic: 'claude-3-5-sonnet-20241022',
  openai:    'gpt-4o-mini',
  custom:    'gpt-4o-mini',
}

/** Models we let the user pick in the Settings UI. Each list is provider-specific. */
export const MODEL_OPTIONS: Record<OcrProvider, { id: string; label: string; note?: string }[]> = {
  auto: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: '默认 · 速度+准确度平衡' },
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   note: '最强，但日限额小' },
  ],
  groq: [
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct',     label: 'Llama 4 Scout 17B' },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: '1500 req/day 免费' },
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   note: '50 req/day 免费，更强' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', note: '备用' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', note: '中文表现极佳' },
    { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku',  note: '便宜，速度快' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', note: '便宜版' },
    { id: 'gpt-4o',      label: 'GPT-4o',      note: '完整版' },
  ],
  custom: [
    { id: 'gpt-4o-mini', label: '默认（gpt-4o-mini 形式）' },
  ],
}

/** Where we store the user's BYOK config in the browser. Keys never leave this device. */
export const OCR_CONFIG_KEY = 'jianpu.ocr.config.v1'
