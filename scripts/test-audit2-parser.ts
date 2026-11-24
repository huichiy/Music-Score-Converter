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

// ============================================================================
// 5-7. Directions
// ============================================================================

describe('5. a direction written for another staff supplies nothing', () => {
  const two = (dirs: string) => parseXml(`<measure number="1">${attrs()}${dirs}
    ${noteXml('C', 5, 4, 'whole', '<voice>1</voice><staff>1</staff>')}<backup><duration>4</duration></backup>
    ${noteXml('C', 3, 4, 'whole', '<voice>5</voice><staff>2</staff>')}</measure>`)[0]
  const dirs = (staff: string) => `<direction><direction-type><dynamics><f/></dynamics></direction-type>${staff}</direction>
    <direction><direction-type><wedge type="crescendo"/></direction-type>${staff}</direction>
    <direction><direction-type><words>D.C. al Fine</words></direction-type>${staff}</direction>`
  const other = two(dirs('<staff>2</staff>'))
  assertEq('staff 2 dynamic, wedge and words are ignored', [other._dynamic, other._wedge, other._direction], ['', null, ''])
  const mine = two(dirs('<staff>1</staff>'))
  assertEq('the kept staff\'s own are read', [mine._dynamic, mine._wedge, mine._direction], ['f', 'cresc', 'D.C. al Fine'])
  const none = two(dirs(''))
  assertEq('a direction without <staff> is read', [none._dynamic, none._wedge, none._direction], ['f', 'cresc', 'D.C. al Fine'])

  const ms = parseXml(`<measure number="1">${attrs()}<direction><direction-type><wedge type="crescendo"/></direction-type><staff>1</staff></direction>
      ${noteXml('C', 5, 4, 'whole', '<staff>1</staff>')}</measure>
    <measure number="2"><direction><direction-type><wedge type="stop"/></direction-type><staff>2</staff></direction>
      ${noteXml('D', 5, 4, 'whole', '<staff>1</staff>')}</measure>
    <measure number="3"><direction><direction-type><wedge type="stop"/></direction-type><staff>1</staff></direction>
      ${noteXml('E', 5, 4, 'whole', '<staff>1</staff>')}</measure>`)
  assertEq('another staff\'s wedge stop does not close this staff\'s hairpin', ms.map(m => m._wedge), ['cresc', 'cresc', null])
})

describe('6. <other-dynamics> keeps only its letters', () => {
  const dyn = (inner: string) => parseXml(`<measure number="1">${attrs()}<direction><direction-type><dynamics>${inner}</dynamics></direction-type></direction>${noteXml('C', 5, 4, 'whole')}</measure>`)[0]._dynamic
  assertEq('sffz', dyn('<other-dynamics>sffz</other-dynamics>'), 'sffz')
  assertEq('"sf-fz 3" → sffz', dyn('<other-dynamics>sf-fz 3</other-dynamics>'), 'sffz')
  assertEq('no letters → empty', dyn('<other-dynamics>123</other-dynamics>'), '')
  assertEq('a plain mark still reads from its tag', dyn('<mf/>'), 'mf')
})

