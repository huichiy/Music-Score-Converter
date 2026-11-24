// Regression tests for the second ABC audit: Q: tempo units, comments in header lines,
// repeated T:, whole-measure rests Z / X, first / second endings, (p:q:r tuplets, ties
// across a barline, text before X:, & voice overlay, K:HP and pickup measures.
// Run via: npx tsx scripts/test-audit2-abc.ts

import { parseABC } from '../src/lib/abcParser'
import { buildPlaybackEvents, expandRepeats } from '../src/lib/playback'
import { durationBeats } from '../src/lib/editor'
import { tupletFactor } from '../src/lib/renderer'
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

const TYPE_CODE: Record<string, string> = { whole: 'w', half: 'h', quarter: 'q', eighth: 'e', '16th': 's', '32nd': 't' }

// One note as text: "~" tie continuation, accidental, degree, octave marks, "/", type, "." dot
function fmtNote(n: NoteObject): string {
  const oct = n.octave > 0 ? "'".repeat(n.octave) : n.octave < 0 ? ','.repeat(-n.octave) : ''
  const pitch = n.rest ? '0' : `${n.accidental}${n.degree}${oct}`
  return `${n.tie ? '~' : ''}${pitch}/${TYPE_CODE[n.type]}${n.dot ? '.' : ''}`
}
const fmt = (m: Measure) => (m as MeasureArray).map(fmtNote).join(' ')
const fmtAll = (ms: Measure[]) => ms.map(fmt)

const HEAD = 'X:1\nM:4/4\nL:1/4\n'
const HEAD8 = 'X:1\nM:4/4\nL:1/8\n'
const abc = (body: string, header = HEAD) => parseABC(`${header}K:C\n${body}`, 'x.abc')

// A bar's length the way playback counts it: written value x tuplet factor
const beatsOf = (m: Measure) =>
  +(m as MeasureArray).reduce((s, n) => s + durationBeats(n.type, n.dot) * tupletFactor(n.tuplet), 0).toFixed(6)

// Where the last note of measure `i` stops sounding, straight from the playback scheduler
function playedEnd(r: ReturnType<typeof parseABC>, i: number): number {
  const ev = buildPlaybackEvents([{ measureIdx: i }], r.measures, r.keyStr, r.timeStr)
  const last = ev[ev.length - 1]
  return +(last.startBeat + last.durBeats).toFixed(6)
}

const order = (ms: Measure[]) => expandRepeats(ms).map(e => e.measureIdx).join(' ')
const voltas = (ms: Measure[]) => ms.map(m => (m as MeasureArray)._volta ?? null)

// ============================================================================
// 1. Q: tempo is quarter notes per minute
// ============================================================================

describe('Q: tempo in quarter notes per minute', () => {
  const tempo = (q: string) => parseABC(`X:1\nM:4/4\nL:1/8\nQ:${q}\nK:C\nC|`, 'x.abc').tempoStr
  assertEq('1/4=120', tempo('1/4=120'), '120')
  assertEq('3/8=80 is 120 quarters', tempo('3/8=80'), '120')
  assertEq('1/2=60 is 120 quarters', tempo('1/2=60'), '120')
  assertEq('1/8=100 is 50 quarters', tempo('1/8=100'), '50')
  assertEq('text after the number', tempo('1/4=120 "Allegro"'), '120')
  assertEq('text before the fraction', tempo('"Allegro" 1/4=120'), '120')
  assertEq('a bare number', tempo('120'), '120')
  assertEq('several fractions add up (1/4 + 1/8 = 3/8)', tempo('1/4 1/8=80'), '120')
  assertEq('words only → no tempo', tempo('"Allegro"'), '')
  assertEq('no Q: line → no tempo', parseABC('X:1\nM:4/4\nK:C\nC|', 'x.abc').tempoStr, '')
  assertEq('rounded', tempo('1/4=92.6'), '93')
})

// ============================================================================
// 2. Comments in header lines
// ============================================================================

