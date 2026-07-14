// Round-trip test for Route B text editor format.
// Run via: npx tsx scripts/test-roundtrip.ts
//
// Strategy: build measures in code → serialize to text → parse back → compare.
// We compare the post-parse measures with the input via deep equality of the
// fields we care about (ignoring undefined/null defaults).

import { serializeToText, parseFromText } from '../src/lib/editor'
import { renderJianpuSVG, collapseRestRuns } from '../src/lib/renderer'
import { transposeNoteObjects } from '../src/lib/parser'
import { normalizeOcrText, extractOcrError } from '../src/lib/vision/utils'
import { JIANPU_OCR_PROMPT, WESTERN_TO_JIANPU_PROMPT } from '../src/lib/vision/prompts'
import { MODEL_OPTIONS } from '../src/lib/vision/types'
import { sanitizeOcrConfig } from '../src/lib/vision/index'
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
  if (meta._volta !== undefined) arr._volta = meta._volta
  if (meta._timeSig !== undefined) arr._timeSig = meta._timeSig
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

describe('Cross-barline tie round-trip', () => {
  const input: Measure[] = [
    measure([note({ degree: 1, type: 'whole' })]),
    measure([note({ degree: 1, tie: true, type: 'whole' })]),
    measure([note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 }), note({ degree: 5 })]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('measure count preserved', out.length, 3)
  assertEq('tie measure', asNotes(out[1]), asNotes(input[1]))
  assertEq('following measure intact', asNotes(out[2]), asNotes(input[2]))
})

describe('Rest extension via standalone dashes', () => {
  const parsed = parseFromText('Key: C   Time: 4/4\n| 0 - - - | 1 2 3 4 ||')
  const m0 = parsed.measures[0] as MeasureArray
  assertEq('single rest in measure', m0.length, 1)
  assertEq('rest extended to whole', { rest: m0[0].rest, type: m0[0].type, dot: m0[0].dot }, { rest: true, type: 'whole', dot: false })
})

describe('Chord notes (double stops) round-trip', () => {
  const input: Measure[] = [
    measure([
      note({ degree: 5, chordNotes: [{ degree: 3, octave: 0, accidental: '' }] }),
      note({ degree: 6, type: 'half', chordNotes: [{ degree: 4, octave: -1, accidental: '#' }, { degree: 1, octave: 0, accidental: '' }] }),
      note({ degree: 1 }),
    ]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('text contains 5:3', text.includes('5:3'), true)
  assertEq('chord measure', asNotes(out[0]), asNotes(input[0]))
})

describe('32nd notes round-trip', () => {
  const input: Measure[] = [
    measure([
      note({ degree: 1, type: '32nd' }),
      note({ degree: 2, type: '32nd', dot: true }),
      note({ degree: 3, type: '16th', dot: true }),
      note({ degree: 4, type: 'half', dot: true }),
    ]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('text contains ///', text.includes('///'), true)
  assertEq('32nd measure', asNotes(out[0]), asNotes(input[0]))
})

describe('Renderer: chord octave dot must not collide with next chord note', () => {
  // 6:#4,:1 — the #4 (low octave) sits above the 1; its below-dot needs
  // to land in the gap between the two digits, not on top of the 1
  const input: Measure[] = [
    measure([
      note({ degree: 6, chordNotes: [{ degree: 4, octave: -1, accidental: '#' }, { degree: 1, octave: 0, accidental: '' }] }),
      note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }),
    ]),
  ]
  const svg = renderJianpuSVG(input, 'C', '4/4', 'T', 800, '', false)
  const chordDigits = [...svg.matchAll(/<text x="[\d.-]+" y="([\d.-]+)"[^>]*font-size="16"[^>]*>(\d)<\/text>/g)]
    .map(m => ({ y: parseFloat(m[1]), digit: m[2] }))
  const dots = [...svg.matchAll(/<circle cx="[\d.-]+" cy="([\d.-]+)" r="1.5"/g)].map(m => parseFloat(m[1]))
  assertEq('two chord digits rendered', chordDigits.length, 2)
  assertEq('one octave dot rendered', dots.length, 1)
  const y4 = chordDigits.find(d => d.digit === '4')!.y
  const y1 = chordDigits.find(d => d.digit === '1')!.y
  const dotCy = dots[0]
  assertEq('dot below the #4 digit', dotCy > y4, true)
  assertEq('dot clear of the 1 digit (above its glyph top)', dotCy < y1 - 12, true)
})

// ============================================================================
// Route B v3: volta {N} / tuplet ~N / temp time sig @N/M
// ============================================================================

describe('Volta (跳房子) round-trip', () => {
  const input: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })], { _repeatStart: true }),
    measure([note({ degree: 3 }), note({ degree: 4 }), note({ degree: 5 }), note({ degree: 6 })], { _volta: 1, _repeatEnd: true }),
    measure([note({ degree: 5 }), note({ degree: 6 }), note({ degree: 7 }), note({ degree: 1, octave: 1 })], { _volta: 2 }),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('text has {1}', text.includes('{1}'), true)
  assertEq('text has {2}', text.includes('{2}'), true)
  assertEq('M1 no volta', (out[0] as MeasureArray)._volta ?? null, null)
  assertEq('M2 volta 1', (out[1] as MeasureArray)._volta, 1)
  assertEq('M3 volta 2', (out[2] as MeasureArray)._volta, 2)
  assertEq('M2 notes intact', asNotes(out[1]), asNotes(input[1]))
})