describe('7. direction signs: words, <segno/>, <coda/>, <sound>', () => {
  const dirOf = (inner: string) => parseXml(`<measure number="1">${attrs()}${inner}${noteXml('C', 5, 4, 'whole')}</measure>`)[0]._direction
  const words = (w: string) => `<direction><direction-type><words>${w}</words></direction-type></direction>`
  const el = (e: string) => `<direction><direction-type>${e}</direction-type></direction>`
  assertEq('"D.S" without the last dot', dirOf(words('D.S')), 'D.S')
  assertEq('"Da Capo"', dirOf(words('Da Capo')), 'Da Capo')
  assertEq('"DC al Fine"', dirOf(words('DC al Fine')), 'DC al Fine')
  assertEq('"Dal Segno al Coda"', dirOf(words('Dal Segno al Coda')), 'Dal Segno al Coda')
  assertEq('other words are not directions', dirOf(words('rit.')), '')
  assertEq('<segno/> alone', dirOf(el('<segno/>')), 'Segno')
  assertEq('<coda/> alone', dirOf(el('<coda/>')), 'Coda')
  assertEq('<segno/> beats <coda/>', dirOf(el('<coda/>') + el('<segno/>')), 'Segno')
  assertEq('recognised words win over a sign', dirOf(el('<segno/>') + words('D.C.')), 'D.C.')
  const sound = (soundAttrs: string, where: 'in' | 'out' = 'in') => where === 'in'
    ? `<direction><direction-type><words>rit.</words></direction-type><sound ${soundAttrs}/></direction>`
    : `<sound ${soundAttrs}/>`
  assertEq('<sound dacapo="yes"/> → D.C.', dirOf(sound('dacapo="yes"')), 'D.C.')
  assertEq('<sound dalsegno="s1"/> → D.S.', dirOf(sound('dalsegno="s1"')), 'D.S.')
  assertEq('<sound fine="yes"/> → Fine', dirOf(sound('fine="yes"')), 'Fine')
  assertEq('<sound segno="s1"/> → Segno', dirOf(sound('segno="s1"')), 'Segno')
  assertEq('a <sound> straight under <measure> counts', dirOf(sound('dacapo="yes"', 'out')), 'D.C.')
  assertEq('a sign beats a <sound>', dirOf(sound('dacapo="yes"') + el('<coda/>')), 'Coda')
  assertEq('a <sound> with only a tempo is nothing', dirOf(sound('tempo="90"')), '')
  assertEq('dacapo="no" is nothing', dirOf(sound('dacapo="no"')), '')
  const otherStaff = parseXml(`<measure number="1">${attrs()}<direction><direction-type><words>x</words></direction-type><staff>2</staff><sound dacapo="yes"/></direction>
    ${noteXml('C', 5, 4, 'whole', '<staff>1</staff>')}<backup><duration>4</duration></backup>${noteXml('C', 3, 4, 'whole', '<staff>2</staff>')}</measure>`)[0]
  assertEq('a <sound> inside another staff\'s direction is ignored', otherStaff._direction, '')
})

// ============================================================================
// 8-12. Note values
// ============================================================================

describe('8. two or more dots are tied pieces that add up', () => {
  const dd = parseXml(`<measure number="1">${attrs(0, 4, 4, 2)}
    ${noteXml('C', 4, 7, 'half', `<dot/><dot/>${notations(slur('start', 1), '<articulations><staccato/></articulations>')}`)}
    ${noteXml('D', 4, 1, 'eighth', notations(slur('stop', 1)))}</measure>`)[0]
  assertEq('double-dotted half = half. + tied eighth', fmt(dd), '1/h. ~1/e 2/e')
  assertEq('slur and articulation sit on the first piece', [slurs(dd), dd.map(n => n.articulation ?? null)], [['(', '', ')'], ['staccato', null, null]])

  const triple = parseXml(`<measure number="1">${attrs(0, 4, 4, 8)}${noteXml('C', 4, 30, 'half', '<dot/><dot/><dot/>')}${noteXml('D', 4, 2, 'eighth')}</measure>`)[0]
  assertEq('three dots: half + 3 dots = 3.75 beats', fmt(triple), '1/h. ~1/e. 2/e')

  const rest = parseXml(`<measure number="1">${attrs(0, 4, 4, 2)}<note><rest/><duration>7</duration><type>half</type><dot/><dot/></note>${noteXml('D', 4, 1, 'eighth')}</measure>`)[0]
  assertEq('a double-dotted rest is rests (never tied)', fmt(rest), '0/h. 0/e 2/e')

  const chord = parseXml(`<measure number="1">${attrs(0, 4, 4, 2)}${noteXml('C', 4, 7, 'half', '<dot/><dot/>')}${chordXml('E', 4, '<dot/><dot/>', 7, 'half')}${noteXml('D', 4, 1, 'eighth')}</measure>`)[0]
  assertEq('a chord keeps its notes on the first piece only', [chord[0].chordNotes?.map(c => c.degree), chord[1].chordNotes ?? null, chord[0].degree, chord[1].degree], [[1], null, 3, 3])

  const trip = parseXml(`<measure number="1">${attrs(0, 4, 4, 6)}${noteXml('C', 4, 7, 'quarter', '<dot/><dot/><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>')}</measure>`)[0]
  assertEq('tuplet goes on every piece', [fmt(trip), trip.map(n => n.tuplet)], ['1/q. ~1/s', [3, 3]])

  const single = parseXml(`<measure number="1">${attrs(0, 4, 4, 2)}${noteXml('C', 4, 3, 'quarter', '<dot/>')}</measure>`)[0]
  assertEq('one dot is untouched', fmt(single), '1/q.')
})

