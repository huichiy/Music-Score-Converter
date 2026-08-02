# MusicXML Volta Import + 总谱 Box-Select Crop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import MusicXML `<ending>` (跳房子) into `_volta`, and add a single-box crop step so users can extract one instrument's row from a 总谱 PDF page or photo before OCR.

**Architecture:** #3 is a pure parser addition (scan `<ending>` beside the existing `<repeat>` scan, carry an `activeVolta` cursor across measures). #1 is a generic, OCR-agnostic `ImageCropper` React component fed by two entry points (PdfPagePicker, OcrSection); its only logic-bearing piece is the pure function `computeCropRect`, which is unit-tested.

**Tech Stack:** React 18 · TypeScript · Vite · pdfjs-dist (already used) · linkedom (test-only, already a devDependency). No new dependencies.

## Global Constraints

- TDD: write the failing test, watch it fail, implement, watch it pass. (Applies to the pure-logic parts: volta parsing, `computeCropRect`. React drag/UI is browser-verified, not unit-tested.)
- `npm run test` must stay green (currently 125 assertions in `test-roundtrip.ts` + 23 in `test-parser.ts`); `npm run build` must pass before every commit.
- No new runtime dependencies. Pure DOM/React for drag — no crop library.
- `parseFloat()` for any MusicXML `alter` reads (not relevant here but a standing rule).
- OCR keys never touched; the cropper never imports store/OCR code — it only takes a source in and hands a cropped `File` out.
- Two commits total (as approved in the spec): (1) volta import, (2) crop feature + docs. Tasks 2–6 build up commit 2; only Task 6 runs `git commit`.
- Commit message trailer:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017xtAhiQouGLaNQRYHLEUL5
  ```

---

## Task 1: MusicXML `<ending>` → `_volta` import

**Files:**
- Modify: `src/lib/parser.ts` (barline scan region ~L80–90; metadata assignment region ~L232)
- Test: `scripts/test-parser.ts` (append new `describe` blocks before the results footer)

**Interfaces:**
- Consumes: existing `parseXMLToNoteObjects(xmlDoc): MeasureArray[]`, `MeasureArray._volta?: number` (already declared in `src/types/score.ts`).
- Produces: nothing new for later tasks (independent feature).

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-parser.ts`, immediately before the final `console.log(\`\n${'='.repeat(50)}\`)` line:

