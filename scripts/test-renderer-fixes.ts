// Regression tests for the renderer / Route B editor audit fixes.
// Run via: npx tsx scripts/test-renderer-fixes.ts
//
// Pure functions only (renderJianpuSVG, editor helpers) — the React handlers in
// App.tsx are covered through the helpers they call (measureIdxFromOrigIdx,
// withNoteEdited).

import {
  serializeToText, parseFromText, computeOrigIdxMap, measureIdxFromOrigIdx, withNoteEdited,
} from '../src/lib/editor'
import { renderJianpuSVG, collapseRestRuns } from '../src/lib/renderer'
import type { Measure, MeasureArray, NoteObject } from '../src/types/score'

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

const render = (ms: Measure[], time = '4/4', mpl = 0, width = 800) =>
  renderJianpuSVG(ms, 'C', time, 'T', width, '', false, mpl)

const dataMs = (svg: string) => [...svg.matchAll(/data-m="(\d+)"/g)].map(m => parseInt(m[1]))
const distinct = (xs: number[]) => xs.filter((x, i) => xs.indexOf(x) === i)
const restMs = (svg: string) => [...svg.matchAll(/data-rest-m="(\d+)"/g)].map(m => parseInt(m[1]))
// Repeat-sign dots are the only r="2" circles
const repeatDots = (svg: string) => (svg.match(/<circle [^>]*r="2"/g) || []).length

// Per-note beam segments at one underline level. The first line's baseline is
// y = 100, so level l sits at y = 100 + 4 * l. Neighbouring notes in the same
// beam group touch (x2 of one === x1 of the next).
function beamSegs(svg: string, level: number): Array<[number, number]> {
  const y = 100 + 4 * level
  return [...svg.matchAll(new RegExp(`<line x1="([\\d.]+)" y1="${y}" x2="([\\d.]+)" y2="${y}"`, 'g'))]
    .map(m => [parseFloat(m[1]), parseFloat(m[2])] as [number, number])
}
const joined = (segs: Array<[number, number]>) =>
  segs.slice(0, -1).map((s, k) => Math.abs(s[1] - segs[k + 1][0]) < 0.01)

// ============================================================================

describe('1. Route A: data-m is not an array index', () => {
  // [A, wholeRest, B]: a lone whole rest does not advance data-m, so B is
  // data-m 1 but sits at array index 2 — the click handler used to read index 1
  const ms: Measure[] = [bar(), wholeRest(), bar({ _dynamic: 'f' })]
  const svg = render(ms)
  assertEq('data-m values rendered', distinct(dataMs(svg)), [0, 1])
  assertEq('data-m 0 → measure 0', measureIdxFromOrigIdx(ms, 0), 0)
  assertEq('data-m 1 → measure 2 (skips the rest)', measureIdxFromOrigIdx(ms, 1), 2)
  assertEq('unknown data-m → -1', measureIdxFromOrigIdx(ms, 7), -1)

  // `| [4] | 1 2 3 4 |`: the [4] block is ONE array entry but advances data-m by 4
  const p = parseFromText('| [4] | 1 2 3 4 |')
  assertEq('parsed as [block, measure]', p.measures.length, 2)
  assertEq('notes after [4] render as data-m 4', distinct(dataMs(render(p.measures))), [4])
  assertEq('data-m 4 → measure 1', measureIdxFromOrigIdx(p.measures, 4), 1)

  // Four separate whole rests collapse in the renderer to the same data-m space
  const four: Measure[] = [wholeRest(), wholeRest(), wholeRest(), wholeRest(), bar()]
  assertEq('collapsed run advances data-m by 4', distinct(dataMs(render(four))), [4])
  assertEq('data-m 4 → measure 4', measureIdxFromOrigIdx(four, 4), 4)

  // computeOrigIdxMap and the renderer must agree for every shape of score
  const shapes: Record<string, Measure[]> = {
    plain: [bar(), bar(), bar()],
    'rest in the middle': ms,
    'marked rests between notes': [bar(), wholeRest({ _dynamic: 'p' }), wholeRest({ _repeatEnd: true }), bar()],
    'rest run then marked rest': [wholeRest(), wholeRest(), wholeRest({ _direction: 'Fine' }), bar()],
    'multi-rest block': parseFromText('| 1 2 3 4 | [3] | 1 2 3 4 | 0--- | 0--- | 1 2 3 4 |').measures,
    'key change on a rest': [bar(), wholeRest({ _key: 'D' }), wholeRest(), bar()],
  }
  for (const [name, m] of Object.entries(shapes)) {
    const svg2 = render(m)
    const fromMap = [...computeOrigIdxMap(m).values()]
    assertEq(`lockstep: ${name}`, distinct(dataMs(svg2)), fromMap)
    // and each data-m round-trips to the measure that owns it
    const owners = fromMap.map(o => measureIdxFromOrigIdx(m, o))
    assertEq(`inverse: ${name}`, owners, [...computeOrigIdxMap(m).keys()])
  }
})

