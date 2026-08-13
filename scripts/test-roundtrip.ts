// Round-trip test for Route B text editor format.
// Run via: npx tsx scripts/test-roundtrip.ts
//
// Strategy: build measures in code → serialize to text → parse back → compare.
// We compare the post-parse measures with the input via deep equality of the
// fields we care about (ignoring undefined/null defaults).

import { serializeToText, parseFromText } from '../src/lib/editor'
import { renderJianpuSVG, collapseRestRuns } from '../src/lib/renderer'
import { transposeNoteObjects, noteToMidi } from '../src/lib/parser'
import { normalizeOcrText, extractOcrError } from '../src/lib/vision/utils'
import { JIANPU_OCR_PROMPT, WESTERN_TO_JIANPU_PROMPT } from '../src/lib/vision/prompts'
import { MODEL_OPTIONS } from '../src/lib/vision/types'
import { sanitizeOcrConfig } from '../src/lib/vision/index'
import { computeCropRect } from '../src/lib/cropTools'
import { expandRepeats, buildPlaybackEvents } from '../src/lib/playback'
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

describe('computeCropRect maps display selection to source pixels', () => {
  // 1:1 — display size equals source size → selection unchanged
  assertEq('1:1 identity', computeCropRect({ x: 10, y: 20, w: 100, h: 40 }, { w: 200, h: 100 }, { w: 200, h: 100 }), { x: 10, y: 20, w: 100, h: 40 })
  // 2.0x — source is twice the display (PDF page rendered at 2.0x)
  assertEq('2x scale', computeCropRect({ x: 0, y: 0, w: 300, h: 30 }, { w: 300, h: 150 }, { w: 600, h: 300 }), { x: 0, y: 0, w: 600, h: 60 })
  // clamp — selection runs past the right/bottom edge, sw/sh shrink to fit
  assertEq('clamp to source bounds', computeCropRect({ x: 80, y: 0, w: 40, h: 50 }, { w: 100, h: 100 }, { w: 100, h: 100 }), { x: 80, y: 0, w: 20, h: 50 })
  // rounding — fractional display coords round to whole source pixels (Math.round: 20.5→21)
  assertEq('rounds to integers', computeCropRect({ x: 10.4, y: 10.6, w: 20.5, h: 20.4 }, { w: 100, h: 100 }, { w: 100, h: 100 }), { x: 10, y: 11, w: 21, h: 20 })
  // never zero — a sliver still yields at least 1px
  assertEq('min 1px', computeCropRect({ x: 0, y: 0, w: 0, h: 0 }, { w: 100, h: 100 }, { w: 100, h: 100 }), { x: 0, y: 0, w: 1, h: 1 })
})

describe('noteToMidi: degree/octave/accidental + key → MIDI', () => {
  // C major: degree 1 octave 0 is middle C = MIDI 60
  assertEq('C key, 1 → 60 (middle C)', noteToMidi(1, 0, '', 'C'), 60)
  assertEq('C key, 5 → 67 (G4)', noteToMidi(5, 0, '', 'C'), 67)
  assertEq('C key, 1 octave +1 → 72', noteToMidi(1, 1, '', 'C'), 72)
  assertEq('C key, 1 octave -1 → 48', noteToMidi(1, -1, '', 'C'), 48)
  assertEq('C key, #4 → 66 (F#4)', noteToMidi(4, 0, '#', 'C'), 66)
  assertEq('C key, b7 → 70 (Bb4)', noteToMidi(7, 0, 'b', 'C'), 70)
  // F major: tonic F4 = MIDI 65
  assertEq('F key, 1 → 65 (F4)', noteToMidi(1, 0, '', 'F'), 65)
  assertEq('F key, 6 → 74 (D5)', noteToMidi(6, 0, '', 'F'), 74)
  // G major: tonic G4 = 67; degree 5 is D5 = 74
  assertEq('G key, 1 → 67 (G4)', noteToMidi(1, 0, '', 'G'), 67)
  assertEq('G key, 5 → 74 (D5)', noteToMidi(5, 0, '', 'G'), 74)
  // Bb major: tonic Bb4 = 70
  assertEq('Bb key, 1 → 70 (Bb4)', noteToMidi(1, 0, '', 'Bb'), 70)
})

