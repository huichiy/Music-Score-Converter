// MusicXML parser tests: articulations / fermata / grace notes / time-modification
// + transposeNoteObjects graceNote transposition.
// Run via: npx tsx scripts/test-parser.ts
//
// Uses linkedom (devDependency, tests only — never bundled) to parse inline
// MusicXML strings outside the browser.

import { DOMParser } from 'linkedom'
import { parseXMLToNoteObjects, transposeNoteObjects } from '../src/lib/parser'
import type { Measure, MeasureArray, NoteObject } from '../src/types/score'

let pass = 0
let fail = 0
const failures: string[] = []

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

function describe(name: string, fn: () => void) {
  console.log(`\n── ${name} ──`)
  fn()
}

// ============================================================================
// XML fixture helpers
// ============================================================================

function parseScore(measuresXml: string): MeasureArray[] {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>
  <part id="P1">${measuresXml}</part>
</score-partwise>`
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  return parseXMLToNoteObjects(doc as unknown as Document)
}

const ATTRS = `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>`

function noteXml(step: string, octave: number, extra = '', duration = 1): string {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>quarter</type>${extra}</note>`
}

// ============================================================================

describe('Articulations extraction', () => {
  const ms = parseScore(`<measure number="1">${ATTRS}
    ${noteXml('C', 4, '<notations><articulations><accent/></articulations></notations>')}
    ${noteXml('D', 4, '<notations><articulations><staccato/></articulations></notations>')}
    ${noteXml('E', 4, '<notations><articulations><tenuto/></articulations></notations>')}
    ${noteXml('F', 4, '<notations><articulations><strong-accent/></articulations></notations>')}
  </measure>`)
  const m = ms[0]
  assertEq('accent', m[0].articulation, 'accent')
  assertEq('staccato', m[1].articulation, 'staccato')
  assertEq('tenuto', m[2].articulation, 'tenuto')
  assertEq('strong-accent → marcato', m[3].articulation, 'marcato')
})

describe('Fermata extraction (direct notations child)', () => {
  const ms = parseScore(`<measure number="1">${ATTRS}
    ${noteXml('C', 4, '<notations><fermata type="upright"/></notations>')}
    ${noteXml('D', 4)}
    ${noteXml('E', 4)}
    ${noteXml('F', 4)}
  </measure>`)
  const m = ms[0]
  assertEq('fermata', m[0].articulation, 'fermata')
  assertEq('plain note has no articulation', m[1].articulation ?? null, null)
})

describe('Grace note attaches to the following real note', () => {
  const ms = parseScore(`<measure number="1">${ATTRS}
    <note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>
    ${noteXml('C', 4)}
    ${noteXml('E', 4)}
    ${noteXml('F', 4)}
    ${noteXml('G', 4)}
  </measure>`)
  const m = ms[0]
  assertEq('grace D on main C', m[0].graceNote, { degree: 2, octave: 0, accidental: '' })
  assertEq('main note pitch intact', { degree: m[0].degree, octave: m[0].octave }, { degree: 1, octave: 0 })
  assertEq('next note has no grace', m[1].graceNote ?? null, null)
})

describe('Grace note with accidental', () => {
  const ms = parseScore(`<measure number="1">${ATTRS}
    <note><grace/><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><type>eighth</type></note>
    ${noteXml('G', 4)}
    ${noteXml('C', 4)}
    ${noteXml('D', 4)}
    ${noteXml('E', 4)}
  </measure>`)
  const m = ms[0]
  assertEq('grace #4 on main 5', m[0].graceNote, { degree: 4, octave: 0, accidental: '#' })
})

describe('Consecutive graces: only the first is kept', () => {
  const ms = parseScore(`<measure number="1">${ATTRS}
    <note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>
    <note><grace/><pitch><step>E</step><octave>4</octave></pitch><type>eighth</type></note>
    ${noteXml('C', 4)}
    ${noteXml('E', 4)}
    ${noteXml('F', 4)}
    ${noteXml('G', 4)}
  </measure>`)
  const m = ms[0]
  assertEq('first grace (D) wins', m[0].graceNote, { degree: 2, octave: 0, accidental: '' })
})

describe('Grace at measure end attaches to next measure first note', () => {
  const ms = parseScore(`
    <measure number="1">${ATTRS}
      ${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
      <note><grace/><pitch><step>A</step><octave>4</octave></pitch><type>eighth</type></note>
    </measure>
    <measure number="2">
      ${noteXml('G', 4)}${noteXml('A', 4)}${noteXml('B', 4)}${noteXml('C', 5)}
    </measure>`)
  assertEq('pending grace lands on M2 first note', (ms[1][0] as NoteObject).graceNote, { degree: 6, octave: 0, accidental: '' })
  assertEq('M1 notes unaffected', ms[0].every(n => !n.graceNote), true)
})

