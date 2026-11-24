// Pure geometry for the box-select cropper. No DOM — unit-tested in
// scripts/test-roundtrip.ts (computeCropRect) and scripts/test-ocr-fixes.ts
// (fitDisplaySize, scaleRect). The cropper (ImageCropper.tsx) uses this to map a
// selection drawn in display (CSS-pixel) space onto the full-resolution source
// so the crop sent to OCR is sharp, not the shrunk preview.

export interface Rect { x: number; y: number; w: number; h: number }
interface Size { w: number; h: number }

/**
 * Map a selection rectangle from display space to full-resolution source pixels.
 * `sel` and `display` share the cropper canvas's CSS-pixel coordinate system;
 * `source` is the natural/rendered size (PDF page @2.0x, or an image's natural
 * pixels). The result is rounded to whole pixels and clamped inside `source`,
 * with width/height at least 1.
 */
export function computeCropRect(sel: Rect, display: Size, source: Size): Rect {
  const kx = source.w / display.w
  const ky = source.h / display.h
  const x = Math.max(0, Math.min(Math.round(sel.x * kx), source.w))
  const y = Math.max(0, Math.min(Math.round(sel.y * ky), source.h))
  const w = Math.max(1, Math.min(Math.round(sel.w * kx), source.w - x))
  const h = Math.max(1, Math.min(Math.round(sel.h * ky), source.h - y))
  return { x, y, w, h }
}

/**
 * Size the cropper preview: as large as the available box allows (never
 * upscaled past the source), aspect preserved. The width fit wins over the
 * height limit below `minW` — a short landscape phone would otherwise get a
 * thumbnail too small to draw on, so the modal scrolls vertically instead.
 *
 * `maxW` should be the container's measured width, not a constant: a fixed
 * 640px preview overflowed (and got clipped) on 360–430px phones.
 */
export function fitDisplaySize(source: Size, maxW: number, maxH: number, minW = 0): Size {
  if (source.w <= 0 || source.h <= 0 || maxW <= 0) return { w: 0, h: 0 }
  const widthFit = Math.min(1, maxW / source.w)
  let scale = widthFit
  if (maxH > 0) {
    const floor = Math.min(widthFit, minW / source.w)   // never below minW, never past the width fit
    scale = Math.max(floor, Math.min(widthFit, maxH / source.h))
  }
  return { w: Math.max(1, Math.round(source.w * scale)), h: Math.max(1, Math.round(source.h * scale)) }
}

// Which whole picture a cropped file was cut from. Keyed by the File object
// itself, so it follows the store's `ocrFile` through remounts (leaving the
// tool layer unmounts the sidebar) and goes away with the file — picking
// another picture or resetting needs no bookkeeping.
const cropSources = new WeakMap<File, File>()

/** Remember that `crop` was cut from `source`. A crop of a crop points at the original. */
export function rememberCropSource(crop: File, source: File): void {
  cropSources.set(crop, cropSources.get(source) ?? source)
}

/** The picture 框选区域 should open on: the original a crop came from, or the file itself. */
export function cropSourceOf(file: File): File {
  return cropSources.get(file) ?? file
}

/** Carry a selection over when the preview is re-fitted (rotation, resize) so the box keeps covering the same part of the page. */
export function scaleRect(sel: Rect, from: Size, to: Size): Rect {
  if (from.w <= 0 || from.h <= 0) return sel
  const kx = to.w / from.w
  const ky = to.h / from.h
  return { x: sel.x * kx, y: sel.y * ky, w: sel.w * kx, h: sel.h * ky }
}
