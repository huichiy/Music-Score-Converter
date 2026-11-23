// Tests for the small modules several parts share: direction text, meter strings,
// Route B header lines, tuplet factors, unpitched notes in playback.
// Run via: npx tsx scripts/test-shared.ts

import { classifyDirection } from '../src/lib/directions'
import { parseMeter, barBeatsOf } from '../src/lib/meter'
import { HEADER_LINE_RE, cleanTitle, parseHeaderLine } from '../src/lib/textHeader'
import { tupletFactor } from '../src/lib/renderer'
import { slurPairs } from '../src/lib/slurs'
import { buildPlaybackEvents, expandRepeats } from '../src/lib/playback'
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
const measure = (notes: NoteObject[], meta: Partial<MeasureArray> = {}): MeasureArray =>
  Object.assign(notes.slice() as unknown as MeasureArray, meta)

describe('classifyDirection: one reading of the printed words', () => {
  const kinds = (xs: string[]) => [...new Set(xs.map(classifyDirection))]
  assertEq('Fine', kinds(['Fine', 'FINE', ' fine ', 'Fine.']), ['fine'])
  assertEq('D.C. in every spelling', kinds(['D.C.', 'D.C', 'DC', 'D. C. al Fine', 'D.C. al Fine', 'DC al Fine', 'Da Capo', 'Da capo al Fine']), ['dc'])
  assertEq('D.S. in every spelling', kinds(['D.S.', 'D.S', 'DS', 'D. S. al Coda', 'DS al Fine', 'Dal Segno', 'dal segno al Coda']), ['ds'])
  assertEq('Segno', kinds(['Segno', 'segno', '𝄋']), ['segno'])
  assertEq('To Coda is not Coda', [classifyDirection('To Coda'), classifyDirection('Coda'), classifyDirection('𝄌')], ['tocoda', 'coda', 'coda'])
  assertEq('other words are nothing', kinds(['', 'rit.', 'define', 'dolce', 'dsus', 'dcx', 'Allegro', 'finely']), [null])
  assertEq('missing text', [classifyDirection(undefined), classifyDirection(null)], [null, null])
})

describe('D.C. spellings drive playback the same way', () => {
  const order = (dir: string) => expandRepeats([
    measure([note()]), measure([note()], { _direction: 'Fine' }), measure([note()], { _direction: dir }),
  ]).map(e => e.measureIdx).join(' ')
  for (const dir of ['D.C.', 'DC al Fine', 'Da Capo', 'D. C. al Fine']) assertEq(dir, order(dir), '0 1 2 0 1')
})

describe('parseMeter / barBeatsOf', () => {
  assertEq('4/4', parseMeter('4/4'), { beats: 4, beatType: 4 })
  assertEq('additive meters add up', [parseMeter('3+2/8'), barBeatsOf('3+2/8')], [{ beats: 5, beatType: 8 }, 2.5])
  assertEq('6/8 is 3 quarters, 2/2 is 4', [barBeatsOf('6/8'), barBeatsOf('2/2')], [3, 4])
  assertEq('unreadable → 4/4', [parseMeter('none'), parseMeter(''), parseMeter(undefined), parseMeter('0/4')].map(m => `${m.beats}/${m.beatType}`), ['4/4', '4/4', '4/4', '4/4'])
  assertEq('a mistyped numerator is capped', parseMeter('44444444/4').beats, 64)
})

