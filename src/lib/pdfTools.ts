// Lazy-loaded wrapper around pdfjs-dist. The PDF dependency is ~280 KB gzipped,
// so we only import it when a user actually uploads a PDF.
//
// Usage:
//   const pdf = await loadPdf(file)
//   const blob = await pageToBlob(pdf, 1, 2.0)
//   pdf.cleanup() / pdf.destroy()

import type { PDFDocumentProxy } from 'pdfjs-dist'

let pdfjsLib: typeof import('pdfjs-dist') | null = null

async function ensurePdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsLib) return pdfjsLib
  const mod = await import('pdfjs-dist')
  // Point pdf.js at its worker file. Vite handles ?url to bundle the worker.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
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

/** Convenience: rendered page → File the rest of the app can treat like a normal upload. */
export async function pageToFile(
  pdf: PDFDocumentProxy,
  pageNum: number,
  baseName: string,
  scale = 2.0,
): Promise<File> {
  const blob = await pageToBlob(pdf, pageNum, scale)
  const safeName = baseName.replace(/\.pdf$/i, '')
  return new File([blob], `${safeName}_page${pageNum}.png`, { type: 'image/png' })
}
