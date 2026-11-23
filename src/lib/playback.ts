// Pure playback scheduling — no DOM, no audio, no Tone.js.
// Unit-tested in scripts/test-roundtrip.ts and scripts/test-playback-fixes.ts.
//
// Two stages:
//   expandRepeats()       score order → linear performance order (repeats, voltas, D.C./D.S./Fine)
//   buildPlaybackEvents() linear order → timed note events (times in BEATS)
//
// Times are in beats (quarter note = 1) so tempo lives entirely in the player:
// the speed slider just changes Transport.bpm, no re-deriving of music.

import type { Measure, MeasureArray, MultiRestBlock } from '@/types/score'
import { noteToMidi } from './parser'
import { tupletFactor } from './renderer'
import { computeOrigIdxMap, durationBeats } from './editor'
import { classifyDirection } from './directions'
import { barBeatsOf } from './meter'

/** One measure occurrence in performance order; `measureIdx` indexes the ORIGINAL array. */
export interface ExpandedEntry { measureIdx: number }

/**
 * Unroll `|:` / `:|` repeats, `{N}` voltas and a D.C. / D.S. jump into
 * performance order.
 *
 * Two passes per repeat section. On pass 1 only measures with `_volta === 1`
 * (or no volta) play; on pass 2 only `_volta === 2` (or no volta). `_volta >= 3`
 * therefore never plays — a documented v1 limitation.
 *
 * A `:|` with no `|:` of its own repeats from the end of the previous repeated
 * section (from the start of the score when there was none), which is standard
 * notation behavior: `A :| B :|` plays A A B B.
 *
 * D.C. / D.S. is the standard single jump: at the end of a measure whose
 * `_direction` is "D.C." the performance goes back to measure 0; "D.S." goes
 * back to the nearest "Segno" (to measure 0 when there is none). Afterwards
 * repeats are NOT taken again, only the last ending of each volta bracket
 * plays, and a "Fine" measure ends the piece (Fine is ignored on the way down).
 * Only one jump happens per performance. "To Coda" / "Coda" are not handled —
 * a D.S. al Coda piece plays on to the end of the score.
 */
export function expandRepeats(measures: Measure[]): ExpandedEntry[] {
  const out: ExpandedEntry[] = []
  // Runaway guard for pathological input (e.g. every measure both opens and closes)
  const cap = Math.max(8, measures.length * 4)

  const arrOf = (idx: number): MeasureArray | null => {
    const m = measures[idx]
    return Array.isArray(m) ? (m as MeasureArray) : null
  }
  const voltaOf = (idx: number): number | undefined => arrOf(idx)?._volta

  // The last ending of each volta bracket (a run of consecutive volta measures;
  // a lower number starts the next bracket). After D.C. / D.S. only that one plays.
  const lastVolta: (number | undefined)[] = []
  for (let s = 0; s < measures.length; ) {
    const first = voltaOf(s)
    if (first === undefined) { s++; continue }
    let e = s
    let last = first
    while (e + 1 < measures.length) {
      const v = voltaOf(e + 1)
      if (v === undefined || v < last) break
      e++
      last = v
    }
    for (let k = s; k <= e; k++) lastVolta[k] = last
    s = e + 1
  }

  // D.S. target: the nearest Segno at or before the jump, else any Segno, else the start (= D.C.)
  const segnoFor = (from: number): number => {
    for (let k = from; k >= 0; k--) {
      if (classifyDirection(arrOf(k)?._direction) === 'segno') return k
    }
    const any = measures.findIndex((_, k) => classifyDirection(arrOf(k)?._direction) === 'segno')
    return any >= 0 ? any : 0
  }

  let i = 0
  let sectionStart = 0
  let sectionEnd = -1   // the `:|` measure that sent pass 1 back; later measures are past the section
  let pass = 1
  // Set right after a jump back: prevents the section's `|:` from resetting `pass`
  // to 1 (which would loop forever).
  let justJumped = false
  let afterJump = false // the D.C. / D.S. jump has been taken

  while (i < measures.length && out.length < cap) {
    const arr = arrOf(i)
    const volta = arr?._volta

    // Pass 2 has walked past its section (the `:|` measure and the second
    // ending are behind us): start over from here, so a later `:|` with no `|:`
    // repeats from THIS measure and a later `{1}` is a pass-1 ending again.
    if (!afterJump && pass === 2 && i > sectionEnd && volta !== 2) {
      sectionStart = i
      pass = 1
    }

    if (!afterJump && arr?._repeatStart && !justJumped) {
      sectionStart = i
      pass = 1
    }
    justJumped = false

    if (volta !== undefined && volta !== (afterJump ? lastVolta[i] : pass)) {
      i++
      continue
    }

    out.push({ measureIdx: i })

    if (!afterJump && arr?._repeatEnd && pass === 1) {
      pass = 2
      sectionEnd = i
      i = sectionStart
      justJumped = true
      continue
    }

    const direction = classifyDirection(arr?._direction)
    if (afterJump && direction === 'fine') break
    if (!afterJump && (direction === 'dc' || direction === 'ds')) {
      afterJump = true
      i = direction === 'ds' ? segnoFor(i) : 0
      continue
    }

    i++
  }

  return out
}

/** A single sounding note: when it starts, how long it lasts, and where it lives on screen. */
export interface PlaybackEvent {
  startBeat: number    // beats from the start of playback
  durBeats: number
  midi: number
  measureIdx: number   // renderer origIdx == SVG data-m (for the follow highlight)
  noteIdx: number      // == SVG data-n
}

