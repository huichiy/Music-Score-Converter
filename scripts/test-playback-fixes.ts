// Regression tests for the playback scheduler fixes (audit round 2).
// Run via: npx tsx scripts/test-playback-fixes.ts
//
// Pure scheduler only — the audio layer (tonePlayer) and the hook need a real
// AudioContext / React, so their fixes are covered by reasoning + browser checks.
// Self-contained on purpose: scripts/test-roundtrip.ts keeps its helpers private.

import { parseFromText } from '../src/lib/editor'
import { expandRepeats, buildPlaybackEvents, nearestNoteStart } from '../src/lib/playback'
import type { Measure, MeasureArray, NoteObject } from '../src/types/score'

let pass = 0
let fail = 0
const failures: string[] = []

function assertEq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    failures.push(`${label}\n    expected: ${e}\n    actual:   ${a}`)
    console.log(`  ✗ ${label}`)
    console.log(`    expected: ${e}`)
    console.log(`    actual:   ${a}`)
  }
}

function describe(name: string, fn: () => void) {
  console.log(`\n── ${name} ──`)
  fn()
}

function note(p: Partial<NoteObject>): NoteObject {
  return {
    degree: 1, octave: 0, type: 'quarter', dot: false, tie: false, rest: false,
    accidental: '', slurStart: false, slurStop: false, ...p,
  }
}

function measure(notes: NoteObject[], meta: Partial<MeasureArray> = {}): MeasureArray {
  const arr = notes.slice() as unknown as MeasureArray
  arr._repeatStart = meta._repeatStart || false
  arr._repeatEnd = meta._repeatEnd || false
  arr._direction = meta._direction || ''
  arr._dynamic = ''
  arr._wedge = null
  if (meta._volta !== undefined) arr._volta = meta._volta
  if (meta._timeSig !== undefined) arr._timeSig = meta._timeSig
  if (meta._key !== undefined) arr._key = meta._key
  return arr
}

/** One-note measure; `deg` doubles as an identity so order checks read naturally. */
const m1 = (deg: number, meta: Partial<MeasureArray> = {}) => measure([note({ degree: deg })], meta)

const order = (ms: Measure[]) => expandRepeats(ms).map((e) => e.measureIdx)
const build = (ms: Measure[], key = 'C', time = '4/4') =>
  buildPlaybackEvents(expandRepeats(ms), ms, key, time)

// ============================================================================

describe('1. mid-piece key change: pitch uses the key in force at each measure', () => {
  // C → D at measure 1; both measures are a plain degree 1
  const ms: Measure[] = [m1(1), m1(1, { _key: 'D' })]
  assertEq('degree 1 is C4 then D4', build(ms).map((e) => e.midi), [60, 62])

  // |: C-major | D-major :|  — the repeat jumps BACK to the C-major measure
  const rep: Measure[] = [m1(1, { _repeatStart: true }), m1(1, { _key: 'D', _repeatEnd: true })]
  assertEq('repeat jump back returns to the earlier key', build(rep).map((e) => e.midi), [60, 62, 60, 62])

  // The key persists until the next _key, and flats work
  const run: Measure[] = [m1(1), m1(1, { _key: 'Bb' }), m1(1), m1(1, { _key: 'C' })]
  assertEq('key persists until the next change', build(run).map((e) => e.midi), [60, 70, 70, 60])

  // Chord notes and grace notes follow the measure's key too
  const rich: Measure[] = [
    measure([note({
      degree: 1,
      chordNotes: [{ degree: 3, octave: -1, accidental: '' }],
      graceNote: { degree: 2, octave: 0, accidental: '' },
    })], { _key: 'G' }),
  ]
  // G major: grace 2 = A4 (69), main 1 = G4 (67), chord 3 an octave down = B3 (59)
  assertEq('grace, main and chord pitches in G', build(rich).map((e) => e.midi), [69, 67, 59])

  const afterRest: Measure[] = [m1(1), { _multiRest: 2 }, m1(1, { _key: 'D' })]
  assertEq('key change after a multi-rest block', build(afterRest).map((e) => e.midi), [60, 62])

  // No _key anywhere → the passed-in initial key is used throughout (old behaviour)
  assertEq('no _key keeps the initial key', build([m1(1), m1(5)], 'F').map((e) => e.midi), [65, 72])
})