describe('header lines: a % comment is not part of the value', () => {
  const r = parseABC('X:1\nT:My tune % comment\nM:6/8 % jig\nL:1/8 % unit\nQ:1/4=90 % slow\nK:G % sharp\nG A B|', 'x.abc')
  assertEq('T:', r.titleStr, 'My tune')
  assertEq('M:', r.timeStr, '6/8')
  assertEq('Q:', r.tempoStr, '90')
  assertEq('K:', r.keyStr, 'G')
  assertEq('L: still read', fmtAll(r.measures), ['1/e 2/e 3/e'])
  assertEq('\\% is a literal percent', parseABC('X:1\nT:100\\% pure\nK:C\nC|', 'x.abc').titleStr, '100% pure')
  assertEq('a comment line between header fields', parseABC('X:1\n   % just a note\nT:Tune\nK:D\nC|', 'x.abc').titleStr, 'Tune')
  assertEq('K: with a mode and a comment', parseABC('X:1\nK:Ador % a mode\nC|', 'x.abc').keyStr, 'G')
})

// ============================================================================
// 3. Several T: lines
// ============================================================================

describe('T: the first is the title, later ones are alternatives', () => {
  assertEq('two titles', parseABC('X:1\nT:First\nT:Second\nK:C\nC|', 'x.abc').titleStr, 'First')
  assertEq('three titles', parseABC('X:1\nT:First\nT:Second\nT:Third\nK:C\nC|', 'x.abc').titleStr, 'First')
  assertEq('an empty first T: does not block the next one', parseABC('X:1\nT:\nT:Second\nK:C\nC|', 'x.abc').titleStr, 'Second')
  assertEq('no T: → file name', parseABC('X:1\nK:C\nC|', 'song.abc').titleStr, 'song')
})

// ============================================================================
// 4. Z / X are n whole measures of rest
// ============================================================================

describe('Zn and Xn: n whole measures of rest', () => {
  const rests = abc('Z2|C D E F|').measures
  assertEq('Z2 is two measures of one whole rest each, then the music', fmtAll(rests), ['0/w', '0/w', '1/q 2/q 3/q 4/q'])
  assertEq('the bar after Z2 does not add an empty measure', rests.length, 3)
  assertEq('Z alone is one measure', fmtAll(abc('Z|C D E F|').measures), ['0/w', '1/q 2/q 3/q 4/q'])
  assertEq('X3 (invisible) is three measures too', fmtAll(abc('X3|C D E F|').measures), ['0/w', '0/w', '0/w', '1/q 2/q 3/q 4/q'])
  assertEq('lower-case z2 is still two units (half rest)', fmtAll(abc('z2 C2|').measures), ['0/h 1/h'])
  assertEq('lower-case x2 is still two units', fmtAll(abc('x2 C2|').measures), ['0/h 1/h'])
  assertEq('Z with no bar after it', fmtAll(abc('C D E F|Z2').measures), ['1/q 2/q 3/q 4/q', '0/w', '0/w'])
  assertEq('capped at 200 measures', abc('Z999|C|').measures.length, 201)

  const rep = abc('|:Z2:|C D E F|').measures
  assertEq('|: lands on the first rest measure, :| on the last', [rep[0]._repeatStart ?? false, rep[0]._repeatEnd ?? false, rep[1]._repeatStart ?? false, rep[1]._repeatEnd ?? false], [true, false, false, true])
  assertEq('...and no empty measure appears', rep.length, 3)

  const keyed = abc('C D E F|[K:G][M:3/4] Z2|G A B|').measures
  assertEq('a pending key / meter change is stamped on the first rest measure only', keyed.map(m => [m._key ?? null, m._timeSig ?? null]), [[null, null], ['G', '3/4'], [null, null], [null, null]])
  assertEq('a Z measure plays as a silent bar of the meter in force', fmtAll(keyed), ['1/q 2/q 3/q 4/q', '0/w', '0/w', '1/q 2/q 3/q'])
  assertEq('Z in the middle of a bar closes that bar first', fmtAll(abc('C D Z|E F G A|').measures), ['1/q 2/q', '0/w', '3/q 4/q 5/q 6/q'])
})

// ============================================================================
// 5. First / second endings
// ============================================================================

