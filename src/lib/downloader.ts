// iOS Safari silently produces a blank canvas past ~16.7M pixels (4096 × 4096);
// other mobile browsers have similar caps. A long score at 2× easily crosses it.
const MAX_CANVAS_PIXELS = 16_000_000

/**
 * Export scale for a width × height SVG: the usual 2× for sharpness, reduced
 * just enough to stay under the canvas pixel cap. A very large score therefore
 * exports softer instead of blank.
 */
export function clampExportScale(width: number, height: number, desired = 2, maxPixels = MAX_CANVAS_PIXELS): number {
  if (!(width > 0) || !(height > 0)) return desired
  return Math.min(desired, Math.sqrt(maxPixels / (width * height)))
}

/**
 * Renders the score SVG to a canvas and saves it as an image file. Resolves true once the
 * download was triggered, false when the browser could not produce the image. It never
 * touches the DOM beyond that: the caller owns whatever feedback is shown.
 */
export async function downloadAsImage(
  type: 'image/png' | 'image/jpeg',
  extension: 'png' | 'jpg',
  svgElement: SVGElement,
  isDark: boolean,
): Promise<boolean> {
  let url = ''
  try {
    await document.fonts.ready
    const svgData = new XMLSerializer().serializeToString(svgElement)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    url = URL.createObjectURL(new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' }))

    // The browser may fail to decode the serialized SVG: that rejects, and we report false
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('svg image failed to load'))
      img.src = url
    })
    await document.fonts.ready

    const w = (svgElement as SVGSVGElement).width.baseVal.value
    const h = (svgElement as SVGSVGElement).height.baseVal.value
    const scale = clampExportScale(w, h)
    canvas.width = Math.floor(w * scale)
    canvas.height = Math.floor(h * scale)
    ctx.fillStyle = isDark ? '#131210' : '#FFFFFF'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    const dataUrl = canvas.toDataURL(type)
    // An unusable canvas exports as the empty data URL "data:,"
    if (dataUrl.length < 32) return false
    const link = document.createElement('a')
    link.download = `jianpu_score.${extension}`
    link.href = dataUrl
    link.click()
    return true
  } catch {
    return false
  } finally {
    if (url) URL.revokeObjectURL(url)
  }
}
