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
import type { NoteObject, Measure, MeasureArray } from '@/types/score'

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

  // Sync isDark to document data-theme attribute + re-render SVG with new theme colors
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', store.isDark ? 'dark' : 'light')
    const svg = rerenderWithStore()
    if (svg) setSvgHtml(svg)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isDark])

  // ── File conversion ──────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    store.setIsConverting(true)
    store.setErrorMsg('')
    try {
      const svg = await convert(file)
      setSvgHtml(svg)
    } catch (err) {
      store.setErrorMsg((err as Error).message || '转换失败，请重试')
    } finally {
      store.setIsConverting(false)
    }
  }, [convert, store])

  const handleLoadSample = useCallback(async () => {
    setHasEnteredTool(true)  // sample also enters tool layer
    store.setIsConverting(true)
    store.setErrorMsg('')
    try {
      const svg = await loadSample()
      setSvgHtml(svg)
    } catch (err) {
      store.setErrorMsg((err as Error).message || '示例加载失败')
    } finally {
      store.setIsConverting(false)
    }
  }, [loadSample, store])

  const handleEnterTool = useCallback(() => {
    setHasEnteredTool(true)
  }, [])

  const handleBackToLanding = useCallback(() => {
    setHasEnteredTool(false)
  }, [])

  // ── Part change ───────────────────────────────────────────────
  const handlePartChange = useCallback(async (idx: number) => {
    const svg = await changePartAndRender(idx)
    if (svg) setSvgHtml(svg)
  }, [changePartAndRender])

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
  const handleNoteClick = useCallback((m: number, n: number) => {
    const { currentMeasures } = useScoreStore.getState()
    if (!currentMeasures) return
    const measure = currentMeasures[m]
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
    const { currentMeasures, currentKeyStr } = useScoreStore.getState()
    if (!currentMeasures) return

    const newMeasures: Measure[] = currentMeasures.map((measure, mi) => {
      if (mi !== m) return measure
      if (!Array.isArray(measure)) return measure
      const arr = [...(measure as MeasureArray)] as unknown as MeasureArray
      arr[n] = { ...(measure as MeasureArray)[n], ...updated }
      // Copy measure metadata
      arr._repeatStart = (measure as MeasureArray)._repeatStart
      arr._repeatEnd = (measure as MeasureArray)._repeatEnd
      arr._direction = (measure as MeasureArray)._direction
      arr._dynamic = (measure as MeasureArray)._dynamic
      arr._wedge = (measure as MeasureArray)._wedge
      return arr
    })

    store.setCurrent(newMeasures, currentKeyStr)
    store.setTransposeKey('')
    store.setPopupNote(null)
    // edit mode stays ON — user closes it manually

    const svg = rerenderWithStore()
    if (svg) setSvgHtml(svg)
  }, [store, rerenderWithStore])

  // ── Edit Mode B: text editor ─────────────────────────────────
  const handleEditModeB = useCallback(() => {
    store.setEditTextVisible(!store.editTextVisible)
  }, [store])

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

  // Tool-layer drag-and-drop: accept a dropped file anywhere on the main canvas
  // (works whether or not a score is already loaded).
  const handleMainDragOver = useCallback((e: React.DragEvent) => {
    if (!hasEnteredTool) return
    e.preventDefault()
    setDragOver(true)
  }, [hasEnteredTool])
  const handleMainDragLeave = useCallback(() => setDragOver(false), [])
  const handleMainDrop = useCallback((e: React.DragEvent) => {
    if (!hasEnteredTool) return
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [hasEnteredTool, handleFile])

  return (
    <div className="flex flex-col sm:flex-row h-screen overflow-hidden" style={{ background: 'var(--color-background)' }}>
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
        {hasEnteredTool && dragOver && (
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
