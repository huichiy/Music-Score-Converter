// Round-trip test for Route B text editor format.
// Run via: npx tsx scripts/test-roundtrip.ts
//
// Strategy: build measures in code → serialize to text → parse back → compare.
// We compare the post-parse measures with the input via deep equality of the
// fields we care about (ignoring undefined/null defaults).

import { serializeToText, parseFromText } from '../src/lib/editor'
import type { Measure, MeasureArray, NoteObject } from '../src/types/score'

let pass = 0
let fail = 0
const failures: string[] = []

function note(p: Partial<NoteObject>): NoteObject {
  return {
    degree: 1,
    octave: 0,
    type: 'quarter',
    dot: false,
    tie: false,
    rest: false,
    accidental: '',
    slurStart: false,
    slurStop: false,
    ...p,
  }
}

function measure(notes: NoteObject[], meta: Partial<MeasureArray> = {}): MeasureArray {
  const arr = notes.slice() as unknown as MeasureArray
  arr._repeatStart = meta._repeatStart || false
  arr._repeatEnd = meta._repeatEnd || false
  arr._direction = meta._direction || ''
  arr._dynamic = meta._dynamic || ''
  arr._wedge = meta._wedge || null
  return arr
}

function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(val).sort()) sorted[k] = (val as Record<string, unknown>)[k]
      return sorted
    }
    return val
  })
}

function assertEq(label: string, actual: unknown, expected: unknown) {
  const a = stableStringify(actual)
  const e = stableStringify(expected)
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

function roundTrip(measures: Measure[], key = 'C', time = '4/4', tempo = '', title = ''): { measures: Measure[]; text: string } {
  const text = serializeToText(measures, key, time, tempo, title)
  const parsed = parseFromText(text, key, time, tempo, title)
  return { measures: parsed.measures, text }
}

// Helper to extract MeasureArray as plain array of notes (strip _multiRest markers)
function asNotes(m: Measure): NoteObject[] | { _multiRest: number } {
  if (!Array.isArray(m)) return m as { _multiRest: number }
  return [...m] as NoteObject[]
}

function describe(name: string, fn: () => void) {
  console.log(`\n── ${name} ──`)
  fn()
}

// ============================================================================

describe('Basic durations', () => {
  const input: Measure[] = [
    measure([
      note({ degree: 1, type: 'quarter' }),
      note({ degree: 2, type: 'eighth' }),
      note({ degree: 3, type: '16th' }),
      note({ degree: 4, type: 'half' }),
    ]),
    measure([
      note({ degree: 5, type: 'whole' }),
    ]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('measure 1 notes', asNotes(out[0]), asNotes(input[0]))
  assertEq('measure 2 notes', asNotes(out[1]), asNotes(input[1]))
})

describe('Dotted notes', () => {
  const input: Measure[] = [
    measure([
      note({ degree: 1, type: 'quarter', dot: true }),    // 1.
      note({ degree: 2, type: 'eighth', dot: true }),     // 2./
      note({ degree: 3, type: '16th', dot: true }),       // 3.//
    ]),
    measure([
      note({ degree: 4, type: 'half', dot: true }),       // 4--
    ]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('measure 1', asNotes(out[0]), asNotes(input[0]))
  assertEq('measure 2', asNotes(out[1]), asNotes(input[1]))
})

describe('Octaves and accidentals', () => {
  const input: Measure[] = [
    measure([
      note({ degree: 1, octave: 1 }),
      note({ degree: 2, octave: 2 }),
      note({ degree: 3, octave: -1 }),
      note({ degree: 4, octave: -2 }),
    ]),
    measure([
      note({ degree: 1, accidental: '#' }),
      note({ degree: 2, accidental: 'b' }),
      note({ degree: 3 }),
      note({ degree: 4 }),
    ]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('octaves', asNotes(out[0]), asNotes(input[0]))
  assertEq('accidentals', asNotes(out[1]), asNotes(input[1]))
})

describe('Dynamics round-trip', () => {
  const input: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })], { _dynamic: 'mf' }),
    measure([note({ degree: 5 }), note({ degree: 6 }), note({ degree: 7 }), note({ degree: 1, octave: 1 })], { _dynamic: 'ff' }),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('M1 dynamic', (out[0] as MeasureArray)._dynamic, 'mf')
  assertEq('M2 dynamic', (out[1] as MeasureArray)._dynamic, 'ff')
})

describe('Hairpins round-trip', () => {
  const input: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })]),
    measure([note({ degree: 5 }), note({ degree: 6 }), note({ degree: 7 }), note({ degree: 1, octave: 1 })], { _wedge: 'cresc' }),
    measure([note({ degree: 5 }), note({ degree: 6 }), note({ degree: 7 }), note({ degree: 1, octave: 1 })], { _wedge: 'cresc' }),
    measure([note({ degree: 1 }), note({ degree: 1 }), note({ degree: 1 }), note({ degree: 1 })]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('M1 wedge null', (out[0] as MeasureArray)._wedge ?? null, null)
  assertEq('M2 wedge cresc', (out[1] as MeasureArray)._wedge, 'cresc')
  assertEq('M3 wedge cresc', (out[2] as MeasureArray)._wedge, 'cresc')
  assertEq('M4 wedge null', (out[3] as MeasureArray)._wedge ?? null, null)
})

