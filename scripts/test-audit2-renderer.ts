// Regression tests for the second renderer audit (17 layout / drawing bugs).
// Run via: npx tsx scripts/test-audit2-renderer.ts
//
// Everything is asserted on the SVG string: positions are read back out of the
// markup, so a test fails when something is drawn in the wrong place, not when
// an internal helper is renamed. Baselines: the first staff sits at y = 100
// (no tempo) / 120 (tempo), lines are 80 apart, a note starts at x = 20.

import { computeOrigIdxMap } from '../src/lib/editor'
import { renderJianpuSVG } from '../src/lib/renderer'
import type { ChordNote, Measure, MeasureArray, NoteObject } from '../src/types/score'

let pass = 0
let fail = 0

function assertEq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}`)
    console.log(`    expected: ${e}`)
    console.log(`    actual:   ${a}`)
  }
}

// Floats out of the layout math (26.666…, stretched widths) compare within a hair
function assertNear(label: string, actual: number | number[], expected: number | number[], eps = 0.01) {
  const a = Array.isArray(actual) ? actual : [actual]
  const e = Array.isArray(expected) ? expected : [expected]
  const ok = a.length === e.length && a.every((v, i) => Math.abs(v - e[i]) <= eps)
  if (ok) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}`)
    console.log(`    expected: ${JSON.stringify(e)}`)
    console.log(`    actual:   ${JSON.stringify(a)}`)
  }
}

function describe(name: string, fn: () => void) {
  console.log(`\n── ${name} ──`)
  fn()
}

function note(p: Partial<NoteObject> = {}): NoteObject {
  return {
    degree: 1, octave: 0, type: 'quarter', dot: false, tie: false, rest: false,
    accidental: '', slurStart: false, slurStop: false, ...p,
  }
}

type Meta = Partial<MeasureArray>

function measure(notes: NoteObject[], meta: Meta = {}): MeasureArray {
  const arr = notes.slice() as unknown as MeasureArray
  arr._repeatStart = false
  arr._repeatEnd = false
  arr._direction = ''
  arr._dynamic = ''
  arr._wedge = null
  Object.assign(arr, meta)
  return arr
}

const wholeRest = (meta: Meta = {}) => measure([note({ rest: true, degree: 0, type: 'whole' })], meta)
const bar = (meta: Meta = {}) => measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })], meta)
const chord = (degree: number, octave = 0, accidental: ChordNote['accidental'] = ''): ChordNote => ({ degree, octave, accidental })

const render = (ms: Measure[], time = '4/4', mpl = 0, width = 800, tempo = '') =>
  renderJianpuSVG(ms, 'C', time, 'T', width, tempo, false, mpl)

