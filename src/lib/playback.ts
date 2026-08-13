// Pure playback scheduling — no DOM, no audio, no Tone.js.
// Unit-tested in scripts/test-roundtrip.ts.
//
// Two stages:
//   expandRepeats()       score order → linear performance order (repeats + voltas)
//   buildPlaybackEvents() linear order → timed note events (times in BEATS)
//
// Times are in beats (quarter note = 1) so tempo lives entirely in the player:
// the speed slider just changes Transport.bpm, no re-deriving of music.

import type { Measure, MeasureArray, MultiRestBlock } from '@/types/score'
import { noteToMidi } from './parser'
import { tupletFactor } from './renderer'
import { computeOrigIdxMap, durationBeats } from './editor'

/** One measure occurrence in performance order; `measureIdx` indexes the ORIGINAL array. */
export interface ExpandedEntry { measureIdx: number }

/**
 * Unroll `|:` / `:|` repeats and `{N}` voltas into performance order.
 *
 * Two passes per repeat section. On pass 1 only measures with `_volta === 1`
 * (or no volta) play; on pass 2 only `_volta === 2` (or no volta). `_volta >= 3`
 * therefore never plays — a documented v1 limitation.
 *
 * A `:|` with no preceding `|:` repeats from the start of the score, which is
 * standard notation behavior.
 */
export function expandRepeats(measures: Measure[]): ExpandedEntry[] {
  const out: ExpandedEntry[] = []
  // Runaway guard for pathological input (e.g. every measure both opens and closes)
  const cap = Math.max(8, measures.length * 4)

  let i = 0
  let sectionStart = 0
  let pass = 1
  // Set right after a jump back: prevents the section's `|:` from resetting `pass`
  // to 1 (which would loop forever).
  let justJumped = false

  while (i < measures.length && out.length < cap) {
    const m = measures[i]
    const arr = Array.isArray(m) ? (m as MeasureArray) : null

    if (arr?._repeatStart && !justJumped) {
      sectionStart = i
      pass = 1
    }
    justJumped = false

    const volta = arr?._volta
    if (volta !== undefined && volta !== pass) {
      i++
      continue
    }

    out.push({ measureIdx: i })

    if (arr?._repeatEnd && pass === 1) {
      pass = 2
      i = sectionStart
      justJumped = true
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
  let beatsPerMeasure = parseInt(timeStr.split('/')[0]) || 4

  for (const entry of expanded) {
    const m = measures[entry.measureIdx]

    // Multi-measure rest: silence for N measures at the current meter
    if (!Array.isArray(m)) {
      beat += ((m as MultiRestBlock)._multiRest || 0) * beatsPerMeasure
      continue
    }

    const arr = m as MeasureArray
    if (arr._timeSig) {
      beatsPerMeasure = parseInt(arr._timeSig.split('/')[0]) || beatsPerMeasure
    }
    const origIdx = origIdxMap.get(entry.measureIdx) ?? -1

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

      let mainStart = beat
      let mainDur = dur

      // Grace note (倚音) borrows the front of the main note
      if (noteObj.graceNote) {
        const g = noteObj.graceNote
        events.push({
          startBeat: beat,
          durBeats: GRACE_BEATS,
          midi: noteToMidi(g.degree, g.octave, g.accidental, keyStr),
          measureIdx: origIdx,
          noteIdx: j,
        })
        mainStart = beat + GRACE_BEATS
        mainDur = Math.max(0.01, dur - GRACE_BEATS)
      }

      events.push({
        startBeat: mainStart,
        durBeats: mainDur,
        midi: noteToMidi(noteObj.degree, noteObj.octave, noteObj.accidental, keyStr),
        measureIdx: origIdx,
        noteIdx: j,
      })

      // Chord notes (double stops) sound with the melody note
      if (noteObj.chordNotes) {
        for (const cn of noteObj.chordNotes) {
          events.push({
            startBeat: mainStart,
            durBeats: mainDur,
            midi: noteToMidi(cn.degree, cn.octave, cn.accidental, keyStr),
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
