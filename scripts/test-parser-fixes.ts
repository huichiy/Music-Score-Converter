// Regression tests for the parser audit: MusicXML (voices, key / meter changes, types,
// tempo), transposition spelling, ABC (ties, modes, body syntax) and MIDI conversion.
// Run via: npx tsx scripts/test-parser-fixes.ts
//
// Uses linkedom (devDependency, tests only — never bundled) to parse inline
// MusicXML strings outside the browser, and @tonejs/midi to build MIDI fixtures.

import { DOMParser } from 'linkedom'
import midiPackage from '@tonejs/midi'
import {
  parseXMLToNoteObjects, transposeNoteObjects, noteToMidi, semitoneToJianpu,
  midiToJianpu, parseMetronomeTempo, splitDuration,
} from '../src/lib/parser'
import { parseABC } from '../src/lib/abcParser'
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

// One measure as text: "~" tie continuation, accidental, degree, octave marks, "/", type, "." dot
function fmtNote(n: NoteObject): string {
  const oct = n.octave > 0 ? "'".repeat(n.octave) : n.octave < 0 ? ','.repeat(-n.octave) : ''
  const pitch = n.rest ? '0' : `${n.accidental}${n.degree}${oct}`
  return `${n.tie ? '~' : ''}${pitch}/${TYPE_CODE[n.type]}${n.dot ? '.' : ''}`
}
const fmt = (m: Measure) => (m as MeasureArray).map(fmtNote).join(' ')
const fmtAll = (ms: Measure[]) => ms.map(fmt)

function note(p: Partial<NoteObject>): NoteObject {
  return {
    degree: 1, octave: 0, type: 'quarter', dot: false, tie: false,
    rest: false, accidental: '', slurStart: false, slurStop: false,
    ...p,
  }
}

function measureOf(notes: NoteObject[], extra: Partial<MeasureArray> = {}): MeasureArray {
  const arr = notes.slice() as unknown as MeasureArray
  arr._repeatStart = false
  arr._repeatEnd = false
  arr._direction = ''
  arr._dynamic = ''
  arr._wedge = null
  return Object.assign(arr, extra)
}

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

const attrs = (fifths = 0, beats = 4, beatType = 4) =>
  `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time></attributes>`