// ── readers ────────────────────────────────────────────────────────────────
interface T { x: number; y: number; attrs: string; text: string }
const texts = (svg: string): T[] =>
  [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"([^>]*)>([^<]*)<\/text>/g)]
    .map(m => ({ x: parseFloat(m[1]), y: parseFloat(m[2]), attrs: m[3], text: m[4] }))
const sized = (svg: string, size: number) => texts(svg).filter(t => t.attrs.includes(`font-size="${size}"`))
const mainNotes = (svg: string) => texts(svg).filter(t => t.attrs.includes('class="jn-note"'))
const byText = (svg: string, s: string) => texts(svg).filter(t => t.text === s)
const circles = (svg: string, r: string) =>
  [...svg.matchAll(new RegExp(`<circle cx="([\\d.-]+)" cy="([\\d.-]+)" r="${r}"`, 'g'))]
    .map(m => ({ x: parseFloat(m[1]), y: parseFloat(m[2]) }))
const arcs = (svg: string) =>
  [...svg.matchAll(/<path d="M ([\d.-]+),([\d.-]+) Q ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)"/g)]
    .map(m => ({ x1: parseFloat(m[1]), y: parseFloat(m[2]), x2: parseFloat(m[5]) }))
// Thin barlines of the first line only (the final barline's thick twin sits 4px further right)
const lastBarline = (svg: string) =>
  Math.max(...[...svg.matchAll(/<line x1="([\d.]+)" y1="85" x2="\1" y2="105" stroke="[^"]+" stroke-width="1"\/>/g)].map(m => parseFloat(m[1])))
const dataMs = (svg: string) => [...svg.matchAll(/data-m="(\d+)"/g)].map(m => parseInt(m[1]))
const distinct = (xs: number[]) => xs.filter((x, i) => xs.indexOf(x) === i)
// The italic size-10 number printed at the start of a line
const lineNumbers = (svg: string) => texts(svg).filter(t => t.attrs.includes('font-size="10" font-style="italic"') && /^\d+$/.test(t.text))
const voltas = (svg: string) =>
  [...svg.matchAll(/<g class="jn-volta">\n?<line x1="([\d.]+)" y1="([\d.]+)"[^>]*\/>(?:\n<line [^>]*\/>\n<text x="([\d.]+)")?/g)]
    .map(m => ({ x1: parseFloat(m[1]), y: parseFloat(m[2]), labelX: m[3] === undefined ? null : parseFloat(m[3]) }))

// ============================================================================

describe('1. Header does not collide with the first measure number', () => {
  const plain = render([bar()])
  const tempo = render([bar()], '4/4', 0, 800, '120')
  const y = (svg: string, s: string) => texts(svg).find(t => t.text.startsWith(s))!.y
  assertEq('title y', y(plain, 'T'), 30)
  assertEq('key line y', y(plain, 'Key:'), 54)
  assertEq('tempo line y', y(tempo, 'Tempo:'), 71)
  // the staff must stay where it was: first barline top is baseline - 15
  assertEq('no tempo: staff baseline stays 100', /<line x1="20" y1="85" x2="20" y2="105"/.test(plain), true)
  assertEq('tempo: staff baseline stays 120', /<line x1="20" y1="105" x2="20" y2="125"/.test(tempo), true)
  // measure number: font 10 at baseline - 30; its glyph top is ~8 above that
  const num = (svg: string) => lineNumbers(svg)[0].y
  assertEq('measure number baselines', [num(plain), num(tempo)], [70, 90])
  assertEq('key line sits clear above the number', num(plain) - 8 > y(plain, 'Key:') + 3, true)
  assertEq('tempo line sits clear above the number', num(tempo) - 8 > y(tempo, 'Tempo:') + 3, true)
  assertEq('key line sits clear below the title', y(plain, 'Key:') - 12 > y(plain, 'T') + 6, true)
  assertEq('tempo line sits clear below the key line', y(tempo, 'Tempo:') - 11 > y(tempo, 'Key:') + 3, true)
})

describe('2. Volta label is pushed right of the measure number', () => {
  const eight = Array.from({ length: 10 }, (_, k) => bar(k === 9 ? { _volta: 1 } : {}))
  let v = voltas(render(eight, '4/4', 1))[0]
  assertEq('line start, 2-digit number (10): label 4 + 6×2 + 4 right of the bracket', v.labelX! - v.x1, 20)

  v = voltas(render([bar({ _volta: 1 }), bar()], '4/4', 1))[0]
  assertEq('line start, 1-digit number: 4 + 6 + 4', v.labelX! - v.x1, 14)

  v = voltas(render([bar(), bar({ _volta: 1 })], '4/4', 2))[0]
  assertEq('mid-line measure draws no number: label stays at +4', v.labelX! - v.x1, 4)

  // A pickup is not counted, so the first line prints no number to avoid
  v = voltas(render([bar({ _pickup: true, _volta: 1 }), bar()], '4/4', 2))[0]
  assertEq('pickup first measure prints no number: label stays at +4', v.labelX! - v.x1, 4)

  // The second measure of a joined bracket draws no label at all
  const joined = voltas(render([bar({ _volta: 1 }), bar({ _volta: 1 })], '4/4', 1))
  assertEq('joined volta: only the first one has a label', joined.map(x => x.labelX !== null), [true, false])
})

describe('3. A slur continued on the next line starts clear of the measure number', () => {
  // 2 per line; the slur opens on the last note of measure 2 (line 1) and closes in measure 3 (line 2)
  const m1 = measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4, slurStart: true })])
  const m2 = measure([note({ degree: 5 }), note({ degree: 6, slurStop: true }), note({ degree: 7 }), note({ degree: 1 })])
  const a = arcs(render([bar(), m1, m2, bar()], '4/4', 2))
  assertEq('two pieces: end of line 1, then line 2', a.map(x => x.y), [70, 150])
  assertEq('continued arc starts at startX + 22', a[1].x1, 42)
  assertEq('…and ends on the note', a[1].x2 > 42, true)

  // Stopping on the very first note of the next line must not draw a backwards arc
  const m2b = measure([note({ degree: 5, slurStop: true }), note({ degree: 6 }), note({ degree: 7 }), note({ degree: 1 })])
  const b = arcs(render([bar(), m1, m2b, bar()], '4/4', 2))
  assertEq('stop on the line\'s first note: every arc has a positive length', b.every(x => x.x2 > x.x1), true)
})

