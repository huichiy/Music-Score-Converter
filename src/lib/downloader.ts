function setBtnFeedback(btn: HTMLButtonElement, originalText: string): void {
  btn.textContent = 'Done ✓'
  setTimeout(() => { btn.textContent = originalText }, 1500)
}

export function downloadAsImage(
  type: 'image/png' | 'image/jpeg',
  extension: 'png' | 'jpg',
  btn: HTMLButtonElement,
  svgElement: SVGElement,
  isDark: boolean,
): void {
  document.fonts.ready.then(() => {
    const svgData = new XMLSerializer().serializeToString(svgElement)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const img = new Image()
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    img.onload = function () {
      document.fonts.ready.then(() => {
        canvas.width = (svgElement as SVGSVGElement).width.baseVal.value * 2
        canvas.height = (svgElement as SVGSVGElement).height.baseVal.value * 2
        ctx.fillStyle = isDark ? '#131210' : '#FFFFFF'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.scale(2, 2)
        ctx.drawImage(img, 0, 0)
        const link = document.createElement('a')
        link.download = `jianpu_score.${extension}`
        link.href = canvas.toDataURL(type)
        link.click()
        setBtnFeedback(btn, type === 'image/png' ? '.PNG' : '.JPEG')
        URL.revokeObjectURL(url)
      })
    }
    img.src = url
  })
}