describe('time-modification → tuplet', () => {
  const tmod = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
  const eighthTriplet = (step: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type>${tmod}</note>`
  const ms = parseScore(`<measure number="1">${ATTRS.replace('<divisions>1</divisions>', '<divisions>3</divisions>')}
    ${eighthTriplet('C')}${eighthTriplet('D')}${eighthTriplet('E')}
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>3</duration><type>quarter</type></note>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration><type>quarter</type></note>
    <note><pitch><step>A</step><octave>4</octave></pitch><duration>3</duration><type>quarter</type></note>
  </measure>`)
  const m = ms[0]
  assertEq('triplet tuplet=3 on all three', [m[0].tuplet ?? null, m[1].tuplet ?? null, m[2].tuplet ?? null], [3, 3, 3])
  assertEq('plain quarter has no tuplet', m[3].tuplet ?? null, null)
})

describe('Rests inside time-modification also get tuplet', () => {
  const tmod = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
  const ms = parseScore(`<measure number="1">${ATTRS.replace('<divisions>1</divisions>', '<divisions>3</divisions>')}
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type>${tmod}</note>
    <note><rest/><duration>1</duration><type>eighth</type>${tmod}</note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type>${tmod}</note>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>3</duration><type>quarter</type></note>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration><type>quarter</type></note>
    <note><pitch><step>A</step><octave>4</octave></pitch><duration>3</duration><type>quarter</type></note>
  </measure>`)
  const m = ms[0]
  assertEq('rest carries tuplet', { rest: m[1].rest, tuplet: m[1].tuplet ?? null }, { rest: true, tuplet: 3 })
})

describe('Articulation + grace + slur coexist on one note', () => {
  const ms = parseScore(`<measure number="1">${ATTRS}
    <note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>
    ${noteXml('C', 4, '<notations><slur type="start" number="1"/><articulations><accent/></articulations></notations>')}
    ${noteXml('E', 4, '<notations><slur type="stop" number="1"/></notations>')}
    ${noteXml('F', 4)}
    ${noteXml('G', 4)}
  </measure>`)
  const n = ms[0][0]
  assertEq('has grace', n.graceNote, { degree: 2, octave: 0, accidental: '' })
  assertEq('has accent', n.articulation, 'accent')
  assertEq('has slurStart', n.slurStart, true)
})

// ============================================================================
// transposeNoteObjects: graceNote must transpose with the main note
// ============================================================================

function note(p: Partial<NoteObject>): NoteObject {
  return {
    degree: 1, octave: 0, type: 'quarter', dot: false, tie: false,
    rest: false, accidental: '', slurStart: false, slurStop: false,
    ...p,
  }
}

function measureOf(notes: NoteObject[]): MeasureArray {
  const arr = notes.slice() as unknown as MeasureArray
  arr._repeatStart = false
  arr._repeatEnd = false
  arr._direction = ''
  arr._dynamic = ''
  arr._wedge = null
  return arr
}

describe('Transpose C→G moves graceNote too', () => {
  const input: Measure[] = [
    measureOf([
      note({ degree: 1, graceNote: { degree: 2, octave: 0, accidental: '' } }),
      note({ degree: 5 }),
    ]),
  ]
  const out = transposeNoteObjects(input, 'C', 'G')
  const m = out[0] as MeasureArray
  // C (1 in C) → degree 4, octave -1 in G; its grace D (2 in C) → degree 5, octave -1 in G
  assertEq('main note transposed', { d: m[0].degree, o: m[0].octave }, { d: 4, o: -1 })
  assertEq('graceNote transposed', m[0].graceNote, { degree: 5, octave: -1, accidental: '' })
})

describe('Transpose C→D: sharp grace stays coherent', () => {
  const input: Measure[] = [
    measureOf([
      note({ degree: 5, graceNote: { degree: 4, octave: 0, accidental: '#' } }),
      note({ degree: 1 }),
    ]),
  ]
  const out = transposeNoteObjects(input, 'C', 'D')
  const m = out[0] as MeasureArray
  // G (5 in C) → F# is degree 3 in D... G = degree 4 in D. #F (#4 in C) → #G? — verify via semitones:
  // grace #4 in C = F#(6). In D (tonic 2): 6-2=4 semis → degree 3 (F#) exact, no accidental.
  assertEq('main 5 in C → 4 in D', { d: m[0].degree, o: m[0].octave, a: m[0].accidental }, { d: 4, o: 0, a: '' })
  assertEq('grace #4 in C → 3 in D', m[0].graceNote, { degree: 3, octave: 0, accidental: '' })
})

describe('Volta <ending> import — single-measure endings', () => {
  const ms = parseScore(`
    <measure number="1">${ATTRS}
      <barline location="left"><repeat direction="forward"/></barline>
      ${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
    </measure>
    <measure number="2">
      <barline location="left"><ending number="1" type="start"/></barline>
      ${noteXml('G', 4)}${noteXml('A', 4)}${noteXml('B', 4)}${noteXml('C', 5)}
      <barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>
    </measure>
    <measure number="3">
      <barline location="left"><ending number="2" type="start"/></barline>
      ${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
      <barline location="right"><ending number="2" type="discontinue"/></barline>
    </measure>`)
  assertEq('M1 no volta', ms[0]._volta ?? null, null)
  assertEq('M2 volta 1', ms[1]._volta, 1)
  assertEq('M2 repeatEnd kept', ms[1]._repeatEnd, true)
  assertEq('M3 volta 2', ms[2]._volta, 2)
})

describe('Volta <ending> import — multi-measure ending', () => {
  const ms = parseScore(`
    <measure number="1">${ATTRS}
      <barline location="left"><ending number="1" type="start"/></barline>
      ${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
    </measure>
    <measure number="2">
      ${noteXml('G', 4)}${noteXml('A', 4)}${noteXml('B', 4)}${noteXml('C', 5)}
      <barline location="right"><ending number="1" type="stop"/></barline>
    </measure>
    <measure number="3">
      ${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
    </measure>`)
  assertEq('M1 volta 1 (start)', ms[0]._volta, 1)
  assertEq('M2 volta 1 (still open, stop here)', ms[1]._volta, 1)
  assertEq('M3 no volta (closed)', ms[2]._volta ?? null, null)
})

describe('Volta <ending> import — number "1, 2" takes first', () => {
  const ms = parseScore(`
    <measure number="1">${ATTRS}
      <barline location="left"><ending number="1, 2" type="start"/></barline>
      ${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
      <barline location="right"><ending number="1, 2" type="stop"/></barline>
    </measure>`)
  assertEq('M1 volta 1 from "1, 2"', ms[0]._volta, 1)
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach(f => console.log(`  · ${f}`))
  process.exit(1)
}