describe('4. Grace notes get their own room', () => {
  const g = (accidental: '' | '#' | 'b' = '') => ({ degree: 2, octave: 0, accidental })
  const withGrace = (extra: Partial<NoteObject> = {}, grace = g()) =>
    [measure([note({ graceNote: grace, ...extra }), note(), note(), note()])]
  const without = (extra: Partial<NoteObject> = {}) => [measure([note(extra), note(), note(), note()])]

  let svg = render(withGrace())
  assertEq('main digit shifts by the 14px of room (20 + 14 + 2)', mainNotes(svg)[0].x, 36)
  assertEq('the next note moves by the same amount', mainNotes(svg)[1].x, 76)
  assertEq('the bar is 14px wider', lastBarline(svg) - lastBarline(render(without())), 14)
  let gr = sized(svg, 11)[0]
  assertEq('the grace digit sits inside its room, right of the barline', gr.x >= 20 && gr.x + 6 < 36, true)

  svg = render(withGrace({}, g('#')))
  assertEq('a grace accidental adds 4 more', lastBarline(svg) - lastBarline(render(without())), 18)
  assertEq('main digit shifts by 18', mainNotes(svg)[0].x, 40)
  gr = sized(svg, 11)[0]
  const gAcc = sized(svg, 7)[0]
  assertEq('grace accidental and digit both inside the room', gAcc.x >= 20 && gr.x + 6 < 40 && gAcc.x < gr.x, true)

  // On the first note of the SECOND measure the grace must not cross into the previous bar
  const two = render([bar(), measure([note({ graceNote: g() }), note(), note(), note()])])
  const boundary = 20 + 160
  gr = sized(two, 11)[0]
  assertEq('grace of a bar\'s first note is right of the barline', gr.x >= boundary, true)

  // A rest or a tie draws no grace, so reserves nothing
  const restG = [measure([note({ rest: true, degree: 0, graceNote: g() }), note(), note(), note()])]
  const tieG = [measure([note({ tie: true, graceNote: g() }), note(), note(), note()])]
  assertEq('rest: no room reserved, none drawn', [lastBarline(render(restG)), sized(render(restG), 11).length], [180, 0])
  assertEq('tie: no room reserved, none drawn', [lastBarline(render(tieG)), sized(render(tieG), 11).length], [180, 0])

  // Everything that belongs to the note moves with the digit
  const loaded: Partial<NoteObject> = { dot: true, octave: 1, articulation: 'accent', chordNotes: [chord(5)] }
  const a = render(without(loaded))
  const b = render(withGrace(loaded))
  const shift = (x: number[], y: number[]) => x.map((v, i) => y[i] - v)
  assertEq('duration dot', shift(circles(a, '1.5').filter(c => c.y === 96).map(c => c.x), circles(b, '1.5').filter(c => c.y === 96).map(c => c.x)), [14])
  assertEq('octave dot', shift(circles(a, '1.5').filter(c => c.y === 82).map(c => c.x), circles(b, '1.5').filter(c => c.y === 82).map(c => c.x)), [14])
  assertEq('articulation', shift(byText(a, '&gt;').map(t => t.x), byText(b, '&gt;').map(t => t.x)), [14])
  assertEq('chord row', shift(sized(a, 16).map(t => t.x), sized(b, 16).map(t => t.x)), [14])
  const half = render([measure([note({ type: 'half', graceNote: g() }), note({ type: 'half' })])])
  const halfNo = render([measure([note({ type: 'half' }), note({ type: 'half' })])])
  assertNear('extension dash', byText(half, '-')[0].x - byText(halfNo, '-')[0].x, 14)
  const slurred = render([measure([note({ graceNote: g(), slurStart: true }), note(), note({ slurStop: true }), note()])])
  assertEq('slur anchor (20 + 14 + 2)', arcs(slurred)[0].x1, 36)
})

