import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { serializeToText, parseFromText } from '@/lib/editor'
import type { NotePosition } from '@/lib/editor'
import { renderJianpuSVG } from '@/lib/renderer'

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
  {
    label: '跳房子 / 连音 / 变拍号',
    items: [
      ['{1}', '第 1 遍结尾（跳房子），写在小节线后'],
      ['~3', '三连音：其后 3 个音一组'],
      ['@3/4', '从本小节起变拍号'],
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
  const [previewSvg, setPreviewSvg] = useState('')
  const [caretPos, setCaretPos] = useState(0)
  const [previewWidth, setPreviewWidth] = useState(540)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 600px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const positionsRef = useRef<NotePosition[]>([])
  const lastGoodSvg = useRef<string>('')

  // Seed text from store when opening
  useEffect(() => {
    if (editTextVisible && currentMeasures) {
      setText(serializeToText(currentMeasures, currentKeyStr, originalTimeStr, originalTempoStr, originalTitleStr))
      setCaretPos(0)
    }
  }, [editTextVisible, currentMeasures, currentKeyStr, originalTimeStr, originalTempoStr, originalTitleStr])

  // Observe preview pane width so renderer can adapt
  useEffect(() => {
    if (!editTextVisible || !previewRef.current) return
    const el = previewRef.current
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        if (w > 0) setPreviewWidth(w)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [editTextVisible])

  // Debounced live preview render
  useEffect(() => {
    if (!editTextVisible) return
    const timer = setTimeout(() => {
      try {
        const parsed = parseFromText(text, currentKeyStr, originalTimeStr, originalTempoStr, originalTitleStr)
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
        const svg = renderJianpuSVG(
          parsed.measures,
          parsed.keyStr,
          parsed.timeStr,
          parsed.titleStr || '',
          previewWidth - 40,
          parsed.tempoStr,
          isDark,
        )
        setPreviewSvg(svg)
        lastGoodSvg.current = svg
        positionsRef.current = parsed.positions
      } catch {
        // Parser is tolerant and never throws in practice; if it does, keep the last good preview
      }
    }, 180)
    return () => clearTimeout(timer)
  }, [text, previewWidth, editTextVisible, currentKeyStr, originalTimeStr, originalTempoStr, originalTitleStr])

  // Find which note the caret currently sits in. Returns either a regular note position
  // (measureIdx >= 0) or a rest-measure position (restMeasureIdx defined) or null.
  const currentNote = useMemo(() => {
    const positions = positionsRef.current
    // Primary: caret is INSIDE a token's range
    for (const p of positions) {
      if (caretPos >= p.start && caretPos <= p.end) {
        // Highlightable note OR rest-measure token — both are returned
        if (p.measureIdx >= 0) return p
        if (p.restMeasureIdx !== undefined) return p
        return null
      }
    }
    // Fallback: caret in whitespace between tokens — last highlightable note
    let best: NotePosition | null = null
    for (const p of positions) {
      if (p.measureIdx < 0) continue
      if (p.end <= caretPos) {
        if (!best || p.end > best.end) best = p
      }
    }
    return best
  }, [caretPos, previewSvg]) // re-run when previewSvg changes (positions updated)

  // Apply highlight class to corresponding SVG element
  useEffect(() => {
    if (!previewRef.current) return
    previewRef.current.querySelectorAll('.jn-note-current').forEach(el => el.classList.remove('jn-note-current'))
    previewRef.current.querySelectorAll('.jn-rest-current').forEach(el => el.classList.remove('jn-rest-current'))
    if (currentNote) {
      if (currentNote.measureIdx >= 0) {
        const el = previewRef.current.querySelector(`[data-m="${currentNote.measureIdx}"][data-n="${currentNote.noteIdx}"]`)
        el?.classList.add('jn-note-current')
      } else if (currentNote.restMeasureIdx !== undefined) {
        const g = previewRef.current.querySelector(`[data-rest-m="${currentNote.restMeasureIdx}"]`)
        g?.classList.add('jn-rest-current')
      }
    }
  }, [currentNote, previewSvg])

  // Track caret position globally — fires on arrow keys, clicks, selection drag
  useEffect(() => {
    if (!editTextVisible) return
    const handler = () => {
      if (document.activeElement === textareaRef.current && textareaRef.current) {
        setCaretPos(textareaRef.current.selectionStart)
      }
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [editTextVisible])

  // Click in preview → jump caret in textarea
  const handlePreviewClick = useCallback((e: React.MouseEvent) => {
    const target = (e.target as Element).closest('[data-m][data-n]') as Element | null
    if (!target || !textareaRef.current) return
    const m = parseInt(target.getAttribute('data-m')!)
    const n = parseInt(target.getAttribute('data-n')!)
    const pos = positionsRef.current.find(p => p.measureIdx === m && p.noteIdx === n && p.measureIdx >= 0)
    if (pos) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(pos.start, pos.end)
      setCaretPos(pos.start)
    }
  }, [])

  // Keyboard shortcuts
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
      {/* Inline styles for highlight + SVG sizing */}
      <style>{`
        .jn-note-current { fill: var(--color-accent) !important; font-weight: 700; }
        .jn-rest-current .jn-rest-rect { stroke: var(--color-accent); stroke-width: 1.2; stroke-dasharray: 3 2; opacity: 0.7; }
        .edit-preview svg { max-width: 100%; height: auto; display: block; }
      `}</style>

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
        <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-muted)', letterSpacing: '0.02em' }}>
          简谱 · Jianpu Notation
        </div>

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

      {/* Body: main column (text top / preview bottom) + optional right drawer */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Main column */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          {/* Textarea (top half) */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onClick={() => textareaRef.current && setCaretPos(textareaRef.current.selectionStart)}
            onKeyUp={() => textareaRef.current && setCaretPos(textareaRef.current.selectionStart)}
            autoFocus
            style={{
              // On mobile, give the textarea slightly more room (60%) than the preview (40%)
              // because composing is the active task; preview is for verification.
              flex: isMobile ? '1 1 60%' : '1 1 50%',
              minHeight: 0,
              padding: isMobile ? '16px 18px' : '24px 32px',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--color-foreground)',
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: isMobile ? '13px' : '14px',
              lineHeight: '1.8',
              resize: 'none',
            }}
            spellCheck={false}
          />

          {/* Divider */}
          <div style={{
            height: '1px',
            background: 'var(--color-border)',
            flexShrink: 0,
          }} />

          {/* Live preview (bottom half) */}
          <div
            ref={previewRef}
            onClick={handlePreviewClick}
            className="edit-preview"
            style={{
              flex: isMobile ? '1 1 40%' : '1 1 50%',
              minHeight: 0,
              padding: isMobile ? '12px 18px' : '20px 32px',
              overflow: 'auto',
              background: 'var(--color-surface)',
              cursor: 'default',
            }}
            dangerouslySetInnerHTML={{ __html: previewSvg || lastGoodSvg.current }}
          />
        </div>

        {/* Format-reference drawer — slides in from the right on desktop,
            fullscreen overlay on mobile so it doesn't squeeze the workspace */}
        {showGuide && (
          <div style={{
            position: isMobile ? 'absolute' : 'static',
            top: isMobile ? '48px' : undefined,    // sit below title bar
            right: isMobile ? 0 : undefined,
            bottom: isMobile ? 0 : undefined,
            left: isMobile ? 0 : undefined,
            zIndex: isMobile ? 51 : undefined,
            width: isMobile ? 'auto' : '280px',
            borderLeft: isMobile ? 'none' : '1px solid var(--color-border)',
            padding: '20px 18px',
            flexShrink: 0,
            overflowY: 'auto',
            background: 'var(--color-surface)',
          }}>
            <div style={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.1em',
              color: 'var(--color-muted)',
              marginBottom: '16px',
              textTransform: 'uppercase',
            }}>
              格式说明
            </div>

            {GUIDE_SECTIONS.map(({ label, items }) => (
              <div key={label} style={{ marginBottom: '16px' }}>
                <div style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  color: 'var(--color-muted)',
                  marginBottom: '6px',
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
              marginTop: '20px',
              paddingTop: '14px',
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