describe('endings: |1 |2 [1 [2 are tagged and play right', () => {
  const pipe = abc('|:CDEF|1 GABc:|2 cBAG|]')
  assertEq('|1 ... :|2 volta tags', voltas(pipe.measures), [null, 1, 2])
  assertEq('...play 0 1 0 2', order(pipe.measures), '0 1 0 2')
  const brk = abc('|:CDEF|[1 GABc:|[2 cBAG|]')
  assertEq('[1 ... [2 volta tags', voltas(brk.measures), [null, 1, 2])
  assertEq('...play 0 1 0 2', order(brk.measures), '0 1 0 2')
  assertEq('the digit is not read as a note', fmtAll(brk.measures), ['1/q 2/q 3/q 4/q', '5/q 6/q 7/q 1\'/q', '1\'/q 7/q 6/q 5/q'])
  assertEq('|[1 and a space before the bracket', voltas(abc('|:CDEF| [1 GABc:| [2 cBAG|]').measures), [null, 1, 2])
  assertEq('[1,3 takes the first number', voltas(abc('|:CDEF|[1,3 GABc:|[2 cBAG|]').measures), [null, 1, 2])
  assertEq('[1-3 takes the first number', voltas(abc('|:CDEF|[1-3 GABc:|[4 cBAG|]').measures), [null, 1, 4])

  const long = abc('|:CDEF|1 GABc|DEFG:|2 cBAG|]')
  assertEq('a first ending runs over plain barlines', voltas(long.measures), [null, 1, 1, 2])
  assertEq('...and plays 0 1 2 0 3', order(long.measures), '0 1 2 0 3')

  assertEq('three endings', voltas(abc('|:CDEF|1 GABc:|2 cBAG:|3 DEFG|]').measures), [null, 1, 2, 3])
  assertEq('|] ends an ending', voltas(abc('|:CDEF|1 GABc:|2 cBAG|]DEFG|').measures), [null, 1, 2, null])
  assertEq('|| ends an ending', voltas(abc('|:CDEF|1 GABc:|2 cBAG||DEFG|').measures), [null, 1, 2, null])
  assertEq('a new |: ends an ending', voltas(abc('|:CDEF|1 GABc:|2 cBAG|:DEFG:|').measures), [null, 1, 2, null])
  assertEq('a second ending with no terminator stops after as many measures as the first had', voltas(abc('|:CDEF|1 GABc:|2 cBAG|DEFG|ABCD|').measures), [null, 1, 2, null, null])
  assertEq('...two-measure endings', voltas(abc('|:CDEF|1 GABc|DEFG:|2 cBAG|ABCD|EFGA|').measures), [null, 1, 1, 2, 2, null])
  assertEq('...and the music after it still plays once', order(abc('|:CDEF|1 GABc:|2 cBAG|DEFG|').measures), '0 1 0 2 3')
  assertEq('a Z measure inside an ending is tagged', voltas(abc('|:CDEF|1 Z:|2 cBAG|]').measures), [null, 1, 2])
  assertEq('a tune without endings has no tags', voltas(abc('|:CDEF:|GABc|').measures), [null, null])
})

// ============================================================================
// 6. (p:q:r tuplets
// ============================================================================