describe('5. Accidentals keep clear of the barline', () => {
  const svg = render([measure([note({ accidental: '#' }), note(), note(), note()])])
  assertEq('accidental at +2', texts(svg).find(t => t.text === '#')!.x, 22)
  assertEq('digit at +10', mainNotes(svg)[0].x, 30)
  assertEq('the note is 8 wider (was 6)', lastBarline(svg) - 180, 8)

  // Chord rows: one column for every digit when anything in the stack has an accidental
  const mixed = render([measure([note({ degree: 5, chordNotes: [chord(3), chord(1, 0, '#')] }), note(), note(), note()])])
  assertEq('rows share one column', distinct(sized(mixed, 16).map(t => t.x)), [30])
  assertEq('…and so does the main digit', mainNotes(mixed)[0].x, 30)
  assertEq('chord accidental at +2 of the column', sized(mixed, 9).map(t => t.x), [22])

  const mainAcc = render([measure([note({ degree: 5, accidental: 'b', chordNotes: [chord(3), chord(1)] }), note(), note(), note()])])
  assertEq('accidental on the main note only: rows still in the digit column', distinct(sized(mainAcc, 16).map(t => t.x)), [30])

  const none = render([measure([note({ degree: 5, chordNotes: [chord(3), chord(1)] }), note(), note(), note()])])
  assertEq('no accidental anywhere: digits stay at +2', distinct(sized(none, 16).map(t => t.x)), [22])
  assertEq('…and the bar is not wider', lastBarline(none), 180)

  const flat = render([measure([note({ degree: 5, accidental: 'b' }), note(), note(), note()])])
  assertEq('b is placed like #', texts(flat).find(t => t.text === 'b')!.x, 22)
})

describe('6. Chord rows start below a low-octave dot', () => {
  const rowsOf = (octave: number, extra: Partial<NoteObject> = {}) =>
    render([measure([note({ octave, chordNotes: [chord(3)], ...extra }), note(), note(), note()])])
  assertEq('octave 0: first row still at baseline + 16', sized(rowsOf(0), 16)[0].y, 116)
  assertEq('octave -1: pushed down by 6 + 4', sized(rowsOf(-1), 16)[0].y, 126)
  assertEq('octave -2: pushed down by 12 + 4', sized(rowsOf(-2), 16)[0].y, 132)
  assertEq('octave +1 (dots above): rows unmoved', sized(rowsOf(1), 16)[0].y, 116)

  const svg = rowsOf(-1)
  const dot = circles(svg, '1.5').find(c => c.y > 100)!
  assertEq('the dot is clear of the digit\'s glyph top', dot.y + 1.5 < sized(svg, 16)[0].y - 12, true)

  // 16ths: dots start under the 2nd beam line, rows under the dot
  const sixteenth = render([measure([note({ type: '16th', octave: -2, chordNotes: [chord(3)] })])])
  const lowestDot = Math.max(...circles(sixteenth, '1.5').map(c => c.y))
  assertEq('16th: row clears the deepest dot', sized(sixteenth, 16)[0].y - 12 > lowestDot + 1.5, true)

  // The next line and the dynamic mirror it: extent 10 + 16 = 26
  const number5 = (svg2: string) => lineNumbers(svg2).find(t => t.text === '5')!.y
  const five = (first: MeasureArray) => [first, bar(), bar(), bar(), bar()]
  const plain5 = number5(render(five(bar())))
  const lowRow = measure([note({ octave: -1, chordNotes: [chord(3)] }), note(), note(), note()])
  assertEq('line 2 starts 26 lower', number5(render(five(lowRow))) - plain5, 26)
  const plainRow = measure([note({ chordNotes: [chord(3)] }), note(), note(), note()])
  assertEq('(octave 0 chord: 16)', number5(render(five(plainRow))) - plain5, 16)
  const dyn = render([measure([note({ octave: -1, chordNotes: [chord(3)] }), note(), note(), note()], { _dynamic: 'mf' })])
  assertEq('dynamic text moves with it (122 + 26)', byText(dyn, 'mf')[0].y, 148)

  // A tie draws no dots of its own, so nothing to avoid
  const tie = render([measure([note({ tie: true, octave: -1, chordNotes: [chord(3)] })])])
  assertEq('tie: rows keep their normal start', sized(tie, 16)[0].y, 116)
})

