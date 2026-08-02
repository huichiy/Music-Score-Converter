import { useRef, useState, useCallback } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { useOcr } from '@/hooks/useOcr'
import { parseFromText } from '@/lib/editor'
import PdfPagePicker from './PdfPagePicker'
import ImageCropper from './ImageCropper'
import OcrSettings from './OcrSettings'

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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cropOpen, setCropOpen] = useState(false)
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
  const setOcrResult = useScoreStore((s) => s.setOcrResult)

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
      // Guard: refuse to render an empty score when the text has no parseable measures
      const probe = parseFromText(ocrResult)
      if (probe.measures.length === 0) {
        useScoreStore.getState().setOcrError('无法解析简谱文本，请检查格式')
        return
      }
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
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex-1 flex items-center justify-between text-xs font-medium uppercase tracking-widest cursor-pointer"
          style={{ color: 'var(--color-muted)', background: 'none', border: 'none', padding: 0 }}
        >
          <span>OCR 图片识别</span>
          <span>{isOpen ? '▲' : '▼'}</span>
        </button>
        {isOpen && (
          <button
            onClick={(e) => { e.stopPropagation(); setSettingsOpen(true) }}
            title="OCR 设置 (BYOK)"
            className="cursor-pointer"
            style={{
              fontSize: 10, padding: '2px 8px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 4, color: 'var(--color-muted)',
            }}
          >
            ⚙ 模型
          </button>
        )}
      </div>

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

          {/* Analyze row: optional crop (images only) + start */}
          <div className="flex gap-2">
            {ocrFile && !isPdf(ocrFile) && (
              <button
                onClick={() => setCropOpen(true)}
                disabled={isOcrAnalyzing}
                className="rounded-lg py-2 px-3 text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 shrink-0"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }}
              >
                框选区域
              </button>
            )}
            <button
              onClick={runOcr}
              disabled={!ocrFile || isOcrAnalyzing}
              className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer disabled:opacity-40"
              style={{ background: 'var(--color-accent)', color: '#fff', border: 'none' }}
            >
              {isOcrAnalyzing ? '识别中…' : '开始识别'}
            </button>
          </div>

          {/* Result — editable so small OCR mistakes can be fixed before rendering */}
          {ocrResult && (
            <div className="space-y-2">
              <textarea
                value={ocrResult}
                onChange={(e) => setOcrResult(e.target.value)}
                spellCheck={false}
                rows={5}
                className="w-full rounded-lg px-3 py-2 text-xs font-mono resize-y outline-none"
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-foreground)',
                }}
              />
              <p className="text-xs" style={{ color: 'var(--color-muted)', fontSize: 10 }}>
                识别结果可直接修改，改完点「渲染为简谱」
              </p>
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

      {cropOpen && ocrFile && (
        <ImageCropper
          source={ocrFile}
          title={ocrFile.name}
          onCrop={(img) => { setCropOpen(false); handleOcrFile(img) }}
          onWhole={() => setCropOpen(false)}
          onCancel={() => setCropOpen(false)}
        />
      )}

      <PdfPagePicker
        file={pendingPdf}
        onSelect={handlePdfPageSelected}
        onCancel={() => setPendingPdf(null)}
      />

      <OcrSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
