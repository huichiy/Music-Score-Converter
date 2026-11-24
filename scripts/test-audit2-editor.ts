// Regression tests for the second audit of the Route B text editor (editor.ts) and
// the edit-note logic. The React handlers (IME guard, empty-save guard, backdrop close)
// are not covered here: they have no pure seam, they were checked in the browser.
// Run via: npx tsx scripts/test-audit2-editor.ts

import {
  serializeToText, parseFromText, withNoteEdited, editedNote, measureIdxFromOrigIdx,
} from '../src/lib/editor'
import { renderJianpuSVG } from '../src/lib/renderer'
import { isUnpitched } from '../src/types/score'
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
const measure = (notes: NoteObject[], meta: Partial<MeasureArray> = {}): MeasureArray => {
  const arr = notes.slice() as unknown as MeasureArray
  arr._repeatStart = false
  arr._repeatEnd = false
  arr._direction = ''
  arr._dynamic = ''
  arr._wedge = null
  return Object.assign(arr, meta)
}
const bar = (meta: Partial<MeasureArray> = {}) => measure([1, 2, 3, 4].map(d => note({ degree: d })), meta)

const parse = (text: string) => parseFromText(text)
const ms = (text: string) => parse(text).measures
const isMeasure = (m: Measure): m is MeasureArray => Array.isArray(m)
// One line per measure: degrees ('0' = rest, 'X' = unpitched), + the marks that matter here
function shape(measures: Measure[]): string[] {
  return measures.map(m => {
    if (!isMeasure(m)) return `[${(m as { _multiRest: number })._multiRest}]`
    const notes = m.map(n => n.rest ? '0' : isUnpitched(n) ? 'X' : String(n.degree)).join('')
    const marks = [
      m._repeatStart && '|:', m._repeatEnd && ':|', m._direction && `&${m._direction}`,
      m._dynamic && `&${m._dynamic}`, m._wedge && m._wedge, m._volta !== undefined && `{${m._volta}}`,
      m._timeSig && `@${m._timeSig}`, m._pickup && 'pickup',
    ].filter(Boolean).join(' ')
    return marks ? `${notes} ${marks}` : notes
  })
}
const bodyOf = (measures: Measure[], time = '4/4') => serializeToText(measures, 'C', time, '', '').split('\n').slice(1).join('\n')

// Every position must land on the note it names (cursor sync reads both index spaces)
function positionsAgree(text: string): boolean {
  const p = parse(text)
  return p.positions.every(pos => {
    if (pos.measureIdx < 0) return true
    const mi = measureIdxFromOrigIdx(p.measures, pos.measureIdx)
    const m = p.measures[mi]
    const n = isMeasure(m) ? m[pos.noteIdx] : undefined
    if (!n) return false
    const src = text.slice(pos.start, pos.end)
    return n.rest ? src.startsWith('0') : isUnpitched(n) ? /^[Xx]/.test(src) : src.includes(String(n.degree))
  })
}

// ============================================================================

describe('1. a title with a line break stays one header line', () => {
  const text = serializeToText([bar()], 'C', '4/4', '120', '望春風\n胡阮')
  assertEq('Title line is cleaned', text.split('\n')[0], 'Title: 望春風 胡阮')
  const p = parse(text)
  assertEq('time and tempo are read as fields, not notes', [p.titleStr, p.timeStr, p.tempoStr, shape(p.measures)], ['望春風 胡阮', '4/4', '120', ['1234']])
  assertEq('a title of only whitespace writes no Title line', serializeToText([bar()], 'C', '4/4', '', ' \n ').startsWith('Key:'), true)
})