describe('7. A dotted whole note draws 5 extension marks', () => {
  const dashes = (n: Partial<NoteObject>) => byText(render([measure([note({ type: 'whole', ...n })])]), '-').length
  assertEq('whole: 3', dashes({}), 3)
  assertEq('dotted whole: 5 (6 beats)', dashes({ dot: true }), 5)
  const half = (n: Partial<NoteObject>) => byText(render([measure([note({ type: 'half', ...n }), note({ type: 'half' })])]), '-').length
  assertEq('half: 1 (+ the other half note\'s own mark)', half({}), 2)
  assertEq('dotted half: 2', half({ dot: true }) - 1, 2)

  // (a lone whole rest is a whole-measure rest and draws the meter's row of 0s instead, so give it company)
  const rest = render([measure([note({ type: 'whole', dot: true, rest: true, degree: 0 }), note()])], '12/8')
  assertEq('dotted whole rest: the 0 plus 5 more', byText(rest, '0').length, 6)

  // They stay inside the note's own width and evenly spaced
  const svg = render([measure([note({ type: 'whole', dot: true })])])
  const xs = byText(svg, '-').map(t => t.x)
  const steps = xs.slice(1).map((x, i) => x - xs[i])
  assertEq('evenly spaced', steps.every(s => Math.abs(s - steps[0]) < 0.01), true)
  assertEq('inside the note', xs[xs.length - 1] < lastBarline(svg), true)
})

describe('8. A tied chord shows dashes in every row', () => {
  const tied = render([measure([note({
    tie: true, degree: 5, accidental: '#', octave: -1,
    chordNotes: [chord(3, -1, 'b'), chord(1, 1, '#')],
  })])])
  assertEq('main + 2 rows all draw -', byText(tied, '-').length, 3)
  assertEq('no chord digit left', sized(tied, 16).every(t => t.text === '-'), true)
  assertEq('no accidental', texts(tied).filter(t => ['#', 'b'].includes(t.text)).length, 0)
  assertEq('no octave dots', circles(tied, '1.5').length, 0)
  assertEq('rows at +16 and +32', sized(tied, 16).map(t => t.y), [116, 132])
  assertEq('rows in the plain column', distinct(sized(tied, 16).map(t => t.x)), [22])
})

describe('9. A rest never draws chord rows', () => {
  const stale = measure([note({ rest: true, degree: 0, chordNotes: [chord(3), chord(5)] }), note(), note(), note()])
  const svg = render([stale, bar(), bar(), bar(), bar()])
  assertEq('no chord row text', sized(svg, 16).length, 0)
  assertEq('line 2 is not pushed down (baseline 180)', lineNumbers(svg).find(t => t.text === '5')!.y, 150)
})

describe('10. Slurs: only ones that close are drawn', () => {
  const open = measure([note({ slurStart: true }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })])
  assertEq('a start with no end draws nothing, however many lines follow',
    arcs(render([open, bar(), bar(), bar(), bar()], '4/4', 2)).length, 0)

  const edited = measure([note({ slurStart: true }), note({ degree: 2 }), note({ degree: 0, rest: true, slurStop: true }), note({ degree: 4 })])
  assertEq('a stop edited into a rest: no arc', arcs(render([edited, bar(), bar(), bar()], '4/4', 2)).length, 0)

  const pair = measure([note({ slurStart: true }), note({ degree: 2 }), note({ degree: 3, slurStop: true }), note({ degree: 4 })])
  const unclosedThenPair = arcs(render([open, pair], '4/4', 0))
  assertEq('an unclosed start does not steal the next slur', unclosedThenPair.map(a => a.x1), [20 + 160 + 2])

  // Line wraps inside a multi-rest block carry the slur like any other wrap
  const stopLate = measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3, slurStop: true }), note({ degree: 4 })])
  const throughRests = arcs(render([measure([note({ slurStart: true }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 })]), { _multiRest: 3 }, stopLate], '4/4', 1))
  assertEq('three pieces, one per line', throughRests.map(a => a.y), [70, 150, 230])
  assertEq('line 1 from the note, later pieces from startX + 22', throughRests.map(a => a.x1), [22, 42, 42])

  // Same score, wrapped by width instead of by count
  const wide = measure([note({ degree: 1 }), note({ degree: 2 }), note({ degree: 3, slurStop: true }), note({ degree: 4 }), note({ degree: 5 }), note({ degree: 6 })])
  // (300 wide: the 240px first measure leaves no room for the 120px block, which leaves none for `wide`)
  const auto = arcs(render([measure([note({ slurStart: true }), note({ degree: 2 }), note({ degree: 3 }), note({ degree: 4 }), note({ degree: 5 }), note({ degree: 6 })]), { _multiRest: 3 }, wide], '4/4', 0, 300))
  assertEq('auto layout carries it through the block too', auto.map(a => a.y), [70, 150, 230])
})