describe('9. pitchToJianpu with a double alteration', () => {
  const j = (step: string, alter: number, octave: number, key = 'C') => { const p = pitchToJianpu(step, alter, octave, key); return `${p.accidental}${p.degree}:${p.octave}` }
  assertEq('F## in C is G (5)', j('F', 2, 4), '5:0')
  assertEq('Bbb in C is A (6)', j('B', -2, 4), '6:0')
  assertEq('C## is D', j('C', 2, 5), '2:1')
  assertEq('a single sharp keeps its spelling', j('F', 1, 4), '#4:0')
  assertEq('a single flat keeps its spelling', j('B', -1, 4), 'b7:0')
  assertEq('E## in G is F# (the 7th, an octave down)', j('E', 2, 4, 'G'), '7:-1')
  assertEq('F## in G is one step above the 7th: still one accidental', j('F', 2, 4, 'G'), '#7:-1')
  assertEq('a quarter-tone stays an accidental', j('F', 0.5, 4), '#4:0')
  const ms = parseXml(`<measure number="1">${attrs()}<note><pitch><step>F</step><alter>2</alter><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>`)
  assertEq('...also through MusicXML', fmt(ms[0]), '5/w')
})

describe('10. a rest with no <type> that fills its measure is a whole rest', () => {
  const m3 = (inner: string) => parseXml(`<measure number="1">${attrs(0, 3, 4)}${inner}</measure>`)[0]
  assertEq('3/4 bar rest', fmt(m3('<note><rest/><duration>3</duration></note>')), '0/w')
  assertEq('...not a dotted half, and it collapses like one', [m3('<note><rest/><duration>3</duration></note>')[0].dot, m3('<note><rest/><duration>3</duration></note>')[0].type], [false, 'whole'])
  assertEq('a typeless rest among notes keeps its duration', fmt(m3(`<note><rest/><duration>1</duration></note>${noteXml('C', 4, 2, 'half')}`)), '0/q 1/h')
  assertEq('a rest that has a <type> keeps it', fmt(m3('<note><rest/><duration>3</duration><type>half</type><dot/></note>')), '0/h.')
})

describe('11. tempo from <sound tempo>', () => {
  const metro = '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type></direction>'
  const doc = (inner: string) => xmlDoc(`<part><measure>${inner}</measure></part>`)
  assertEq('only a <sound tempo>', parseMetronomeTempo(doc('<sound tempo="96.4"/>')), '96')
  assertEq('inside a <direction>', parseMetronomeTempo(doc('<direction><sound tempo="80"/></direction>')), '80')
  assertEq('the first in document order wins: sound first', parseMetronomeTempo(doc(`<sound tempo="90"/>${metro}`)), '90')
  assertEq('...metronome first', parseMetronomeTempo(doc(`${metro}<sound tempo="90"/>`)), '100')
  assertEq('a zero tempo is skipped', parseMetronomeTempo(doc(`<sound tempo="0"/>${metro}`)), '100')
  assertEq('a metronome without per-minute is skipped', parseMetronomeTempo(doc('<direction><direction-type><metronome><beat-unit>quarter</beat-unit></metronome></direction-type></direction><sound tempo="70"/>')), '70')
  assertEq('a later measure counts too', parseMetronomeTempo(xmlDoc('<part><measure/><measure><sound tempo="60"/></measure></part>')), '60')
  assertEq('nothing → empty', parseMetronomeTempo(doc('<sound dacapo="yes"/>')), '')
})

describe('12. two-note tremolo is not a tuplet', () => {
  const trem = (type: string, dur: number) =>
    `<note><pitch><step>C</step><octave>5</octave></pitch><duration>${dur}</duration><type>whole</type>
      <time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes></time-modification>
      <notations><ornaments><tremolo type="${type}">3</tremolo></ornaments></notations></note>`
  const ms = parseXml(`<measure number="1">${attrs(0, 4, 4, 4)}${trem('start', 8)}${trem('stop', 8)}</measure>`)[0]
  assertEq('two written wholes of 2 beats each make a 4-beat bar', [fmt(ms), ms.map(n => n.tuplet ?? null)], ["1'/h 1'/h", [null, null]])
  const long = parseXml(`<measure number="1">${attrs(0, 4, 4, 4)}${trem('start', 20)}</measure>`)[0]
  assertEq('a value that needs a tie is split from the duration', fmt(long), "1'/w ~1'/q")
  const single = parseXml(`<measure number="1">${attrs(0, 4, 4, 1)}<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type><notations><ornaments><tremolo type="single">3</tremolo></ornaments></notations></note></measure>`)[0]
  assertEq('a one-note tremolo is just its note', fmt(single), "1'/q")
})