describe('2. temp time signature: bar length survives a repeat jump back', () => {
  // |: 0 - - - | @3/4 1 2 3 :|   — the rest bar is 4/4 on BOTH passes
  const ms: Measure[] = [
    measure([note({ degree: 0, type: 'whole', rest: true })], { _repeatStart: true }),
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 })], { _timeSig: '3/4', _repeatEnd: true }),
  ]
  assertEq('second-pass notes at 11, 12, 13', build(ms).map((e) => e.startBeat), [4, 5, 6, 11, 12, 13])

  // A multi-rest BEFORE the 3/4 measure is 4/4 bars on the second pass too
  const mr: Measure[] = [
    m1(1, { _repeatStart: true }),
    { _multiRest: 2 },
    m1(2, { _timeSig: '3/4', _repeatEnd: true }),
  ]
  // pass 1: 1 beat | 2 bars x 4 | note at 9 ; pass 2: 1 beat from 10 | 2 bars x 4 | note at 19
  assertEq('multi-rest keeps its own 4/4 meter on the second pass', build(mr).map((e) => e.startBeat),
    [0, 9, 10, 19])

  // D.C. also goes back to the start: the first rest bar is 4/4 again
  const dc: Measure[] = [
    measure([note({ degree: 0, type: 'whole', rest: true })]),
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 })], { _timeSig: '3/4', _direction: 'D.C.' }),
  ]
  assertEq('D.C. replays the rest bar at 4/4', build(dc).map((e) => e.startBeat), [4, 5, 6, 11, 12, 13])
})

describe('3. expandRepeats: a `:|` with no `|:` repeats from the end of the previous section', () => {
  assertEq('1 2 3 4 :| 5 6 7 1 :|  →  0,0,1,1',
    order([m1(1, { _repeatEnd: true }), m1(5, { _repeatEnd: true })]), [0, 0, 1, 1])

  assertEq('A :| B :| C :|  →  0,0,1,1,2,2',
    order([m1(1, { _repeatEnd: true }), m1(2, { _repeatEnd: true }), m1(3, { _repeatEnd: true })]),
    [0, 0, 1, 1, 2, 2])

  // A {1}B :| {2}C D {1}E :| {2}F  →  A B A C D E D F
  const twoBrackets: Measure[] = [
    m1(1),
    m1(2, { _volta: 1, _repeatEnd: true }),
    m1(3, { _volta: 2 }),
    m1(4),
    m1(5, { _volta: 1, _repeatEnd: true }),
    m1(6, { _volta: 2 }),
  ]
  assertEq('second volta bracket without |: repeats from D', order(twoBrackets), [0, 1, 0, 2, 3, 4, 3, 5])

  // |: A B :| C   — the section still closes properly
  assertEq('plain section then more music',
    order([m1(1, { _repeatStart: true }), m1(2, { _repeatEnd: true }), m1(3)]), [0, 1, 0, 1, 2])

  // |: A | {1} B :| C D :|  — no second ending; the later `:|` repeats from C, not from A
  const noSecond: Measure[] = [
    m1(1, { _repeatStart: true }),
    m1(2, { _volta: 1, _repeatEnd: true }),
    m1(3),
    m1(4, { _repeatEnd: true }),
  ]
  assertEq('late `:|` after a first-ending-only section', order(noSecond), [0, 1, 0, 2, 3, 2, 3])

  // `|:` in the middle still wins over the previous section end
  const explicit: Measure[] = [
    m1(1, { _repeatEnd: true }),
    m1(2),
    m1(3, { _repeatStart: true }),
    m1(4, { _repeatEnd: true }),
  ]
  assertEq('explicit |: after a finished section', order(explicit), [0, 0, 1, 2, 3, 2, 3])

  // Runaway guard: every measure both opens and closes a repeat
  const pathological: Measure[] = Array.from({ length: 6 }, () => m1(1, { _repeatStart: true, _repeatEnd: true }))
  assertEq('runaway guard still caps output', order(pathological).length <= 6 * 4, true)
})