describe('11. Tuplet bracket follows the real group length', () => {
  const brackets = (svg: string) => (svg.match(/class="jn-tuplet"/g) || []).length
  const bracketXs = (svg: string) => {
    const g = /<g class="jn-tuplet">\n<line x1="([\d.]+)"[^>]*\/>\n<line x1="[\d.]+" y1="[\d.]+" x2="([\d.]+)"/.exec(svg)
    return g ? [parseFloat(g[1]), parseFloat(g[2])] : []
  }
  // quarter + eighth under a 3: two notes close the group
  const qe = [measure([
    note({ type: 'quarter', tuplet: 3, tupletLen: 2 }), note({ type: 'eighth', tuplet: 3 }),
    note({ degree: 3 }), note({ degree: 4 }),
  ])]
  let svg = render(qe)
  assertEq('quarter + eighth triplet: one bracket', brackets(svg), 1)
  assertEq('its digit is the tuplet number', texts(svg).some(t => t.attrs.includes('font-style="italic"') && t.text === '3' && t.y === 75.5), true)
  assertNear('it spans exactly the two notes', bracketXs(svg), [22, 20 + 40 * (2 / 3) + 30 * (2 / 3) - 2], 0.5)

  // a plain triplet still waits for 3 notes; two notes then a normal one is no bracket
  const three = [measure([note({ type: 'eighth', tuplet: 3 }), note({ type: 'eighth', tuplet: 3 }), note({ type: 'eighth', tuplet: 3 }), note()])]
  assertEq('plain eighth triplet: one bracket', brackets(render(three)), 1)
  const short = [measure([note({ type: 'eighth', tuplet: 3 }), note({ type: 'eighth', tuplet: 3 }), note(), note()])]
  assertEq('group cut short by a normal note: none', brackets(render(short)), 0)
  const cutByBar = [measure([note(), note(), note({ type: 'eighth', tuplet: 3 }), note({ type: 'eighth', tuplet: 3 })]), bar()]
  assertEq('group cut short by the barline: none', brackets(render(cutByBar)), 0)

  // two groups back to back
  const twoGroups = [measure([
    note({ type: 'quarter', tuplet: 3, tupletLen: 2 }), note({ type: 'eighth', tuplet: 3 }),
    note({ type: 'quarter', tuplet: 3, tupletLen: 2 }), note({ type: 'eighth', tuplet: 3 }),
  ])]
  svg = render(twoGroups)
  assertEq('two groups: two brackets', brackets(svg), 2)
})

describe('12. Unpitched notes are drawn X', () => {
  const svg = render([measure([note({ degree: 0, octave: -2 }), note({ degree: 0, rest: true }), note({ degree: 0, tie: true }), note({ degree: 5 })])])
  assertEq('X for the unpitched hit', mainNotes(svg).map(t => t.text), ['X', '0', '-', '5'])
  assertEq('no octave dots for it', circles(svg, '1.5').length, 0)
  const high = render([measure([note({ degree: 0, octave: 2 })])])
  assertEq('…whichever way the octave points', circles(high, '1.5').length, 0)
})

