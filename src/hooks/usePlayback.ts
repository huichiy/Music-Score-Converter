import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { buildPlaybackEvents, expandRepeats, nearestNoteStart, totalBeatsOf } from '@/lib/playback'
import { createPlayer, type Player } from '@/lib/tonePlayer'

const DEFAULT_BPM = 90

function clearHighlight(root: HTMLElement | null) {
  if (!root) return
  root.querySelectorAll('.jn-note-playing').forEach((el) => el.classList.remove('jn-note-playing'))
}

function paintHighlight(root: HTMLElement | null, measureIdx: number, noteIdx: number) {
  if (!root) return
  clearHighlight(root)
  const note = root.querySelector(`[data-m="${measureIdx}"][data-n="${noteIdx}"]`)
  note?.classList.add('jn-note-playing')
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
  // The first play() awaits the lazy Tone import. One shared in-flight promise,
  // so a second click in that window can't build a second PolySynth.
  const playerLoadRef = useRef<Promise<Player> | null>(null)
  const rafRef = useRef<number | null>(null)
  // Mirrors of state that async callbacks must read fresh (not from a stale closure)
  const positionRef = useRef(0)
  const rateRef = useRef(1)
  // Bumped by every stop and every score change: a play() that finds a different
  // number after an await was superseded and must not touch the player.
  const runRef = useRef(0)
  const startingRunRef = useRef(-1)
  const unmountedRef = useRef(false)

  const events = useMemo(() => {
    if (!currentMeasures || currentMeasures.length === 0) return []
    return buildPlaybackEvents(expandRepeats(currentMeasures), currentMeasures, currentKeyStr, originalTimeStr)
  }, [currentMeasures, currentKeyStr, originalTimeStr])

  const totalBeats = useMemo(() => totalBeatsOf(events), [events])
  const bpm = parseInt(originalTempoStr) || DEFAULT_BPM

  const setPos = useCallback((beat: number) => {
    positionRef.current = beat
    setPositionBeats(beat)
  }, [])

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  // `letRing`: the piece ended by itself, so don't cut the last notes short
  const halt = useCallback((letRing: boolean) => {
    runRef.current++
    stopLoop()
    playerRef.current?.stop(letRing)
    setStatus('idle')
    setPos(0)
    clearHighlight(scoreRef.current)
  }, [stopLoop, setPos, scoreRef])

  // Not `halt` itself: PlaybackBar uses it as an onClick, which would pass the
  // click event in as `letRing`.
  const stop = useCallback(() => halt(false), [halt])

  // rAF loop: single source for both the progress bar and the follow highlight
  const startLoop = useCallback(() => {
    stopLoop()
    const tick = () => {
      const p = playerRef.current
      if (!p) return
      const pos = p.positionBeats()
      setPos(pos)
      if (pos >= totalBeats) { halt(true); return }   // auto-stop and reset at the end

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
  }, [halt, stopLoop, setPos, totalBeats, events, scoreRef])

  const ensurePlayer = useCallback((): Promise<Player> => {
    if (playerRef.current) return Promise.resolve(playerRef.current)
    if (!playerLoadRef.current) {
      playerLoadRef.current = createPlayer()
        .then((p) => {
          // Unmounted while Tone was loading: nobody will ever dispose this one
          if (unmountedRef.current) {
            p.dispose()
            throw new Error('unmounted')
          }
          playerRef.current = p
          return p
        })
        .finally(() => { playerLoadRef.current = null })
    }
    return playerLoadRef.current
  }, [])

  // `fromBeat` lets "click a note to start there" begin at that note instead of
  // starting at 0 and immediately jumping (which would blip the first note).
  // Without it, a stopped player starts where the slider was left.
  const play = useCallback(async (fromBeat?: number) => {
    if (events.length === 0) return
    setError('')
    // Resuming from pause: the schedule is still loaded, just start the clock.
    // Honor an explicit fromBeat (click-a-note while paused) instead of
    // resuming at the pause point.
    if (status === 'paused' && playerRef.current) {
      if (fromBeat !== undefined) {
        playerRef.current.seekBeat(fromBeat)
        setPos(fromBeat)
      }
      playerRef.current.play()
      setStatus('playing')
      startLoop()
      return
    }

    const run = runRef.current
    if (startingRunRef.current === run) return   // double click while the first start is still loading
    startingRunRef.current = run
    try {
      const player = await ensurePlayer()
      if (run !== runRef.current) return   // stopped or score changed while Tone loaded
      await player.load(events, bpm)
      if (run !== runRef.current) return
      player.setRate(rateRef.current)
      const startAt = fromBeat ?? (positionRef.current < totalBeats ? positionRef.current : 0)
      if (startAt > 0) player.seekBeat(startAt)
      setPos(startAt)
      player.play()
      setStatus('playing')
      startLoop()
    } catch {
      if (unmountedRef.current || run !== runRef.current) return
      setError('音频加载失败，请重试')
      setStatus('idle')
    } finally {
      if (startingRunRef.current === run) startingRunRef.current = -1
    }
  }, [events, bpm, totalBeats, startLoop, status, ensurePlayer, setPos])

  // Re-loading the score, resetting, or unmounting must silence any running audio
  useEffect(() => {
    stop()
  }, [events, stop])

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      runRef.current++
      stopLoop()
      playerRef.current?.dispose()
      playerRef.current = null
    }
  }, [stopLoop])

  const pause = useCallback(() => {
    if (status !== 'playing') return
    stopLoop()
    playerRef.current?.pause()
    setStatus('paused')
  }, [status, stopLoop])

  // Seek works whether we're playing, paused, or stopped. If audio hasn't been
  // created yet (nothing played so far) we only move the visual position; the
  // next play() starts from there.
  const seekBeat = useCallback((beat: number) => {
    const clamped = Math.max(0, Math.min(beat, totalBeats))
    setPos(clamped)
    playerRef.current?.seekBeat(clamped)
    if (status === 'playing') startLoop()
  }, [status, startLoop, totalBeats, setPos])

  const seekToNote = useCallback(async (measureIdx: number, noteIdx: number) => {
    // A note inside a repeat sounds more than once: take the pass we're closest to
    const start = nearestNoteStart(events, measureIdx, noteIdx, positionRef.current)
    if (start === null) return
    if (status === 'playing') {
      seekBeat(start)
      return
    }
    // Not playing (idle or paused): start fresh from the clicked note
    await play(start)
  }, [events, status, seekBeat, play])

  const setRate = useCallback((r: number) => {
    rateRef.current = r
    setRateState(r)
    playerRef.current?.setRate(r)   // takes effect mid-playback
  }, [])

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
    pause,
    seekBeat,
    seekToNote,
    setRate,
  }
}