describe('expandRepeats: repeats and voltas unroll into a linear measure list', () => {
  const idxs = (ms: Measure[]) => expandRepeats(ms).map(e => e.measureIdx)

  // No repeats → identity
  const plain: Measure[] = [
    measure([note({ degree: 1 })]),
    measure([note({ degree: 2 })]),
    measure([note({ degree: 3 })]),
  ]
  assertEq('no repeats → identity', idxs(plain), [0, 1, 2])

  // |: A B :| → A B A B
  const simple: Measure[] = [
    measure([note({ degree: 1 })], { _repeatStart: true }),
    measure([note({ degree: 2 })], { _repeatEnd: true }),
  ]
  assertEq('simple repeat doubles the section', idxs(simple), [0, 1, 0, 1])

  // |: M1 | {1} M2 :| {2} M3 ||  →  M1 M2 M1 M3
  const volta: Measure[] = [
    measure([note({ degree: 1 })], { _repeatStart: true }),
    measure([note({ degree: 2 })], { _volta: 1, _repeatEnd: true }),
    measure([note({ degree: 3 })], { _volta: 2 }),
  ]
  assertEq('volta 1/2 chooses per pass', idxs(volta), [0, 1, 0, 2])

  // :| with no preceding |: → repeat from the very beginning
  const noStart: Measure[] = [
    measure([note({ degree: 1 })]),
    measure([note({ degree: 2 })], { _repeatEnd: true }),
  ]
  assertEq('repeatEnd without repeatStart repeats from index 0', idxs(noStart), [0, 1, 0, 1])

  // Multi-measure volta: |: M1 | {1} M2 | {1} M3 :| {2} M4
  const multiVolta: Measure[] = [
    measure([note({ degree: 1 })], { _repeatStart: true }),
    measure([note({ degree: 2 })], { _volta: 1 }),
    measure([note({ degree: 3 })], { _volta: 1, _repeatEnd: true }),
    measure([note({ degree: 4 })], { _volta: 2 }),
  ]
  assertEq('multi-measure volta', idxs(multiVolta), [0, 1, 2, 0, 3])

  // volta 3 never matches either pass → skipped (documented v1 limitation)
  const volta3: Measure[] = [
    measure([note({ degree: 1 })], { _repeatStart: true }),
    measure([note({ degree: 2 })], { _volta: 1, _repeatEnd: true }),
    measure([note({ degree: 3 })], { _volta: 3 }),
  ]
  assertEq('volta 3 is skipped', idxs(volta3), [0, 1, 0])

  // multiRest blocks pass through
  const withMultiRest: Measure[] = [
    measure([note({ degree: 1 })]),
    { _multiRest: 4 },
    measure([note({ degree: 2 })]),
  ]
  assertEq('multiRest passes through', idxs(withMultiRest), [0, 1, 2])

  // Two independent repeat sections each double
  const twoSections: Measure[] = [
    measure([note({ degree: 1 })], { _repeatStart: true }),
    measure([note({ degree: 2 })], { _repeatEnd: true }),
    measure([note({ degree: 3 })], { _repeatStart: true }),
    measure([note({ degree: 4 })], { _repeatEnd: true }),
  ]
  assertEq('two sections', idxs(twoSections), [0, 1, 0, 1, 2, 3, 2, 3])

  // Runaway guard: every measure both opens and closes a repeat
  const pathological: Measure[] = Array.from({ length: 6 }, () =>
    measure([note({ degree: 1 })], { _repeatStart: true, _repeatEnd: true }))
  const out = expandRepeats(pathological)
  assertEq('runaway guard caps output', out.length <= 6 * 4, true)
})