describe('13. Whole-measure rest symbols follow the meter', () => {
  const zeros = (svg: string) => byText(svg, '0')
  const underlines = (svg: string, level: number) =>
    [...svg.matchAll(new RegExp(`<line x1="[\\d.]+" y1="${100 + 4 * level}" x2="[\\d.]+" y2="${100 + 4 * level}"`, 'g'))].length
  const dots = (svg: string) => circles(svg, '1.5').filter(c => c.y === 96).length
  const rows: Array<[string, number, number, number[]]> = [
    // meter, zeros, duration dots, underlines at level 1/2/3
    ['4/4', 4, 0, [0, 0, 0]],
    ['3/4', 3, 0, [0, 0, 0]],
    ['2/2', 4, 0, [0, 0, 0]],
    ['3/2', 6, 0, [0, 0, 0]],
    ['4/1', 16, 0, [0, 0, 0]],
    ['6/8', 2, 2, [0, 0, 0]],
    ['9/8', 3, 3, [0, 0, 0]],
    ['12/8', 4, 4, [0, 0, 0]],
    ['3/8', 1, 1, [0, 0, 0]],
    ['5/8', 5, 0, [5, 0, 0]],
    ['3+2/8', 5, 0, [5, 0, 0]],
    ['7/8', 7, 0, [7, 0, 0]],
    ['3/16', 3, 0, [3, 3, 0]],
    ['3/32', 3, 0, [3, 3, 3]],
  ]
  for (const [meter, z, d, u] of rows) {
    const svg = render([wholeRest()], meter)
    assertEq(`${meter}: ${z} zeros, ${d} dots, underlines ${u.join('/')}`, [zeros(svg).length, dots(svg), [1, 2, 3].map(l => underlines(svg, l))], [z, d, u])
  }

  // evenly spread over the measure, inside the rest group
  const six = render([wholeRest()], '6/8')
  assertNear('6/8: two zeros half a bar apart', zeros(six).map(t => t.x), [22, 102])
  const group = /<g class="jn-rest-group"[^>]*>([\s\S]*?)<\/g>/.exec(six)![1]
  assertEq('…all inside the jn-rest-group', (group.match(/>0<\/text>/g) || []).length, 2)
  assertEq('…and their dots too', (group.match(/r="1.5"/g) || []).length, 2)

  // a mid-piece @6/8 changes what the rest looks like from there on
  const mid = render([bar(), wholeRest({ _timeSig: '6/8' })])
  assertEq('@6/8 on a rest measure: two dotted zeros', [zeros(mid).length, dots(mid)], [2, 2])
  // the bar numbers don't change by meter
  assertEq('beats in the header read with the shared meter parser', zeros(render([wholeRest()], '3+2/8')).length, 5)
})

describe('14. A pickup measure is not counted', () => {
  const nums = (ms: Measure[]) => lineNumbers(render(ms, '4/4', 4, 1240)).map(t => t.text)
  const eight = (first: Meta) => [bar(first), ...Array.from({ length: 7 }, () => bar())]
  assertEq('without a pickup: 1 and 5', nums(eight({})), ['1', '5'])
  assertEq('with a pickup: no number on line 1, 4 on line 2', nums(eight({ _pickup: true })), ['4'])
  assertEq('number 0 is never printed', nums(eight({ _pickup: true })).includes('0'), false)
  // data-m is a different index space and must not move
  assertEq('data-m unaffected', distinct(dataMs(render(eight({ _pickup: true })))), [0, 1, 2, 3, 4, 5, 6, 7])
})

