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
      <div className="flex gap-2">
        <button
          ref={pngBtnRef}
          onClick={() => handleExport('image/png', 'png', pngBtnRef)}
          className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer"
          style={btnStyle}
        >
          PNG
        </button>
        <button
          ref={jpgBtnRef}
          onClick={() => handleExport('image/jpeg', 'jpg', jpgBtnRef)}
          className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer"
          style={btnStyle}
        >
          JPEG
        </button>
      </div>
    </div>
  )
}
