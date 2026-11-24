import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdf, renderPageToCanvas, canvasToOcrFile } from '@/lib/pdfTools'
import { useBackdropClose } from '@/hooks/useBackdropClose'
import ImageCropper from './ImageCropper'

interface PdfPagePickerProps {
  file: File | null         // when non-null, modal is open
  /**
   * The user picked a page (or a box on it). `img` is what goes to OCR; `page`
   * is the whole page as an image when `img` is only a crop of it, so the other
   * rows of the same page can be cropped later without opening the PDF again.
   */
  onSelect: (img: File, page?: File) => void
  onCancel: () => void
}

const NO_PAGES_MSG = '没能显示这份 PDF 的任何页面——可能是浏览器太旧，或 PDF 已损坏。请换新版浏览器，或把 PDF 转成图片后再上传。'

export default function PdfPagePicker({ file, onSelect, onCancel }: PdfPagePickerProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [extracting, setExtracting] = useState<number | null>(null)
  const [cropTarget, setCropTarget] = useState<{ canvas: HTMLCanvasElement; page: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const backdrop = useBackdropClose(onCancel)
  // Bumped whenever `file` changes: a page that finishes rendering for a PDF
  // that has since been closed or replaced must not open over the next one
  const fileGen = useRef(0)

  // Load the PDF whenever a new file is provided
  useEffect(() => {
    fileGen.current++
    setCropTarget(null)
    setExtracting(null)
    if (!file) {
      setPdf(null); setError(''); setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true); setError('')
    loadPdf(file)
      .then((doc) => {
        if (cancelled) { doc.destroy(); return }
        setPdf(doc)
      })
      .catch((e) => {
        if (cancelled) return
        setError((e as Error).message || 'PDF 加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [file])

  // Render all page thumbnails once the doc is open. Depends on the document
  // only — onSelect is a fresh function on every parent render and is not used
  // here, so listing it restarted every thumbnail on each keystroke elsewhere.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''  // clear previous renders
    if (!pdf) return
    let cancelled = false

    ;(async () => {
      let shown = 0
      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) return
        try {
          const canvas = await renderPageToCanvas(pdf, i, 0.4)  // small thumbnail
          if (cancelled) return
          const card = document.createElement('button')
          card.dataset.page = String(i)
          card.style.cssText = `
            display:flex; flex-direction:column; align-items:center; gap:6px;
            padding:10px; border-radius:8px; cursor:pointer;
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            transition: border-color 0.15s, transform 0.15s;
          `
          canvas.style.cssText = 'max-width:100%; height:auto; border-radius:4px; background:#fff;'
          const label = document.createElement('span')
          label.textContent = `第 ${i} 页`
          label.style.cssText = 'font-size:11px; color:var(--color-muted);'
          card.appendChild(canvas)
          card.appendChild(label)
          card.onclick = () => {
            const gen = fileGen.current
            setExtracting(i)
            renderPageToCanvas(pdf, i, 2.0)
              .then((canvas) => { if (gen === fileGen.current) setCropTarget({ canvas, page: i }) })
              .catch((e) => { if (gen === fileGen.current) setError((e as Error).message || '提取失败') })
              .finally(() => { if (gen === fileGen.current) setExtracting(null) })
          }
          card.onmouseenter = () => { card.style.borderColor = 'var(--color-accent)'; card.style.transform = 'translateY(-2px)' }
          card.onmouseleave = () => { card.style.borderColor = 'var(--color-border)'; card.style.transform = 'translateY(0)' }
          container.appendChild(card)
          shown++
        } catch (e) {
          if (!cancelled) console.error(`Failed to render page ${i}`, e)
        }
      }
      // Every page failed (an engine too old for pdf.js, a broken file): say so
      // instead of leaving an empty grid that looks like it is still loading
      if (!cancelled && shown === 0) setError(NO_PAGES_MSG)
    })()

    return () => {
      cancelled = true
    }
  }, [pdf])

  // Cleanup PDF resources on unmount
  useEffect(() => {
    return () => {
      if (pdf) pdf.destroy()
    }
  }, [pdf])

  if (!file) return null

  const baseName = file.name.replace(/\.pdf$/i, '')

  return (
    <>
    <div
      {...backdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 920, maxHeight: '90vh',
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>选择 PDF 页面</div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
              {file.name}
              {pdf && <> · 共 {pdf.numPages} 页</>}
            </div>
          </div>
          <button
            onClick={onCancel}
            style={{
              padding: '4px 12px', fontSize: 12,
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 6, color: 'var(--color-muted)',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 40, fontSize: 13, color: 'var(--color-muted)' }}>
              加载 PDF 中…
            </div>
          )}

          {error && (
            <div style={{
              padding: 12,
              background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
              borderRadius: 6,
              color: 'var(--color-accent)',
              fontSize: 12,
            }}>
              {error}
            </div>
          )}

          {extracting !== null && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                padding: '12px 24px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 8, fontSize: 13,
              }}>
                提取第 {extracting} 页…
              </div>
            </div>
          )}

          {/* Thumbnail grid */}
          <div
            ref={containerRef}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 12,
            }}
          />
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '10px 20px',
          borderTop: '1px solid var(--color-border)',
          fontSize: 11, color: 'var(--color-muted)',
          flexShrink: 0,
        }}>
          点击任意一页 → 框选要识别的部分，或整页识别
        </div>
      </div>
    </div>

    {cropTarget && (
      <ImageCropper
        source={cropTarget.canvas}
        title={`${file.name} · 第 ${cropTarget.page} 页`}
        onCrop={(img) => {
          const t = cropTarget
          const gen = fileGen.current
          setCropTarget(null)
          // Keep the whole page too: the other rows of this page are cropped from
          // it later (OcrSection's 框选区域) without opening the PDF again
          canvasToOcrFile(t.canvas, `${baseName}_page${t.page}`)
            .then((page) => { if (gen === fileGen.current) onSelect(img, page) })
            .catch(() => { if (gen === fileGen.current) onSelect(img) })
        }}
        onWhole={() => {
          const t = cropTarget
          const gen = fileGen.current
          setCropTarget(null)
          // PNG, or a smaller JPEG for a dense page — it must clear the 5 MB image limit
          canvasToOcrFile(t.canvas, `${baseName}_page${t.page}`)
            .then((page) => { if (gen === fileGen.current) onSelect(page) })
            .catch((e) => { if (gen === fileGen.current) setError((e as Error).message || '提取失败') })
        }}
        onCancel={() => setCropTarget(null)}
      />
    )}
    </>
  )
}