describe('(p:q:r tuplets use the real ratio', () => {
  const q5 = abc('(5CDEFG A2 A2 A2|', HEAD8)
  assertEq('(5 in 4/4 is 5 in the time of 2: sixteenths', fmt(q5.measures[0]), '1/s 2/s 3/s 4/s 5/s 6/q 6/q 6/q')
  assertEq('...tuplet = 5 on the five notes', q5.measures[0].map(n => n.tuplet ?? null), [5, 5, 5, 5, 5, null, null, null])
  assertEq('...a 4-beat bar', beatsOf(q5.measures[0]), 4)
  assertEq('...and playback agrees', playedEnd(q5, 0), 4)

  const t32 = abc('(3:2:2A2B A2 A2 A2|', HEAD8)
  assertEq('(3:2:2 puts two notes in the triplet', t32.measures[0].map(n => n.tuplet ?? null), [3, 3, null, null, null])
  assertEq('...tupletLen = 2 on the first note only', t32.measures[0].map(n => n.tupletLen ?? null), [2, null, null, null, null])
  assertEq('...a 4-beat bar', beatsOf(t32.measures[0]), 4)
  assertEq('...and playback agrees', playedEnd(t32, 0), 4)

  const d2 = abc('(2CD A3|', 'X:1\nM:6/8\nL:1/8\n')
  assertEq('(2 in 6/8 is 2 in the time of 3: written values stay', fmt(d2.measures[0]), '1/e 2/e 6/q.')
  assertEq('...a 3-beat bar', beatsOf(d2.measures[0]), 3)
  assertEq('...no tupletLen when r is not given', d2.measures[0].map(n => n.tupletLen ?? null), [null, null, null])

  const trip = abc('(3CDE F G|', HEAD8).measures[0]
  assertEq('(3 is unchanged: 3 in the time of 2', [fmt(trip), beatsOf(trip)], ['1/e 2/e 3/e 4/e 5/e', 2])
  assertEq('(3:2:3 spelled out changes nothing, no tupletLen', abc('(3:2:3CDE F G|', HEAD8).measures[0].map(n => [n.tuplet ?? null, n.tupletLen ?? null]), [[3, null], [3, null], [3, null], [null, null], [null, null]])

  const total = (body: string, header = HEAD8) => beatsOf(abc(body, header).measures[0])
  assertEq('(5:4:5 keeps the written value (5 in the time of 4)', fmt(abc('(5:4:5CDEFG A2 A2|', HEAD8).measures[0]), '1/e 2/e 3/e 4/e 5/e 6/q 6/q')
  assertEq('...and fills 4 beats', total('(5:4:5CDEFG A2 A2|'), 4)
  assertEq('(5 in 6/8 is 5 in the time of 3', total('(5CDEFG A2 A|', 'X:1\nM:6/8\nL:1/8\n'), 3)
  assertEq('...dotted sixteenths', fmt(abc('(5CDEFG A2 A|', 'X:1\nM:6/8\nL:1/8\n').measures[0]).split(' ').slice(0, 2), ['1/s.', '2/s.'])
  assertEq('(6 is 6 in the time of 2', total('(6CDEFGA B2 B2 B2|'), 4)
  assertEq('(7 is 7 in the time of 2', total('(7CDEFGAB c2 c2 c2|'), 4)
  assertEq('(8 is 8 in the time of 3', total('(8CDEFGABc A2 A2 A|'), 4)
  assertEq('(9 is 9 in the time of 2', total('(9CDEFGABcd e2 e2 e2|'), 4)
  assertEq('(4 is 4 in the time of 3', total('(4CDEF G2 G2 G2|'), 1.5 + 3)
  assertEq('(2 is 2 in the time of 3 in simple meter too', total('(2CD A2 A2 A2|'), 1.5 + 3)
  assertEq('(3:2 with q but no r', total('(3:2CDE A2 A2 A2|'), 4)

  const odd = abc('(5C5DEFG A2 A2|', HEAD8)
  assertEq('a value the ratio makes unrepresentable keeps its written length', fmt(odd.measures[0]).split(' ').slice(0, 3), ['1/h', '~1/e', '2/s'])

  const broken = abc('(3A>BC D2 D2 D2|', HEAD8).measures[0]
  assertEq('broken rhythm inside a triplet', fmt(broken).split(' ').slice(0, 3), ['6/e.', '7/s', '1/e'])
  assertEq('...still a 4-beat bar', beatsOf(broken), 4)
})

// ============================================================================
// 7. A tie across a barline carries the accidental
// ============================================================================

describe('tie across a barline keeps the accidental', () => {
  const t = abc('CD^F2-|F2 G2|', HEAD8).measures
  assertEq('F# tied over the barline stays #4', fmt(t[1]), '~#4/q 5/q')
  assertEq('...and the tied note is the continuation of the first', fmt(t[0]), '1/e 2/e #4/q')
  assertEq('a later F in the same bar is natural again (the carry is not a bar accidental)', fmt(abc('^F2-|F2 F2|', HEAD).measures[1]), '~#4/h 4/h')
  assertEq('a chain of ties keeps carrying', fmtAll(abc('^F2-|F2-|F2|', HEAD).measures), ['#4/h', '~#4/h', '~#4/h'])
  assertEq('an explicit natural wins (and the tie is dropped: pitches differ)', fmt(abc('^F2-|=F2|', HEAD).measures[1]), '4/h')
  assertEq('another octave does not borrow it', fmt(abc('^F2-|f2|', HEAD).measures[1]), "4'/h")
  assertEq('another letter is untouched', fmt(abc('^F2-|G2|', HEAD).measures[1]), '5/h')
  assertEq('a flat carries too', fmt(abc('_B2-|B2|', HEAD).measures[1]), '~b7/h')
  assertEq('...but a plain tie in the same bar behaves as before', fmt(abc('^F2- F2|', HEAD).measures[0]), '#4/h ~#4/h')
})

// ============================================================================
// 8. Free text before X:
// ============================================================================

