// Pure playback scheduling — no DOM, no audio, no Tone.js.
// Unit-tested in scripts/test-roundtrip.ts.
//
// Two stages:
//   expandRepeats()       score order → linear performance order (repeats + voltas)
//   buildPlaybackEvents() linear order → timed note events (times in BEATS)
//
// Times are in beats (quarter note = 1) so tempo lives entirely in the player:
// the speed slider just changes Transport.bpm, no re-deriving of music.

import type { Measure, MeasureArray } from '@/types/score'

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