describe('2. header lines go through the shared reader', () => {
  const p = parse('key: 1=G   time: 3/4   tempo: ♩=96\n| 1 2 3 |')
  assertEq('lower case, 1=G, ♩=96', [p.keyStr, p.timeStr, p.tempoStr, shape(p.measures)], ['G', '3/4', '96', ['123']])
  assertEq('♭B and leading spaces', parse('  Key: ♭B\n| 1 |').keyStr, 'Bb')
  assertEq('full-width colon', parse('Key：D\n| 1 |').keyStr, 'D')
  const gap = parse('Title: a\n\n\nKey: D\n\n\nTime: 2/4\n\n| 1 2 |')
  assertEq('blank lines between headers do not count toward the 4', [gap.titleStr, gap.keyStr, gap.timeStr, shape(gap.measures)], ['a', 'D', '2/4', ['12']])
  const five = parse('Key: D\nTime: 2/4\nTempo: 90\nTitle: x\nKey: G\n| 1 2 |')
  assertEq('at most 4 header lines', [five.keyStr, five.titleStr], ['D', 'x'])
  const none = parseFromText('| 1 2 3 4 |', 'G', '3/4', '90', 'T')
  assertEq('no header: the fallbacks stand', [none.keyStr, none.timeStr, none.tempoStr, none.titleStr], ['G', '3/4', '90', 'T'])
  const partial = parseFromText('Tempo: 80\n| 1 |', 'G', '3/4', '90', 'T')
  assertEq('a field that is absent keeps its fallback', [partial.keyStr, partial.timeStr, partial.tempoStr, partial.titleStr], ['G', '3/4', '80', 'T'])
  assertEq('a Title line is all title', parse('Title: Key: G study\n| 1 |').titleStr, 'Key: G study')
  assertEq('"Time: 4/4" never becomes notes', shape(parse('Time: 4/4\nKey: C\n| 1 |').measures), ['1'])
})

describe('3. [0] and huge [N]', () => {
  const p = parse('| [0] | 1 2 3 4 |')
  assertEq('[0] is ignored', shape(p.measures), ['1234'])
  assertEq('and the renderer survives it', renderJianpuSVG(p.measures, 'C', '4/4', 'T', 600, '', false).includes('<svg'), true)
  assertEq('[5000] is capped at 999', (ms('| [5000] |')[0] as { _multiRest: number })._multiRest, 999)
  assertEq('[999] stays', (ms('| [999] |')[0] as { _multiRest: number })._multiRest, 999)
  assertEq('a plain [4] is still one block', shape(ms('| [4] | 1 |')), ['[4]', '1'])
})

describe('4. markings around [N] survive', () => {
  assertEq('repeat start before [N]', shape(ms('|: [4] | 1 2 3 4 :|')), ['0 |:', '[3]', '1234 :|'])
  assertEq('…with N = 2 the rest is a plain measure', shape(ms('|: [2] |')), ['0 |:', '0'])
  assertEq('…with N = 1 there is only the marked one', shape(ms('|: [1] |')), ['0 |:'])
  assertEq('time signature before [N]', shape(ms('| 1 2 3 4 | @3/4 [4] |')), ['1234', '0 @3/4', '[3]'])
  assertEq('dynamic before [N]', shape(ms('| &f [4] |')), ['0 &f', '[3]'])
  assertEq('repeat start + time signature + dynamic together', shape(ms('|: @3/4 &p [3] |')), ['0 |: &p @3/4', '[2]'])
  assertEq('volta before [N] marks all of them', shape(ms('| {1} [3] |')), ['0 {1}', '0 {1}', '0 {1}'])
  assertEq('volta then repeat end', shape(ms('| {1} [2] :|')), ['0 {1}', '0 :| {1}'])
  assertEq('an active hairpin goes through the rests', shape(ms('| < 1 2 3 4 | [2] | 5 6 7 1 ! |')), ['1234 cresc', '0 cresc', '0 cresc', '5671 cresc'])
  assertEq('a hairpin opened right before [N]', shape(ms('| < [2] | 1 ! |')), ['0 cresc', '0 cresc', '1 cresc'])
  assertEq('repeat end right after [N] goes on the last rest', shape(ms('| [4] :|')), ['[3]', '0 :|'])
  assertEq('…also for a block of 2', shape(ms('| [2] :|')), ['0', '0 :|'])
  assertEq('…and a block of 1', shape(ms('| [1] :|')), ['0 :|'])
  assertEq('direction right after [N]', shape(ms('| [4] ||&fine')), ['[3]', '0 &Fine'])
  assertEq(':|&dc right after [N]', shape(ms('| [3] :|&dc')), ['[2]', '0 :| &D.C.'])
  assertEq('a bare [4] with nothing before it is unchanged', shape(ms('[4] | 1 |')), ['[4]', '1'])
  assertEq('a rest block with no closing mark stays a block', shape(ms('| [4] | 1 2 3 4 :|')), ['[4]', '1234 :|'])
  assertEq('a closing mark on an empty measure goes on the previous measure', shape(ms('| 1 2 3 4 | :|')), ['1234 :|'])
  assertEq('…also a direction', shape(ms('| 1 2 3 4 | ||&dc')), ['1234 &D.C.'])
  assertEq('…but a bar after a rest block has nothing to close', shape(ms('| [4] | :| 1 |')), ['[4]', '1'])
  assertEq('a plain barline keeps doing nothing', shape(ms('| 1 2 3 4 | | 5 |')), ['1234', '5'])
  for (const t of ['|: [4] | 1 2 3 4 :|', '| {1} [2] :| {2} 1 2 3 4 ||', '| [4] :| 1 2 3 4 |', '| &f [3] | 1 2 3 4 ||&fine']) {
    assertEq(`positions agree with the measure array: ${t}`, positionsAgree(t), true)
  }
  assertEq('positions after a split rest block (data-m skips the 3 + 1 rest measures)', parse('| [4] :| 1 2').positions.map(p => [p.measureIdx, p.noteIdx]), [[3, 0], [3, 1]])
  // Written back and read again, these survive
  for (const t of ['|: [4] | 1 2 3 4 :|', '| {1} [2] :| {2} 1 2 3 4 ||', '| [4] :| 1 2 3 4 ||', '| @3/4 [4] | 1 2 3 ||']) {
    const first = parse(t)
    const again = parse(serializeToText(first.measures, 'C', '4/4', '', ''))
    assertEq(`round trip: ${t}`, shape(again.measures), shape(first.measures))
  }
})