describe('2. Route A confirm preserves all measure metadata', () => {
  const m1 = bar({ _volta: 2, _timeSig: '3/4', _key: 'D', _repeatStart: true, _dynamic: 'mf', _wedge: 'cresc' })
  ;(m1 as unknown as Record<string, unknown>)._future = 'kept'
  const ms: Measure[] = [bar(), m1]
  const out = withNoteEdited(ms, 1, 2, { degree: 6, octave: 1 }) as MeasureArray[]
  const edited = out[1]
  assertEq('note patched', [edited[2].degree, edited[2].octave], [6, 1])
  assertEq('other notes untouched', [edited[0].degree, edited[1].degree, edited[3].degree], [1, 2, 4])
  assertEq('_volta', edited._volta, 2)
  assertEq('_timeSig', edited._timeSig, '3/4')
  assertEq('_key', edited._key, 'D')
  assertEq('_repeatStart / _dynamic / _wedge', [edited._repeatStart, edited._dynamic, edited._wedge], [true, 'mf', 'cresc'])
  assertEq('unknown future _ field', (edited as unknown as Record<string, unknown>)._future, 'kept')
  assertEq('other measure is the same object', out[0], ms[0])
  assertEq('source measure not mutated', (ms[1] as MeasureArray)[2].degree, 3)
  assertEq('out-of-range note index is a no-op', withNoteEdited(ms, 1, 9, { degree: 5 })[1], ms[1])
})

describe('4. SVG injection: header / labels are escaped', () => {
  const evil = '<img src=x onerror=alert(1)>'
  const m = [bar({ _timeSig: '<b>3/4</b>', _key: '"><script>' })]
  const svg = renderJianpuSVG(m, evil, evil + '/4', 'T', 800, '<b>1</b>&', false)
  assertEq('no raw <img', svg.includes('<img'), false)
  assertEq('no raw <b>', svg.includes('<b>'), false)
  assertEq('no raw <script', svg.includes('<script'), false)
  assertEq('header text is entity-escaped', svg.includes('Key: 1=&lt;img src=x onerror=alert(1)&gt;'), true)
  assertEq('tempo is entity-escaped', svg.includes('Tempo: &lt;b&gt;1&lt;/b&gt;&amp;'), true)
  assertEq('_key label escaped', svg.includes('1=&quot;&gt;&lt;script&gt;'), true)
  assertEq('_timeSig label escaped', svg.includes('&lt;b&gt;3/4&lt;/b&gt;'), true)
})

describe('5. Whole-rest measures keep their markings', () => {
  const R = (m: Measure[]) => collapseRestRuns(m).map(x => (Array.isArray(x) ? 'm' : (x as { _multiRest: number })._multiRest))
  assertEq('plain rests still collapse', R([wholeRest(), wholeRest()]), [2])
  for (const meta of [
    { _repeatStart: true }, { _repeatEnd: true }, { _dynamic: 'p' }, { _wedge: 'dim' as const },
    { _direction: 'Fine' }, { _key: 'D' }, { _volta: 1 }, { _timeSig: '3/4' },
  ] as Meta[]) {
    assertEq(`${Object.keys(meta)[0]} keeps the rest as its own measure`, R([wholeRest(meta), wholeRest()]), ['m', 'm'])
  }

  // The audit's repros
  let p = parseFromText('|: 1 1 1 1 | &p 0--- | 0--- :|')
  let svg = render(p.measures)
  assertEq('|: … :| around rests → both repeat signs (4 dots)', repeatDots(svg), 4)
  assertEq('&p on a rest measure is drawn', />p<\/text>/.test(svg), true)
  assertEq('computeOrigIdxMap agrees with the renderer', distinct(dataMs(svg)), [...computeOrigIdxMap(p.measures).values()])

  p = parseFromText('|: 1 2 3 4 | 0--- :|')
  svg = render(p.measures)
  assertEq('|: 1 2 3 4 | 0--- :| → 4 dots', repeatDots(svg), 4)
  assertEq('closing repeat sign replaces the plain barline (one thick line at x of :|)',
    (svg.match(/stroke-width="3"/g) || []).length, 2)

  p = parseFromText('| 1 2 3 4 | 0--- ||&fine')
  svg = render(p.measures)
  assertEq('Fine text on a rest measure', />Fine<\/text>/.test(svg), true)

  p = parseFromText('| 1 2 3 4 | < 0--- | 1 2 3 4 ! |')
  svg = render(p.measures)
  assertEq('hairpin on the rest measure (2 wedge lines)', (svg.match(/opacity="0.7"/g) || []).length >= 4, true)

  // The serializer keeps the same rests separate instead of folding them into [N]
  const text = serializeToText([wholeRest({ _dynamic: 'p' }), wholeRest({ _repeatEnd: true }), wholeRest()], 'C', '4/4', '')
  assertEq('marked rests are not folded into [N]', text.includes('['), false)
  assertEq('text round-trips with markings', parseFromText(text).measures.map(m => [(m as MeasureArray)._dynamic, (m as MeasureArray)._repeatEnd]),
    [['p', false], ['', true], ['', false]])
})