// ============================================================================
// 13-15. tupletLen, _pickup, transposition keeps measure properties
// ============================================================================

describe('13. tupletLen: a tuplet group that is not `tuplet` notes long', () => {
  const tm = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
  const t = (step: string, d: number, type: string, mark = '') => noteXml(step, 4, d, type, tm + mark)
  const mark = (type: 'start' | 'stop', number = 1) => notations(`<tuplet type="${type}" number="${number}"/>`)
  const lens = (m: MeasureArray) => m.map(n => n.tupletLen ?? null)
  const bar = (inner: string, divisions = 3) => parseXml(`<measure number="1">${attrs(0, 4, 4, divisions)}${inner}</measure>`)[0]

  const qe = bar(`${t('C', 2, 'quarter')}${t('D', 1, 'eighth')}${t('E', 2, 'quarter')}${t('F', 1, 'eighth')}${noteXml('G', 4, 6, 'half')}`)
  assertEq('quarter + eighth triplet: tupletLen 2 on the first note of each group', lens(qe), [2, null, 2, null, null])
  assertEq('...tuplet itself is untouched', qe.map(n => n.tuplet ?? null), [3, 3, 3, 3, null])

  const marked = bar(`${t('C', 2, 'quarter', mark('start'))}${t('D', 1, 'eighth', mark('stop'))}${t('E', 2, 'quarter', mark('start'))}${t('F', 1, 'eighth', mark('stop'))}${noteXml('G', 4, 6, 'half')}`)
  assertEq('the same with <tuplet> start / stop', lens(marked), [2, null, 2, null, null])

  const three = bar(`${t('C', 1, 'eighth')}${t('D', 1, 'eighth')}${t('E', 1, 'eighth')}${noteXml('F', 4, 9, 'half', '<dot/>')}`)
  assertEq('a plain eighth triplet needs none', lens(three), [null, null, null, null])

  const sext = bar(Array(6).fill(0).map(() => noteXml('C', 4, 1, '16th', '<time-modification><actual-notes>6</actual-notes><normal-notes>4</normal-notes></time-modification>')).join('') + noteXml('G', 4, 12, 'half', '<dot/>'), 6)
  assertEq('six 16ths of a sextuplet are one group of 6', lens(sext), [null, null, null, null, null, null, null])

  const restIn = bar(`${t('C', 2, 'quarter')}<note><rest/><duration>1</duration><type>eighth</type>${tm}</note>${noteXml('G', 4, 9, 'half', '<dot/>')}`)
  assertEq('a rest is a member of the group', lens(restIn), [2, null, null])

  const nested = bar(['C', 'D', 'E', 'F'].map((s, k) => t(s, 1, 'eighth', k === 0 ? mark('start', 1) : k === 1 ? mark('start', 2) : k === 2 ? mark('stop', 2) : mark('stop', 1))).join(''))
  assertEq('nested tuplets: the outermost start / stop pair is the group', lens(nested), [4, null, null, null])

  const split = parseXml(`<measure number="1">${attrs(0, 4, 4, 3)}${noteXml('C', 4, 9, 'half', '<dot/>')}${t('D', 2, 'quarter')}</measure>
    <measure number="2">${t('E', 1, 'eighth')}${noteXml('F', 4, 9, 'half', '<dot/>')}</measure>`)
  assertEq('a group never crosses a barline', [lens(split[0]), lens(split[1])], [[null, null], [null, null]])
})