describe('parseHeaderLine', () => {
  assertEq('not a header', [parseHeaderLine('| 1 2 3 4 |'), parseHeaderLine(''), HEADER_LINE_RE.test('Keyboard')], [null, null, false])
  assertEq('three fields on one line', parseHeaderLine('Key: C   Time: 4/4   Tempo: 120'), { key: 'C', time: '4/4', tempo: '120' })
  assertEq('a title is the whole line', parseHeaderLine('Title: Tempo: 60 Key: G study'), { title: 'Tempo: 60 Key: G study' })
  assertEq('leading space, case, space before the colon', parseHeaderLine('  key : G   time : 3/4'), { key: 'G', time: '3/4' })
  assertEq('full-width colon', parseHeaderLine('Key：G'), { key: 'G' })
  const key = (s: string) => parseHeaderLine(`Key: ${s}`)?.key
  assertEq('keys as printed in a Jianpu score', ['G', 'Bb', 'B♭', 'F#', 'F♯', '1=G', '1 = ♭B', 'bB', '♯F', '#C'].map(key), ['G', 'Bb', 'Bb', 'F#', 'F#', 'G', 'Bb', 'Bb', 'F#', 'C#'])
  assertEq('key of "1=D Time: 2/4" keeps its line', parseHeaderLine('Key: 1=D   Time: 2/4'), { key: 'D', time: '2/4' })
  const tempo = (s: string) => parseHeaderLine(`Tempo: ${s}`)?.tempo
  assertEq('tempo: plain, ♩=120, 1/4=120, c. 100, 92.6', ['120', '♩=120', '1/4=120', 'c. 100', '92.6'].map(tempo), ['120', '120', '120', '100', '93'])
  assertEq('a tempo of nothing is nothing', tempo('0') ?? null, null)
  assertEq('common time', [parseHeaderLine('Time: C')?.time, parseHeaderLine('Time: C|')?.time], ['4/4', '2/2'])
  assertEq('a title never spans lines', cleanTitle(' 望春風\n  胡阮 '), '望春風 胡阮')
})

describe('tupletFactor: powers of two are compound-meter groups', () => {
  assertEq('2 3 4 5 6 7 8', [2, 3, 4, 5, 6, 7, 8].map(n => +tupletFactor(n).toFixed(4)), [1.5, 0.6667, 0.75, 0.8, 0.6667, 0.5714, 0.75])
  assertEq('a 4:3 group fills three eighths', 4 * 0.5 * tupletFactor(4), 1.5)
})

describe('slurPairs: only slurs that can be drawn', () => {
  const n = (d: number, p: Partial<NoteObject> = {}) => note({ degree: d, ...p })
  const pairs = (...ms: NoteObject[][]) => [...slurPairs(ms.map(m => measure(m)))].map(([a, b]) => `${a.degree}-${b.degree}`)
  assertEq('a plain slur', pairs([n(1, { slurStart: true }), n(2), n(3, { slurStop: true })]), ['1-3'])
  assertEq('across a barline', pairs([n(1, { slurStart: true })], [n(2, { slurStop: true })]), ['1-2'])
  assertEq('chained on one note', pairs([n(1, { slurStart: true }), n(2, { slurStart: true, slurStop: true }), n(3, { slurStop: true })]), ['1-2', '2-3'])
  assertEq('a start that never closes is not a slur', pairs([n(1, { slurStart: true }), n(2), n(3)]), [])
  assertEq('…and does not swallow the next one', pairs([n(1, { slurStart: true }), n(2)], [n(3, { slurStart: true }), n(4, { slurStop: true })]), ['3-4'])
  assertEq('a stop with no start is nothing', pairs([n(1), n(2, { slurStop: true })]), [])
  assertEq('rests carry no slur', pairs([n(1, { slurStart: true }), n(0, { rest: true, slurStop: true }), n(3)]), [])
})

describe('Unpitched notes', () => {
  const x = note({ degree: 0 })
  assertEq('isUnpitched', [isUnpitched(x), isUnpitched(note({ degree: 0, rest: true })), isUnpitched(note())], [true, false, false])
  const ms: Measure[] = [measure([x, x, note({ degree: 5 }), x])]
  const ev = buildPlaybackEvents(expandRepeats(ms), ms, 'C', '4/4')
  assertEq('they take time but no NaN pitch reaches the synth', ev.map(e => [e.startBeat, e.midi]), [[2, 67]])
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