```ts
describe('Volta <ending> import — single-measure endings', () => {
  const ms = parseScore(`
    <measure number="1">${ATTRS}
      <barline location="left"><repeat direction="forward"/></barline>
      ${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
    </measure>
    <measure number="2">
      <barline location="left"><ending number="1" type="start"/></barline>
      ${noteXml('G', 4)}${noteXml('A', 4)}${noteXml('B', 4)}${noteXml('C', 5)}
      <barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>
    </measure>
    <measure number="3">
      <barline location="left"><ending number="2" type="start"/></barline>
      ${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
      <barline location="right"><ending number="2" type="discontinue"/></barline>
    </measure>`)
  assertEq('M1 no volta', ms[0]._volta ?? null, null)
  assertEq('M2 volta 1', ms[1]._volta, 1)
  assertEq('M2 repeatEnd kept', ms[1]._repeatEnd, true)
  assertEq('M3 volta 2', ms[2]._volta, 2)
})

describe('Volta <ending> import — multi-measure ending', () => {
  const ms = parseScore(`
    <measure number="1">${ATTRS}
      <barline location="left"><ending number="1" type="start"/></barline>
      ${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
    </measure>
    <measure number="2">
      ${noteXml('G', 4)}${noteXml('A', 4)}${noteXml('B', 4)}${noteXml('C', 5)}
      <barline location="right"><ending number="1" type="stop"/></barline>
    </measure>
    <measure number="3">
      ${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
    </measure>`)
  assertEq('M1 volta 1 (start)', ms[0]._volta, 1)
  assertEq('M2 volta 1 (still open, stop here)', ms[1]._volta, 1)
  assertEq('M3 no volta (closed)', ms[2]._volta ?? null, null)
})

describe('Volta <ending> import — number "1, 2" takes first', () => {
  const ms = parseScore(`
    <measure number="1">${ATTRS}
      <barline location="left"><ending number="1, 2" type="start"/></barline>
      ${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
      <barline location="right"><ending number="1, 2" type="stop"/></barline>
    </measure>`)
  assertEq('M1 volta 1 from "1, 2"', ms[0]._volta, 1)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx scripts/test-parser.ts`
Expected: FAIL — the three new blocks report `✗` with `actual: null`/`undefined` for the volta assertions (parser doesn't read `<ending>` yet). Process exits 1.

- [ ] **Step 3: Add the `activeVolta` cursor declaration**

In `src/lib/parser.ts`, find:

```ts
  let wedgeType: 'cresc' | 'dim' | null = null
  // Grace note waiting for its host: attaches to the NEXT pitched note,
```

Replace with (add one line):

```ts
  let wedgeType: 'cresc' | 'dim' | null = null
  // Active volta (跳房子) number, carried across measures until an ending closes it
  let activeVolta: number | null = null
  // Grace note waiting for its host: attaches to the NEXT pitched note,
```

- [ ] **Step 4: Scan `<ending>` inside the existing barline loop**

Find:

```ts
    let repeatStart = false
    let repeatEnd = false
    const barlineNodes = measures[i].getElementsByTagName('barline')
    for (let b = 0; b < barlineNodes.length; b++) {
      const repeatNode = barlineNodes[b].getElementsByTagName('repeat')[0]
      if (repeatNode) {
        const dir = repeatNode.getAttribute('direction')
        if (dir === 'forward') repeatStart = true
        if (dir === 'backward') repeatEnd = true
      }
    }
```

Replace with:

```ts
    let repeatStart = false
    let repeatEnd = false
    let endingStart: number | null = null
    let endingCloses = false
    const barlineNodes = measures[i].getElementsByTagName('barline')
    for (let b = 0; b < barlineNodes.length; b++) {
      const repeatNode = barlineNodes[b].getElementsByTagName('repeat')[0]
      if (repeatNode) {
        const dir = repeatNode.getAttribute('direction')
        if (dir === 'forward') repeatStart = true
        if (dir === 'backward') repeatEnd = true
      }
      const endingNode = barlineNodes[b].getElementsByTagName('ending')[0]
      if (endingNode) {
        const type = endingNode.getAttribute('type')
        if (type === 'start') {
          const num = parseInt((endingNode.getAttribute('number') || '').split(',')[0].trim())
          if (!Number.isNaN(num)) endingStart = num
        } else if (type === 'stop' || type === 'discontinue') {
          endingCloses = true
        }
      }
    }
```

- [ ] **Step 5: Assign `_volta` and advance the cursor**

Find:

```ts
    measureNotes._repeatStart = repeatStart
    measureNotes._repeatEnd = repeatEnd
```

Replace with:

```ts
    measureNotes._repeatStart = repeatStart
    measureNotes._repeatEnd = repeatEnd

    // Volta: a start opens the ending; the measure carrying stop/discontinue is
    // still part of it, so assign first and clear the cursor afterwards.
    if (endingStart !== null) activeVolta = endingStart
    if (activeVolta !== null) measureNotes._volta = activeVolta
    if (endingCloses) activeVolta = null
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsx scripts/test-parser.ts`
Expected: PASS — all blocks `✓`, results line shows the higher count (26 assertions), exit 0.

- [ ] **Step 7: Run the full test + build**

Run: `npm run test && npm run build`
Expected: `Results: 125 passed, 0 failed` then `Results: 26 passed, 0 failed`; build ends `✓ built in …`.

- [ ] **Step 8: Update docs for #3**

In `docs/JIANPU_FORMAT.md`, find:

```
- **MusicXML 跳房子导入**：`{N}` 语法已支持手写；MusicXML `<ending>` 元素的导入暂未实现。
```

Replace with:

```
- **MusicXML 跳房子导入**：`{N}` 手写与 MusicXML `<ending>` 导入均已支持（`<ending type="start/stop/discontinue">` → `_volta`，多小节结尾自动延续）。
```

In `CLAUDE.md`, find the MusicXML Notations Import bullet list and add after the `<time-modification>` line:

```
- `<barline><ending>` → `MeasureArray._volta`: `type="start"` opens (number `"1, 2"` → first int), `type="stop"`/`"discontinue"` closes; the closing measure is still tagged. Carried across measures via an `activeVolta` cursor.
```

In `CLAUDE.md` roadmap, move the pending line `- [ ] MusicXML parser: import `<ending>` (volta) into `_volta`` into the shipped list as:

```
- [x] MusicXML import: `<ending>` (跳房子/volta) → `_volta`
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/parser.ts scripts/test-parser.ts docs/JIANPU_FORMAT.md CLAUDE.md
git commit -m "feat(parser): import MusicXML <ending> into _volta

<barline><ending> now maps to MeasureArray._volta. type=start opens
(number '1, 2' takes the first int), stop/discontinue closes; the
closing measure is still tagged, and an activeVolta cursor carries
the number across multi-measure endings. Renderer already ships the
{N} bracket, so imported voltas render immediately.

3 new test-parser.ts blocks (23 -> 26 assertions).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017xtAhiQouGLaNQRYHLEUL5"
```

---

## Task 2: `computeCropRect` pure function + unit tests

> Tasks 2–6 build up commit 2. **Do not commit** until Task 6. After each of these tasks, verify tests/build are green as the reviewer gate.

**Files:**
- Create: `src/lib/cropTools.ts`
- Test: `scripts/test-roundtrip.ts` (append a `describe` block + one import before the results footer)

**Interfaces:**
- Produces: `interface Rect { x: number; y: number; w: number; h: number }` and `computeCropRect(sel: Rect, display: { w: number; h: number }, source: { w: number; h: number }): Rect`. Task 3 (ImageCropper) consumes both.

- [ ] **Step 1: Write the failing tests**

At the top of `scripts/test-roundtrip.ts`, add to the imports (after the existing `import { ... } from '../src/lib/vision/...'` lines):

```ts
import { computeCropRect } from '../src/lib/cropTools'
```

Then, immediately before the final `console.log(\`\n${'='.repeat(50)}\`)` line, append:

```ts
describe('computeCropRect maps display selection to source pixels', () => {
  // 1:1 — display size equals source size → selection unchanged
  assertEq('1:1 identity', computeCropRect({ x: 10, y: 20, w: 100, h: 40 }, { w: 200, h: 100 }, { w: 200, h: 100 }), { x: 10, y: 20, w: 100, h: 40 })
  // 2.0x — source is twice the display (PDF page rendered at 2.0x)
  assertEq('2x scale', computeCropRect({ x: 0, y: 0, w: 300, h: 30 }, { w: 300, h: 150 }, { w: 600, h: 300 }), { x: 0, y: 0, w: 600, h: 60 })
  // clamp — selection runs past the right/bottom edge, sw/sh shrink to fit
  assertEq('clamp to source bounds', computeCropRect({ x: 80, y: 0, w: 40, h: 50 }, { w: 100, h: 100 }, { w: 100, h: 100 }), { x: 80, y: 0, w: 20, h: 50 })
  // rounding — fractional display coords round to whole source pixels
  assertEq('rounds to integers', computeCropRect({ x: 10.4, y: 10.6, w: 20.5, h: 20.4 }, { w: 100, h: 100 }, { w: 100, h: 100 }), { x: 10, y: 11, w: 20, h: 20 })
  // never zero — a sliver still yields at least 1px
  assertEq('min 1px', computeCropRect({ x: 0, y: 0, w: 0, h: 0 }, { w: 100, h: 100 }, { w: 100, h: 100 }), { x: 0, y: 0, w: 1, h: 1 })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx scripts/test-roundtrip.ts`
Expected: FAIL to load — `computeCropRect`/`cropTools` module does not exist yet (import error), or the block reports `✗`.

- [ ] **Step 3: Create the implementation**

Create `src/lib/cropTools.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx scripts/test-roundtrip.ts`
Expected: PASS — the new block is all `✓`, results line shows 130 passed.

- [ ] **Step 5: Verify (no commit yet)**

Run: `npm run build`
Expected: `✓ built in …`. Do NOT commit — Task 6 commits the whole crop feature.

---

## Task 3: `ImageCropper` component

**Files:**
- Create: `src/components/ImageCropper.tsx`

**Interfaces:**
- Consumes: `computeCropRect`, `Rect` from `src/lib/cropTools` (Task 2).
- Produces: default export `ImageCropper` with props
  `{ source: HTMLCanvasElement | File; title: string; onCrop: (file: File) => void; onWhole: () => void; onCancel: () => void }`. Tasks 4 & 5 render it.

- [ ] **Step 1: Create the component**

Create `src/components/ImageCropper.tsx`:

```tsx
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
          <button onClick={onWhole} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>整张送识别</button>
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
```

- [ ] **Step 2: Verify it type-checks / builds (no commit)**

Run: `npm run build`
Expected: `✓ built in …` (the component is not imported anywhere yet — an unreferenced module is fine). Do NOT commit.

---

## Task 4: PDF entry — crop after picking a page

**Files:**
- Modify: `src/components/PdfPagePicker.tsx`

**Interfaces:**
- Consumes: `ImageCropper` (Task 3), existing `renderPageToCanvas(pdf, n, scale)` from `@/lib/pdfTools`.
- Produces: unchanged public contract (`onSelect(img: File)` still fires with the file to OCR — now either a crop or the whole page).

- [ ] **Step 1: Import ImageCropper and add crop-target state**

In `src/components/PdfPagePicker.tsx`, find:

```ts
import { loadPdf, renderPageToCanvas, pageToFile } from '@/lib/pdfTools'
```

Replace with:

```ts
import { loadPdf, renderPageToCanvas } from '@/lib/pdfTools'
import ImageCropper from './ImageCropper'
```

(`pageToFile` is no longer used — the cropper produces the file, and whole-page uses `canvas.toBlob`.)

Find:

```ts
  const [extracting, setExtracting] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
```

Replace with:

```ts
  const [extracting, setExtracting] = useState<number | null>(null)
  const [cropTarget, setCropTarget] = useState<{ canvas: HTMLCanvasElement; page: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
```

- [ ] **Step 2: Change the thumbnail click to open the cropper**

Find:

```ts
          card.onclick = () => {
            setExtracting(i)
            pageToFile(pdf, i, file?.name || 'page', 2.0)
              .then((img) => onSelect(img))
              .catch((e) => setError((e as Error).message || '提取失败'))
              .finally(() => setExtracting(null))
          }
```

Replace with:

```ts
          card.onclick = () => {
            setExtracting(i)
            renderPageToCanvas(pdf, i, 2.0)
              .then((canvas) => setCropTarget({ canvas, page: i }))
              .catch((e) => setError((e as Error).message || '提取失败'))
              .finally(() => setExtracting(null))
          }
```

- [ ] **Step 3a: Wrap the return in a fragment (open)**

The cropper must be a SIBLING of the picker's backdrop `<div onClick={onCancel}>`, not a child — otherwise clicking the cropper's own backdrop bubbles up and closes the whole picker. Wrap the return in a fragment.

Find:

```tsx
  if (!file) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
```

Replace with:

```tsx
  if (!file) return null

  return (
    <>
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
```

- [ ] **Step 3b: Close the fragment + render the cropper as a sibling**

Find the last lines of the returned JSX:

```tsx
      </div>
    </div>
  )
}
```

Replace with:

```tsx
      </div>
    </div>

    {cropTarget && (
      <ImageCropper
        source={cropTarget.canvas}
        title={`${file.name} · 第 ${cropTarget.page} 页`}
        onCrop={(img) => { setCropTarget(null); onSelect(img) }}
        onWhole={() => {
          const t = cropTarget
          setCropTarget(null)
          t.canvas.toBlob((b) => {
            if (b) onSelect(new File([b], `${file.name.replace(/\.pdf$/i, '')}_page${t.page}.png`, { type: 'image/png' }))
          }, 'image/png')
        }}
        onCancel={() => setCropTarget(null)}
      />
    )}
    </>
  )
}
```

- [ ] **Step 4: Verify build (no commit)**

Run: `npm run build`
Expected: `✓ built in …`. Do NOT commit.

---

## Task 5: Image entry — optional 框选区域 button

**Files:**
- Modify: `src/components/OcrSection.tsx`

**Interfaces:**
- Consumes: `ImageCropper` (Task 3), existing `handleOcrFile` (from `useOcr`), existing `isPdf(file)` helper.
- Produces: unchanged public contract.

- [ ] **Step 1: Import ImageCropper and add cropper state**

In `src/components/OcrSection.tsx`, find:

```ts
import PdfPagePicker from './PdfPagePicker'
import OcrSettings from './OcrSettings'
```

Replace with:

```ts
import PdfPagePicker from './PdfPagePicker'
import ImageCropper from './ImageCropper'
import OcrSettings from './OcrSettings'
```

Find:

```ts
  const [settingsOpen, setSettingsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
```

Replace with:

```ts
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cropOpen, setCropOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
```

- [ ] **Step 2: Add the 框选区域 button beside 开始识别**

Find:

```tsx
          {/* Analyze button */}
          <button
            onClick={runOcr}
            disabled={!ocrFile || isOcrAnalyzing}
            className="w-full rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer disabled:opacity-40"
            style={{
              background: 'var(--color-accent)',
              color: '#fff',
              border: 'none',
            }}
          >
            {isOcrAnalyzing ? '识别中…' : '开始识别'}
          </button>
```

Replace with:

```tsx
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
          </div>
```

- [ ] **Step 3: Render the cropper overlay**

Find:

```tsx
      <PdfPagePicker
        file={pendingPdf}
        onSelect={handlePdfPageSelected}
        onCancel={() => setPendingPdf(null)}
      />
```

Replace with:

```tsx
      {cropOpen && ocrFile && (
        <ImageCropper
          source={ocrFile}
          title={ocrFile.name}
          onCrop={(img) => { setCropOpen(false); handleOcrFile(img) }}
          onWhole={() => setCropOpen(false)}
          onCancel={() => setCropOpen(false)}
        />
      )}

      <PdfPagePicker
        file={pendingPdf}
        onSelect={handlePdfPageSelected}
        onCancel={() => setPendingPdf(null)}
      />
```

- [ ] **Step 4: Verify build (no commit)**

Run: `npm run build`
Expected: `✓ built in …`. Do NOT commit.

---

## Task 6: Docs sync + full verify + commit 2

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: Update CLAUDE.md file structure**

In `CLAUDE.md`, find the components list line:

```
│   │   ├── PdfPagePicker.tsx        — PDF thumbnail grid
```

Replace with:

```
│   │   ├── PdfPagePicker.tsx        — PDF thumbnail grid (page → ImageCropper)
│   │   ├── ImageCropper.tsx         — box-select crop modal (PDF page / image → cropped PNG)
```

Find the lib list line:

```
│   │   ├── pdfTools.ts              — Lazy pdfjs wrapper
```

Replace with:

```
│   │   ├── pdfTools.ts              — Lazy pdfjs wrapper
│   │   ├── cropTools.ts             — computeCropRect (display→source pixel mapping, unit-tested)
```

- [ ] **Step 2: Add a CLAUDE.md section for the cropper**

In `CLAUDE.md`, find the PDF Input section header:

```
## PDF Input (src/lib/pdfTools.ts + src/components/PdfPagePicker.tsx)
```

Immediately BEFORE it, insert:

```
## Box-Select Crop (src/components/ImageCropper.tsx + src/lib/cropTools.ts)
Generic, OCR-agnostic crop step so users can extract one instrument's row from a 总谱 before OCR. `ImageCropper` takes `source: HTMLCanvasElement | File` (PDF page rendered @2.0x, or an uploaded image), shows a draggable/resizable box (pure React pointer events, no library, dim-outside via `box-shadow`), and on confirm maps the display selection to full-resolution pixels via `computeCropRect` (the only logic-bearing piece, unit-tested in test-roundtrip.ts), crops with `drawImage`, and hands back a PNG `File`. Two entry points: PdfPagePicker (clicking a page opens the cropper; 整页 button = whole page) and OcrSection (optional 框选区域 button for images; not shown for PDFs, which route through the picker). Single-box, iterate: the editable OCR result box accumulates multiple crops.

```

- [ ] **Step 3: Update CLAUDE.md roadmap**

In `CLAUDE.md`, find:

```
- [ ] Phase 3 OCR: box-select UI to extract one instrument from a 总谱 PDF
```

Replace with:

```
- [x] Phase 3 OCR: box-select crop — extract one instrument's row from a 总谱 PDF/image before OCR (single-box, iterate)
```

- [ ] **Step 4: Update README (both language sections)**

In `README.md`, find:

```
| **PDF Input + Page Picker** | Drop a multi-page PDF into the OCR drop zone — page thumbnails appear, click any page to extract it as an image and feed the existing OCR pipeline |
```

Replace with:

```
| **PDF Input + Page Picker** | Drop a multi-page PDF into the OCR drop zone — page thumbnails appear, click any page to extract it as an image and feed the existing OCR pipeline |
| **Box-Select Crop** | On a 总谱 (full score) page or photo, drag a box around one instrument's row (e.g. 笛子) and send just that strip to OCR — crop images too via the 框选区域 button; iterate row by row into the editable result box |
```

In `README.md`, find the shipped roadmap line:

```
- [x] Route C: OCR output is Route B text — normalized, hand-editable, and rendered as a real score in one click
```

Replace with:

```
- [x] Route C: OCR output is Route B text — normalized, hand-editable, and rendered as a real score in one click
- [x] Box-select crop — extract one instrument's row from a 总谱 PDF/image before OCR
- [x] MusicXML volta (跳房子) import via `<ending>`
```

In `README.md` 中文 roadmap, find:

```
- [x] MusicXML 导入表情记号、fermata、倚音、连音（`<time-modification>`）
```

Replace with:

```
- [x] MusicXML 导入表情记号、fermata、倚音、连音（`<time-modification>`）、跳房子（`<ending>`）
- [x] 总谱框选裁剪 — 在 PDF 页/照片上框一行声部（如笛子）单独送识别
```

In `README.md`, find the pending line and remove it (it's now shipped):

```
- [ ] Phase 3 OCR: box-select UI for picking one instrument out of a 总谱 (full score) PDF
```

Delete that line. Do the same for the 中文 pending line:

```
- [ ] Phase 3 OCR：总谱框选 UI，挑一行（如笛子）单独识别
```

Delete it.

- [ ] **Step 5: Full verify**

Run: `npm run test && npm run build`
Expected: `Results: 130 passed, 0 failed` then `Results: 26 passed, 0 failed`; build ends `✓ built in …`.

- [ ] **Step 6: Commit the crop feature**

```bash
git add src/lib/cropTools.ts src/components/ImageCropper.tsx src/components/PdfPagePicker.tsx src/components/OcrSection.tsx scripts/test-roundtrip.ts CLAUDE.md README.md
git commit -m "feat(ocr): 总谱 box-select crop — ImageCropper + cropTools, PDF/image entries

Add a generic, OCR-agnostic crop step. ImageCropper takes a PDF page
canvas (rendered @2.0x) or an uploaded image, shows a draggable/
resizable box, and maps the selection to full-resolution pixels via
the pure computeCropRect (unit-tested) before cropping with drawImage.
PdfPagePicker now opens the cropper on page click (整页 button keeps
whole-page); OcrSection adds an optional 框选区域 button for images.
Single-box, iterate — the editable result box accumulates crops.

5 new computeCropRect assertions (125 -> 130).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017xtAhiQouGLaNQRYHLEUL5"
```

- [ ] **Step 7: Browser verification (manual, before merge)**

Run: `npm run dev` and verify in the browser:
- MusicXML volta: import a score with 1st/2nd endings (or hand-build one) → 跳房子 brackets render.
- PDF crop: drop a multi-page PDF → click a page → cropper opens → drag box → 框选送识别 → OCR runs on the strip; 整页送识别 → whole page.
- Image crop: upload an image → 框选区域 → cropper → 框选送识别 → OCR on the crop; without cropping, 开始识别 still uses the whole image.

Do NOT merge until the user confirms in the browser.

---

## Self-Review Notes

- **Spec coverage:** #3 (`<ending>`→`_volta`, start/stop/discontinue, multi-measure, `"1,2"`) = Task 1. #1 `cropTools.computeCropRect` = Task 2; `ImageCropper` = Task 3; PDF entry = Task 4; image entry = Task 5; docs = Task 1 (volta) + Task 6 (crop). All spec sections mapped.
- **Placeholder scan:** none — every step has full code/commands.
- **Type consistency:** `computeCropRect(sel, display, source)` and `Rect` identical across Tasks 2–3; `ImageCropper` prop names (`source`/`title`/`onCrop`/`onWhole`/`onCancel`) identical across Tasks 3–5; `cropTarget: { canvas, page }` consistent within Task 4.
- **Assertion counts:** test-parser 23→26 (Task 1), test-roundtrip 125→130 (Task 2). Used in verify steps.