describe('14. _pickup on the first measure', () => {
  const implicit = parseXml(`<measure number="0" implicit="yes">${attrs()}${noteXml('C', 5, 1)}</measure><measure number="1">${noteXml('D', 5, 4, 'whole')}</measure>`)
  assertEq('implicit="yes" → _pickup', implicit.map(x => x._pickup ?? false), [true, false])
  const zero = parseXml(`<measure number="0">${attrs()}${noteXml('C', 5, 1)}</measure><measure number="1">${noteXml('D', 5, 4, 'whole')}</measure>`)
  assertEq('number="0" → _pickup', zero.map(x => x._pickup ?? false), [true, false])
  const plain = parseXml(`<measure number="1">${attrs()}${noteXml('C', 5, 4, 'whole')}</measure><measure number="2" implicit="yes">${noteXml('D', 5, 1)}</measure>`)
  assertEq('a normal first measure is not a pickup, an implicit later one is not either', plain.map(x => x._pickup ?? false), [false, false])
})

describe('15. transposeNoteObjects keeps every measure property', () => {
  const one = { degree: 1, octave: 0, type: 'quarter', dot: false, tie: false, rest: false, accidental: '', slurStart: false, slurStop: false }
  const src = [Object.assign([one] as unknown as MeasureArray, { _pickup: true, _repeatStart: true, _custom: 'x' } as Record<string, unknown>)] as Measure[]
  const out = transposeNoteObjects(src, 'C', 'D')[0] as MeasureArray & Record<string, unknown>
  assertEq('_pickup and unknown properties survive', [out._pickup, out._repeatStart, out._custom], [true, true, 'x'])
  assertEq('the notes were transposed', out[0].degree, 7)
  assertEq('the new array carries no stray keys', Object.keys(out).sort(), ['0', '_custom', '_pickup', '_repeatStart'])

  const keyed = [Object.assign([one] as unknown as MeasureArray, { _key: 'C' })] as Measure[]
  assertEq('a _key equal to the source key is not carried over', '_key' in (transposeNoteObjects(keyed, 'C', 'D')[0] as MeasureArray), false)
})

// ============================================================================
// 16-17. MIDI: meter changes, the no-notes message
// ============================================================================

