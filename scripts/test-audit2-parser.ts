// Regression tests for the second parser audit: MusicXML chords, slurs by number, silent
// measures, the measure timeline, directions, tuplets, and MIDI meter changes.
// Run via: npx tsx scripts/test-audit2-parser.ts
//
// Uses linkedom (devDependency, tests only — never bundled) to parse inline MusicXML,
// and @tonejs/midi to build MIDI fixtures.

import { DOMParser } from 'linkedom'
import midiPackage from '@tonejs/midi'
import {
  parseXMLToNoteObjects, transposeNoteObjects, midiToJianpu, parseMetronomeTempo, pitchToJianpu,
} from '../src/lib/parser'
import type { Measure, MeasureArray, NoteObject } from '../src/types/score'

// @tonejs/midi ships a CommonJS build, which Node only exposes through the default import
const { Midi } = midiPackage as unknown as typeof import('@tonejs/midi')

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

// ============================================================================
// Helpers
// ============================================================================

const TYPE_CODE: Record<string, string> = { whole: 'w', half: 'h', quarter: 'q', eighth: 'e', '16th': 's', '32nd': 't' }

// One note as text: "~" tie continuation, accidental, degree, octave marks, "/", type, "." dot
function fmtNote(n: NoteObject): string {
  const oct = n.octave > 0 ? "'".repeat(n.octave) : n.octave < 0 ? ','.repeat(-n.octave) : ''
  const pitch = n.rest ? '0' : `${n.accidental}${n.degree}${oct}`
  return `${n.tie ? '~' : ''}${pitch}/${TYPE_CODE[n.type]}${n.dot ? '.' : ''}`
}
const fmt = (m: Measure) => (m as MeasureArray).map(fmtNote).join(' ')
const fmtAll = (ms: Measure[]) => ms.map(fmt)
// Slur flags per note: ")" closes, "(" opens, both on one note read ")("
const slurs = (m: MeasureArray) => m.map(n => `${n.slurStop ? ')' : ''}${n.slurStart ? '(' : ''}`)

function parseXml(measuresXml: string, partList = true): MeasureArray[] {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  ${partList ? '<part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>' : ''}
  <part id="P1">${measuresXml}</part>
</score-partwise>`
  return parseXMLToNoteObjects(new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document)
}

function xmlDoc(body: string): Document {
  return new DOMParser().parseFromString(`<score-partwise>${body}</score-partwise>`, 'text/xml') as unknown as Document
}

const attrs = (fifths = 0, beats = 4, beatType = 4, divisions = 1) =>
  `<attributes><divisions>${divisions}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time></attributes>`

function noteXml(step: string, octave: number, duration = 1, type = 'quarter', extra = ''): string {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>${type}</type>${extra}</note>`
}
function chordXml(step: string, octave: number, extra = '', duration = 1, type = 'quarter'): string {
  return `<note><chord/><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>${type}</type>${extra}</note>`
}
function graceXml(step: string, octave: number, extra = ''): string {
  return `<note><grace/><pitch><step>${step}</step><octave>${octave}</octave></pitch><type>eighth</type>${extra}</note>`
}
const slur = (type: 'start' | 'stop', number?: number) =>
  `<slur type="${type}"${number === undefined ? '' : ` number="${number}"`}/>`
const notations = (...parts: string[]) => `<notations>${parts.join('')}</notations>`
const TIE_START = '<tie type="start"/>'
const TIE_STOP = '<tie type="stop"/>'

// ============================================================================
// 1. Chords: the highest note is the melody
// ============================================================================

