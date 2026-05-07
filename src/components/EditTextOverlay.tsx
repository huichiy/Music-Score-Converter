import { useState, useEffect } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { serializeToText } from '@/lib/editor'

interface EditTextOverlayProps {
  onSave: (text: string) => void
  onClose: () => void
}

export default function EditTextOverlay({ onSave, onClose }: EditTextOverlayProps) {
  const editTextVisible = useScoreStore((s) => s.editTextVisible)
  const currentMeasures = useScoreStore((s) => s.currentMeasures)
  const currentKeyStr = useScoreStore((s) => s.currentKeyStr)
  const originalTimeStr = useScoreStore((s) => s.originalTimeStr)
  const originalTempoStr = useScoreStore((s) => s.originalTempoStr)

  const [text, setText] = useState('')

  useEffect(() => {
    if (editTextVisible && currentMeasures) {
      setText(serializeToText(currentMeasures, currentKeyStr, originalTimeStr, originalTempoStr))
    }
  }, [editTextVisible, currentMeasures, currentKeyStr, originalTimeStr, originalTempoStr])

  if (!editTextVisible) return null

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '16px',
    padding: '24px',
    width: '100%',
    maxWidth: '640px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxHeight: '80vh',
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>文本编辑</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: '18px' }}>✕</button>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--color-muted)', lineHeight: '1.6' }}>
          格式：<code style={{ fontFamily: 'monospace' }}>| 1 2' 3, 0 |</code>　音符：[#/b]度数['/,][时值][d]　时值：w h q e x　延音：-　小节线：|
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="font-mono text-sm resize-none outline-none rounded-lg p-3"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-foreground)',
            flex: 1,
          }}
          spellCheck={false}
        />

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => onSave(text)}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '8px',
              background: 'var(--color-accent)',
              color: '#fff',
              border: 'none',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            保存并渲染
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '8px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-muted)',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