describe('5. glued tokens', () => {
  assertEq('{1}5 6 7 1', shape(ms('| {1}5 6 7 1 :|')), ['5671 :| {1}'])
  assertEq('1234', shape(ms('| 1234 |')), ['1234'])
  const e = ms('| 1/2/ |')[0] as MeasureArray
  assertEq('1/2/ is two eighths', e.map(n => [n.degree, n.type]), [[1, 'eighth'], [2, 'eighth']])
  const h = ms('| 1-2- |')[0] as MeasureArray
  assertEq('1-2- is two halves', h.map(n => [n.degree, n.type]), [[1, 'half'], [2, 'half']])
  const t = ms('| ~31/ 2/ 3/ |')[0] as MeasureArray
  assertEq('~31/ 2/ 3/ keeps the first note', t.map(n => [n.degree, n.type, n.tuplet]), [[1, 'eighth', 3], [2, 'eighth', 3], [3, 'eighth', 3]])
  assertEq('each glued note has its own text position', parse('| 1234 |').positions.map(p => [p.start, p.end]), [[2, 3], [3, 4], [4, 5], [5, 6]])
  assertEq('…also with suffixes', parse('1/2./3').positions.map(p => [p.start, p.end]), [[0, 2], [2, 5], [5, 6]])
  const mix = ms("| #1b2'3,4.5./6//7--0 |")[0] as MeasureArray
  assertEq('accidentals, octaves and every suffix', mix.map(n => [n.accidental, n.degree, n.octave, n.type, n.dot]), [
    ['#', 1, 0, 'quarter', false], ['b', 2, 1, 'quarter', false], ['', 3, -1, 'quarter', false], ['', 4, 0, 'quarter', true],
    ['', 5, 0, 'eighth', true], ['', 6, 0, '16th', false], ['', 7, 0, 'half', true], ['', 0, 0, 'quarter', false],
  ])
  const chord = ms('| 5:3,6 |')[0] as MeasureArray
  assertEq('a chord then a note', chord.map(n => [n.degree, (n.chordNotes ?? []).map(c => [c.degree, c.octave])]), [[5, [[3, -1]]], [6, []]])
  assertEq('a modifier after glued notes belongs to the last one', (ms('| 12[>] |')[0] as MeasureArray).map(n => n.articulation ?? ''), ['', 'accent'])
  assertEq('…and extends its position', parse('12[>]').positions.map(p => [p.start, p.end]), [[0, 1], [1, 5]])
  const slur = ms('| (1234) |')[0] as MeasureArray
  assertEq('a slur around a glued run', slur.map(n => [n.slurStart, n.slurStop]), [[true, false], [false, false], [false, false], [false, true]])
  assertEq('a glued dash extends the last note', shape(ms('| 1 2- - |')), ['12'])
  // Not entirely notes → exactly as before
  assertEq('6/8 (8 is no note) stays one note 6', (ms('| 6/8 |')[0] as MeasureArray).map(n => [n.degree, n.type]), [[6, 'quarter']])
  assertEq('…while 4/4 is two notes, an eighth 4 and a 4', (ms('| 4/4 |')[0] as MeasureArray).map(n => [n.degree, n.type]), [[4, 'eighth'], [4, 'quarter']])
  assertEq('1.- (not a suffix) stays one quarter note', (ms('| 1.- |')[0] as MeasureArray).map(n => [n.degree, n.type, n.dot]), [[1, 'quarter', false]])
  assertEq('words are ignored', shape(ms('| hello 1 |')), ['1'])
  assertEq('a single note is untouched', shape(ms('| 5:3 #4/ 0 |')), ['540'])
  const tn = (s: string) => (ms(`| ${s} |`)[0] as MeasureArray).map(n => n.tuplet ?? 0)
  assertEq('~10 followed by a space is ten', tn('~10 1/ 2/'), [10, 10])
  assertEq('~3 1 2 3', tn('~3 1 2 3'), [3, 3, 3])
})