describe('1. MusicXML chord: highest note is the melody, the rest stack below, high to low', () => {
  const ms = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 4, 2, 'half')}${chordXml('E', 4, '', 2, 'half')}${chordXml('G', 4, '', 2, 'half')}
    ${noteXml('A', 4, 2, 'half')}
  </measure>`)
  const first = ms[0][0]
  assertEq('C E G listed low to high → main is G (5)', [first.degree, first.octave], [5, 0])
  assertEq('...the others follow from high to low (3 then 1)', first.chordNotes?.map(c => c.degree), [3, 1])
  assertEq('the next note is untouched', [ms[0].length, ms[0][1].degree], [2, 6])
  assertEq('duration stays that of the chord', [first.type, first.dot], ['half', false])

  const rev = parseXml(`<measure number="1">${attrs()}
    ${noteXml('G', 4, 4, 'whole')}${chordXml('C', 4, '', 4, 'whole')}${chordXml('E', 4, '', 4, 'whole')}
  </measure>`)
  assertEq('listed high first: same result', [rev[0][0].degree, rev[0][0].chordNotes?.map(c => c.degree)], [5, [3, 1]])

  const wide = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 5, 4, 'whole')}${chordXml('A', 4, '', 4, 'whole')}${chordXml('C', 4, '', 4, 'whole')}
  </measure>`)
  assertEq('pitch decides, not the spelling order (C5 over A4 over C4)', [wide[0][0].degree, wide[0][0].octave, wide[0][0].chordNotes?.map(c => `${c.degree}${c.octave}`)], [1, 1, ['60', '10']])

  const dup = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 4, 4, 'whole')}${chordXml('C', 4, '', 4, 'whole')}${chordXml('E', 4, '', 4, 'whole')}
  </measure>`)
  assertEq('the same pitch written twice is one note', [dup[0][0].degree, (dup[0][0].chordNotes ?? []).map(c => c.degree)], [3, [1]])

  const unison = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 4, 4, 'whole')}${chordXml('C', 4, '', 4, 'whole')}
  </measure>`)
  assertEq('only duplicates → a plain note', [unison[0][0].degree, (unison[0][0].chordNotes ?? []).length], [1, 0])

  const props = parseXml(`<measure number="1">${attrs()}
    ${graceXml('D', 4)}
    ${noteXml('C', 4, 1, 'quarter', notations('<articulations><staccato/></articulations>'))}${chordXml('G', 4)}
    ${noteXml('E', 4, 1, 'quarter', notations('<fermata/>'))}${chordXml('B', 4)}
    ${noteXml('F', 4, 2, 'half')}
  </measure>`)
  assertEq('articulation, grace and fermata come from the first <note>', [props[0][0].articulation, props[0][0].graceNote, props[0][1].articulation], ['staccato', { degree: 2, octave: 0, accidental: '' }, 'fermata'])
  assertEq('...and the main note is still the top one', [props[0][0].degree, props[0][1].degree], [5, 7])

  const sl = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 4)}${chordXml('E', 4, notations(slur('start', 1)))}
    ${noteXml('D', 4)}
    ${noteXml('F', 4)}${chordXml('A', 4, notations(slur('stop', 1)))}
  </measure>`)
  assertEq('a slur start on a chord member counts for the chord', slurs(sl[0]), ['(', '', ')'])

  // The chord is the last thing in the measure: it must still be finished
  const tail = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 4, 2, 'half')}${noteXml('E', 4, 1)}${chordXml('G', 4)}
  </measure>`)
  assertEq('a chord at the end of the measure is finished', [tail[0].length, tail[0][1].degree, tail[0][1].chordNotes?.map(c => c.degree)], [2, 5, [3]])

  const tied = (second: string) => parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 4, 2, 'half')}${chordXml('E', 4, TIE_START, 2, 'half')}${chordXml('G', 4, TIE_START, 2, 'half')}
    ${second}
  </measure>`)
  const allStop = tied(`${noteXml('C', 4, 2, 'half', TIE_STOP)}${chordXml('E', 4, TIE_STOP, 2, 'half')}${chordXml('G', 4, TIE_STOP, 2, 'half')}`)
  assertEq('every member has <tie stop/> → the chord is tied', allStop[0][1].tie, true)

  const someStop = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 4, 2, 'half')}${chordXml('E', 4, '', 2, 'half')}
    ${noteXml('C', 4, 2, 'half', TIE_STOP)}${chordXml('E', 4, '', 2, 'half')}
  </measure>`)
  assertEq('only some members stop a tie → a new attack', someStop[0][1].tie, false)

  const dangling = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 4, 2, 'half')}${chordXml('G', 4, TIE_START, 2, 'half')}
    ${noteXml('G', 4, 2, 'half')}
  </measure>`)
  assertEq('tie start on the HIGHEST note, same pitch next (no stop written) → tied', dangling[0][1].tie, true)

  const lowStart = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 4, 2, 'half', TIE_START)}${chordXml('G', 4, '', 2, 'half')}
    ${noteXml('C', 4, 2, 'half')}
  </measure>`)
  assertEq('tie start on a lower member only → no tie into the next note', lowStart[0][1].tie, false)

  const perc = parseXml(`<measure number="1">${attrs()}
    <note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>2</duration><type>half</type></note>
    <note><chord/><unpitched><display-step>G</display-step><display-octave>4</display-octave></unpitched><duration>2</duration><type>half</type></note>
    ${noteXml('C', 4, 2, 'half')}
  </measure>`)
  assertEq('<chord/> on an unpitched note does not crash and stays one hit', [perc[0].length, perc[0][0].degree, perc[0][0].rest], [2, 0, false])
})

// ============================================================================
// 2. Slurs are tracked by number
// ============================================================================