describe('text before the first X: line is skipped', () => {
  const r = parseABC('Some collection notes\nBook 1, page 3\n\nX:1\nT:Real Title\nM:3/4\nL:1/4\nK:G\nG A B|', 'x.abc')
  assertEq('title / meter / key come from the real header', [r.titleStr, r.timeStr, r.keyStr], ['Real Title', '3/4', 'G'])
  assertEq('the notes are the tune, not the intro', fmtAll(r.measures), ['1/q 2/q 3/q'])
  assertEq('a file that starts with X: is unchanged', fmtAll(abc('C D E F|').measures), ['1/q 2/q 3/q 4/q'])
  assertEq('only the first tune is read', parseABC('intro\nX:1\nT:One\nK:C\nC|\n\nX:2\nT:Two\nK:G\nG|', 'x.abc').titleStr, 'One')
})

// ============================================================================
// 9. & voice overlay
// ============================================================================

describe('& overlay is skipped to the next barline', () => {
  assertEq('notes after & do not extend the bar', fmtAll(abc('C D E F & G4|A B c d|').measures), ['1/q 2/q 3/q 4/q', '6/q 7/q 1\'/q 2\'/q'])
  assertEq('...with no space around the &', fmtAll(abc('C D E F&G4|A B c d|').measures), ['1/q 2/q 3/q 4/q', '6/q 7/q 1\'/q 2\'/q'])
  assertEq('& before a repeat bar', abc('C D E F & G4:|A B c d|').measures.map(m => [m.length, m._repeatEnd ?? false]), [[4, true], [4, false]])
  assertEq('& at the end of a line without a barline', fmtAll(abc('C D E F & G4\nA B c d|').measures), ['1/q 2/q 3/q 4/q 6/q 7/q 1\'/q 2\'/q'])
})

// ============================================================================
// 10. K:HP / K:Hp
// ============================================================================

describe('K:HP and K:Hp are the Highland pipe scale (F#, C#)', () => {
  const key = (k: string) => parseABC(`X:1\nL:1/4\nK:${k}\nF|`, 'x.abc')
  assertEq('K:HP → D', key('HP').keyStr, 'D')
  assertEq('K:Hp → D', key('Hp').keyStr, 'D')
  assertEq('F is F#, the 3rd degree of D', fmt(key('HP').measures[0]), '3/q')
  assertEq('K:Hp, same notes', fmt(key('Hp').measures[0]), '3/q')
  assertEq('K:D is the same signature', fmt(key('D').measures[0]), '3/q')
})

// ============================================================================
// 11. Pickup measure
// ============================================================================

describe('_pickup on a short first measure', () => {
  const pick = (body: string, header = HEAD) => abc(body, header).measures.map(m => m._pickup ?? false)
  assertEq('one note before a 4/4 bar', pick('G|C D E F|'), [true, false])
  assertEq('a full first measure is not a pickup', pick('C D E F|G A B c|'), [false, false])
  assertEq('6/8 with one eighth', pick('G|CDE FGA|', 'X:1\nM:6/8\nL:1/8\n'), [true, false])
  assertEq('a lone measure is not a pickup', pick('G|'), [false])
  assertEq('a whole-rest measure is not a pickup', pick('z4|C D E F G A|', 'X:1\nM:6/4\nL:1/4\n'), [false, false])
  assertEq('a short bar after the first is not a pickup', pick('C D E F|G|'), [false, false])
  assertEq('tuplets are counted (naive sum is a full bar)', pick('(3GAB c2 d2 e|C2 D2 E2 F2|', HEAD8), [true, false])
  assertEq('four triplets fill a bar exactly', pick('(3GAB (3cde (3fga (3bc\'d\'|C2 D2 E2 F2|', HEAD8), [false, false])
  assertEq('the meter of the first measure is used when the body sets one', pick('M:3/4\nG A B|C D E|'), [false, false])
})

describe('Review: a second ending that only a new |: ends', () => {
  const voltas = (body: string) => parseABC(`X:1\nT:t\nM:4/4\nL:1/4\nK:C\n${body}`, 'f').measures.map(m => m._volta ?? 0)
  assertEq('is as long as the first one', voltas('|:CDEF|1 GABc:|2 cBAG|CDEF|GABc|:CDEF:|'), [0, 1, 2, 0, 0, 0])
  assertEq('a double bar still ends it where it stands', voltas('|:CDEF|1 GABc:|2 cBAG|CDEF||GABc|'), [0, 1, 2, 2, 0])
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