describe('Volta parse from text', () => {
  const parsed = parseFromText("Key: C   Time: 4/4\n|: 1 2 3 4 | {1} 5 6 7 1' :| {2} 1 2 3 4 ||")
  const ms = parsed.measures as MeasureArray[]
  assertEq('3 measures', ms.length, 3)
  assertEq('M1 no volta', ms[0]._volta ?? null, null)
  assertEq('M2 volta=1 + repeatEnd', { v: ms[1]._volta, r: ms[1]._repeatEnd }, { v: 1, r: true })
  assertEq('M3 volta=2', ms[2]._volta, 2)
})

describe('Tuplet (连音) round-trip', () => {
  const input: Measure[] = [
    measure([
      note({ degree: 1, type: 'eighth', tuplet: 3 }),
      note({ degree: 2, type: 'eighth', tuplet: 3 }),
      note({ degree: 3, type: 'eighth', tuplet: 3 }),
      note({ degree: 2 }),
      note({ degree: 3 }),
      note({ degree: 4 }),
    ]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('text has ~3', text.includes('~3'), true)
  const m = out[0] as MeasureArray
  assertEq('tuplet flags', [m[0].tuplet ?? null, m[1].tuplet ?? null, m[2].tuplet ?? null, m[3].tuplet ?? null], [3, 3, 3, null])
  assertEq('measure equal', asNotes(out[0]), asNotes(input[0]))
})

describe('Tuplet counts rests in group', () => {
  const parsed = parseFromText('Key: C   Time: 4/4\n| ~3 1/ 0/ 3/ 2 3 4 ||')
  const m = parsed.measures[0] as MeasureArray
  assertEq('6 notes', m.length, 6)
  assertEq('rest inside tuplet', { rest: m[1].rest, tuplet: m[1].tuplet ?? null }, { rest: true, tuplet: 3 })
  assertEq('4th note out of group', m[3].tuplet ?? null, null)
})

describe('Two consecutive triplets serialize as two groups', () => {
  const t = (d: number) => note({ degree: d, type: 'eighth', tuplet: 3 })
  const input: Measure[] = [
    measure([t(1), t(2), t(3), t(4), t(5), t(6), note({ degree: 2, type: 'half' })]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('two ~3 markers', (text.match(/~3/g) || []).length, 2)
  assertEq('round-trips', asNotes(out[0]), asNotes(input[0]))
})

describe('Temp time signature round-trip', () => {
  const input: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })]),
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 })], { _timeSig: '3/4' }),
    measure([note({ degree: 4 }), note({ degree: 5 }), note({ degree: 6 })]),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('text has @3/4', text.includes('@3/4'), true)
  assertEq('M2 timeSig', (out[1] as MeasureArray)._timeSig, '3/4')
  assertEq('M1/M3 none', [(out[0] as MeasureArray)._timeSig ?? null, (out[2] as MeasureArray)._timeSig ?? null], [null, null])
})