describe('6. ~N:K', () => {
  const g = ms('| ~3:2 1 2/ 3 |')[0] as MeasureArray
  assertEq('quarter + eighth triplet does not swallow the next note', g.map(n => [n.degree, n.tuplet ?? 0, n.tupletLen ?? 0]), [[1, 3, 2], [2, 3, 0], [3, 0, 0]])
  assertEq('~3:3 is plain ~3', (ms('| ~3:3 1 2 3 |')[0] as MeasureArray).map(n => n.tupletLen ?? 0), [0, 0, 0])
  assertEq('~3 alone still means three notes', (ms('| ~3 1 2 3 4 |')[0] as MeasureArray).map(n => n.tuplet ?? 0), [3, 3, 3, 0])
  assertEq('~5:3', (ms('| ~5:3 1 2 3 4 |')[0] as MeasureArray).map(n => [n.tuplet ?? 0, n.tupletLen ?? 0]), [[5, 3], [5, 0], [5, 0], [0, 0]])
  const qe = measure([note({ degree: 1, tuplet: 3, tupletLen: 2 }), note({ degree: 2, type: 'eighth', tuplet: 3 }), note({ degree: 3 }), note({ degree: 4 })])
  assertEq('serialize a 2-note triplet', bodyOf([qe]), '| ~3:2 1 2/ 3 4 ||')
  const back = ms(bodyOf([qe]))[0] as MeasureArray
  assertEq('…and read it back', back.map(n => [n.degree, n.tuplet ?? 0, n.tupletLen ?? 0]), [[1, 3, 2], [2, 3, 0], [3, 0, 0], [4, 0, 0]])
  const two = measure([
    note({ degree: 1, tuplet: 3, tupletLen: 2 }), note({ degree: 2, type: 'eighth', tuplet: 3 }),
    note({ degree: 3, tuplet: 3, tupletLen: 2 }), note({ degree: 4, type: 'eighth', tuplet: 3 }),
  ])
  assertEq('two 2-note groups in a row', bodyOf([two]), '| ~3:2 1 2/ ~3:2 3 4/ ||')
  const noLen = measure([note({ degree: 1, tuplet: 3 }), note({ degree: 2, type: 'eighth', tuplet: 3 }), note({ degree: 3 })])
  assertEq('without tupletLen a short run is still written ~N:size when a note follows', bodyOf([noLen]), '| ~3:2 1 2/ 3 ||')
  const tail = measure([note({ degree: 1, tuplet: 3 }), note({ degree: 2, tuplet: 3 })])
  assertEq('…but a run the barline ends keeps today\'s ~3', bodyOf([tail]), '| ~3 1 2 ||')
  const full = measure([1, 2, 3, 4].map(d => note({ degree: d, tuplet: 3 })).slice(0, 3).concat([note({ degree: 4 })]))
  assertEq('a full triplet is written ~3', bodyOf([full]), '| ~3 1 2 3 4 ||')
  const twice = measure([1, 2, 3, 4, 5, 6].map(d => note({ degree: d, type: 'eighth', tuplet: 3 })))
  assertEq('two full triplets in a row', bodyOf([twice]), '| ~3 1/ 2/ 3/ ~3 4/ 5/ 6/ ||')
})