describe('Repeats round-trip', () => {
  const input: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })], { _repeatStart: true }),
    measure([note({ degree: 5 }), note({ degree: 6 }), note({ degree: 7 }), note({ degree: 1, octave: 1 })], { _repeatEnd: true }),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('M1 repeatStart', (out[0] as MeasureArray)._repeatStart, true)
  assertEq('M2 repeatEnd', (out[1] as MeasureArray)._repeatEnd, true)
})

describe('Direction marks round-trip', () => {
  const input: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })], { _direction: 'Fine' }),
    measure([note({ degree: 5 }), note({ degree: 6 }), note({ degree: 7 }), note({ degree: 1, octave: 1 })], { _direction: 'D.C.' }),
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })], { _direction: 'D.S.' }),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('M1 Fine', (out[0] as MeasureArray)._direction, 'Fine')
  assertEq('M2 D.C.', (out[1] as MeasureArray)._direction, 'D.C.')
  assertEq('M3 D.S.', (out[2] as MeasureArray)._direction, 'D.S.')
})

describe('Slurs round-trip', () => {
  const input: Measure[] = [
    measure([
      note({ degree: 1, slurStart: true }),
      note({ degree: 2 }),
      note({ degree: 3, slurStop: true }),
      note({ degree: 4 }),
    ]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  const m = out[0] as MeasureArray
  assertEq('note 0 slurStart', m[0].slurStart, true)
  assertEq('note 1 slurStart', m[1].slurStart, false)
  assertEq('note 2 slurStop', m[2].slurStop, true)
})

describe('Articulations round-trip', () => {
  const input: Measure[] = [
    measure([
      note({ degree: 1, articulation: 'accent' }),
      note({ degree: 2, articulation: 'staccato' }),
      note({ degree: 3, articulation: 'tenuto' }),
      note({ degree: 4, articulation: 'marcato' }),
    ]),
    measure([note({ degree: 5, articulation: 'fermata' }), note({ degree: 6 }), note({ degree: 7 }), note({ degree: 1, octave: 1 })]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  const m1 = out[0] as MeasureArray
  const m2 = out[1] as MeasureArray
  assertEq('accent', m1[0].articulation, 'accent')
  assertEq('staccato', m1[1].articulation, 'staccato')
  assertEq('tenuto', m1[2].articulation, 'tenuto')
  assertEq('marcato', m1[3].articulation, 'marcato')
  assertEq('fermata', m2[0].articulation, 'fermata')
})

describe('Grace notes round-trip', () => {
  const input: Measure[] = [
    measure([
      note({ degree: 1, graceNote: { degree: 2, octave: 0, accidental: '' } }),
      note({ degree: 3, graceNote: { degree: 4, octave: 0, accidental: '#' } }),
      note({ degree: 5, graceNote: { degree: 6, octave: 1, accidental: '' } }),
      note({ degree: 7 }),
    ]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  const m = out[0] as MeasureArray
  assertEq('grace 0', m[0].graceNote, { degree: 2, octave: 0, accidental: '' })
  assertEq('grace 1 sharp', m[1].graceNote, { degree: 4, octave: 0, accidental: '#' })
  assertEq('grace 2 high oct', m[2].graceNote, { degree: 6, octave: 1, accidental: '' })
})

describe('Multi-rest collapse', () => {
  const input: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })]),
    measure([note({ degree: 0, type: 'whole', rest: true })]),
    measure([note({ degree: 0, type: 'whole', rest: true })]),
    measure([note({ degree: 0, type: 'whole', rest: true })]),
    measure([note({ degree: 5 }), note({ degree: 6 }), note({ degree: 7 }), note({ degree: 1, octave: 1 })]),
  ]
  const { text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  // Three consecutive whole-rest measures should be serialized as [3]
  const hasMultiRest = text.includes('[3]')
  assertEq('contains [3]', hasMultiRest, true)
})

describe('Title round-trip', () => {
  const input: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })]),
  ]
  const text = serializeToText(input, 'G', '4/4', '120', 'My Test Song')
  console.log(`  text:\n${text}`)
  const parsed = parseFromText(text, 'C', '4/4', '', '')
  assertEq('title', parsed.titleStr, 'My Test Song')
  assertEq('key', parsed.keyStr, 'G')
  assertEq('time', parsed.timeStr, '4/4')
  assertEq('tempo', parsed.tempoStr, '120')
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach(f => console.log(`  · ${f}`))
  process.exit(1)
}