describe('Temp time sig parse from text', () => {
  const parsed = parseFromText('Key: C   Time: 4/4\n| 1 2 3 4 | @3/4 1 2 3 | 4 5 6 ||')
  const ms = parsed.measures as MeasureArray[]
  assertEq('M2 timeSig', ms[1]._timeSig, '3/4')
  assertEq('M1/M3 none', [ms[0]._timeSig ?? null, ms[2]._timeSig ?? null], [null, null])
})

describe('v3 serialization order: | {N} @N/M &dyn', () => {
  const input: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })], { _repeatStart: true }),
    measure([note({ degree: 5 }), note({ degree: 6 }), note({ degree: 7 })], { _volta: 1, _timeSig: '3/4', _dynamic: 'mf', _repeatEnd: true }),
  ]
  const { measures: out, text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  const i1 = text.indexOf('{1}'), i2 = text.indexOf('@3/4'), i3 = text.indexOf('&mf')
  assertEq('{1} before @3/4 before &mf', i1 > -1 && i1 < i2 && i2 < i3, true)
  const m = out[1] as MeasureArray
  assertEq('all meta round-trips', { v: m._volta, t: m._timeSig, d: m._dynamic, r: m._repeatEnd }, { v: 1, t: '3/4', d: 'mf', r: true })
})

describe('Whole-rest with v3 metadata not collapsed in text', () => {
  const input: Measure[] = [
    measure([note({ degree: 0, type: 'whole', rest: true })], { _timeSig: '3/4' }),
    measure([note({ degree: 0, type: 'whole', rest: true })]),
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 })]),
  ]
  const { text } = roundTrip(input)
  console.log(`  text: ${text.split('\n').slice(1).join(' ')}`)
  assertEq('no [2] block', text.includes('[2]'), false)
  assertEq('@3/4 in text', text.includes('@3/4'), true)
})

describe('collapseRestRuns keeps v3-tagged rest measures', () => {
  const rest = () => measure([note({ degree: 0, type: 'whole', rest: true })])
  const tagged = measure([note({ degree: 0, type: 'whole', rest: true })], { _timeSig: '3/4' })
  const out = collapseRestRuns([tagged, rest(), rest()])
  assertEq('tagged measure stays array', Array.isArray(out[0]), true)
  assertEq('remaining run of 2 collapsed', (out[1] as { _multiRest: number })._multiRest, 2)
  const voltaTagged = measure([note({ degree: 0, type: 'whole', rest: true })], { _volta: 1 })
  const out2 = collapseRestRuns([voltaTagged, rest(), rest()])
  assertEq('volta-tagged measure stays array', Array.isArray(out2[0]), true)
})

describe('Transpose preserves v3 metadata', () => {
  const input: Measure[] = [
    measure([
      note({ degree: 1, type: 'eighth', tuplet: 3 }),
      note({ degree: 2, type: 'eighth', tuplet: 3 }),
      note({ degree: 3, type: 'eighth', tuplet: 3 }),
      note({ degree: 5 }),
    ], { _volta: 2, _timeSig: '3/4' }),
  ]
  const out = transposeNoteObjects(input, 'C', 'D')
  const m = out[0] as MeasureArray
  assertEq('_volta kept', m._volta, 2)
  assertEq('_timeSig kept', m._timeSig, '3/4')
  assertEq('tuplet kept', m[0].tuplet, 3)
})

