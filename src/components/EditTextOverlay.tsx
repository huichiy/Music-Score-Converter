import { useState, useEffect } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { serializeToText } from '@/lib/editor'

interface EditTextOverlayProps {
  onSave: (text: string) => void
  onClose: () => void
}

const GUIDE_SECTIONS: { label: string; items: [string, string][] }[] = [
  {
    label: '音符',
    items: [
      ['1–7', '度数'],
      ['0', '休止符'],
      ["1'", '高八度'],
      ["1''", '高八度×2'],
      ['1,', '低八度'],
      ['1,,', '低八度×2'],
      ['#1', '升号'],
      ['b1', '降号'],
    ],
  },
  {
    label: '时值',
    items: [
      ['1', '四分（默认）'],
      ['1-', '二分'],
      ['1--', '附点二分'],
      ['1---', '全音符'],
      ['1/', '八分'],
      ['1//', '十六分'],
      ['1.', '附点四分'],
      ['1./', '附点八分'],
      ['1.//', '附点十六分'],
    ],
  },
  {
    label: '力度',
    items: [
      ['&pp', '很弱'],
      ['&p', '弱'],
      ['&mp', '中弱'],
      ['&mf', '中强'],
      ['&f', '强'],
      ['&ff', '很强'],
      ['&fff', '极强'],
      ['&fp', '强后弱'],
      ['&sfp', '突强后弱'],
      ['&sfz', '突强重音'],
    ],
  },
  {
    label: '渐强渐弱',
    items: [
      ['<', '渐强开始'],
      ['>', '渐弱开始'],
      ['!', '结束'],
    ],
  },
  {
    label: '单音表情',
    items: [
      ['1[>]', '重音 accent'],
      ['1[.]', '短促 staccato'],
      ['1[-]', '保持 tenuto'],
      ['1[^]', '强重音 marcato'],
      ['1[$]', '延长 fermata'],
    ],
  },
  {
    label: '倚音',
    items: [
      ['1[2]', '2 装饰 1'],
      ['1[#2]', '可带升降号'],
    ],
  },
  {
    label: '连线',
    items: [
      ['(1 2 3)', '括号内连奏'],
    ],
  },
  {
    label: '小节线',
    items: [
      ['|', '普通'],
      ['||', '双竖线'],
      ['|:', '反复开始'],
      [':|', '反复结束'],
      ['||&fine', 'Fine 终止'],
      ['||&dc', 'D.C. 从头反复'],
      ['||&ds', 'D.S. 从记号反复'],
    ],
  },
  {
    label: '休止',
    items: [
      ['[N]', 'N 小节休止压缩'],
    ],
  },
]

export default function EditTextOverlay({ onSave, onClose }: EditTextOverlayProps) {
  const editTextVisible = useScoreStore((s) => s.editTextVisible)
  const currentMeasures = useScoreStore((s) => s.currentMeasures)
  const currentKeyStr = useScoreStore((s) => s.currentKeyStr)
  const originalTimeStr = useScoreStore((s) => s.originalTimeStr)
  const originalTempoStr = useScoreStore((s) => s.originalTempoStr)
  const originalTitleStr = useScoreStore((s) => s.originalTitleStr)

  const [text, setText] = useState('')
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    if (editTextVisible && currentMeasures) {
      setText(serializeToText(currentMeasures, currentKeyStr, originalTimeStr, originalTempoStr, originalTitleStr))
    }
  }, [editTextVisible, currentMeasures, currentKeyStr, originalTimeStr, originalTempoStr, originalTitleStr])

  // Cmd+Enter / Ctrl+Enter to save
  useEffect(() => {
    if (!editTextVisible) return
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSave(text)
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editTextVisible, text, onSave, onClose])

  if (!editTextVisible) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-background)',
    }}>
      {/* Title bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        height: '48px',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        {/* Title */}
        <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-muted)', letterSpacing: '0.02em' }}>
          简谱 · Jianpu Notation
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={() => setShowGuide(v => !v)}
            style={{
              padding: '4px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              background: showGuide ? 'var(--color-surface-2)' : 'none',
              border: '1px solid var(--color-border)',
              color: showGuide ? 'var(--color-foreground)' : 'var(--color-muted)',
              cursor: 'pointer',
              transition: 'color 0.15s, background 0.15s',
            }}
          >
            ? 格式
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '4px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-muted)',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={() => onSave(text)}
            style={{
              padding: '4px 16px',
              borderRadius: '6px',
              fontSize: '12px',
              background: 'var(--color-accent)',
              border: 'none',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            保存并渲染
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Editor */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          style={{
            flex: 1,
            padding: '28px 32px',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--color-foreground)',
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            fontSize: '14px',
            lineHeight: '1.8',
            resize: 'none',
          }}
          spellCheck={false}
        />

        {/* Format guide panel */}
        {showGuide && (
          <div style={{
            width: '300px',
            borderLeft: '1px solid var(--color-border)',
            padding: '24px 20px',
            flexShrink: 0,
            overflowY: 'auto',
            background: 'var(--color-surface)',
          }}>
            <div style={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.1em',
              color: 'var(--color-muted)',
              marginBottom: '20px',
              textTransform: 'uppercase',
            }}>
              格式说明
            </div>

            {/* Example — first measure of the actual score */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '8px' }}>你的第一小节</div>
              <code style={{
                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                fontSize: '12px',
                color: 'var(--color-foreground)',
                background: 'var(--color-surface-2)',
                padding: '8px 12px',
                borderRadius: '6px',
                display: 'block',
                lineHeight: '1.6',
                wordBreak: 'break-all',
              }}>
                {text.match(/\|[^|\n]+\|/)?.[0]?.trim() ?? '| 1/ 2/ #3 0--- |'}
              </code>
            </div>

            {/* Reference sections */}
            {GUIDE_SECTIONS.map(({ label, items }) => (
              <div key={label} style={{ marginBottom: '18px' }}>
                <div style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  color: 'var(--color-muted)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                }}>{label}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {items.map(([sym, desc]) => (
                    <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <code style={{
                        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                        fontSize: '11px',
                        color: 'var(--color-accent)',
                        background: 'var(--color-surface-2)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        minWidth: '60px',
                        textAlign: 'center',
                        flexShrink: 0,
                      }}>
                        {sym}
                      </code>
                      <span style={{ fontSize: '11px', color: 'var(--color-muted)' }}>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div style={{
              marginTop: '24px',
              paddingTop: '16px',
              borderTop: '1px solid var(--color-border)',
              fontSize: '10px',
              color: 'var(--color-muted)',
              lineHeight: '1.6',
            }}>
              ⌘↵ 保存 · Esc 取消
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
