import { useRef } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { downloadAsImage } from '@/lib/downloader'

interface ExportButtonsProps {
  svgRef: React.RefObject<HTMLDivElement | null>
  isDark: boolean
}

export default function ExportButtons({ svgRef, isDark }: ExportButtonsProps) {
  const isConverted = useScoreStore((s) => s.isConverted)
  const pngBtnRef = useRef<HTMLButtonElement>(null)
  const jpgBtnRef = useRef<HTMLButtonElement>(null)

  if (!isConverted) return null

  const handleExport = (type: 'image/png' | 'image/jpeg', ext: 'png' | 'jpg', btnRef: React.RefObject<HTMLButtonElement | null>) => {
    const btn = btnRef.current
    if (!btn) return
    const svgEl = svgRef.current?.querySelector('svg')
    if (!svgEl) return
    downloadAsImage(type, ext, btn, svgEl as SVGElement, isDark)
  }

  const btnStyle = {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-foreground)',
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
        导出
      </label>
      <button
        ref={pngBtnRef}
        onClick={() => handleExport('image/png', 'png', pngBtnRef)}
        className="w-full rounded-lg py-2 text-sm font-medium transition-opacity cursor-pointer"
        style={{
          background: 'var(--color-accent)',
          color: '#fff',
          border: 'none',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      >
        导出 PNG
      </button>
      <button
        ref={jpgBtnRef}
        onClick={() => handleExport('image/jpeg', 'jpg', jpgBtnRef)}
        className="w-full py-1 text-xs cursor-pointer transition-colors"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-muted)',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-foreground)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}
      >
        或导出 JPEG
      </button>
    </div>
  )
}