describe('Renderer: volta bracket', () => {
  const input: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })], { _repeatStart: true }),
    measure([note({ degree: 5 }), note({ degree: 6 }), note({ degree: 7 }), note({ degree: 1, octave: 1 })], { _volta: 1, _repeatEnd: true }),
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })], { _volta: 2 }),
  ]
  const svg = renderJianpuSVG(input, 'C', '4/4', 'T', 900, '', false)
  assertEq('two volta groups', (svg.match(/class="jn-volta"/g) || []).length, 2)
  assertEq('volta labels 1. and 2.', svg.includes('>1.</text>') && svg.includes('>2.</text>'), true)
})

describe('Renderer: tuplet bracket and beat correction', () => {
  const input: Measure[] = [
    measure([
      note({ degree: 1, type: 'eighth', tuplet: 3 }),
      note({ degree: 2, type: 'eighth', tuplet: 3 }),
      note({ degree: 3, type: 'eighth', tuplet: 3 }),
      note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 }),
    ]),
  ]
  const svg = renderJianpuSVG(input, 'C', '4/4', 'T', 800, '', false)
  assertEq('tuplet group present', svg.includes('class="jn-tuplet"'), true)
  // Triplet of eighths = 1 beat total after ×2/3 correction → all three share
  // beat group 0 → their beaming underlines (y = currentY+4 = 104) must connect.
  const beams = [...svg.matchAll(/<line x1="([\d.]+)" y1="104" x2="([\d.]+)" y2="104"/g)]
    .map(b => ({ x1: parseFloat(b[1]), x2: parseFloat(b[2]) }))
  assertEq('three beam segments', beams.length, 3)
  assertEq('segments connected', beams.length === 3 && Math.abs(beams[0].x2 - beams[1].x1) < 0.01 && Math.abs(beams[1].x2 - beams[2].x1) < 0.01, true)
})

describe('Renderer: temp time signature', () => {
  const input: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })]),
    measure([note({ degree: 0, type: 'whole', rest: true })], { _timeSig: '3/4' }),
  ]
  const svg = renderJianpuSVG(input, 'C', '4/4', 'T', 900, '', false)
  assertEq('3/4 label drawn', svg.includes('>3/4<'), true)
  const zeros = (svg.match(/>0<\/text>/g) || []).length
  assertEq('whole rest renders 3 zeros under 3/4', zeros, 3)
})

// ============================================================================
// OCR loop: normalizeOcrText / error sentinel / prompt format contract
// ============================================================================

describe('normalizeOcrText cleans OCR output', () => {
  assertEq('strips markdown code fences',
    normalizeOcrText('```\nKey: C   Time: 4/4\n| 1 2 3 4 ||\n```'),
    'Key: C   Time: 4/4\n| 1 2 3 4 ||')
  assertEq('fullwidth bar and colon',
    normalizeOcrText('Key： C\n｜ 1 2 3 4 ｜'),
    'Key: C\n| 1 2 3 4 |')
  assertEq('fullwidth digits and space',
    normalizeOcrText('| １ ２　３ ４ |'),
    '| 1 2 3 4 |')
  assertEq('fullwidth comma becomes low-octave mark',
    normalizeOcrText('| 1， 2 3 4 |'),
    '| 1, 2 3 4 |')
  assertEq('legacy underscore dialect → slashes',
    normalizeOcrText('| 1_ 2__ 3 4 |'),
    '| 1/ 2// 3 4 |')
  assertEq('does NOT rewrite 1. (dotted quarter stays)',
    normalizeOcrText('| 1. 2/ 3 4 |'),
    '| 1. 2/ 3 4 |')
})

describe('normalize + parse: OCR text becomes real measures', () => {
  const raw = '```\nKey： G   Time: 4/4\n｜ 1_ 2_ 3 4 ｜ 5 - - - ｜\n```'
  const parsed = parseFromText(normalizeOcrText(raw))
  assertEq('key from header', parsed.keyStr, 'G')
  assertEq('two measures', parsed.measures.length, 2)
  const m1 = parsed.measures[0] as MeasureArray
  assertEq('eighths from legacy underscores', [m1[0].type, m1[1].type], ['eighth', 'eighth'])
  const m2 = parsed.measures[1] as MeasureArray
  assertEq('rest-extended note is whole', { deg: m2[0].degree, type: m2[0].type }, { deg: 5, type: 'whole' })
})