describe('7. a tie dash at measure start takes the pending ~N and (', () => {
  const t = ms('| 1 2 3 4 | ~3 - 2/ 3/ 4 |')[1] as MeasureArray
  assertEq('the dash is the first tuplet slot', t.map(n => [n.tie, n.tuplet ?? 0]), [[true, 3], [false, 3], [false, 3], [false, 0]])
  const s = ms('| 1 2 3 4 | ( - 2 3 ) |')[1] as MeasureArray
  assertEq('the dash takes the slur start', s.map(n => [n.tie, n.slurStart, n.slurStop]), [[true, true, false], [false, false, false], [false, false, true]])
  const l = ms('| 1 2 3 4 | ~3:2 - 2/ 3 |')[1] as MeasureArray
  assertEq('and the group length', l.map(n => [n.tuplet ?? 0, n.tupletLen ?? 0]), [[3, 2], [3, 0], [0, 0]])
  assertEq('without markers nothing changes', (ms('| 1 2 3 4 | - 2 |')[1] as MeasureArray).map(n => [n.tie, n.tuplet ?? 0, n.slurStart]), [[true, 0, false], [false, 0, false]])
})

describe('8. unpitched notes are X', () => {
  const m = measure([note({ degree: 0 }), note({ degree: 0, type: 'eighth', octave: 2, accidental: '#' }), note({ degree: 0, type: 'half', dot: true, articulation: 'accent' }), note({ degree: 0, rest: true })])
  assertEq('serialized as X + duration, rests still 0', bodyOf([m]), '| X X/ X--[>] 0 ||')
  const back = ms('| X X/ X--[>] 0 |')[0] as MeasureArray
  assertEq('parsed back', back.map(n => [isUnpitched(n), n.rest, n.degree, n.octave, n.accidental, n.type, n.dot, n.articulation ?? '']), [
    [true, false, 0, 0, '', 'quarter', false, ''], [true, false, 0, 0, '', 'eighth', false, ''],
    [true, false, 0, 0, '', 'half', true, 'accent'], [false, true, 0, 0, '', 'quarter', false, ''],
  ])
  assertEq('lower case x and glued', (ms('| xX/x. |')[0] as MeasureArray).map(n => [isUnpitched(n), n.type, n.dot]), [[true, 'quarter', false], [true, 'eighth', false], [true, 'quarter', true]])
  assertEq('an X between pitched notes', shape(ms('| 1 X 3 X |')), ['1X3X'])
  assertEq('a word is not a drum hit', shape(ms('| Xylophone 1 |')), ['1'])
  assertEq('positions', parse('| X 1 |').positions.map(p => [p.start, p.end]), [[2, 3], [4, 5]])
})

