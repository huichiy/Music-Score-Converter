// Public surface of the vision module — pick an adapter, load/save BYOK config.

import type { OcrConfig, OcrProvider, VisionAdapter } from './types'
import { DEFAULT_MODELS, OCR_CONFIG_KEY } from './types'

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
      return createCustomAdapter(config.customUrl, config.apiKey, config.model || DEFAULT_MODELS.custom)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// localStorage persistence. Keys never leave the browser.
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: OcrConfig = { provider: 'auto' }

export function loadOcrConfig(): OcrConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_CONFIG
  try {
    const raw = localStorage.getItem(OCR_CONFIG_KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw) as OcrConfig
    if (!parsed.provider) return DEFAULT_CONFIG
    return parsed
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveOcrConfig(config: OcrConfig): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(OCR_CONFIG_KEY, JSON.stringify(config))
}

export function clearOcrConfig(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(OCR_CONFIG_KEY)
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
