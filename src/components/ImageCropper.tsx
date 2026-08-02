import { useEffect, useRef, useState } from 'react'
import { computeCropRect, type Rect } from '@/lib/cropTools'

interface ImageCropperProps {
  source: HTMLCanvasElement | File   // PDF page → canvas (rendered @2.0x); image → File
  title: string                       // sub-line, e.g. "市集.pdf · 第 1 页" or a filename
  onCrop: (file: File) => void        // cropped PNG
  onWhole: () => void                 // "use the whole source" (skip crop)
  onCancel: () => void
}

const MAX_W = 640
const MINW = 60
const MINH = 22

type DragMode = 'move' | 'tl' | 'tr' | 'bl' | 'br'

export default function ImageCropper({ source, title, onCrop, onWhole, onCancel }: ImageCropperProps) {
  const [previewUrl, setPreviewUrl] = useState('')
  const [srcSize, setSrcSize] = useState({ w: 0, h: 0 })
  const [dispSize, setDispSize] = useState({ w: 0, h: 0 })
  const [sel, setSel] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 })
  const [error, setError] = useState('')
  const drawRef = useRef<CanvasImageSource | null>(null)

  // Resolve source → preview URL + natural size + a drawable for cropping
  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    const apply = (w: number, h: number, url: string) => {
      if (cancelled) return
      const dw = Math.min(MAX_W, w)
      const dh = Math.round((dw * h) / w)
      setPreviewUrl(url)
      setSrcSize({ w, h })
      setDispSize({ w: dw, h: dh })
      // default box: full width, a strip near the top (总谱 top row = 笛子)
      setSel({ x: 6, y: 6, w: dw - 12, h: Math.max(MINH, Math.round(dh * 0.18)) })
    }
    if (source instanceof HTMLCanvasElement) {
      drawRef.current = source
      apply(source.width, source.height, source.toDataURL('image/png'))
    } else {
      objectUrl = URL.createObjectURL(source)
      const img = new Image()
      img.onload = () => { drawRef.current = img; apply(img.naturalWidth, img.naturalHeight, objectUrl) }
      img.onerror = () => { if (!cancelled) setError('图片载入失败') }
      img.src = objectUrl
    }
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [source])

  function startDrag(e: React.PointerEvent, mode: DragMode) {
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX, sy = e.clientY
    const s0 = { ...sel }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      const n = { ...s0 }
      if (mode === 'move') { n.x = s0.x + dx; n.y = s0.y + dy }
      else {
        if (mode.includes('r')) n.w = s0.w + dx
        if (mode.includes('l')) { n.w = s0.w - dx; n.x = s0.x + dx }
        if (mode.includes('b')) n.h = s0.h + dy
        if (mode.includes('t')) { n.h = s0.h - dy; n.y = s0.y + dy }
        if (n.w < MINW && mode.includes('l')) n.x = s0.x + s0.w - MINW
        if (n.h < MINH && mode.includes('t')) n.y = s0.y + s0.h - MINH
      }
      n.w = Math.max(MINW, Math.min(n.w, dispSize.w))
      n.h = Math.max(MINH, Math.min(n.h, dispSize.h))
      n.x = Math.max(0, Math.min(n.x, dispSize.w - n.w))
      n.y = Math.max(0, Math.min(n.y, dispSize.h - n.h))
      setSel(n)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function doCrop() {
    const src = drawRef.current
    if (!src) return
    const r = computeCropRect(sel, dispSize, srcSize)
    const out = document.createElement('canvas')
    out.width = r.w; out.height = r.h
    const ctx = out.getContext('2d')
    if (!ctx) { setError('裁剪失败'); return }
    ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
    out.toBlob((b) => {
      if (!b) { setError('裁剪失败'); return }
      const base = source instanceof File ? source.name.replace(/\.[^.]+$/, '') : 'page'
      onCrop(new File([b], `${base}_crop.png`, { type: 'image/png' }))
    }, 'image/png')
  }

  const canCrop = sel.w >= MINW && sel.h >= MINH
  const handle = (cls: string, mode: DragMode, cursor: string) => (
    <span
      onPointerDown={(e) => startDrag(e, mode)}
      style={{ position: 'absolute', width: 14, height: 14, background: '#fff', border: '2px solid var(--color-accent)', borderRadius: 2, cursor, ...handlePos(cls) }}
    />
  )

  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 700, maxHeight: '92vh', background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 18px', borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>框选要识别的声部</div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>{title}</div>
          </div>
          <button onClick={onCancel} style={{ padding: '4px 12px', fontSize: 12, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-muted)', cursor: 'pointer' }}>取消</button>
        </div>

        <div style={{ padding: 16, overflow: 'auto' }}>
          {error && (
            <div style={{ padding: 12, marginBottom: 12, background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)', borderRadius: 6, color: 'var(--color-accent)', fontSize: 12 }}>{error}</div>
          )}
          <p style={{ fontSize: 11, color: 'var(--color-muted)', margin: '0 0 10px' }}>拖动红框移动，拖四角缩放。默认框住最上面一行（总谱里通常是笛子）。</p>
          {previewUrl && (
            <div style={{ position: 'relative', width: dispSize.w, maxWidth: '100%', margin: '0 auto', userSelect: 'none', touchAction: 'none', overflow: 'hidden', borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <img src={previewUrl} width={dispSize.w} height={dispSize.h} draggable={false} style={{ display: 'block', width: dispSize.w, height: dispSize.h, background: '#fff' }} />
              <div
                onPointerDown={(e) => { if (e.currentTarget === e.target) startDrag(e, 'move') }}
                style={{ position: 'absolute', left: sel.x, top: sel.y, width: sel.w, height: sel.h, border: '2px solid var(--color-accent)', borderRadius: 2, cursor: 'move', boxShadow: '0 0 0 9999px rgba(20,15,10,0.42)' }}
              >
                {handle('tl', 'tl', 'nwse-resize')}
                {handle('tr', 'tr', 'nesw-resize')}
                {handle('bl', 'bl', 'nesw-resize')}
                {handle('br', 'br', 'nwse-resize')}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '13px 18px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
          <button onClick={onWhole} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>{source instanceof HTMLCanvasElement ? '整页送识别' : '整张送识别'}</button>
          <button onClick={doCrop} disabled={!canCrop} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: canCrop ? 'pointer' : 'not-allowed', background: 'var(--color-accent)', color: '#fff', border: 'none', opacity: canCrop ? 1 : 0.4 }}>框选送识别</button>
        </div>
      </div>
    </div>
  )
}

function handlePos(cls: string): React.CSSProperties {
  switch (cls) {
    case 'tl': return { top: -8, left: -8 }
    case 'tr': return { top: -8, right: -8 }
    case 'bl': return { bottom: -8, left: -8 }
    default: return { bottom: -8, right: -8 }
  }
}
