// Public surface of the vision module — pick an adapter, load/save BYOK config.

import type { OcrConfig, OcrProvider, VisionAdapter } from './types'
import { DEFAULT_MODELS, MODEL_OPTIONS, OCR_CONFIG_KEY } from './types'

import { createGroqAdapter } from './adapters/groq'
import { createGeminiAdapter } from './adapters/gemini'
import { createAnthropicAdapter } from './adapters/anthropic'
import { createOpenAIAdapter } from './adapters/openai'
import { createCustomAdapter } from './adapters/custom'

export type { OcrConfig, OcrProvider, OcrMode, VisionAdapter } from './types'
export { DEFAULT_MODELS, MODEL_OPTIONS } from './types'

// ──────────────────────────────────────────────────────────────────────────
// Build a runnable adapter from a saved config + the build-time fallbacks.
// ──────────────────────────────────────────────────────────────────────────

interface BuildEnv {
  /** URL of our Cloudflare Worker (set at build time). When present, `provider:auto` uses this. */
  workerUrl?: string
  /** Built-in Groq key for dev/legacy fallback. Avoid in production. */
  groqEnvKey?: string
}

export function buildAdapter(config: OcrConfig, env: BuildEnv): VisionAdapter {
  switch (config.provider) {
    case 'auto': {
      // Default path: hit the Worker (which carries our Gemini key)
      if (env.workerUrl) {
        return createCustomAdapter(env.workerUrl, /* dummy key, worker ignores it */ 'auto', config.model || DEFAULT_MODELS.auto)
      }
      // No worker deployed — fall back to dev Groq if we have a build-time key
      if (env.groqEnvKey) {
        return createGroqAdapter(env.groqEnvKey, DEFAULT_MODELS.groq)
      }
      throw new Error('未配置 OCR — 请在「OCR 设置」里填入你的 API key (BYOK)')
    }
    case 'groq': {
      const key = config.apiKey || env.groqEnvKey
      if (!key) throw new Error('Groq 模式需要 API key')
      return createGroqAdapter(key, config.model || DEFAULT_MODELS.groq)
    }
    case 'gemini':
      if (!config.apiKey) throw new Error('Gemini 模式需要 API key')
      return createGeminiAdapter(config.apiKey, config.model || DEFAULT_MODELS.gemini)
    case 'anthropic':
      if (!config.apiKey) throw new Error('Anthropic 模式需要 API key')
      return createAnthropicAdapter(config.apiKey, config.model || DEFAULT_MODELS.anthropic)
    case 'openai':
      if (!config.apiKey) throw new Error('OpenAI 模式需要 API key')
      return createOpenAIAdapter(config.apiKey, config.model || DEFAULT_MODELS.openai)
    case 'custom':
      if (!config.apiKey) throw new Error('Custom 模式需要 API key')
      if (!config.customUrl) throw new Error('Custom 模式需要 endpoint URL')
      try { new URL(config.customUrl) } catch { throw new Error('Custom endpoint URL 格式不对，应形如 https://api.example.com/v1/chat/completions') }
      return createCustomAdapter(config.customUrl, config.apiKey, config.model || DEFAULT_MODELS.custom)
    default:
      // A saved provider this build doesn't know (older/newer version, hand-edited storage)
      throw new Error('未配置 OCR — 保存的识别渠道无法识别，请在「OCR 设置」里重新选择')
  }
}

// ──────────────────────────────────────────────────────────────────────────
// localStorage persistence. Keys never leave the browser.
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: OcrConfig = { provider: 'auto' }

// Config the browser refused to persist. Blocked storage (Chrome "block all
// cookies", some in-app browsers) makes every localStorage access throw; holding
// the config in memory lets BYOK still work until the tab closes.
let memoryConfig: OcrConfig | null = null

/**
 * Drop a saved model id the provider no longer offers (e.g. 默认 channel used
 * to list Pro — a stale localStorage entry would keep 429ing forever; retired
 * Claude / Gemini ids would 404).
 * `custom` endpoints accept arbitrary model strings, so they're left alone.
 */
export function sanitizeOcrConfig(config: OcrConfig): OcrConfig {
  if (!config.model || config.provider === 'custom') return config
  const options = MODEL_OPTIONS[config.provider] ?? []
  if (options.length > 0 && !options.some(o => o.id === config.model)) {
    const { model: _dropped, ...rest } = config
    return rest
  }
  return config
}

// Every storage access — including the `typeof` check, whose getter throws
// when storage is blocked — lives inside try/catch so it can never reach the
// caller (the store reads prefs at module init; a throw there is a white screen).

export function loadOcrConfig(): OcrConfig {
  try {
    const raw = localStorage.getItem(OCR_CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as OcrConfig
      // An unknown provider would also crash the Settings modal (no model list)
      if (parsed && typeof parsed.provider === 'string' && Object.prototype.hasOwnProperty.call(MODEL_OPTIONS, parsed.provider)) {
        return sanitizeOcrConfig(parsed)
      }
    }
  } catch {
    // blocked / unavailable / corrupt → fall through
  }
  return memoryConfig ? sanitizeOcrConfig(memoryConfig) : DEFAULT_CONFIG
}

/** Returns false when the browser refused to persist it (the config still applies for this session). */
export function saveOcrConfig(config: OcrConfig): boolean {
  try {
    localStorage.setItem(OCR_CONFIG_KEY, JSON.stringify(config))
    memoryConfig = null
    return true
  } catch {
    memoryConfig = config
    return false
  }
}

export function clearOcrConfig(): void {
  memoryConfig = null
  try {
    localStorage.removeItem(OCR_CONFIG_KEY)
  } catch {
    // nothing stored, or storage blocked — either way there is nothing to clear
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Build env from Vite env vars. `VITE_OCR_WORKER_URL` is what production
// uses; `VITE_GROQ_API_KEY` is the legacy dev fallback.
// ──────────────────────────────────────────────────────────────────────────

export function buildEnv(): BuildEnv {
  return {
    workerUrl: import.meta.env.VITE_OCR_WORKER_URL || undefined,
    groqEnvKey: import.meta.env.VITE_GROQ_API_KEY || undefined,
  }
}