describe('9. directions go through classifyDirection', () => {
  const tag = (d: string) => bodyOf([bar({ _direction: d }), bar()])
  assertEq('Da Capo al Fine', tag('Da Capo al Fine'), '| 1 2 3 4 ||&dc | 1 2 3 4 ||')
  assertEq('D.C al Fine', tag('D.C al Fine'), '| 1 2 3 4 ||&dc | 1 2 3 4 ||')
  assertEq('D.S. al Coda', tag('D.S. al Coda'), '| 1 2 3 4 ||&ds | 1 2 3 4 ||')
  assertEq('Dal Segno', tag('Dal Segno'), '| 1 2 3 4 ||&ds | 1 2 3 4 ||')
  assertEq('Fine.', tag('Fine.'), '| 1 2 3 4 ||&fine | 1 2 3 4 ||')
  assertEq('Segno', tag('Segno'), '| 1 2 3 4 ||&segno | 1 2 3 4 ||')
  assertEq('Coda has no syntax', tag('Coda'), '| 1 2 3 4 | 1 2 3 4 ||')
  assertEq('free text has no syntax', tag('rit.'), '| 1 2 3 4 | 1 2 3 4 ||')
  assertEq('||&segno parses to Segno', (ms('| 1 2 3 4 ||&segno')[0] as MeasureArray)._direction, 'Segno')
  assertEq('||&fine, ||&dc, ||&ds still parse', ['fine', 'dc', 'ds'].map(t => (ms(`| 1 ||&${t}`)[0] as MeasureArray)._direction), ['Fine', 'D.C.', 'D.S.'])
  assertEq('an unknown tag is just a double bar', (ms('| 1 ||&coda')[0] as MeasureArray)._direction, '')
})

describe('10. repeat end + direction on one measure', () => {
  for (const [dir, tag] of [['Fine', 'fine'], ['D.C.', 'dc'], ['D.S.', 'ds'], ['Segno', 'segno']] as const) {
    const text = bodyOf([bar({ _repeatEnd: true, _direction: dir }), bar()])
    assertEq(`write :|&${tag}`, text, `| 1 2 3 4 :|&${tag} | 1 2 3 4 ||`)
    const back = ms(text)[0] as MeasureArray
    assertEq(`read :|&${tag}`, [back._repeatEnd, back._direction], [true, dir])
  }
  assertEq('a plain :| is still a plain :|', shape(ms('| 1 2 3 4 :| 2 |')), ['1234 :|', '2'])
  assertEq(':|&fine then more music', shape(ms('| 1 2 3 4 :|&fine | 2 |')), ['1234 :| &Fine', '2'])
  assertEq('an unknown tag after :| is only the repeat', shape(ms('| 1 2 3 4 :|&x | 2 |')), ['1234 :|', '2'])
  assertEq('positions around :|&fine', positionsAgree('| 1 2 :|&fine | 3 4 ||'), true)
})

describe('11. slurs are written from slurPairs', () => {
  const dangling = measure([note({ degree: 1, slurStart: true }), note({ degree: 2 })])
  const closed = measure([note({ degree: 3, slurStart: true }), note({ degree: 4, slurStop: true })])
  assertEq('a start that never closes is not written, the next slur is', bodyOf([dangling, closed]), '| 1 2 | ( 3 4 ) ||')
  const back = ms(bodyOf([dangling, closed])) as MeasureArray[]
  assertEq('…so it does not close on the wrong note', back.map(m => m.map(n => [n.slurStart, n.slurStop])), [[[false, false], [false, false]], [[true, false], [false, true]]])
  const chained = measure([note({ degree: 1, slurStart: true }), note({ degree: 2, slurStart: true, slurStop: true }), note({ degree: 3, slurStop: true }), note({ degree: 4 })])
  assertEq('a chain on one note, as before', bodyOf([chained]), '| ( 1 ( 2 ) 3 ) 4 ||')
  const plain = measure([note({ degree: 1, slurStart: true }), note({ degree: 2 }), note({ degree: 3, slurStop: true }), note({ degree: 4 })])
  assertEq('a plain slur, as before', bodyOf([plain]), '| ( 1 2 3 ) 4 ||')
  const across = [measure([note({ degree: 1, slurStart: true })]), measure([note({ degree: 2, slurStop: true })])]
  assertEq('across a barline, as before', bodyOf(across), '| ( 1 | 2 ) ||')
  const rest = measure([note({ degree: 1, slurStart: true }), note({ degree: 0, rest: true, slurStop: true }), note({ degree: 3 })])
  assertEq('a slur ending on a rest is not written', bodyOf([rest]), '| 1 0 3 ||')
})

