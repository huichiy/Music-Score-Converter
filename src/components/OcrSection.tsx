import { useRef, useState, useCallback } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { useOcr } from '@/hooks/useOcr'
import { parseFromText } from '@/lib/editor'
import PdfPagePicker from './PdfPagePicker'
import ImageCropper from './ImageCropper'
import OcrSettings from './OcrSettings'

interface OcrSectionProps {
  onOcrScore: (svgHtml: string) => void
  loadFromText: (text: string, opts?: { fresh?: boolean }) => string
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
  const { handleOcrFile, runOcr, cancelOcr, resetOcr } = useOcr()

  // Route incoming files: PDFs open the page picker; images go straight to OCR.
  const routeFile = useCallback((file: File | null | undefined) => {
    if (!file) return
    // The picture must not change under a run that is still waiting for its answer
    if (useScoreStore.getState().isOcrAnalyzing) return
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

  // `page` is the whole PDF page when `img` is a crop of it: it stays the crop
  // source, so another row of the same page needs no trip back through the picker
  const handlePdfPageSelected = useCallback((img: File, page?: File) => {
    setPendingPdf(null)      // close picker
    handleOcrFile(img, page) // image takes the normal OCR path
  }, [handleOcrFile])

  const ocrFile = useScoreStore((s) => s.ocrFile)
  const isOcrAnalyzing = useScoreStore((s) => s.isOcrAnalyzing)
  const ocrError = useScoreStore((s) => s.ocrError)
  const ocrMode = useScoreStore((s) => s.ocrMode)
  const ocrResult = useScoreStore((s) => s.ocrResult)
  const setOcrMode = useScoreStore((s) => s.setOcrMode)
  const setOcrResult = useScoreStore((s) => s.setOcrResult)
  // The whole picture 框选区域 opens on. After a crop, ocrFile is only the strip;
  // cropping that again would shrink it further instead of picking another row.
  const cropBase = useScoreStore((s) => s.ocrSource)
  const isCrop = !!ocrFile && cropBase !== ocrFile

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (isOcrAnalyzing) return
    routeFile(e.dataTransfer.files[0])
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    routeFile(e.target.files?.[0] ?? null)
  }

  const handleUseAsScore = () => {
    if (!ocrResult?.trim()) return
    try {
      // Guard: refuse to render an empty score when the text has no parseable measures
      const probe = parseFromText(ocrResult)
      if (probe.measures.length === 0) {
        useScoreStore.getState().setOcrError('无法解析简谱文本，请检查格式')
        return
      }
      const svgHtml = loadFromText(ocrResult, { fresh: true })
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
            onClick={() => { if (!isOcrAnalyzing) inputRef.current?.click() }}
            onDragOver={(e) => { e.preventDefault(); if (!isOcrAnalyzing) setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            aria-disabled={isOcrAnalyzing}
            className={`rounded-lg border-2 border-dashed p-3 text-center transition-colors ${isOcrAnalyzing ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            style={{
              borderColor: isDragging ? 'var(--color-accent)' : 'var(--color-border)',
              background: isDragging ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'var(--color-surface-2)',
              opacity: isOcrAnalyzing ? 0.5 : 1,
            }}
          >
            {ocrFile ? (
              <div className="text-xs space-y-0.5">
                <div className="truncate font-medium">{ocrFile.name}</div>
                {isCrop && cropBase && (
                  <div className="truncate" style={{ color: 'var(--color-muted)', fontSize: '10px' }}>框选自 {cropBase.name}</div>
                )}
                <div style={{ color: 'var(--color-muted)' }}>{isOcrAnalyzing ? '识别中，请稍候…' : '点击更换图片'}</div>
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
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf"
            disabled={isOcrAnalyzing}
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
            {/* The only way out of a request that never answers on the first run
                (there is no result box with 重置 yet). Keeps the file and any result. */}
            {isOcrAnalyzing && (
              <button
                onClick={cancelOcr}
                className="rounded-lg py-2 px-3 text-sm font-medium transition-colors cursor-pointer shrink-0"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
              >
                取消
              </button>
            )}
          </div>

          {/* Result — editable so small OCR mistakes can be fixed before rendering.
              Shown for any text, blank included: emptying the box to retype it must
              not make the box (and its 重置) vanish. */}
          {ocrResult !== null && (
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
                  disabled={!ocrResult.trim()}
                  className="flex-1 rounded-lg py-1.5 text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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

      {cropOpen && cropBase && (
        <ImageCropper
          source={cropBase}
          title={cropBase.name}
          onCrop={(img) => { setCropOpen(false); handleOcrFile(img, cropBase) }}
          // 整张: the whole picture goes back in as the file to recognise (when a crop
          // was selected, ocrFile is only that strip)
          onWhole={() => { setCropOpen(false); if (cropBase !== ocrFile) handleOcrFile(cropBase) }}
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