describe('OCR error sentinel detection', () => {
  assertEq('Chinese sentinel', extractOcrError('[错误：图片不是简谱，请切换模式]'), '图片不是简谱，请切换模式')
  assertEq('English sentinel', extractOcrError('[Error: Image is not staff notation.]'), 'Image is not staff notation.')
  assertEq('sentinel wrapped in fences (after normalize)', extractOcrError(normalizeOcrText('```\n[错误：识别失败]\n```')), '识别失败')
  assertEq('normal text is not an error', extractOcrError('Key: C\n| 1 2 3 4 ||'), null)
})

describe('OCR prompts teach the Route B format', () => {
  const both: Array<[string, string]> = [['jianpu', JIANPU_OCR_PROMPT], ['western', WESTERN_TO_JIANPU_PROMPT]]
  for (const [name, p] of both) {
    assertEq(`${name}: teaches 1/ eighth`, p.includes('1/'), true)
    assertEq(`${name}: teaches 1, low octave`, p.includes('1,'), true)
    assertEq(`${name}: no underscore durations`, p.includes('_'), false)
    assertEq(`${name}: teaches Title: header line`, p.includes('Title:'), true)
    assertEq(`${name}: teaches volta {1}`, p.includes('{1}'), true)
    assertEq(`${name}: teaches tuplet ~3`, p.includes('~3'), true)
    assertEq(`${name}: teaches temp time sig @`, p.includes('@3/4') || p.includes('@2/4'), true)
  }
  assertEq('jianpu: keeps 错误 sentinel rule', JIANPU_OCR_PROMPT.includes('[错误：'), true)
  assertEq('western: keeps Error sentinel rule', WESTERN_TO_JIANPU_PROMPT.includes('[Error:'), true)
  // Completeness: dense scores must be transcribed to the end, not summarized
  assertEq('jianpu: demands transcription to the last measure', JIANPU_OCR_PROMPT.includes('最后一小节'), true)
  assertEq('western: demands transcription to the last measure', WESTERN_TO_JIANPU_PROMPT.includes('last measure'), true)
  // Ornament-heavy 笛子谱: technique marks are skipped but their notes are kept
  assertEq('jianpu: ignore technique marks, keep notes', JIANPU_OCR_PROMPT.includes('技巧'), true)
})

describe('OCR model options match shared-key quota reality', () => {
  // The 默认 (worker) provider uses the shared free-tier Gemini key, which has
  // NO Pro quota — offering Pro there guarantees a 429
  assertEq('auto (worker) offers no Pro model', MODEL_OPTIONS.auto.some(m => m.id.includes('pro')), false)
  assertEq('auto still offers Flash', MODEL_OPTIONS.auto.some(m => m.id === 'gemini-2.5-flash'), true)
})

describe('sanitizeOcrConfig drops stale saved model ids', () => {
  // localStorage may hold a model the provider no longer offers (auto+pro)
  assertEq('stale auto+pro model dropped', sanitizeOcrConfig({ provider: 'auto', model: 'gemini-2.5-pro' }).model ?? null, null)
  assertEq('valid auto+flash kept', sanitizeOcrConfig({ provider: 'auto', model: 'gemini-2.5-flash' }).model, 'gemini-2.5-flash')
  assertEq('BYOK gemini keeps Pro', sanitizeOcrConfig({ provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'k' }).model, 'gemini-2.5-pro')
  assertEq('custom keeps arbitrary model', sanitizeOcrConfig({ provider: 'custom', model: 'llava:13b', apiKey: 'k', customUrl: 'https://x' }).model, 'llava:13b')
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach(f => console.log(`  · ${f}`))
  process.exit(1)
}