describe('16. MIDI: bars follow every time signature', () => {
  // notes are [pitch, start tick, duration ticks]; sigs [tick, beats, beat type]; ppq 480, one 4/4 bar = 1920
  const midiWith = (notes: Array<[number, number, number]>, sigs: Array<[number, number, number]>, keys: Array<[number, string]> = []) => {
    const midi = new Midi()
    for (const [ticks, n, d] of sigs) midi.header.timeSignatures.push({ ticks, timeSignature: [n, d] })
    for (const [ticks, key] of keys) midi.header.keySignatures.push({ ticks, key, scale: 'major' })
    const t = midi.addTrack()
    for (const [pitch, ticks, durationTicks] of notes) t.addNote({ midi: pitch, ticks, durationTicks })
    return midi
  }
  const timeSigs = (ms: MeasureArray[]) => ms.map(m => m._timeSig ?? null)

  const change = midiToJianpu(midiWith([[60, 0, 1920], [62, 1920, 1920], [64, 3840, 1440], [65, 5280, 1440]], [[0, 4, 4], [3840, 3, 4]]))
  assertEq('4/4 for two bars, then 3/4: 4-beat bars then 3-beat bars', fmtAll(change.measures), ['1/w', '2/w', '3/h.', '4/h.'])
  assertEq('_timeSig on the first measure of the new meter only', timeSigs(change.measures), [null, null, '3/4', null])
  assertEq('the header keeps the opening meter', change.timeStr, '4/4')

  const unsorted = midiToJianpu(midiWith([[60, 0, 1920], [62, 1920, 1920], [64, 3840, 1440]], [[3840, 3, 4], [0, 4, 4]]))
  assertEq('signatures given out of order are sorted', [fmtAll(unsorted.measures), unsorted.timeStr], [['1/w', '2/w', '3/h.'], '4/4'])

  const cut = midiToJianpu(midiWith([[60, 0, 1920], [62, 1920, 960], [64, 2880, 960], [65, 3840, 960]], [[0, 4, 4], [2880, 2, 4]]))
  assertEq('a bar the next signature cuts short ends there', fmtAll(cut.measures), ['1/w', '2/h', '3/h', '4/h'])
  assertEq('...and the new meter starts on the next bar', timeSigs(cut.measures), [null, null, '2/4', null])

  const pickup = midiToJianpu(midiWith([[67, 0, 480], [60, 480, 1920], [62, 2400, 1920]], [[0, 1, 4], [480, 4, 4]]))
  assertEq('a 1/4 bar before 4/4 is a pickup', [fmtAll(pickup.measures), pickup.measures.map(m => m._pickup ?? false)], [['5/q', '1/w', '2/w'], [true, false, false]])
  assertEq('...the header is the real meter and nothing marks a change', [pickup.timeStr, timeSigs(pickup.measures)], ['4/4', [null, null, null]])

  const sameTick = midiToJianpu(midiWith([[60, 0, 1440]], [[0, 3, 4], [0, 6, 8]]))
  assertEq('a later signature on the same tick wins', sameTick.timeStr, '6/8')

  const trailing = midiToJianpu(midiWith([[60, 0, 1920], [62, 3840, 1920]], [[0, 4, 4], [3840, 1, 4]]))
  assertEq('a 1-beat signature with nothing after it is ignored', [fmtAll(trailing.measures), timeSigs(trailing.measures)], [['1/w', '0/w', '2/w'], [null, null, null]])

  const silent = midiToJianpu(midiWith([[60, 0, 1920], [62, 3360, 1440]], [[0, 4, 4], [1920, 3, 4]]))
  assertEq('a silent bar of the new meter is one whole rest', [fmtAll(silent.measures), timeSigs(silent.measures)], [['1/w', '0/w', '2/h.'], [null, '3/4', null]])

  const tied = midiToJianpu(midiWith([[60, 0, 2400], [62, 2400, 960]], [[0, 4, 4], [1920, 3, 4]]))
  assertEq('a note across the meter change is cut and tied', fmtAll(tied.measures), ['1/w', '~1/q 2/h'])

  const keyed = midiToJianpu(midiWith([[60, 0, 1920], [62, 1920, 1440], [64, 3360, 1440], [65, 4800, 1440]], [[0, 4, 4], [1920, 3, 4]], [[0, 'C'], [3840, 'D']]))
  assertEq('a key change lands on the first bar at or after its tick, whatever the bar length', keyed.measures.map(m => m._key ?? null), [null, null, null, 'D'])

  const six8 = midiToJianpu(midiWith([[60, 0, 1440], [62, 1440, 1440], [64, 2880, 960], [65, 3840, 960]], [[0, 6, 8], [2880, 2, 4]]))
  assertEq('6/8 then 2/4', [fmtAll(six8.measures), timeSigs(six8.measures)], [['1/h.', '2/h.', '3/h', '4/h'], [null, null, '2/4', null]])
})

describe('17. MIDI: a file without a melody says so in Chinese', () => {
  const onlyDrums = new Midi()
  const d = onlyDrums.addTrack()
  d.channel = 9
  d.addNote({ midi: 36, ticks: 0, durationTicks: 120 })
  let message = ''
  try { midiToJianpu(onlyDrums) } catch (e) { message = (e as Error).message }
  assertEq('message', message, '这个 MIDI 里没有可转换的音符（打击乐轨不算）')
  let empty = ''
  try { midiToJianpu(new Midi()) } catch (e) { empty = (e as Error).message }
  assertEq('a file with no tracks says the same', empty, '这个 MIDI 里没有可转换的音符（打击乐轨不算）')
})

// @@SECTIONS@@

describe('Review: trailing rests stop at the bar, ties stop at silence', () => {
  const rounded = parseXml(`<measure number="1">${attrs(0, 4, 4, 4)}
    ${noteXml('C', 5, 16, 'whole', '<voice>1</voice>')}<backup><duration>16</duration></backup>
    ${noteXml('E', 4, 9, 'half', '<voice>2</voice>')}${noteXml('F', 4, 8, 'half', '<voice>2</voice>')}
  </measure>`)
  assertEq('a second voice that overshoots the bar adds no rest to a full one', fmtAll(rounded), ["1'/w"])

  const gap = parseXml(`<measure number="1">${attrs()}${noteXml('C', 5, 4, 'whole', TIE_START)}</measure>
    <measure number="2"></measure>
    <measure number="3">${noteXml('C', 5, 4, 'whole')}</measure>`)
  assertEq('a dangling tie does not reach over a silent bar', fmtAll(gap), ["1'/w", '0/w', "1'/w"])
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach(f => console.log(`  · ${f}`))
  process.exit(1)
}