describe('15. A hairpin pushes the next line down', () => {
  const five = (first: MeasureArray) => [first, bar(), bar(), bar(), bar()]
  const num5 = (ms: Measure[]) => lineNumbers(render(ms)).find(t => t.text === '5')!.y
  assertEq('no hairpin: line 2 at 150', num5(five(bar())), 150)
  assertEq('cresc on line 1: 8 lower', num5(five(bar({ _wedge: 'cresc' }))), 158)
  assertEq('dim on line 1: 8 lower', num5(five(bar({ _wedge: 'dim' }))), 158)
  const stack = measure([note({ chordNotes: [chord(3), chord(5)] }), note(), note(), note()])
  assertEq('chords alone: 32 lower (unchanged)', num5(five(stack)), 182)
  stack._wedge = 'cresc'
  assertEq('chords under the same hairpin: 32 + 8', num5(five(stack)), 190)
  // not the whole line: only the measure carrying a hairpin needs the room
  const chordsElsewhere = [bar({ _wedge: 'cresc' }), measure([note({ chordNotes: [chord(3), chord(5)] }), note(), note(), note()]), bar(), bar(), bar()]
  assertEq('hairpin and chords in different measures: the deeper one wins', num5(chordsElsewhere), 182)

  // The next line's volta bracket no longer touches it
  const ms = [bar({ _wedge: 'cresc' }), bar(), bar(), bar(), bar({ _volta: 1 })]
  const svg = render(ms)
  const hairpinBottom = Math.max(...[...svg.matchAll(/<line x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)"[^>]*opacity="0.7"/g)].flatMap(m => [parseFloat(m[1]), parseFloat(m[2])]))
  assertEq('hairpin bottom (baseline + 35)', hairpinBottom, 135)
  assertEq('volta line is at least 8 clear below it', voltas(svg)[0].y - hairpinBottom >= 8, true)

  // totalHeight rules are untouched
  const height = (svg2: string) => parseInt(/height="(\d+)"/.exec(svg2)![1])
  assertEq('a one-line score with a hairpin keeps baseline + 40', height(render([bar({ _wedge: 'cresc' })])), 140)
})

describe('16. A multi-rest block with no length does not crash', () => {
  const base = [bar(), bar()]
  const expected = render(base)
  for (const [label, block] of [
    ['_multiRest: 0', { _multiRest: 0 }],
    ['_multiRest: -3', { _multiRest: -3 }],
    ['_multiRest: NaN', { _multiRest: NaN }],
    ['no _multiRest at all', {}],
  ] as Array<[string, unknown]>) {
    let out = ''
    let threw = ''
    try { out = render([base[0], block as Measure, base[1]]) } catch (e) { threw = (e as Error).message }
    assertEq(`${label}: no throw`, threw, '')
    assertEq(`${label}: draws and takes nothing`, out, expected)
  }
  let threw = ''
  try { render([bar(), null as unknown as Measure, bar()]) } catch (e) { threw = (e as Error).message }
  assertEq('null entry: no throw', threw, '')

  // Zero-length blocks are not items: 4 per line is still 4 per line
  const six = [bar(), { _multiRest: 0 } as Measure, bar(), bar(), bar(), bar()]
  assertEq('line planning is unchanged', render(six, '4/4', 4, 1240), render(six.filter((_, i) => i !== 1), '4/4', 4, 1240))
  assertEq('…and the closing barline is on the last real measure', render([bar(), { _multiRest: 0 } as Measure], '4/4'), render([bar()]))

  // data-m stays in lockstep with the editor's index map
  const lock = [bar(), { _multiRest: 0 } as Measure, bar()]
  assertEq('data-m matches computeOrigIdxMap', distinct(dataMs(render(lock))), [...computeOrigIdxMap(lock).values()])
  // …and a real block still counts N
  const real = [bar(), { _multiRest: 3 } as Measure, bar()]
  assertEq('a real [3] block still advances data-m by 3', distinct(dataMs(render(real))), [0, 4])
  assertEq('…in step with computeOrigIdxMap', distinct(dataMs(render(real))), [...computeOrigIdxMap(real).values()])
})

describe('17. Articulations clear every octave dot', () => {
  const accentY = (octave: number) => byText(render([measure([note({ octave, articulation: 'accent' })])]), '&gt;')[0].y
  assertEq('octave 0..4', [0, 1, 2, 3, 4].map(accentY), [80, 74, 68, 62, 56])
  for (const o of [3, 4]) {
    const svg = render([measure([note({ octave: o, articulation: 'accent' })])])
    const topDot = Math.min(...circles(svg, '1.5').map(c => c.y))
    assertEq(`octave ${o}: the mark sits above the topmost dot`, accentY(o) < topDot - 1.5, true)
  }
  const fermata = render([measure([note({ octave: 3, articulation: 'fermata' })])])
  const arc = /<path d="M [\d.]+,([\d.]+) Q/.exec(fermata)
  assertEq('fermata follows the same rule', arc && parseFloat(arc[1]) < Math.min(...circles(fermata, '1.5').map(c => c.y)) - 1.5, true)
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