/** Grace note (倚音) length, taken from the front of its main note. */
export const GRACE_BEATS = 0.125

/**
 * Turn performance order into timed events.
 *
 * Times are in beats. `measureIdx` is the renderer's origIdx (not the array
 * index) so the highlight can find the rendered note by `data-m`/`data-n` —
 * computeOrigIdxMap is reused from editor.ts rather than re-derived, because
 * two copies of that mapping drift (see CLAUDE.md).
 *
 * `keyStr` / `timeStr` are the score's INITIAL key and meter. A mid-piece key
 * change (`_key`) or temp time signature (`_timeSig`) takes effect from its
 * measure on, but is resolved here in SCORE order and looked up by each
 * entry's measure index: a repeat or D.C. jump back to an earlier measure must
 * use the key and meter in force THERE, not whatever the performance last saw.
 */
export function buildPlaybackEvents(
  expanded: ExpandedEntry[],
  measures: Measure[],
  keyStr: string,
  timeStr: string,
): PlaybackEvent[] {
  const origIdxMap = computeOrigIdxMap(measures)
  const events: PlaybackEvent[] = []
  let beat = 0

  const keyOf: string[] = []
  const barBeatsAt: number[] = []
  let runKey = keyStr
  let runBar = barBeatsOf(timeStr)
  measures.forEach((m, idx) => {
    if (Array.isArray(m)) {
      const arr = m as MeasureArray
      if (arr._key) runKey = arr._key
      if (arr._timeSig) runBar = barBeatsOf(arr._timeSig)
    }
    keyOf[idx] = runKey
    barBeatsAt[idx] = runBar
  })

  for (const entry of expanded) {
    const m = measures[entry.measureIdx]
    const key = keyOf[entry.measureIdx]
    const barBeats = barBeatsAt[entry.measureIdx]

    // Multi-measure rest: silence for N measures at the current meter
    if (!Array.isArray(m)) {
      beat += ((m as MultiRestBlock)._multiRest || 0) * barBeats
      continue
    }

    const arr = m as MeasureArray
    const origIdx = origIdxMap.get(entry.measureIdx) ?? -1

    // A lone whole rest is the notation for a fully silent bar (the renderer
    // draws it as such) — advance one bar rather than a literal whole note.
    // A partially filled measure is NOT padded: written durations only.
    if (arr.length === 1 && arr[0].rest && arr[0].type === 'whole') {
      beat += barBeats
      continue
    }

    for (let j = 0; j < arr.length; j++) {
      const noteObj = arr[j]
      const dur = durationBeats(noteObj.type, noteObj.dot) * tupletFactor(noteObj.tuplet)

      // Rest: silence, but time still moves
      if (noteObj.rest) {
        beat += dur
        continue
      }

      // Tie continuation: lengthen whatever was still sounding at this instant
      // (all voices of a chord, not just the melody) instead of re-attacking.
      if (noteObj.tie) {
        for (const ev of events) {
          if (Math.abs(ev.startBeat + ev.durBeats - beat) < 1e-6) ev.durBeats += dur
        }
        beat += dur
        continue
      }

      // Unpitched percussion (X): there is no pitch to sound, but time still moves
      if (noteObj.degree === 0) {
        beat += dur
        continue
      }

      let mainStart = beat
      let mainDur = dur

      // Grace note (倚音) borrows the front of the main note
      if (noteObj.graceNote) {
        const g = noteObj.graceNote
        events.push({
          startBeat: beat,
          durBeats: GRACE_BEATS,
          midi: noteToMidi(g.degree, g.octave, g.accidental, key),
          measureIdx: origIdx,
          noteIdx: j,
        })
        mainStart = beat + GRACE_BEATS
        mainDur = Math.max(0.01, dur - GRACE_BEATS)
      }

      events.push({
        startBeat: mainStart,
        durBeats: mainDur,
        midi: noteToMidi(noteObj.degree, noteObj.octave, noteObj.accidental, key),
        measureIdx: origIdx,
        noteIdx: j,
      })

      // Chord notes (double stops) sound with the melody note
      if (noteObj.chordNotes) {
        for (const cn of noteObj.chordNotes) {
          events.push({
            startBeat: mainStart,
            durBeats: mainDur,
            midi: noteToMidi(cn.degree, cn.octave, cn.accidental, key),
            measureIdx: origIdx,
            noteIdx: j,
          })
        }
      }

      beat += dur
    }
  }

  return events
}

/** Total length in beats — the end of the last sounding note. */
export function totalBeatsOf(events: PlaybackEvent[]): number {
  return events.reduce((max, e) => Math.max(max, e.startBeat + e.durBeats), 0)
}

/**
 * Where a clicked note starts, when it sounds more than once (a repeat or a
 * D.C. replays it): the occurrence closest to `nearBeat`, the current playback
 * position. A grace note and its main note share (measureIdx, noteIdx) but are
 * one occurrence — it starts at the grace. Returns null when no event matches.
 */
export function nearestNoteStart(
  events: PlaybackEvent[],
  measureIdx: number,
  noteIdx: number,
  nearBeat: number,
): number | null {
  let best: number | null = null
  let lastStart = -Infinity
  for (const ev of events) {
    if (ev.measureIdx !== measureIdx || ev.noteIdx !== noteIdx) continue
    // Same occurrence as the previous match (grace + main, chord voices): skip
    if (ev.startBeat - lastStart <= GRACE_BEATS + 1e-6) continue
    lastStart = ev.startBeat
    if (best === null || Math.abs(ev.startBeat - nearBeat) < Math.abs(best - nearBeat)) {
      best = ev.startBeat
    }
  }
  return best
}