function noteXml(step: string, octave: number, duration = 1, type = 'quarter', extra = ''): string {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>${type}</type>${extra}</note>`
}

// ============================================================================
// 1. ABC ties
// ============================================================================

describe('ABC: a tie marks the NEXT note, the note before `-` keeps its pitch', () => {
  const abc = (body: string) => parseABC(`X:1\nM:4/4\nL:1/4\nK:C\n${body}`, 'x.abc').measures
  assertEq('C2- C2 → C half + tied half', fmtAll(abc('C2- C2 |')), ['1/h ~1/h'])
  assertEq('tie across the barline', fmtAll(abc('C4- | C4 |')), ['1/w', '~1/w'])
  assertEq('a tie between different pitches is dropped (D keeps its pitch)', fmtAll(abc('C2- D2 |')), ['1/h 2/h'])
  assertEq('no tie, no flag', fmtAll(abc('C2 C2 |')), ['1/h 1/h'])
})

// ============================================================================
// 2. MusicXML voices / staves / cues
// ============================================================================

describe('MusicXML: only the first voice of the first staff', () => {
  const m1 = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 5, 4, 'whole', '<voice>1</voice><staff>1</staff>')}
    <backup><duration>4</duration></backup>
    ${noteXml('C', 3, 4, 'whole', '<voice>5</voice><staff>2</staff>')}
  </measure>`)
  assertEq('two staves → right hand only', fmtAll(m1), ["1'/w"])

  const m2 = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 5, 2, 'half', '<voice>1</voice>')}${noteXml('D', 5, 2, 'half', '<voice>1</voice>')}
    <backup><duration>4</duration></backup>
    ${noteXml('E', 4, 2, 'half', '<voice>2</voice>')}${noteXml('F', 4, 2, 'half', '<voice>2</voice>')}
  </measure>`)
  assertEq('two voices on one staff → voice 1', fmtAll(m2), ["1'/h 2'/h"])

  const m3 = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 5, 2, 'half', '<voice>1</voice>')}
    <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><type>half</type><voice>1</voice></note>
    ${noteXml('D', 5, 2, 'half', '<voice>1</voice>')}
    <backup><duration>4</duration></backup>
    ${noteXml('G', 3, 4, 'whole', '<voice>2</voice>')}
  </measure>`)
  // C5 + E5 listed low to high: the highest note is the melody now, the lower one stacks below
  assertEq('<chord/> notes of the kept voice survive', [m3[0][0].degree, (m3[0][0].chordNotes ?? []).map(c => c.degree)], [3, [1]])
  assertEq('...and the other voice does not', m3[0].length, 2)

  const m4 = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 5, 4, 'whole', '<voice>1</voice><staff>1</staff>')}
  </measure><measure number="2">
    ${noteXml('D', 5, 4, 'whole', '<voice>2</voice><staff>1</staff>')}
  </measure>`)
  assertEq('a measure without the first voice uses its own first voice', fmtAll(m4), ["1'/w", "2'/w"])

  const cue = parseXml(`<measure number="1">${attrs()}
    <note><cue/><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    <backup><duration>2</duration></backup>
    ${noteXml('C', 5, 4, 'whole')}
  </measure>`)
  assertEq('cue notes are skipped', fmtAll(cue), ["1'/w"])
})

// ============================================================================
// 3. Key changes: _key on the measure, transposition follows it
// ============================================================================

describe('MusicXML: _key on the measure where <fifths> changes', () => {
  const ms = parseXml(`<measure number="1">${attrs(0)}${noteXml('C', 5, 4, 'whole')}</measure>
    <measure number="2"><attributes><key><fifths>2</fifths></key></attributes>${noteXml('D', 5, 4, 'whole')}</measure>
    <measure number="3">${noteXml('E', 5, 4, 'whole')}</measure>
    <measure number="4"><attributes><key><fifths>2</fifths></key></attributes>${noteXml('F', 5, 4, 'whole', '')}</measure>`)
  assertEq('first measure carries no _key', ms[0]._key ?? null, null)
  assertEq('change → _key D', ms[1]._key, 'D')
  assertEq('degrees are relative to the new key (F natural is b3 in D)', fmtAll(ms), ["1'/w", "1'/w", "2'/w", "b3'/w"])
  assertEq('measures after the change carry none', ms[2]._key ?? null, null)
  assertEq('a repeated, unchanged key is not a change', ms[3]._key ?? null, null)

  // fifths written after the measure's first note applies from the next measure
  const late = parseXml(`<measure number="1">${attrs(0)}${noteXml('C', 5, 4, 'whole')}<attributes><key><fifths>1</fifths></key></attributes></measure>
    <measure number="2">${noteXml('G', 5, 4, 'whole')}</measure>`)
  assertEq('late key change lands on the next measure', [late[0]._key ?? null, late[1]._key], [null, 'G'])
  assertEq('...and the next measure reads in the new key', fmt(late[1]), "1'/w")
})

describe('transposeNoteObjects follows _key changes', () => {
  const src: Measure[] = [
    measureOf([note({ degree: 1, octave: 1 })]),
    measureOf([note({ degree: 1, octave: 1 })], { _key: 'D' }),
    measureOf([note({ degree: 5, octave: 1 })]),
  ]
  // 1' in C = C5 (72), 1' in D = D5 (74), 5' in D = A5 (81)
  const out = transposeNoteObjects(src, 'C', 'G') as MeasureArray[]
  assertEq('first measure: no key change', out[0]._key ?? null, null)
  assertEq('D moves by the same interval as C→G (to A)', out[1]._key, 'A')
  assertEq('later measures carry no _key', out[2]._key ?? null, null)
  const keys = ['G', 'A', 'A']
  assertEq('pitches are preserved measure by measure',
    out.map((m, i) => noteToMidi(m[0].degree, m[0].octave, m[0].accidental, keys[i])),
    [72, 74, 81])

  const toGb = transposeNoteObjects(src, 'C', 'Gb') as MeasureArray[]
  assertEq('C→Gb: D lands on Ab (spelled like the selector list)', toGb[1]._key, 'Ab')

  const same = transposeNoteObjects(src, 'C', 'C')
  assertEq('same key returns the measures untouched', same === src, true)
})

describe('MIDI key signature change → _key', () => {
  const midi = new Midi()
  midi.header.keySignatures.push({ ticks: 0, key: 'C', scale: 'major' }, { ticks: 1920, key: 'D', scale: 'major' })
  const t = midi.addTrack()
  t.addNote({ midi: 72, ticks: 0, durationTicks: 1920 })
  t.addNote({ midi: 74, ticks: 1920, durationTicks: 1920 })
  const out = midiToJianpu(midi)
  assertEq('key of the file is the first one', out.keyStr, 'C')
  assertEq('_key on measure 2 only', out.measures.map(m => m._key ?? null), [null, 'D'])
  assertEq('D5 is 1 in D', fmtAll(out.measures), ["1'/w", "1'/w"])
})

// ============================================================================
// 4. Spelling: Gb / F# / Cb / C#
// ============================================================================

describe('Transposition into Gb / F# / Cb / C# spells in-scale pitches as plain degrees', () => {
  const cfb = [measureOf([note({ degree: 1 }), note({ degree: 4 }), note({ degree: 7 })])]
  const spelled = (to: string) => (transposeNoteObjects(cfb, 'C', to)[0] as MeasureArray).map(n => [n.accidental, n.degree, n.octave])
  // C4 F4 B4 against each tonic
  assertEq('C→Gb: C is #4, F is 7, B is the 4th (Cb)', spelled('Gb'), [['#', 4, -1], ['', 7, -1], ['', 4, 0]])
  assertEq('C→F#: C is b5, F is the 7th (E#), B is the 4th', spelled('F#'), [['b', 5, -1], ['', 7, -1], ['', 4, 0]])
  assertEq('C→C#: C is the 7th (B#), F is the 3rd (E#)', spelled('C#').slice(0, 2), [['', 7, -1], ['', 3, 0]])
  assertEq('C→Cb: C is #1, B is the tonic', [spelled('Cb')[0], spelled('Cb')[2]], [['#', 1, 0], ['', 1, 1]])
})

describe('Every key × every pitch keeps its sound through semitoneToJianpu and transposition', () => {
  const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']
  let bad = 0
  let plainScaleBad = 0
  for (const key of KEYS) {
    for (let midi = 36; midi <= 96; midi++) {
      const j = semitoneToJianpu(midi - 12, key)
      if (noteToMidi(j.degree, j.octave, j.accidental, key) !== midi) bad++
      if ([0, 2, 4, 5, 7, 9, 11].includes((((midi - 12 - noteToMidi(1, 0, '', key) + 12) % 12) + 12) % 12) && j.accidental !== '') plainScaleBad++
    }
  }
  assertEq('semitoneToJianpu round-trips in all 15 keys', bad, 0)
  assertEq('scale tones never carry an accidental', plainScaleBad, 0)

  let transBad = 0
  const chromatic: NoteObject[] = []
  for (let d = 1; d <= 7; d++) for (const acc of ['', '#', 'b'] as const) chromatic.push(note({ degree: d, octave: 0, accidental: acc }))
  for (const from of KEYS) {
    for (const to of KEYS) {
      const out = transposeNoteObjects([measureOf(chromatic)], from, to)[0] as MeasureArray
      out.forEach((n, i) => {
        const before = noteToMidi(chromatic[i].degree, 0, chromatic[i].accidental, from)
        if (noteToMidi(n.degree, n.octave, n.accidental, to) !== before) transBad++
      })
    }
  }
  assertEq('transposing between any two keys keeps every pitch', transBad, 0)
})

describe('MIDI pitches in Gb / F# keys use the same spelling', () => {
  const midi = new Midi()
  midi.header.keySignatures.push({ ticks: 0, key: 'Gb', scale: 'major' })
  const t = midi.addTrack()
  // F4 (7th of Gb), B4 (4th of Gb), Gb4 (tonic), C5
  ;[65, 71, 66, 72].forEach((m, i) => t.addNote({ midi: m, ticks: i * 480, durationTicks: 480 }))
  const out = midiToJianpu(midi)
  assertEq('F4 B4 Gb4 C5 in Gb', fmt(out.measures[0]), "7,/q 4/q 1/q #4/q")
})

// ============================================================================
// 5. ABC key modes
// ============================================================================

describe('ABC: K: with a mode', () => {
  const key = (k: string) => parseABC(`X:1\nL:1/4\nK:${k}\nC|`, 'x.abc').keyStr
  assertEq('A minor → C', key('A minor'), 'C')
  assertEq('Am → C', key('Am'), 'C')
  assertEq('Ador → G', key('Ador'), 'G')
  assertEq('Dmix → G', key('Dmix'), 'G')
  assertEq('Dmin → F', key('Dmin'), 'F')
  assertEq('Ephr → C', key('Ephr'), 'C')
  assertEq('Flyd → C', key('Flyd'), 'C')
  assertEq('Bloc → C', key('Bloc'), 'C')
  assertEq('Gmaj → G', key('Gmaj'), 'G')
  assertEq('Dion → D', key('Dion'), 'D')
  assertEq('Eaeo → G', key('Eaeo'), 'G')
  assertEq('F#m → A', key('F#m'), 'A')
  assertEq('Bb → Bb', key('Bb'), 'Bb')
  assertEq('Bbm → Db', key('Bbm'), 'Db')
  assertEq('K:D Dorian (spaced, full word) → C', key('D Dorian'), 'C')
  assertEq('key signature applies: Ador F is F#', fmt(parseABC('X:1\nL:1/4\nK:Ador\nF|', 'x.abc').measures[0]), '7,/q')
})

// ============================================================================
// 6. ABC body syntax
// ============================================================================

describe('ABC body syntax', () => {
  const abc = (body: string, header = 'X:1\nM:4/4\nL:1/4\n') => parseABC(`${header}K:C\n${body}`, 'x.abc')

  assertEq('w: and W: lines are not music', fmtAll(abc('C D E F|\nw: a-ble be-fore\nW: more words\n').measures), ['1/q 2/q 3/q 4/q'])
  assertEq('V: lines are not music', fmtAll(abc('V:1\nC D E F|\n').measures), ['1/q 2/q 3/q 4/q'])
  assertEq('!f! decorations are not notes', fmtAll(abc('!f!C !fermata!D +trill+E F|').measures), ['1/q 2/q 3/q 4/q'])
  assertEq('a note then :| on the same line is music, not a field', fmtAll(abc('|:C D E A:|').measures), ['1/q 2/q 3/q 6/q'])

  const grace = abc('{g}A B C D|').measures[0]
  assertEq('{g} is not a note', grace.length, 4)
  assertEq('...it is the grace note of A (g is the octave above G)', grace[0].graceNote, { degree: 5, octave: 1, accidental: '' })

  const chord = abc('[CEG]2 G2|').measures[0]
  assertEq('[CEG]2 is one note', chord.length, 2)
  assertEq('melody is the highest note', [chord[0].degree, chord[0].type], [5, 'half'])
  assertEq('the others are chordNotes', chord[0].chordNotes, [{ degree: 3, octave: 0, accidental: '' }, { degree: 1, octave: 0, accidental: '' }])

  const L8 = 'X:1\nM:4/4\nL:1/8\n'
  assertEq('A>B is dotted + half length', fmtAll(abc('A>B C2 D2|', L8).measures), ['6/e. 7/s 1/q 2/q'])
  assertEq('A<B is half + dotted', fmtAll(abc('A<B C2 D2|', L8).measures), ['6/s 7/e. 1/q 2/q'])

  const trip = abc('(3CDE F G|', L8).measures[0]
  assertEq('(3 marks the next 3 notes', trip.map(n => n.tuplet ?? null), [3, 3, 3, null, null])

  const rep = abc('|:C D E F:|G A B c|', 'X:1\nM:4/4\nL:1/4\n').measures
  assertEq('|: sets _repeatStart', [rep[0]._repeatStart ?? false, rep[1]._repeatStart ?? false], [true, false])
  assertEq(':| sets _repeatEnd', [rep[0]._repeatEnd ?? false, rep[1]._repeatEnd ?? false], [true, false])
  const both = abc('C D E F::G A B c|', 'X:1\nM:4/4\nL:1/4\n').measures
  assertEq(':: closes one repeat and opens the next', [both[0]._repeatEnd, both[1]._repeatStart], [true, true])

  const inline = abc('C D E F| [K:G] E F G A|').measures
  assertEq('inline [K:G] is not music', inline.length, 2)
  assertEq('inline K change → _key on the next measure', [inline[0]._key ?? null, inline[1]._key], [null, 'G'])
  assertEq('...and the measure reads in the new key', fmt(inline[1]), '6,/q 7,/q 1/q 2/q')
  assertEq('a K: field line in the body changes key too', abc('C D E F|\nK:D\nF G A B|').measures[1]._key, 'D')

  const twoVoices = abc('V:1\nC D E F|\nV:2\nG, A, B, C|\nV:1\nG A B c|\n').measures
  assertEq('only the first voice of a multi-voice tune', fmtAll(twoVoices), ['1/q 2/q 3/q 4/q', '5/q 6/q 7/q 1\'/q'])

  assertEq('A// is a quarter of a unit, A/ a half', fmtAll(abc('A// A// A/ A2 A|', L8).measures), ['6/t 6/t 6/s 6/q 6/e'])
  assertEq('a body line starting a second tune (X:) stops the parse', abc('C D E F|\nX:2\nK:G\nG A B c|').measures.length, 1)
  assertEq('5 beats are a whole + tied quarter', fmtAll(abc('C5|', 'X:1\nM:4/4\nL:1/4\n').measures), ['1/w ~1/q'])
})

// ============================================================================
// 7-9. MIDI
// ============================================================================

// notes are [midi pitch, start tick, duration ticks]; the default resolution is 480 ticks per quarter
function midiOf(notes: Array<[number, number, number]>, opts: { time?: [number, number] } = {}) {
  const midi = new Midi()
  if (opts.time) midi.header.timeSignatures.push({ ticks: 0, timeSignature: opts.time })
  const t = midi.addTrack()
  for (const [pitch, ticks, durationTicks] of notes) t.addNote({ midi: pitch, ticks, durationTicks })
  return midi
}

describe('MIDI: rests fill gaps, durations come from onset to onset', () => {
  // 480 ticks = a quarter note; one 4/4 bar = 1920
  const gap = midiToJianpu(midiOf([[60, 0, 480], [64, 960, 960], [67, 1920, 1920]]))
  assertEq('a silent beat becomes a rest', fmtAll(gap.measures), ['1/q 0/q 3/h', '5/w'])

  const legato = midiToJianpu(midiOf([[60, 0, 450], [62, 480, 450], [64, 960, 450], [65, 1440, 450]]))
  assertEq('slightly short (legato) notes keep the full beat', fmtAll(legato.measures), ['1/q 2/q 3/q 4/q'])

  const jitter = midiToJianpu(midiOf([[60, 0, 480], [62, 485, 475], [64, 958, 480], [65, 1442, 478]]))
  assertEq('onsets a few ticks off the grid still come out on the beat', fmtAll(jitter.measures), ['1/q 2/q 3/q 4/q'])

  const stac = midiToJianpu(midiOf([[60, 0, 240], [62, 480, 240], [64, 960, 480], [65, 1440, 480]]))
  assertEq('a clearly short (staccato) note is followed by a rest', fmtAll(stac.measures), ['1/e 0/e 2/e 0/e 3/q 4/q'])

  const lead = midiToJianpu(midiOf([[60, 480, 480], [62, 960, 480], [64, 1440, 480]]))
  assertEq('a late start gets a leading rest', fmtAll(lead.measures), ['0/q 1/q 2/q 3/q'])

  const emptyBar = midiToJianpu(midiOf([[60, 0, 1920], [62, 3840, 1920]]))
  assertEq('a silent bar is a whole rest', fmtAll(emptyBar.measures), ['1/w', '0/w', '2/w'])

  const across = midiToJianpu(midiOf([[60, 0, 480], [62, 480, 480], [64, 960, 480], [65, 1440, 960], [67, 2400, 480], [69, 2880, 960]]))
  assertEq('a note over the barline is cut and tied', fmtAll(across.measures), ['1/q 2/q 3/q 4/q', '~4/q 5/q 6/h'])

  const long = midiToJianpu(midiOf([[60, 0, 2400], [62, 2400, 480]]))
  assertEq('5 beats = whole + tied quarter', fmtAll(long.measures), ['1/w', '~1/q 2/q'])

  const odd = midiToJianpu(midiOf([[60, 0, 600], [62, 600, 360], [64, 960, 960]]))
  assertEq('a 1.25-beat note is a quarter + tied 16th', fmtAll(odd.measures), ['1/q ~1/s 2/e. 3/h'])

  const chord = midiToJianpu(midiOf([[60, 0, 480], [64, 0, 480], [62, 480, 480], [65, 960, 960]]))
  assertEq('chords keep the highest pitch per tick', fmtAll(chord.measures), ['3/q 2/q 4/h'])

  const sixteenths = midiToJianpu(midiOf([[60, 0, 120], [62, 120, 120], [64, 240, 120], [65, 360, 120], [67, 480, 480], [69, 960, 960]]))
  assertEq('sixteenth notes survive', fmtAll(sixteenths.measures), ['1/s 2/s 3/s 4/s 5/q 6/h'])
})

describe('MIDI: a valid time signature is never overridden', () => {
  // one note per bar: the old density heuristic reset this to 4/4
  const sparse = midiToJianpu(midiOf([[60, 0, 1440], [62, 1440, 1440], [64, 2880, 1440]], { time: [3, 4] }))
  assertEq('3/4 stays 3/4', sparse.timeStr, '3/4')
  assertEq('three dotted halves, three bars', fmtAll(sparse.measures), ['1/h.', '2/h.', '3/h.'])

  const six8 = midiToJianpu(midiOf([[60, 0, 1440], [62, 1440, 1440]], { time: [6, 8] }))
  assertEq('6/8 stays 6/8', [six8.timeStr, six8.measures.length], ['6/8', 2])

  const none = midiToJianpu(midiOf([[60, 0, 1920]]))
  assertEq('no time signature → 4/4', none.timeStr, '4/4')
  const invalid = midiToJianpu(midiOf([[60, 0, 1920]], { time: [1, 4] }))
  assertEq('an invalid one (1/4) → 4/4', invalid.timeStr, '4/4')
})

describe('MIDI: percussion is never the melody', () => {
  const midi = new Midi()
  const drums = midi.addTrack()
  drums.channel = 9
  for (let i = 0; i < 16; i++) drums.addNote({ midi: 36 + (i % 3), ticks: i * 240, durationTicks: 120 })
  const lead = midi.addTrack()
  ;[60, 62, 64, 65].forEach((m, i) => lead.addNote({ midi: m, ticks: i * 480, durationTicks: 480 }))
  assertEq('the busier drum track is skipped', fmtAll(midiToJianpu(midi).measures), ['1/q 2/q 3/q 4/q'])

  const onlyDrums = new Midi()
  const d = onlyDrums.addTrack()
  d.channel = 9
  d.addNote({ midi: 36, ticks: 0, durationTicks: 120 })
  let message = ''
  try { midiToJianpu(onlyDrums) } catch (e) { message = (e as Error).message }
  assertEq('a file with only drums has no melody', message, '这个 MIDI 里没有可转换的音符（打击乐轨不算）')
})

// ============================================================================
// 10. Wedges
// ============================================================================

describe('MusicXML: wedge walk', () => {
  const cresc = '<direction><direction-type><wedge type="crescendo"/></direction-type></direction>'
  const stop = '<direction><direction-type><wedge type="stop"/></direction-type></direction>'
  const inOne = parseXml(`<measure number="1">${attrs()}${cresc}${noteXml('C', 5, 2, 'half')}${stop}${noteXml('D', 5, 2, 'half')}</measure>
    <measure number="2">${noteXml('E', 5, 4, 'whole')}</measure>
    <measure number="3">${noteXml('F', 5, 4, 'whole')}</measure>`)
  assertEq('opened and closed in one measure: that measure only', inOne.map(m => m._wedge), ['cresc', null, null])

  const span = parseXml(`<measure number="1">${attrs()}${cresc}${noteXml('C', 5, 4, 'whole')}</measure>
    <measure number="2">${noteXml('D', 5, 4, 'whole')}</measure>
    <measure number="3">${stop}${noteXml('E', 5, 4, 'whole')}</measure>
    <measure number="4">${noteXml('F', 5, 4, 'whole')}</measure>`)
  assertEq('a hairpin across measures still spans them', span.map(m => m._wedge), ['cresc', 'cresc', null, null])

  const dim = '<direction><direction-type><wedge type="diminuendo"/></direction-type></direction>'
  const swap = parseXml(`<measure number="1">${attrs()}${cresc}${noteXml('C', 5, 4, 'whole')}</measure>
    <measure number="2">${stop}${noteXml('D', 5, 2, 'half')}${dim}${noteXml('E', 5, 2, 'half')}</measure>
    <measure number="3">${noteXml('F', 5, 4, 'whole')}</measure>`)
  assertEq('a close followed by a new hairpin in one measure', swap.map(m => m._wedge), ['cresc', 'dim', 'dim'])
})

// ============================================================================
// 11. Meter change, whole-measure rest
// ============================================================================

describe('MusicXML: mid-piece <time> and <rest measure="yes"/>', () => {
  const ms = parseXml(`<measure number="1">${attrs()}${noteXml('C', 5, 4, 'whole')}</measure>
    <measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes><note><rest measure="yes"/><duration>3</duration></note></measure>
    <measure number="3">${noteXml('D', 5, 1)}${noteXml('E', 5, 1)}${noteXml('F', 5, 1)}</measure>
    <measure number="4"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes><note><rest measure="yes"/><duration>3</duration><type>half</type><dot/></note></measure>`)
  assertEq('first <time> is the score meter, not a change', ms[0]._timeSig ?? null, null)
  assertEq('a different <time> → _timeSig', ms[1]._timeSig, '3/4')
  assertEq('measures in between carry none', ms[2]._timeSig ?? null, null)
  assertEq('restating the same meter is not a change', ms[3]._timeSig ?? null, null)
  assertEq('measure rest without <type> is a whole rest', fmt(ms[1]), '0/w')
  assertEq('measure rest with a dotted <type> is still a whole rest', fmt(ms[3]), '0/w')

  const compound = parseXml(`<measure number="1">${attrs()}${noteXml('C', 5, 4, 'whole')}</measure>
    <measure number="2"><attributes><time><beats>3+2</beats><beat-type>8</beat-type></time></attributes>${noteXml('D', 5, 4, 'whole')}</measure>`)
  assertEq('a compound "3+2" meter is not invented into a bad label', compound[1]._timeSig ?? null, null)
})

// ============================================================================
// 12. Note types
// ============================================================================

describe('MusicXML: note types NoteObject cannot hold', () => {
  const ms = parseXml(`<measure number="1">${attrs()}
    ${noteXml('C', 5, 1, '64th')}${noteXml('C', 5, 1, '128th')}${noteXml('C', 5, 1, 'breve')}${noteXml('C', 5, 1, '16th')}
  </measure>`)
  assertEq('64th and 128th → 32nd, breve → whole', ms[0].map(n => n.type), ['32nd', '32nd', 'whole', '16th'])

  const unknown = parseXml(`<measure number="1">${attrs()}
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>bogus</type></note>
  </measure>`)
  assertEq('an unknown type falls back to the duration, never passes through', unknown[0][0].type, 'quarter')
})

// ============================================================================
// 13. Several <notations> blocks
// ============================================================================

describe('MusicXML: every <notations> block of a note is read', () => {
  const ms = parseXml(`<measure number="1">${attrs()}
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type>
      <notations><articulations><staccato/></articulations></notations>
      <notations><slur type="start" number="1"/></notations></note>
    <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type>
      <notations><slur type="stop" number="1"/></notations>
      <notations><fermata/></notations></note>
    ${noteXml('E', 5)}${noteXml('F', 5)}
  </measure>`)
  assertEq('articulation in the first block, slur in the second', [ms[0][0].articulation, ms[0][0].slurStart], ['staccato', true])
  assertEq('slur and fermata in separate blocks', [ms[0][1].slurStop, ms[0][1].articulation], [true, 'fermata'])
})

// ============================================================================
// 15. Tempo
// ============================================================================

describe('MusicXML: tempo in quarter notes per minute', () => {
  const metro = (unit: string, perMinute: string, dot = false) =>
    xmlDoc(`<direction><direction-type><metronome><beat-unit>${unit}</beat-unit>${dot ? '<beat-unit-dot/>' : ''}<per-minute>${perMinute}</per-minute></metronome></direction-type></direction>`)
  assertEq('quarter = 120', parseMetronomeTempo(metro('quarter', '120')), '120')
  assertEq('half = 60 → 120', parseMetronomeTempo(metro('half', '60')), '120')
  assertEq('dotted quarter = 60 → 90', parseMetronomeTempo(metro('quarter', '60', true)), '90')
  assertEq('eighth = 120 → 60', parseMetronomeTempo(metro('eighth', '120')), '60')
  assertEq('whole = 30 → 120', parseMetronomeTempo(metro('whole', '30')), '120')
  assertEq('"c. 100" still reads', parseMetronomeTempo(metro('quarter', 'c. 100')), '100')
  assertEq('no metronome → empty', parseMetronomeTempo(xmlDoc('<part/>')), '')
})

// ============================================================================
// Shared helper
// ============================================================================

describe('splitDuration', () => {
  assertEq('1.5 beats is a dotted quarter', splitDuration(1.5), [{ type: 'quarter', dot: true }])
  assertEq('5 beats is whole + quarter', splitDuration(5), [{ type: 'whole', dot: false }, { type: 'quarter', dot: false }])
  assertEq('0.125 is a 32nd', splitDuration(0.125), [{ type: '32nd', dot: false }])
  assertEq('never empty', splitDuration(0.01).length, 1)
})

// ============================================================================

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach(f => console.log(`  · ${f}`))
  process.exit(1)
}