describe('6. Beam groups survive tuplet float drift', () => {
  // 6 sextuplet 16ths = exactly one beat, but 0.25 * (2/3) * 6 = 0.9999999999999999,
  // so the next note floored into the previous beat and was beamed to it
  const sextuplet = render(parseFromText('| ~6 1// 2// 3// 4// 5// 6// 7/ 1/ 2 3 |').measures)
  const l1 = beamSegs(sextuplet, 1)
  assertEq('level-1 beam joins the six 16ths', joined(l1).slice(0, 5), [true, true, true, true, true])
  assertEq('…and breaks before the next beat', joined(l1)[5], false)
  assertEq('the following two eighths are joined', joined(l1)[6], true)

  // Same for 7 in the time of 4
  const septuplet = render(parseFromText('| ~7 1// 2// 3// 4// 5// 6// 7// 1/ 2/ 3 |').measures)
  const s1 = beamSegs(septuplet, 1)
  assertEq('septuplet: break after the 7th note', joined(s1).slice(0, 7), [true, true, true, true, true, true, false])
})

describe('7. A note that ends one slur and starts the next', () => {
  const ms: Measure[] = [measure([
    note({ degree: 1, slurStart: true }),
    note({ degree: 2, slurStop: true, slurStart: true }),
    note({ degree: 3 }),
    note({ degree: 4, slurStop: true }),
  ])]
  const arcs = [...render(ms).matchAll(/<path d="M ([\d.]+),[\d.-]+ Q [\d.]+,[\d.-]+ ([\d.]+),/g)]
    .map(m => [parseFloat(m[1]), parseFloat(m[2])])
  assertEq('two arcs drawn', arcs.length, 2)
  assertEq('first arc ends where the second begins (same note)', Math.abs(arcs[0][1] - 10 - arcs[1][0]) < 12, true)
  assertEq('both arcs have positive length', arcs.every(a => a[1] > a[0]), true)

  const text = serializeToText(ms, 'C', '4/4', '')
  console.log(`  text: ${text.split('\n')[1]}`)
  const back = parseFromText(text).measures[0] as MeasureArray
  assertEq('serializer keeps both arcs through a round-trip', back.map(n => [+n.slurStart, +n.slurStop]), [[1, 0], [1, 1], [0, 0], [0, 1]])

  // Back-to-back slurs on different notes still serialize the plain way
  const plain: Measure[] = [measure([
    note({ slurStart: true }), note({ degree: 2, slurStop: true }), note({ degree: 3, slurStart: true }), note({ degree: 4, slurStop: true }),
  ])]
  assertEq('( 1 2 ) ( 3 4 ) unchanged', serializeToText(plain, 'C', '4/4', '').split('\n')[1], '| ( 1 2 ) ( 3 4 ) ||')
})

describe('8. Compound meters beam in groups of three eighths', () => {
  const six = render(parseFromText('| 1/ 2/ 3/ 4/ 5/ 6/ ||').measures, '6/8')
  assertEq('6/8: 123 | 456', joined(beamSegs(six, 1)), [true, true, false, true, true])
  const nine = render(parseFromText('| 1/ 2/ 3/ 4/ 5/ 6/ 7/ 1/ 2/ ||').measures, '9/8')
  assertEq('9/8: 123 | 456 | 789', joined(beamSegs(nine, 1)), [true, true, false, true, true, false, true, true])
  const twelve = render(parseFromText('| 1// 2// 3// 4// 5// 6// 7// 1// 2// 3// 4// 5// 6// 7// 1// 2// 3// 4// 5// 6// 7// 1// 2// 3// ||').measures, '12/8')
  assertEq('12/8: level-1 beam breaks only at the 3-eighth boundaries', joined(beamSegs(twelve, 1)).map((j, k) => (k + 1) % 6 === 0 ? !j : j).every(Boolean), true)

  // Simple meters are untouched: 4/4 eighths pair up per beat, 3/4 too
  const four = render(parseFromText('| 1/ 2/ 3/ 4/ 5 6 ||').measures)
  assertEq('4/4 eighths: pairs per beat', joined(beamSegs(four, 1)), [true, false, true])
  const three = render(parseFromText('| 1/ 2/ 3/ 4/ 5 ||').measures, '3/4')
  assertEq('3/4 eighths: pairs per beat', joined(beamSegs(three, 1)), [true, false, true])

  // A mid-piece @6/8 switches grouping from that measure on
  const mid: Measure[] = [
    measure([note({ type: 'eighth' }), note({ type: 'eighth' }), note({ type: 'eighth' }), note({ type: 'eighth' }), note(), note()]),
    measure(Array.from({ length: 6 }, () => note({ type: 'eighth' })), { _timeSig: '6/8' }),
  ]
  const midSegs = beamSegs(render(mid), 1)
  assertEq('4/4 measure pairs, then 6/8 measure triples', joined(midSegs).slice(0, 4), [true, false, true, false])
  assertEq('6/8 measure after the switch', joined(midSegs).slice(4), [true, true, false, true, true])

  // Whole-bar rest: one symbol per beat of the meter. 6/8 beats are dotted quarters, so two
  // dotted 0s (it used to be six plain ones, as if 6/4) — see test-audit2-renderer.ts item 13
  const rest68 = render([wholeRest()], '6/8')
  assertEq('6/8 whole rest draws two dotted 0s', (rest68.match(/>0<\/text>/g) || []).length, 2)
})

describe('9/10. Rest highlight indices: editor and renderer agree', () => {
  const sets = (text: string) => {
    const p = parseFromText(text)
    const fromEditor = distinct(p.positions.filter(x => x.restMeasureIdx !== undefined).map(x => x.restMeasureIdx as number))
    return { fromEditor, fromSvg: distinct(restMs(render(p.measures))) }
  }
  // audit repro: a collapsed run in front used to shift every later rest by one
  let r = sets('| 0--- | 0--- | 1 2 3 4 | 0--- |')
  assertEq('collapsed run + later rest: same indices', r.fromEditor, [0, 3])
  assertEq('renderer emits the same indices', r.fromSvg, [0, 3])
  r = sets('| [4] | 0--- | 1 2 3 4 | 0--- |')
  assertEq('after a [4] block, editor indices are in the SAME space as the renderer', r.fromEditor.every(i => r.fromSvg.includes(i)), true)
  r = sets('| 1 2 3 4 | 0--- | 0--- | 0--- | 1 2 3 4 | 0--- :|')
  assertEq('3-rest run reports the run start for every rest in it', r.fromEditor, [1, 5])
  assertEq('…and the renderer matches', r.fromSvg, [1, 5])
  // Every rest in a collapsed run maps to the group the renderer drew
  const p = parseFromText('| 0--- | 0--- | 0--- |')
  assertEq('each of three rests → run start 0', p.positions.map(x => x.restMeasureIdx), [0, 0, 0])
})

describe('11. Header regexes stay on their own line', () => {
  let p = parseFromText('Title: Tempo: 60 Key: G study\nKey: C   Time: 4/4\n| 1 |')
  assertEq('title keeps the whole line', p.titleStr, 'Tempo: 60 Key: G study')
  assertEq('key from its own line', p.keyStr, 'C')
  assertEq('tempo untouched', p.tempoStr, '')
  p = parseFromText('Title: Key: G Time: 3/4 Tempo: 99\n| 1 |', 'D', '2/4', '50')
  assertEq('a Title-only header leaves key/time/tempo at their fallbacks', [p.keyStr, p.timeStr, p.tempoStr], ['D', '2/4', '50'])
  p = parseFromText('Title: Sonata\nKey: Bb   Time: 6/8   Tempo: 90\n| 1 |')
  assertEq('normal header still parses', [p.titleStr, p.keyStr, p.timeStr, p.tempoStr], ['Sonata', 'Bb', '6/8', '90'])
  p = parseFromText('Key: G\nTime: 3/4\nTempo: 80\n| 1 |')
  assertEq('one field per line still parses', [p.keyStr, p.timeStr, p.tempoStr], ['G', '3/4', '80'])
})

describe('12. A mid-piece key change draws a 1=X label', () => {
  const ms: Measure[] = [bar(), bar({ _key: 'D' })]
  const svg = render(ms)
  assertEq('label drawn', />1=D<\/text>/.test(svg), true)
  assertEq('label is bold', /font-weight="600"[^>]*>1=D</.test(svg), true)

  // The label's width is reserved: the same measure sits 32px further right with _key
  const lastBarline = (s: string) => Math.max(...[...s.matchAll(/<line x1="([\d.]+)" y1="85" x2="\1" y2="105"/g)].map(m => parseFloat(m[1])))
  assertEq('key label pushes the measure right by its width', lastBarline(svg) - lastBarline(render([bar(), bar()])), 32)

  // …and counts toward the line's fixed width, so justified lines still end flush right
  const four = [bar(), bar({ _key: 'G' }), bar(), bar()]
  const barlinesAtRight = [...render(four, '4/4', 4, 1240).matchAll(/<line x1="([\d.]+)" y1="85" x2="\1" y2="105" stroke="[^"]+" stroke-width="1"\/>/g)]
    .map(m => Math.round(parseFloat(m[1])))
  assertEq('4 per line with a key label: closing barline on the right edge (1200)', Math.max(...barlinesAtRight), 1200)

  // Both labels together keep their order: key, then time signature
  const both = render([bar(), bar({ _key: 'D', _timeSig: '3/4' })])
  assertEq('1=D drawn before 3/4', both.indexOf('>1=D<') < both.indexOf('>3/4<'), true)

  // Route B has no syntax for it: the serializer must not invent one or crash
  const text = serializeToText(ms, 'C', '4/4', '')
  assertEq('no key-change token in the text', /1=D|\bD\b/.test(text.split('\n')[1]), false)
})

describe('13. Export font has fallbacks', () => {
  const svg = render([bar({ _dynamic: 'f', _direction: 'Fine' })])
  const fams = distinct([...svg.matchAll(/font-family="([^"]+)"/g)].map(m => m[1]).map(f => f.length))
  assertEq('one font stack everywhere', fams.length, 1)
  assertEq('no bare Inter', /font-family="Inter"/.test(svg), false)
  assertEq('ends in a generic family', /font-family="Inter, [^"]*sans-serif"/.test(svg), true)
})

describe('14. Beam lines vs chord digits / octave dots / line height', () => {
  const beamY = { eighth: 104, '16th': 108, '32nd': 112 } as const
  // Beam underlines at y + 4 per line (baseline 100) must clear the chord digit's
  // glyph top (baseline - 12) and the first low-octave dot (cy - 1.5)
  for (const type of ['eighth', '16th', '32nd'] as const) {
    const chord = render([measure([note({ type, chordNotes: [{ degree: 3, octave: 0, accidental: '' }] })])])
    const digitY = parseFloat(/<text x="[\d.-]+" y="([\d.-]+)"[^>]*font-size="16"[^>]*>3<\/text>/.exec(chord)![1])
    assertEq(`${type} chord digit sits below its beam lines`, digitY - 12 > beamY[type], true)

    const low = render([measure([note({ type, octave: -1 })])])
    const dotY = parseFloat(/<circle cx="[\d.-]+" cy="([\d.-]+)" r="1.5"/.exec(low)![1])
    assertEq(`${type} low-octave dot sits below its beam lines`, dotY - 1.5 > beamY[type], true)
  }
  // Quarter notes (no beams) are laid out exactly as before: row at +16, dot at +10
  const q = render([measure([note({ chordNotes: [{ degree: 3, octave: 0, accidental: '' }] })])])
  assertEq('quarter chord row unchanged (baseline + 16)', />3<\/text>/.test(q) && q.includes('y="116"'), true)
  assertEq('quarter low dot unchanged (baseline + 10)', render([measure([note({ octave: -1 })])]).includes('cy="110"'), true)

  // A line holding a chord stack starts the next line lower by that stack's height
  const numberY = (svg: string, n: number) =>
    parseFloat(new RegExp(`y="([\\d.-]+)" font-family="[^"]*" font-size="10" font-style="italic"[^>]*>${n}</text>`).exec(svg)![1])
  const plainLines = Array.from({ length: 5 }, () => bar())
  const chordLines = [measure([note({ chordNotes: [{ degree: 3, octave: 0, accidental: '' }, { degree: 5, octave: 0, accidental: '' }] }), note(), note(), note()]), bar(), bar(), bar(), bar()]
  assertEq('5th measure wraps to line 2 at y 150 without chords', numberY(render(plainLines), 5), 150)
  assertEq('two chord rows push line 2 down by 32', numberY(render(chordLines), 5), 150 + 32)
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
