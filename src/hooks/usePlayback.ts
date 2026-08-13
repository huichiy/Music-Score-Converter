import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { buildPlaybackEvents, expandRepeats, totalBeatsOf } from '@/lib/playback'
import { createPlayer, type Player } from '@/lib/tonePlayer'

const DEFAULT_BPM = 90

function clearHighlight(root: HTMLElement | null) {
  if (!root) return
  root.querySelectorAll('.jn-note-playing').forEach((el) => el.classList.remove('jn-note-playing'))
  root.querySelectorAll('.jn-rest-playing').forEach((el) => el.classList.remove('jn-rest-playing'))
}

function paintHighlight(root: HTMLElement | null, measureIdx: number, noteIdx: number) {
  if (!root) return
  clearHighlight(root)
  const note = root.querySelector(`[data-m="${measureIdx}"][data-n="${noteIdx}"]`)
  if (note) { note.classList.add('jn-note-playing'); return }
  // Whole-rest measures have no per-note data-m; outline the rest group instead
  const rest = root.querySelector(`[data-rest-m="${measureIdx}"]`)
  rest?.classList.add('jn-rest-playing')
}

export function usePlayback(scoreRef: React.RefObject<HTMLDivElement | null>) {
  const currentMeasures = useScoreStore((s) => s.currentMeasures)
  const currentKeyStr = useScoreStore((s) => s.currentKeyStr)
  const originalTimeStr = useScoreStore((s) => s.originalTimeStr)
  const originalTempoStr = useScoreStore((s) => s.originalTempoStr)

  const [status, setStatus] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [positionBeats, setPositionBeats] = useState(0)
  const [rate, setRateState] = useState(1)
  const [error, setError] = useState('')
  const playerRef = useRef<Player | null>(null)
  const rafRef = useRef<number | null>(null)

  const events = useMemo(() => {
    if (!currentMeasures || currentMeasures.length === 0) return []
    return buildPlaybackEvents(expandRepeats(currentMeasures), currentMeasures, currentKeyStr, originalTimeStr)
  }, [currentMeasures, currentKeyStr, originalTimeStr])

  const totalBeats = useMemo(() => totalBeatsOf(events), [events])
  const bpm = parseInt(originalTempoStr) || DEFAULT_BPM

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  const stop = useCallback(() => {
    stopLoop()
    playerRef.current?.stop()
    setStatus('idle')
    setPositionBeats(0)
    clearHighlight(scoreRef.current)
  }, [stopLoop, scoreRef])

  // rAF loop: single source for progress (and, in the next task, the highlight)
  const startLoop = useCallback(() => {
    stopLoop()
    const tick = () => {
      const p = playerRef.current
      if (!p) return
      const pos = p.positionBeats()
      setPositionBeats(pos)
      if (pos >= totalBeats) { stop(); return }   // auto-stop and reset at the end

      // Latest event that has already started is the one sounding now
      let cur = -1
      for (let i = 0; i < events.length; i++) {
        if (events[i].startBeat <= pos + 1e-6) cur = i
        else break
      }
      if (cur >= 0) paintHighlight(scoreRef.current, events[cur].measureIdx, events[cur].noteIdx)

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stop, stopLoop, totalBeats, events, scoreRef])

  // `fromBeat` lets "click a note to start there" begin at that note instead of
  // starting at 0 and immediately jumping (which would blip the first note).
  const play = useCallback(async (fromBeat?: number) => {
    if (events.length === 0) return
    setError('')
    try {
      if (!playerRef.current) playerRef.current = await createPlayer()
      await playerRef.current.load(events, bpm)
      playerRef.current.setRate(rate)
      if (fromBeat !== undefined) {
        playerRef.current.seekBeat(fromBeat)
        setPositionBeats(fromBeat)
      }
      playerRef.current.play()
      setStatus('playing')
      startLoop()
    } catch {
      setError('音频加载失败，请重试')
      setStatus('idle')
    }
  }, [events, bpm, rate, startLoop])

  // Re-loading the score, resetting, or unmounting must silence any running audio
  useEffect(() => {
    stop()
  }, [events, stop])

  useEffect(() => () => {
    stopLoop()
    playerRef.current?.dispose()
    playerRef.current = null
  }, [stopLoop])

  return {
    status,
    positionBeats,
    totalBeats,
    rate,
    bpm,
    error,
    canPlay: events.length > 0,
    play,
    stop,
    // Filled in by later tasks; declared now so PlaybackBar's props never change shape
    pause: () => {},
    seekBeat: (_b: number) => {},
    seekToNote: (_m: number, _n: number) => {},
    setRate: (r: number) => setRateState(r),
    scoreRef,
  }
}
