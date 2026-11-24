// Lazy-loaded wrapper around pdfjs-dist. The PDF dependency is ~280 KB gzipped,
// so we only import it when a user actually uploads a PDF.
//
// Usage:
//   const pdf = await loadPdf(file)
//   const blob = await pageToBlob(pdf, 1, 2.0)
//   pdf.cleanup() / pdf.destroy()

import type { PDFDocumentProxy } from 'pdfjs-dist'

// The LEGACY build, on purpose: the modern one calls Map.prototype.getOrInsertComputed
// (a 2026 addition), so on older iOS Safari and in-app browsers such as WeChat's
// it failed inside the worker and the page picker showed an empty grid. The
// legacy build polyfills what it needs and is otherwise the same library — its
// pdf.d.mts re-exports the types of 'pdfjs-dist', so PDFDocumentProxy is shared.
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsLib: PdfJs | null = null

async function ensurePdfJs(): Promise<PdfJs> {
  if (pdfjsLib) return pdfjsLib
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // Point pdf.js at its worker file. Vite handles ?url to bundle the worker.
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  mod.GlobalWorkerOptions.workerSrc = workerUrl
  pdfjsLib = mod
  return mod
}

/** Open a PDF File/Blob and return the pdf.js document proxy. */
export async function loadPdf(file: File | Blob): Promise<PDFDocumentProxy> {
  const lib = await ensurePdfJs()
  const buf = await file.arrayBuffer()
  return await lib.getDocument({ data: new Uint8Array(buf) }).promise
}

/** Render a 1-indexed page to an offscreen canvas at the given scale (CSS pixels). */
export async function renderPageToCanvas(
  pdf: PDFDocumentProxy,
  pageNum: number,
  scale = 1.5,
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2D context')
  // Type assertion: pdfjs accepts canvas + viewport but its TS types vary across versions.
  await page.render({ canvasContext: ctx, viewport, canvas } as unknown as Parameters<typeof page.render>[0]).promise
  return canvas
}

/** Render a page and produce a PNG Blob suitable for handing to OCR. */
export async function pageToBlob(
  pdf: PDFDocumentProxy,
  pageNum: number,
  scale = 2.0,
): Promise<Blob> {
  const canvas = await renderPageToCanvas(pdf, pageNum, scale)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/png',
    )
  })
}

// Just under the 5 MB direct-image limit in useOcr. Pages and crops come from
// our own canvas rather than a user upload, so one that is too big gets
// re-encoded smaller instead of being rejected for a size the user never chose
// (a dense scanned page at 2.0x, or a crop of a big photo, easily passes 5 MB as PNG).
const OCR_SOFT_LIMIT = 4.5 * 1024 * 1024

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Canvas → File for OCR. PNG when it fits; otherwise JPEG (0.9, then 0.75).
 * The JPEG path flattens onto white first — JPEG has no alpha, and transparent
 * pixels would turn black.
 */
export async function canvasToOcrFile(canvas: HTMLCanvasElement, baseName: string): Promise<File> {
  const png = await canvasBlob(canvas, 'image/png')
  if (!png) throw new Error('图片导出失败')
  if (png.size <= OCR_SOFT_LIMIT) return new File([png], `${baseName}.png`, { type: 'image/png' })

  const flat = document.createElement('canvas')
  flat.width = canvas.width
  flat.height = canvas.height
  const ctx = flat.getContext('2d')
  if (!ctx) throw new Error('图片导出失败')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, flat.width, flat.height)
  ctx.drawImage(canvas, 0, 0)

  let jpg: Blob | null = null
  for (const q of [0.9, 0.75]) {
    jpg = await canvasBlob(flat, 'image/jpeg', q)
    if (jpg && jpg.size <= OCR_SOFT_LIMIT) break
  }
  // Still over the limit (absurdly large page): hand it over anyway and let
  // the size check say so, rather than failing silently here
  return new File([jpg ?? png], `${baseName}.${jpg ? 'jpg' : 'png'}`, { type: jpg ? 'image/jpeg' : 'image/png' })
}

/** Convenience: rendered page → File the rest of the app can treat like a normal upload. */
export async function pageToFile(
  pdf: PDFDocumentProxy,
  pageNum: number,
  baseName: string,
  scale = 2.0,
): Promise<File> {
  const canvas = await renderPageToCanvas(pdf, pageNum, scale)
  return await canvasToOcrFile(canvas, `${baseName.replace(/\.pdf$/i, '')}_page${pageNum}`)
}