describe('12. a short first measure is a pickup', () => {
  const p = (t: string) => shape(ms(t))
  assertEq('one beat in 4/4', p('Time: 4/4\n| 5 | 1 2 3 4 |'), ['5 pickup', '1234'])
  assertEq('a full first measure is not', p('| 1 2 3 4 | 5 6 7 1 |'), ['1234', '5671'])
  assertEq('a lone measure is not', p('| 5 |'), ['5'])
  assertEq('a whole rest is not', p('| 0--- | 1 2 3 4 |'), ['0', '1234'])
  assertEq('[N] is not', p('| [2] | 1 2 3 4 |'), ['[2]', '1234'])
  assertEq('the measure\'s own time signature is the bar', p('Time: 4/4\n| @3/4 1 2 3 | 1 2 3 |'), ['123 @3/4', '123'])
  assertEq('…and short against it', p('Time: 4/4\n| @3/4 1 2 | 1 2 3 |'), ['12 @3/4 pickup', '123'])
  assertEq('a triplet bar adds up to a full bar', p('| ~3 1/ 2/ 3/ 2 3 4 | 1 2 3 4 |'), ['123234', '1234'])
  assertEq('6/8 is 3 beats', p('Time: 6/8\n| 5/ | 1 2 3 |'), ['5 pickup', '123'])
  assertEq('3/4 with a 1-beat start', p('Time: 3/4\n| 5 | 1 2 3 | 1 2 3 |'), ['5 pickup', '123', '123'])
  assertEq('a short bar later in the piece is not a pickup', p('| 1 2 3 4 | 5 | 1 2 3 4 |'), ['1234', '5', '1234'])
  assertEq('an overfull first bar is not', p('| 1 2 3 4 5 | 1 |'), ['12345', '1'])
})

describe('13. editedNote', () => {
  const tie = note({ degree: 5, octave: 1, accidental: '#', tie: true })
  const toRest = editedNote(note({ degree: 3, tie: true, chordNotes: [{ degree: 1, octave: 0, accidental: '' }], graceNote: { degree: 2, octave: 0, accidental: '' }, articulation: 'accent', slurStart: true, slurStop: true, accidental: 'b', octave: 1 }), { rest: true, degree: 0, accidental: '', type: 'half' })
  assertEq('a note turned into a rest keeps only the rhythm', toRest, {
    degree: 0, octave: 0, type: 'half', dot: false, tie: false, rest: true, accidental: '', slurStart: false, slurStop: false,
  })
  assertEq('a rest keeps its tuplet', editedNote(note({ rest: true, degree: 0, tuplet: 3 }), { type: 'eighth' }).tuplet, 3)
  assertEq('a tie whose degree changed stops being a tie', editedNote(tie, { degree: 6 }).tie, false)
  assertEq('…octave', editedNote(tie, { octave: 0 }).tie, false)
  assertEq('…accidental', editedNote(tie, { accidental: '' }).tie, false)
  assertEq('a tie edited with the same pitch stays a tie', editedNote(tie, { degree: 5, octave: 1, accidental: '#', type: 'half', dot: true }).tie, true)
  assertEq('only the duration changed', editedNote(tie, { type: 'half' }).tie, true)
  assertEq('a pitched note keeps its chord, grace and slurs', editedNote(note({ chordNotes: [{ degree: 1, octave: 0, accidental: '' }], graceNote: { degree: 2, octave: 0, accidental: '' }, slurStart: true, articulation: 'accent' }), { degree: 4 }),
    note({ degree: 4, chordNotes: [{ degree: 1, octave: 0, accidental: '' }], graceNote: { degree: 2, octave: 0, accidental: '' }, slurStart: true, articulation: 'accent' }))
  assertEq('a rest turned back into a note', editedNote(note({ rest: true, degree: 0 }), { rest: false, degree: 3, accidental: '#' }), note({ degree: 3, accidental: '#' }))
  const m = bar()
  ;(m[1] as NoteObject).tie = true
  ;(m[1] as NoteObject).chordNotes = [{ degree: 7, octave: 0, accidental: '' }]
  const edited = withNoteEdited([m], 0, 1, { rest: true, degree: 0, accidental: '' })[0] as MeasureArray
  assertEq('withNoteEdited uses it', edited[1], note({ degree: 0, rest: true }))
  assertEq('…and leaves the original alone', (m[1] as NoteObject).tie, true)
  assertEq('…and the measure marks', [edited._repeatEnd, edited._wedge], [false, null])
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
