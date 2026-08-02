// Pure geometry for the box-select cropper. No DOM — unit-tested in
// scripts/test-roundtrip.ts. The cropper (ImageCropper.tsx) uses this to map a
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
