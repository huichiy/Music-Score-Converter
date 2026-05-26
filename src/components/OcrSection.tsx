import { useRef, useState, useCallback } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { useOcr } from '@/hooks/useOcr'
import PdfPagePicker from './PdfPagePicker'

interface OcrSectionProps {
  onOcrScore: (svgHtml: string) => void
  loadFromText: (text: string) => string
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

export default function OcrSection({ onOcrScore, loadFromText }: OcrSectionProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [pendingPdf, setPendingPdf] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { handleOcrFile, runOcr, resetOcr } = useOcr()

  // Route incoming files: PDFs open the page picker; images go straight to OCR.
  const routeFile = useCallback((file: File | null | undefined) => {
    if (!file) return
    if (isPdf(file)) {
      if (file.size > 20 * 1024 * 1024) {
        useScoreStore.getState().setOcrError('PDF 不能超过 20MB')
        return
      }
      useScoreStore.getState().setOcrError('')
      setPendingPdf(file)
      return
    }
    handleOcrFile(file)
  }, [handleOcrFile])

  const handlePdfPageSelected = useCallback((img: File) => {
    setPendingPdf(null)  // close picker
    handleOcrFile(img)   // image takes the normal OCR path
  }, [handleOcrFile])

  const ocrFile = useScoreStore((s) => s.ocrFile)
  const isOcrAnalyzing = useScoreStore((s) => s.isOcrAnalyzing)
  const ocrError = useScoreStore((s) => s.ocrError)
  const ocrMode = useScoreStore((s) => s.ocrMode)
  const ocrResult = useScoreStore((s) => s.ocrResult)
  const setOcrMode = useScoreStore((s) => s.setOcrMode)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    routeFile(e.dataTransfer.files[0])
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    routeFile(e.target.files?.[0] ?? null)
  }

  const handleUseAsScore = () => {
    if (!ocrResult) return
    try {
      const svgHtml = loadFromText(ocrResult)
      onOcrScore(svgHtml)
    } catch {
      useScoreStore.getState().setOcrError('无法解析简谱文本，请检查格式')
    }
  }

  const sectionStyle = {
    borderTop: '1px solid var(--color-border)',
    paddingTop: '12px',
  }

  return (
    <div style={sectionStyle} className="space-y-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-xs font-medium uppercase tracking-widest cursor-pointer"
        style={{ color: 'var(--color-muted)', background: 'none', border: 'none', padding: 0 }}
      >
        <span>OCR 图片识别</span>
        <span>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="space-y-3">
          {/* Mode selector */}
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {(['jianpu', 'western'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setOcrMode(mode)}
                className="flex-1 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                style={{
                  background: ocrMode === mode ? 'var(--color-accent)' : 'var(--color-surface-2)',
                  color: ocrMode === mode ? '#fff' : 'var(--color-muted)',
                  border: 'none',
                }}
              >
                {mode === 'jianpu' ? '简谱' : '五线谱'}
              </button>
            ))}
          </div>

          {/* Image drop zone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className="rounded-lg border-2 border-dashed p-3 text-center cursor-pointer transition-colors"
            style={{
              borderColor: isDragging ? 'var(--color-accent)' : 'var(--color-border)',
              background: isDragging ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'var(--color-surface-2)',
            }}
          >
            {ocrFile ? (
              <div className="text-xs space-y-0.5">
                <div className="truncate font-medium">{ocrFile.name}</div>
                <div style={{ color: 'var(--color-muted)' }}>点击更换图片</div>
              </div>
            ) : (
              <div className="text-xs space-y-0.5" style={{ color: 'var(--color-muted)' }}>
                <div>拖放图片或点击选择</div>
                <div style={{ fontSize: '10px' }}>JPG · PNG · WebP · PDF</div>
              </div>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf,.pdf"
            className="hidden"
            onChange={handleInputChange}
            onClick={(e) => { (e.target as HTMLInputElement).value = '' }}
          />

          {/* Error */}
          {ocrError && (
            <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>
              {ocrError}
            </p>
          )}

          {/* Analyze button */}
          <button
            onClick={runOcr}
            disabled={!ocrFile || isOcrAnalyzing}
            className="w-full rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer disabled:opacity-40"
            style={{
              background: 'var(--color-accent)',
              color: '#fff',
              border: 'none',
            }}
          >
            {isOcrAnalyzing ? '识别中…' : '开始识别'}
          </button>

          {/* Result */}
          {ocrResult && (
            <div className="space-y-2">
              <textarea
                readOnly
                value={ocrResult}
                rows={5}
                className="w-full rounded-lg px-3 py-2 text-xs font-mono resize-none outline-none"
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-foreground)',
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleUseAsScore}
                  className="flex-1 rounded-lg py-1.5 text-xs font-medium cursor-pointer"
                  style={{ background: 'var(--color-accent)', color: '#fff', border: 'none' }}
                >
                  渲染为简谱
                </button>
                <button
                  onClick={resetOcr}
                  className="flex-1 rounded-lg py-1.5 text-xs font-medium cursor-pointer"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                >
                  重置
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <PdfPagePicker
        file={pendingPdf}
        onSelect={handlePdfPageSelected}
        onCancel={() => setPendingPdf(null)}
      />
    </div>
  )
}