describe('4. D.C. / D.S. / Fine', () => {
  // Route B text → the real direction strings the editor produces
  const parsedOrder = (text: string) => {
    const p = parseFromText(text)
    return order(p.measures)
  }
  assertEq('Route B: 1 1 1 1 ||&fine 2 2 2 2 ||&dc  →  0,1,0',
    parsedOrder('Key: C   Time: 4/4\n1 1 1 1 ||&fine 2 2 2 2 ||&dc'), [0, 1, 0])

  assertEq('D.C. al Fine (MusicXML words, any case)',
    order([m1(1), m1(2, { _direction: 'Fine' }), m1(3, { _direction: 'd.c. al fine' })]), [0, 1, 2, 0, 1])

  assertEq('D.C. with no Fine plays to the end again',
    order([m1(1), m1(2, { _direction: 'D.C.' })]), [0, 1, 0, 1])

  assertEq('Fine is ignored before the jump',
    order([m1(1, { _direction: 'Fine' }), m1(2)]), [0, 1])

  assertEq('only one jump per performance',
    order([m1(1, { _direction: 'D.C.' })]), [0, 0])

  // D.S. al Fine
  assertEq('D.S. returns to the Segno, stops at Fine',
    order([m1(1), m1(2, { _direction: 'Segno' }), m1(3, { _direction: 'Fine' }), m1(4, { _direction: 'D.S. al Fine' })]),
    [0, 1, 2, 3, 1, 2])

  assertEq('D.S. without a Segno acts like D.C.',
    order([m1(1), m1(2, { _direction: 'Fine' }), m1(3, { _direction: 'D.S.' })]), [0, 1, 2, 0, 1])

  // After the jump: no repeats…
  assertEq('repeats are not taken after D.C.',
    order([m1(1, { _repeatStart: true }), m1(2, { _repeatEnd: true }), m1(3, { _direction: 'D.C.' })]),
    [0, 1, 0, 1, 2, 0, 1, 2])

  // …and only the last ending of each volta bracket plays
  assertEq('last volta only after D.C.',
    order([
      m1(1, { _repeatStart: true }),
      m1(2, { _volta: 1, _repeatEnd: true }),
      m1(3, { _volta: 2 }),
      m1(4, { _direction: 'D.C.' }),
    ]),
    [0, 1, 0, 2, 3, 0, 2, 3])

  // Events: the replay is laid out in time
  const ms: Measure[] = [m1(1), m1(2, { _direction: 'Fine' }), m1(3, { _direction: 'D.C.' })]
  assertEq('events follow the D.C. performance order', build(ms).map((e) => e.midi), [60, 62, 64, 60, 62])
})

describe('8. nearestNoteStart: a note that sounds twice seeks to the closer occurrence', () => {
  // |: A B :|  → A B A B ; each note sounds at 0/2 (A) and 1/3 (B)
  const ms: Measure[] = [m1(1, { _repeatStart: true }), m1(2, { _repeatEnd: true })]
  const ev = build(ms)
  const near = (m: number, n: number, at: number) => nearestNoteStart(ev, m, n, at)
  assertEq('at the start → first occurrence', near(0, 0, 0), 0)
  assertEq('in the second pass → second occurrence', near(0, 0, 2.5), 2)
  assertEq('closer to the second pass → second occurrence', near(1, 0, 3), 3)
  assertEq('unknown note → null', near(5, 0, 0), null)

  // Grace + main under one (m, n) are ONE occurrence, starting at the grace
  const grace: Measure[] = [
    measure([note({ degree: 1, graceNote: { degree: 2, octave: 0, accidental: '' } })], { _repeatEnd: true }),
  ]
  const gEv = build(grace)
  assertEq('grace + main are one occurrence', [nearestNoteStart(gEv, 0, 0, 0), nearestNoteStart(gEv, 0, 0, 1.2)], [0, 1])
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  · ${f}`))
  process.exit(1)
}
