import { useCallback, useEffect, useRef, useState } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { downloadAsImage } from '@/lib/downloader'

interface ExportButtonsProps {
  svgRef: React.RefObject<HTMLDivElement | null>
  isDark: boolean
}

type Format = 'png' | 'jpg'
type Feedback = 'ok' | 'fail'

const FEEDBACK_MS = 1500
const FEEDBACK_TEXT: Record<Feedback, string> = { ok: '已导出 ✓', fail: '导出失败 ✗' }

export default function ExportButtons({ svgRef, isDark }: ExportButtonsProps) {
  const isConverted = useScoreStore((s) => s.isConverted)
  // The feedback is React state, not a write to the button's textContent: React owns that
  // text node, and overwriting it left the label stuck on whatever the timer restored.
  const [feedback, setFeedback] = useState<Partial<Record<Format, Feedback>>>({})
  const timers = useRef<Partial<Record<Format, number>>>({})
  const exporting = useRef<Partial<Record<Format, boolean>>>({})
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      Object.values(pending).forEach((t) => window.clearTimeout(t))
    }
  }, [])

  const showFeedback = useCallback((format: Format, result: Feedback) => {
    if (!mounted.current) return   // the export finished after the sidebar was gone
    window.clearTimeout(timers.current[format])   // a second click restarts the 1.5 s, it does not cut it short
    setFeedback((f) => ({ ...f, [format]: result }))
    timers.current[format] = window.setTimeout(() => {
      setFeedback((f) => ({ ...f, [format]: undefined }))
    }, FEEDBACK_MS)
  }, [])

  if (!isConverted) return null

  const handleExport = async (type: 'image/png' | 'image/jpeg', ext: 'png' | 'jpg', format: Format) => {
    const svgEl = svgRef.current?.querySelector('svg')
    if (!svgEl) return
    if (exporting.current[format]) return   // a double click must not save the file twice
    exporting.current[format] = true
    try {
      showFeedback(format, (await downloadAsImage(type, ext, svgEl as SVGElement, isDark)) ? 'ok' : 'fail')
    } finally {
      exporting.current[format] = false
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
        导出
      </label>
      <button
        onClick={() => handleExport('image/png', 'png', 'png')}
        className="w-full rounded-lg py-2 text-sm font-medium transition-opacity cursor-pointer"
        style={{
          background: 'var(--color-accent)',
          color: '#fff',
          border: 'none',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      >
        {feedback.png ? FEEDBACK_TEXT[feedback.png] : '导出 PNG'}
      </button>
      <button
        onClick={() => handleExport('image/jpeg', 'jpg', 'jpg')}
        className="w-full py-1 text-xs cursor-pointer transition-colors"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-muted)',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-foreground)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}
      >
        {feedback.jpg ? FEEDBACK_TEXT[feedback.jpg] : '或导出 JPEG'}
      </button>
    </div>
  )
}