describe('2. MusicXML slurs: tracked by number, one arc at a time', () => {
  const run = (notes: string[]) => parseXml(`<measure number="1">${attrs(0, 5)}${notes.join('')}</measure>`)[0]
  const q = (step: string, extra = '') => noteXml(step, 4, 1, 'quarter', extra)

  const grace = run([
    q('C', notations(slur('start', 1))),
    graceXml('E', 4, notations(slur('start', 2))),
    q('D', notations(slur('stop', 2))),
    q('G', notations(slur('stop', 1))),
  ])
  assertEq('a grace note\'s own slur does not close the phrase slur early', slurs(grace), ['(', '', ')'])

  const nested = run([
    q('C', notations(slur('start', 1))),
    q('D', notations(slur('start', 2))),
    q('E', notations(slur('stop', 2))),
    q('F'),
    q('G', notations(slur('stop', 1))),
  ])
  assertEq('nested 1..5 with inner 2..3: only the inner arc is drawn', slurs(nested), ['', '(', ')', '', ''])

  const sameNote = run([
    q('C', notations(slur('start', 1) + slur('start', 2))),
    q('D', notations(slur('stop', 2))),
    q('E', notations(slur('stop', 1))),
  ])
  assertEq('two starts on one note are one arc that ends at the first stop', slurs(sameNote), ['(', ')', ''])

  const chain = run([
    q('C', notations(slur('start', 1))),
    q('D', notations(slur('stop', 1) + slur('start', 1))),
    q('E', notations(slur('stop', 1))),
  ])
  assertEq('a note that ends one slur and opens the next draws both', slurs(chain), ['(', ')(', ')'])

  const orphanStop = run([q('C'), q('D', notations(slur('stop', 1))), q('E')])
  assertEq('a stop whose number is not open is ignored', slurs(orphanStop), ['', '', ''])

  const noNumber = run([q('C', notations(slur('start'))), q('D', notations(slur('stop')))])
  assertEq('slurs without a number default to 1', slurs(noNumber), ['(', ')'])

  const open = parseXml(`<measure number="1">${attrs()}${q('C', notations(slur('start', 1)))}${q('D')}${q('E')}${q('F')}</measure>
    <measure number="2">${q('G')}${q('A')}${q('B')}${q('C')}</measure>`)
  assertEq('a start that never closes is removed at the end', [slurs(open[0]), slurs(open[1])], [['', '', '', ''], ['', '', '', '']])

  const reopen = parseXml(`<measure number="1">${attrs()}${q('C', notations(slur('start', 1)))}${q('D')}${q('E')}${q('F')}</measure>
    <measure number="2">${q('G', notations(slur('start', 1)))}${q('A', notations(slur('stop', 1)))}${q('B')}${q('C')}</measure>`)
  assertEq('a later start replaces the unclosed one', [slurs(reopen[0]), slurs(reopen[1])], [['', '', '', ''], ['(', ')', '', '']])

  const phrase = run([
    q('C', notations(slur('start', 1))),
    q('D', TIE_START),
    q('E'),
    q('F', notations(slur('stop', 1))),
  ])
  assertEq('a pitch-changing tie inside a phrase slur is the later start: it wins', slurs(phrase), ['', '(', ')', ''])

  const tieSlur = run([q('C', TIE_START), q('D', TIE_START), q('E'), q('F')])
  assertEq('consecutive pitch-changing ties still extend one slur', slurs(tieSlur), ['(', '', ')', ''])
})

// ============================================================================
// 3. Silent measures keep their place
// ============================================================================