describe('buildPlaybackEvents: linear measures → timed events (beats)', () => {
  const build = (ms: Measure[], key = 'C', time = '4/4') =>
    buildPlaybackEvents(expandRepeats(ms), ms, key, time)

  // Durations: quarter=1, eighth=0.5, dotted quarter=1.5, half=2
  const durs: Measure[] = [
    measure([
      note({ degree: 1 }),
      note({ degree: 2, type: 'eighth' }),
      note({ degree: 3, dot: true }),
      note({ degree: 4, type: 'half' }),
    ]),
  ]
  const dEv = build(durs)
  assertEq('4 events', dEv.length, 4)
  assertEq('start beats accumulate', dEv.map(e => e.startBeat), [0, 1, 1.5, 3])
  assertEq('durations', dEv.map(e => e.durBeats), [1, 0.5, 1.5, 2])
  assertEq('midi pitches in C', dEv.map(e => e.midi), [60, 62, 64, 65])

  // Rests advance time but emit nothing
  const withRest: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 0, rest: true }), note({ degree: 3 })]),
  ]
  const rEv = build(withRest)
  assertEq('rest emits no event', rEv.length, 2)
  assertEq('rest still advances time', rEv.map(e => e.startBeat), [0, 2])

  // Tie extends the previous event instead of re-attacking
  const tied: Measure[] = [
    measure([note({ degree: 1, type: 'whole' })]),
    measure([note({ degree: 1, tie: true, type: 'whole' })]),
  ]
  const tEv = build(tied)
  assertEq('tie does not add an event', tEv.length, 1)
  assertEq('tie extends duration to 8 beats', tEv[0].durBeats, 8)

  // Chord notes sound together
  const chord: Measure[] = [
    measure([note({ degree: 5, chordNotes: [{ degree: 3, octave: 0, accidental: '' }] }), note({ degree: 1 })]),
  ]
  const cEv = build(chord)
  assertEq('chord yields 3 events total', cEv.length, 3)
  assertEq('chord pair shares startBeat', cEv[0].startBeat === cEv[1].startBeat, true)
  assertEq('chord pitches 5 and 3 in C', [cEv[0].midi, cEv[1].midi].sort((a, b) => a - b), [64, 67])

  // Triplet: three eighths under ~3 occupy one beat (x 2/3 each)
  const trip: Measure[] = [
    measure([
      note({ degree: 1, type: 'eighth', tuplet: 3 }),
      note({ degree: 2, type: 'eighth', tuplet: 3 }),
      note({ degree: 3, type: 'eighth', tuplet: 3 }),
      note({ degree: 5 }),
    ]),
  ]
  const trEv = build(trip)
  assertEq('triplet total is one beat', trEv[3].startBeat, 1)
  assertEq('each triplet eighth is 1/3 beat', Math.abs(trEv[0].durBeats - 1 / 3) < 1e-9, true)

  // multiRest advances 4 measures of silence in 4/4
  const mr: Measure[] = [
    measure([note({ degree: 1, type: 'whole' })]),
    { _multiRest: 4 },
    measure([note({ degree: 2 })]),
  ]
  const mrEv = build(mr)
  assertEq('multiRest emits nothing', mrEv.length, 2)
  assertEq('multiRest advances 4 measures', mrEv[1].startBeat, 4 + 16)

  // Temp time signature changes the multiRest measure length
  const ts: Measure[] = [
    measure([note({ degree: 1 })], { _timeSig: '3/4' }),
    { _multiRest: 2 },
    measure([note({ degree: 2 })]),
  ]
  const tsEv = build(ts)
  assertEq('3/4 multiRest advances 2x3 beats', tsEv[1].startBeat, 1 + 6)

  // Grace note: short event before the main, main shifted and shortened
  const grace: Measure[] = [
    measure([note({ degree: 1, graceNote: { degree: 2, octave: 0, accidental: '' } })]),
  ]
  const gEv = build(grace)
  assertEq('grace adds an event', gEv.length, 2)
  assertEq('grace is first and short', [gEv[0].startBeat, gEv[0].durBeats], [0, 0.125])
  assertEq('grace pitch is degree 2', gEv[0].midi, 62)
  assertEq('main note shifted after grace', gEv[1].startBeat, 0.125)
  assertEq('main note shortened', gEv[1].durBeats, 0.875)

  // Repeats are honored end-to-end: a full 4/4 measure under |: :| plays twice
  const rep: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })], { _repeatStart: true, _repeatEnd: true }),
  ]
  const repEv = build(rep)
  assertEq('repeat plays all four notes twice', repEv.length, 8)
  assertEq('second pass starts one measure later', repEv[4].startBeat, 4)

  // Key is honored (F major tonic = MIDI 65)
  const inF = build([measure([note({ degree: 1 })])], 'F')
  assertEq('key F tonic is 65', inF[0].midi, 65)
})

