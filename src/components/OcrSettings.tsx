import { useState, useEffect } from 'react'
import {
  loadOcrConfig, saveOcrConfig, clearOcrConfig,
  MODEL_OPTIONS, DEFAULT_MODELS,
  type OcrConfig, type OcrProvider,
} from '@/lib/vision'

interface OcrSettingsProps {
  open: boolean
  onClose: () => void
}

const PROVIDER_LABELS: Record<OcrProvider, { name: string; desc: string }> = {
  auto:      { name: '默认 · 自动',  desc: '使用内置 Worker 代理（不需要 API key）' },
  groq:      { name: 'Groq',        desc: 'Llama 4 Vision · 免费但准确度一般' },
  gemini:    { name: 'Google Gemini', desc: '推荐 · 1500 次/天免费，中文好' },
  anthropic: { name: 'Anthropic Claude', desc: '中文表现极佳 · 付费' },
  openai:    { name: 'OpenAI',      desc: 'GPT-4o 系列 · 付费' },
  custom:    { name: 'Custom 端点',  desc: '任意 OpenAI 兼容 API · OpenRouter / Together / 自部署' },
}

const PROVIDER_LINKS: Partial<Record<OcrProvider, { label: string; url: string }>> = {
  groq:      { label: '取 Groq key', url: 'https://console.groq.com/keys' },
  gemini:    { label: '取 Gemini key', url: 'https://aistudio.google.com/apikey' },
  anthropic: { label: '取 Anthropic key', url: 'https://console.anthropic.com/settings/keys' },
  openai:    { label: '取 OpenAI key', url: 'https://platform.openai.com/api-keys' },
}

export default function OcrSettings({ open, onClose }: OcrSettingsProps) {
  const [config, setConfig] = useState<OcrConfig>({ provider: 'auto' })
  const [showKey, setShowKey] = useState(false)

  // Re-seed from localStorage every time the modal opens
  useEffect(() => {
    if (open) {
      setConfig(loadOcrConfig())
      setShowKey(false)
    }
  }, [open])

  if (!open) return null

  const needsKey = config.provider !== 'auto'
  const needsUrl = config.provider === 'custom'
  const providerLink = PROVIDER_LINKS[config.provider]
  const modelOptions = MODEL_OPTIONS[config.provider]

  const handleSave = () => {
    if (needsKey && !config.apiKey?.trim()) {
      alert('请填写 API key')
      return
    }
    if (needsUrl && !config.customUrl?.trim()) {
      alert('请填写 Custom endpoint URL')
      return
    }
    saveOcrConfig({ ...config, apiKey: config.apiKey?.trim(), customUrl: config.customUrl?.trim() })
    onClose()
  }

  const handleReset = () => {
    if (!confirm('清除当前 OCR 设置？将恢复为默认（Worker 代理）')) return
    clearOcrConfig()
    setConfig({ provider: 'auto' })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, maxHeight: '92vh',
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>OCR 设置</div>
          <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
            选择视觉识别模型 — Key 只存在你的浏览器，永不上传
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {/* Provider radio list */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
            Provider
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
            {(Object.keys(PROVIDER_LABELS) as OcrProvider[]).map((p) => {
              const { name, desc } = PROVIDER_LABELS[p]
              const active = config.provider === p
              return (
                <label
                  key={p}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '10px 12px', borderRadius: 8,
                    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: active ? 'color-mix(in srgb, var(--color-accent) 6%, transparent)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="provider"
                    checked={active}
                    onChange={() => setConfig({ provider: p })}
                    style={{ marginTop: 3, accentColor: 'var(--color-accent)' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)' }}>{name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>{desc}</div>
                  </div>
                </label>
              )
            })}
          </div>

          {/* Custom URL (only for custom provider) */}
          {needsUrl && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
                Endpoint URL
              </div>
              <input
                type="url"
                placeholder="https://api.example.com/v1/chat/completions"
                value={config.customUrl || ''}
                onChange={(e) => setConfig({ ...config, customUrl: e.target.value })}
                style={inputStyle}
              />
            </div>
          )}

          {/* Model dropdown */}
          {(needsKey || config.provider === 'auto') && modelOptions.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
                Model
              </div>
              <select
                value={config.model || DEFAULT_MODELS[config.provider]}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
                style={inputStyle}
              >
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.note ? `  ·  ${m.note}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* API key */}
          {needsKey && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>
                  API Key
                </div>
                {providerLink && (
                  <a href={providerLink.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: 'var(--color-accent)', textDecoration: 'none' }}>
                    {providerLink.label} →
                  </a>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  value={config.apiKey || ''}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  style={{ ...inputStyle, paddingRight: 70 }}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  style={{
                    position: 'absolute', right: 4, top: 4, bottom: 4,
                    padding: '0 10px', fontSize: 11,
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4, color: 'var(--color-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 6, lineHeight: 1.6 }}>
                Key 仅保存在你的浏览器 localStorage，永不上传，也不会进 git。
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 20px', borderTop: '1px solid var(--color-border)', flexShrink: 0, gap: 8,
        }}>
          <button onClick={handleReset} style={ghostButtonStyle}>清除设置</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={ghostButtonStyle}>取消</button>
            <button onClick={handleSave} style={primaryButtonStyle}>保存</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-foreground)',
  outline: 'none',
}

const ghostButtonStyle: React.CSSProperties = {
  padding: '7px 14px',
  fontSize: 12,
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-muted)',
  cursor: 'pointer',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '7px 16px',
  fontSize: 12,
  fontWeight: 600,
  background: 'var(--color-accent)',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer',
}
