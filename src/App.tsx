import { useRef, useState, useCallback, useEffect } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { useFileHandler } from '@/hooks/useFileHandler'
import Sidebar from '@/components/Sidebar'
import LandingPage from '@/components/LandingPage'
import Toolbar from '@/components/Toolbar'
import ScoreOutput from '@/components/ScoreOutput'
import PlaybackBar from '@/components/PlaybackBar'
import { usePlayback } from '@/hooks/usePlayback'
import EditNotePopup from '@/components/EditNotePopup'
import EditTextOverlay from '@/components/EditTextOverlay'
import { measureIdxFromOrigIdx, withNoteEdited } from '@/lib/editor'
import { loadErrorMessage } from '@/lib/scoreFile'
import type { NoteObject, MeasureArray } from '@/types/score'

// Only a file drag is ours: dragging selected text around the page must not raise the drop overlay
const hasFileDrag = (dt: DataTransfer | null) => Array.from(dt?.types ?? []).includes('Files')

// Resize events arrive in bursts while a window edge is dragged; lay out once it settles
const RELAYOUT_DEBOUNCE_MS = 150

export default function App() {
  const mainContentRef = useRef<HTMLDivElement>(null)
  const scoreOutputRef = useRef<HTMLDivElement>(null)
  const [svgHtml, setSvgHtml] = useState('')
  // Two-layer entry: landing pitches the project; clicking 开始使用 lifts user into the tool layer.
  // Reset keeps you in the tool layer (bouncing to landing on every reset is jarring);
  // the sidebar title / 首页 link is the explicit way back. Score state survives the trip.
  const [hasEnteredTool, setHasEnteredTool] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const store = useScoreStore()
  const { convert, transpose, loadSample, changePartAndRender, rerenderWithStore, loadFromText } = useFileHandler(mainContentRef)
  const playback = usePlayback(scoreOutputRef)
  // pause() does nothing unless something is playing
  const pausePlayback = playback.pause

  // The score is laid out for main's width at the time. While the landing page shows, the
  // sidebar is hidden and main is wider, so a layout made then is wrong for the tool layer.
  const relayout = useCallback(() => {
    const svg = rerenderWithStore()   // null when nothing is converted
    if (svg) setSvgHtml(svg)
  }, [rerenderWithStore])

  // Sync isDark to document data-theme attribute + re-render SVG with new theme colors
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', store.isDark ? 'dark' : 'light')
    if (hasEnteredTool) relayout()   // from the landing page it waits for the tool layer's own pass below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isDark])

  // Re-layout when the measures-per-line setting changes
  useEffect(() => {
    relayout()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.measuresPerLine])

  // Back in the tool layer (sidebar mounted, main narrower): lay the score out for this width
  useEffect(() => {
    if (hasEnteredTool) relayout()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEnteredTool])

  // Rotating the phone or resizing the window changes main's width without any state
  // change, so watch the element itself.
  const hasEnteredToolRef = useRef(hasEnteredTool)
  hasEnteredToolRef.current = hasEnteredTool
  useEffect(() => {
    const el = mainContentRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let lastWidth = el.clientWidth
    let timer: number | undefined
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth
      if (width === lastWidth) return   // height-only change (on-screen keyboard, sidebar max-height)
      lastWidth = width
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (hasEnteredToolRef.current) relayout()
      }, RELAYOUT_DEBOUNCE_MS)
    })
    observer.observe(el)
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [relayout])

  // Dropping a file outside a drop zone makes the browser open it and navigate away,
  // taking the score with it. Refuse every file drag nobody claimed.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      // A drop zone's own handler ran first (React listens below window) and has already
      // called preventDefault; only the unclaimed ones are refused here
      if (!hasFileDrag(e.dataTransfer) || e.defaultPrevented) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    }
    const onDrop = (e: DragEvent) => {
      if (hasFileDrag(e.dataTransfer)) e.preventDefault()
      setDragOver(false)
    }
    const onDragEnd = () => setDragOver(false)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [])

  // ── File conversion ──────────────────────────────────────────
  // The overlay belongs to the last load still running: one that finishes while a newer
  // one is in flight must not take it down.
  const loadsInFlight = useRef(0)
  const runLoad = useCallback(async (load: () => Promise<string | null>) => {
    loadsInFlight.current++
    useScoreStore.getState().setIsConverting(true)
    useScoreStore.getState().setErrorMsg('')
    try {
      const svg = await load()
      if (svg !== null) setSvgHtml(svg)   // null: superseded by a newer load
    } catch (err) {
      // The score on screen is untouched; say why the file was not used
      useScoreStore.getState().setErrorMsg(loadErrorMessage(err))
    } finally {
      if (--loadsInFlight.current === 0) useScoreStore.getState().setIsConverting(false)
    }
  }, [])

  const handleFile = useCallback((file: File) => runLoad(() => convert(file)), [runLoad, convert])

  const handleLoadSample = useCallback(() => {
    setHasEnteredTool(true)  // sample also enters tool layer
    return runLoad(loadSample)
  }, [runLoad, loadSample])

  const handleEnterTool = useCallback(() => {
    setHasEnteredTool(true)
  }, [])

  const handleBackToLanding = useCallback(() => {
    // The transport bar goes with the tool layer; audio must not keep playing without it
    pausePlayback()
    setHasEnteredTool(false)
  }, [pausePlayback])

  // ── Part change ───────────────────────────────────────────────
  const handlePartChange = useCallback(async (idx: number) => {
    try {
      const svg = await changePartAndRender(idx)
      if (svg) setSvgHtml(svg)
    } catch (err) {
      store.setErrorMsg(loadErrorMessage(err))
    }
  }, [changePartAndRender, store])

  // ── Transpose ─────────────────────────────────────────────────
  const handleTranspose = useCallback((key: string) => {
    const svg = transpose(key)
    if (svg) setSvgHtml(svg)
  }, [transpose])

  // ── Theme toggle ─────────────────────────────────────────────
  const handleThemeToggle = useCallback(() => {
    store.setIsDark(!store.isDark)
  }, [store])

  // ── Reset ─────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    store.reset()
    setSvgHtml('')
  }, [store])

  // ── Edit Mode A: note click ───────────────────────────────────
  // `m` is the clicked element's data-m — the renderer's origIdx, NOT an index
  // into currentMeasures (whole rests and [N] blocks shift the two apart), so it
  // is mapped back here and in handleNoteConfirm. popupNote.m keeps the data-m.
  const handleNoteClick = useCallback((m: number, n: number) => {
    const { currentMeasures } = useScoreStore.getState()
    if (!currentMeasures) return
    const measure = currentMeasures[measureIdxFromOrigIdx(currentMeasures, m)]
    if (!Array.isArray(measure)) return
    const note = (measure as MeasureArray)[n]
    if (!note) return
    store.setPopupNote({ m, n, note })
  }, [store])

  const handleEditModeAToggle = useCallback(() => {
    store.setEditModeA(!store.editModeA)
    store.setPopupNote(null)
  }, [store])

  const handleNoteConfirm = useCallback((m: number, n: number, updated: Partial<NoteObject>) => {
    const { currentMeasures, currentKeyStr, originalTimeStr, originalTitleStr, originalTempoStr } = useScoreStore.getState()
    if (!currentMeasures) return

    const measureIdx = measureIdxFromOrigIdx(currentMeasures, m)
    if (measureIdx < 0) return
    const newMeasures = withNoteEdited(currentMeasures, measureIdx, n, updated)

    store.setCurrent(newMeasures, currentKeyStr)
    // The edit now IS the score: rebase the "original" on it. Otherwise a score
    // edited while transposed would show 原调 for a score that is in another key,
    // and the next transpose (which starts from originalMeasures) would throw the edit away.
    store.setOriginal(newMeasures, currentKeyStr, originalTimeStr, originalTitleStr, originalTempoStr)
    store.setTransposeKey('')
    store.setPopupNote(null)
    // edit mode stays ON — user closes it manually

    const svg = rerenderWithStore()
    if (svg) setSvgHtml(svg)
  }, [store, rerenderWithStore])

  // ── Edit Mode B: text editor ─────────────────────────────────
  const handleEditModeB = useCallback(() => {
    // The full-screen editor covers the transport bar, so opening it must not leave audio playing
    if (!store.editTextVisible) pausePlayback()
    store.setEditTextVisible(!store.editTextVisible)
  }, [store, pausePlayback])

  const handleTextSave = useCallback((text: string) => {
    try {
      const svg = loadFromText(text)
      setSvgHtml(svg)
      store.setEditTextVisible(false)
    } catch (err) {
      store.setErrorMsg((err as Error).message || '解析失败')
    }
  }, [loadFromText, store])

  // ── OCR score ────────────────────────────────────────────────
  const handleOcrScore = useCallback((svg: string) => {
    setSvgHtml(svg)
  }, [])

  const isConverted = store.isConverted
  const isConverting = store.isConverting
  const errorMsg = store.errorMsg

  // Drag-and-drop: accept a dropped file anywhere on the main canvas, whether or not a
  // score is loaded. On the landing page a drop enters the tool layer and loads the file.
  const handleMainDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFileDrag(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])
  const handleMainDragLeave = useCallback((e: React.DragEvent) => {
    // Crossing into a child of main also fires dragleave on main; the drag is still over it
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
    setDragOver(false)
  }, [])
  const handleMainDrop = useCallback((e: React.DragEvent) => {
    if (!hasFileDrag(e.dataTransfer)) return
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    setHasEnteredTool(true)
    handleFile(file)
  }, [handleFile])

  return (
    <div className="flex flex-col sm:flex-row h-dvh overflow-hidden" style={{ background: 'var(--color-background)' }}>
      {hasEnteredTool && (
        <Sidebar
          onFile={handleFile}
          onPartChange={handlePartChange}
          onTranspose={handleTranspose}
          onOcrScore={handleOcrScore}
          loadFromText={loadFromText}
          svgRef={scoreOutputRef}
          isDark={store.isDark}
          onThemeToggle={handleThemeToggle}
          onBackToLanding={handleBackToLanding}
        />
      )}

      {/* Main content */}
      <main
        ref={mainContentRef}
        className="flex-1 flex flex-col min-w-0 overflow-hidden relative"
        style={{ background: 'var(--color-background)' }}
        onDragOver={handleMainDragOver}
        onDragLeave={handleMainDragLeave}
        onDrop={handleMainDrop}
      >
        {isConverting && (
          <div
            className="absolute inset-0 flex items-center justify-center z-40"
            style={{ background: 'rgba(0,0,0,0.5)' }}
          >
            <div
              className="px-6 py-4 rounded-xl text-sm font-medium"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              转换中…
            </div>
          </div>
        )}

        {errorMsg && (
          <div
            className="mx-4 mt-3 px-4 py-3 rounded-lg text-sm flex items-center justify-between"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
              color: 'var(--color-accent)',
            }}
          >
            <span>{errorMsg}</span>
            <button
              onClick={() => store.setErrorMsg('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '16px' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Drop-target overlay — appears only when user is dragging a file over the main canvas */}
        {dragOver && (
          <div
            className="absolute inset-0 flex items-center justify-center z-40 pointer-events-none"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
              border: '2px dashed var(--color-accent)',
              borderRadius: '12px',
              margin: '12px',
            }}
          >
            <div
              className="px-6 py-4 rounded-lg text-sm font-medium"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-accent)',
                color: 'var(--color-accent)',
              }}
            >
              松手即可上传
            </div>
          </div>
        )}

        {!hasEnteredTool ? (
          <LandingPage
            onEnterTool={handleEnterTool}
            onLoadSample={handleLoadSample}
            isDark={store.isDark}
            onThemeToggle={handleThemeToggle}
          />
        ) : isConverted ? (
          <>
            <Toolbar
              onEditModeA={handleEditModeAToggle}
              onEditModeB={handleEditModeB}
              onReset={handleReset}
            />
            <PlaybackBar playback={playback} />
            <div className="flex-1 overflow-y-auto">
              <ScoreOutput
                svgHtml={svgHtml}
                outputRef={scoreOutputRef}
                onNoteClick={handleNoteClick}
                onNoteSeek={playback.seekToNote}
              />
            </div>
          </>
        ) : (
          // Empty tool state — user entered but hasn't converted anything yet.
          // Sidebar is fully usable; this surface invites a drop or sidebar click.
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="text-center" style={{ maxWidth: 380 }}>
              <div
                style={{
                  fontSize: 38,
                  marginBottom: 14,
                  color: 'var(--color-muted)',
                  fontFamily: "Georgia, 'Noto Serif SC', serif",
                  letterSpacing: 6,
                  userSelect: 'none',
                }}
              >
                1 2 3
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 8 }}>
                把乐谱拖到这里
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.7 }}>
                或在左侧选择文件 · 支持 MusicXML、MIDI、ABC
                <br />
                也可以扫一张简谱/五线谱图片
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Overlays */}
      <EditNotePopup onConfirm={handleNoteConfirm} onClose={() => store.setPopupNote(null)} />
      <EditTextOverlay onSave={handleTextSave} onClose={() => store.setEditTextVisible(false)} />
    </div>
  )
}
