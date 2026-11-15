function setBtnFeedback(btn: HTMLButtonElement, originalText: string, ok = true): void {
  btn.textContent = ok ? 'Done ✓' : 'Failed ✗'
  setTimeout(() => { btn.textContent = originalText }, 1500)
}

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

export function downloadAsImage(
  type: 'image/png' | 'image/jpeg',
  extension: 'png' | 'jpg',
  btn: HTMLButtonElement,
  svgElement: SVGElement,
  isDark: boolean,
): void {
  const label = type === 'image/png' ? '.PNG' : '.JPEG'
  document.fonts.ready.then(() => {
    const svgData = new XMLSerializer().serializeToString(svgElement)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) { setBtnFeedback(btn, label, false); return }
    const img = new Image()
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    img.onload = function () {
      document.fonts.ready.then(() => {
        try {
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
          if (dataUrl.length < 32) throw new Error('canvas export is empty')
          const link = document.createElement('a')
          link.download = `jianpu_score.${extension}`
          link.href = dataUrl
          link.click()
          setBtnFeedback(btn, label)
        } catch {
          setBtnFeedback(btn, label, false)
        } finally {
          URL.revokeObjectURL(url)
        }
      })
    }
    // The browser couldn't decode the serialized SVG — release the URL and say so
    img.onerror = function () {
      URL.revokeObjectURL(url)
      setBtnFeedback(btn, label, false)
    }
    img.src = url
  })
}