describe('buildPlaybackEvents: measureIdx matches renderer data-m', () => {
  // A whole-rest measure gets no data-m of its own and does not advance origIdx,
  // so the following measure's events must carry origIdx 1, not 2.
  const ms: Measure[] = [
    measure([note({ degree: 1 })]),
    measure([note({ degree: 0, type: 'whole', rest: true })]),
    measure([note({ degree: 2 })]),
  ]
  const ev = buildPlaybackEvents(expandRepeats(ms), ms, 'C', '4/4')
  assertEq('two sounding events', ev.length, 2)
  assertEq('first measure origIdx 0', ev[0].measureIdx, 0)
  assertEq('measure after a whole rest keeps origIdx 1', ev[1].measureIdx, 1)
  assertEq('noteIdx is the within-measure index', [ev[0].noteIdx, ev[1].noteIdx], [0, 0])
})

describe('buildPlaybackEvents: bar length honors the time-signature denominator', () => {
  const build = (ms: Measure[], time: string) =>
    buildPlaybackEvents(expandRepeats(ms), ms, 'C', time)

  // A lone whole rest is the notation for a silent BAR, so it advances one bar —
  // 3 quarters in 3/4, not the 4 that a literal whole note would last.
  const emptyBar34: Measure[] = [
    measure([note({ degree: 1 })]),
    measure([note({ degree: 0, rest: true, type: 'whole' })]),
    measure([note({ degree: 2 })]),
  ]
  assertEq('3/4 empty bar advances 3 beats', build(emptyBar34, '3/4')[1].startBeat, 4)

  // 6/8: a bar is 6 eighths = 3 quarters, so the numerator alone is wrong
  const emptyBar68: Measure[] = [
    measure([note({ degree: 1 })]),
    measure([note({ degree: 0, rest: true, type: 'whole' })]),
    measure([note({ degree: 2 })]),
  ]
  assertEq('6/8 empty bar advances 3 beats', build(emptyBar68, '6/8')[1].startBeat, 4)

  const multiRest: Measure[] = [
    measure([note({ degree: 1 })]),
    { _multiRest: 2 },
    measure([note({ degree: 2 })]),
  ]
  assertEq('4/4 multiRest x2 advances 8 beats', build(multiRest, '4/4')[1].startBeat, 9)
  assertEq('6/8 multiRest x2 advances 6 beats', build(multiRest, '6/8')[1].startBeat, 7)
  assertEq('3/4 multiRest x2 advances 6 beats', build(multiRest, '3/4')[1].startBeat, 7)

  // _timeSig mid-score switches the bar length too (6/8 bar = 3 quarters)
  const switched: Measure[] = [
    measure([note({ degree: 1 })]),
    { _multiRest: 2 },
    measure([note({ degree: 2 })], { _timeSig: '6/8' }),
    { _multiRest: 2 },
    measure([note({ degree: 3 })]),
  ]
  const sw = build(switched, '4/4')
  assertEq('before switch: 4/4 bars', sw[1].startBeat, 9)
  assertEq('after switch to 6/8: 3-quarter bars', sw[2].startBeat, 9 + 1 + 6)

  // The no-padding rule still holds: a partially filled bar advances only its written notes
  const shortBar: Measure[] = [
    measure([note({ degree: 1 }), note({ degree: 2 })]),
    measure([note({ degree: 3 })]),
  ]
  assertEq('short bar is NOT padded to the bar', build(shortBar, '4/4')[2].startBeat, 2)
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach(f => console.log(`  · ${f}`))
  process.exit(1)
}