describe('3. MusicXML: a measure without kept notes is a whole rest', () => {
  const body = (middle: string) => `<measure number="1">${attrs()}${noteXml('C', 5, 4, 'whole')}</measure>${middle}<measure number="3">${noteXml('D', 5, 4, 'whole')}</measure>`

  const empty = parseXml(body('<measure number="2"/>'))
  assertEq('an empty <measure/> is a whole rest, later bars keep their number', fmtAll(empty), ["1'/w", '0/w', "2'/w"])
  assertEq('...a plain rest object', empty[1][0], { degree: 0, octave: 0, type: 'whole', dot: false, tie: false, rest: true, accidental: '', slurStart: false, slurStop: false })

  const fwd = parseXml(body('<measure number="2"><forward><duration>4</duration></forward></measure>'))
  assertEq('only <forward> → whole rest', fmtAll(fwd), ["1'/w", '0/w', "2'/w"])

  const piano = parseXml(`<measure number="1">${attrs()}${noteXml('C', 5, 4, 'whole', '<voice>1</voice><staff>1</staff>')}
    <backup><duration>4</duration></backup>${noteXml('C', 3, 4, 'whole', '<voice>5</voice><staff>2</staff>')}</measure>
    <measure number="2">${noteXml('C', 3, 4, 'whole', '<voice>5</voice><staff>2</staff>')}</measure>
    <measure number="3">${noteXml('D', 5, 4, 'whole', '<voice>1</voice><staff>1</staff>')}</measure>`)
  assertEq('a piano bar with notes on staff 2 only', fmtAll(piano), ["1'/w", '0/w', "2'/w"])

  const meta = parseXml(body(`<measure number="2">
    <attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
    <barline location="left"><repeat direction="forward"/><ending number="1" type="start"/></barline>
    <direction><direction-type><words>D.C. al Fine</words></direction-type></direction></measure>`))
  assertEq('...and keeps its meter, repeat, volta and direction', [meta[1]._timeSig, meta[1]._repeatStart, meta[1]._volta, meta[1]._direction], ['3/4', true, 1, 'D.C. al Fine'])

  const implicit = parseXml(body('<measure number="2" implicit="yes"/>'))
  assertEq('an empty implicit measure is still skipped', fmtAll(implicit), ["1'/w", "2'/w"])
  const implicitRepeat = parseXml(body('<measure number="2" implicit="yes"><barline location="right"><repeat direction="backward"/></barline></measure>'))
  assertEq('...unless it carries a repeat', [implicitRepeat.length, implicitRepeat[1]._repeatEnd], [3, true])
  const implicitDir = parseXml(body('<measure number="2" implicit="yes"><direction><direction-type><words>Fine</words></direction-type></direction></measure>'))
  assertEq('...or a direction', [implicitDir.length, implicitDir[1]._direction], [3, 'Fine'])
  const implicitOther = parseXml(`<measure number="1">${attrs()}${noteXml('C', 5, 4, 'whole', '<staff>1</staff>')}</measure>
    <measure number="2" implicit="yes">${noteXml('C', 3, 4, 'whole', '<staff>2</staff>')}</measure>`)
  assertEq('...or notes on another staff', fmtAll(implicitOther), ["1'/w", '0/w'])
})

// ============================================================================
// 4. The measure timeline: <forward>, <backup>, layers
// ============================================================================

describe('4. MusicXML timeline: forward, gaps, second layers', () => {
  const one = (inner: string, beats = 4) => parseXml(`<measure number="1">${attrs(0, beats)}${inner}</measure>`)[0]
  const fwd = (d: number) => `<forward><duration>${d}</duration></forward>`

  assertEq('<forward> before the notes leaves a leading rest', fmt(one(`${fwd(1)}${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}`)), '0/q 1/q 2/q 3/q')
  assertEq('<forward> between notes leaves a rest there', fmt(one(`${noteXml('C', 4)}${fwd(1)}${noteXml('D', 4)}${noteXml('E', 4)}`)), '1/q 0/q 2/q 3/q')
  assertEq('<forward> at the end fills the bar', fmt(one(`${noteXml('C', 4)}${noteXml('D', 4)}${fwd(2)}`)), '1/q 2/q 0/h')

  const longer = one(`${noteXml('C', 5, 2, 'half', '<voice>1</voice>')}<backup><duration>2</duration></backup>${noteXml('E', 4, 4, 'whole', '<voice>2</voice>')}`)
  assertEq('the kept voice ends before another voice → rest to the end', fmt(longer), "1'/h 0/h")

  const same = one(`${noteXml('C', 5, 4, 'whole', '<voice>1</voice>')}<backup><duration>4</duration></backup>${noteXml('E', 4, 4, 'whole', '<voice>2</voice>')}`)
  assertEq('voices of the same length add nothing', fmt(same), "1'/w")

  const layered = one(`${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}
    <backup><duration>4</duration></backup>
    ${noteXml('G', 4)}${noteXml('A', 4)}${noteXml('B', 4)}${chordXml('D', 5)}${noteXml('C', 5)}`)
  assertEq('a second layer written without <voice> after a <backup> is skipped (chord members too)', fmt(layered), '1/q 2/q 3/q 4/q')

  const noDuration = one(`${fwd(1)}${noteXml('C', 4)}${noteXml('D', 4)}<note><pitch><step>E</step><octave>4</octave></pitch><type>quarter</type></note>`)
  assertEq('a note without <duration> turns the gap logic off for the measure', fmt(noDuration), '1/q 2/q 3/q')

  const grace = one(`<note><grace/><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note>${noteXml('C', 4)}${noteXml('D', 4)}${noteXml('E', 4)}${noteXml('F', 4)}`)
  assertEq('a grace note never advances the position', [fmt(grace), grace[0].graceNote?.degree], ['1/q 2/q 3/q 4/q', 2])

  const cue = one(`<note><cue/><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>${noteXml('C', 4, 2, 'half')}`)
  assertEq('a cue note takes up time: it leaves a rest where it sounds', fmt(cue), '0/h 1/h')

  const short = one(`${noteXml('C', 4)}`)
  assertEq('a short measure is never padded to the bar', fmt(short), '1/q')
})

// @@SECTIONS@@

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach(f => console.log(`  · ${f}`))
  process.exit(1)
}
