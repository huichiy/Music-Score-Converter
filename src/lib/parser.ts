import type { NoteObject, MeasureArray, Measure, ChordNote, GraceNote, Articulation } from '@/types/score'
import type { Midi } from '@tonejs/midi'
import { classifyDirection } from './directions'
import { durationBeats } from './editor'
import { barBeatsOf } from './meter'

export function pitchToSemitones(step: string, alter: number, octave: number): number {
  const stepMap: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  return stepMap[step] + alter + octave * 12
}

export const scaleDegrees = [0, 2, 4, 5, 7, 9, 11]
export const stepMapDiatonic: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
export const keyMap: Record<string, string> = {
  '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
  '0': 'C', '1': 'G', '2': 'D', '3': 'A', '4': 'E', '5': 'B', '6': 'F#', '7': 'C#',
}

const FLAT_KEYS = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
// Spelling for a key reached by transposing a mid-piece key change (the TransposeSelect list)
const PREFERRED_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/** Semitone (C4 = 48) of a key's tonic in the register Jianpu measures it from */
export function tonicSemiOf(keyStr: string): number {
  const alter = keyStr.includes('#') ? 1 : keyStr.includes('b') ? -1 : 0
  return pitchToSemitones(keyStr[0], alter, 4)
}

/** Absolute semitone (C4 = 48) of a Jianpu note in a key */
export function jianpuToSemitone(degree: number, octave: number, accidental: string, keyStr: string): number {
  const accVal = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  return tonicSemiOf(keyStr) + octave * 12 + scaleDegrees[degree - 1] + accVal
}

/**
 * Absolute MIDI note number for a Jianpu note in a given key.
 * Shared by playback (and available to anything else needing real pitch):
 * it is `jianpuToSemitone` plus the +12 that converts our semitone space
 * (where C4 = 48) to MIDI (C4 = 60).
 */
export function noteToMidi(degree: number, octave: number, accidental: string, keyStr: string): number {
  return jianpuToSemitone(degree, octave, accidental, keyStr) + 12
}

/**
 * A spelled pitch (letter + alter + octave, as MusicXML and ABC write it) → degree /
 * octave / accidental relative to a key. The letter decides the degree, so a
 * composer's spelling survives: Bb in C is b7, A# is #6.
 */
export function pitchToJianpu(step: string, alter: number, octave: number, keyStr: string): ChordNote {
  const tonicSemi = tonicSemiOf(keyStr)
  const noteSemi = pitchToSemitones(step, alter, octave)
  const diatonicDiff = (stepMapDiatonic[step] + octave * 7) - (stepMapDiatonic[keyStr[0]] + 4 * 7)
  const degree = mod(diatonicDiff, 7)
  const shift = Math.round((noteSemi - (tonicSemi + scaleDegrees[degree])) / 12)
  const intended = tonicSemi + shift * 12 + scaleDegrees[degree]
  // F## or Bbb needs two semitones of alteration, which one accidental can't say (it came
  // out as a plain sharp / flat and the pitch was wrong): spell by the sounding pitch instead
  if (Math.abs(noteSemi - intended) >= 2) return semitoneToJianpu(Math.round(noteSemi), keyStr)
  const accidental: '#' | 'b' | '' = noteSemi > intended ? '#' : noteSemi < intended ? 'b' : ''
  return { degree: degree + 1, octave: shift, accidental }
}

/**
 * An absolute semitone (C4 = 48, no spelling) → degree / octave / accidental in a key.
 * Used where only the pitch is known: transposition and MIDI.
 *
 * Pitches in the key's own scale are always plain degrees, decided by the semitone
 * distance to the tonic. Spelling them by letter name goes wrong in the keys whose
 * scale contains an enharmonic spelling (F is the 7th of F#, B is the 4th of Gb):
 * it called them 1 and #3. Only out-of-scale pitches fall back to a letter, from
 * flat names in flat keys and sharp names elsewhere.
 */
export function semitoneToJianpu(noteSemi: number, keyStr: string): ChordNote {
  const tonicSemi = tonicSemiOf(keyStr)
  const rel = mod(noteSemi - tonicSemi, 12)
  let degreeIdx = scaleDegrees.indexOf(rel)
  let accVal = 0
  if (degreeIdx === -1) {
    const name = (FLAT_KEYS.includes(keyStr) ? FLAT_NAMES : SHARP_NAMES)[mod(noteSemi, 12)]
    degreeIdx = mod(stepMapDiatonic[name[0]] - stepMapDiatonic[keyStr[0]], 7)
    accVal = rel - scaleDegrees[degreeIdx]
    if (accVal > 6) accVal -= 12
    if (accVal < -6) accVal += 12
  }
  const octave = Math.round((noteSemi - (tonicSemi + scaleDegrees[degreeIdx] + accVal)) / 12)
  const accidental: '#' | 'b' | '' = accVal > 0 ? '#' : accVal < 0 ? 'b' : ''
  return { degree: degreeIdx + 1, octave, accidental }
}

// Note values a NoteObject can express (type + one dot), longest first
const NOTE_VALUES: Array<{ beats: number; type: NoteObject['type']; dot: boolean }> = [
  { beats: 4, type: 'whole', dot: false },
  { beats: 3, type: 'half', dot: true },
  { beats: 2, type: 'half', dot: false },
  { beats: 1.5, type: 'quarter', dot: true },
  { beats: 1, type: 'quarter', dot: false },
  { beats: 0.75, type: 'eighth', dot: true },
  { beats: 0.5, type: 'eighth', dot: false },
  { beats: 0.375, type: '16th', dot: true },
  { beats: 0.25, type: '16th', dot: false },
  { beats: 0.125, type: '32nd', dot: false },
]

/**
 * A duration in quarter-note beats → the note values that add up to it, longest first.
 * One value when it is representable; more than one means the caller ties them
 * (5 beats = whole + quarter). Anything shorter than a 32nd is dropped.
 */
export function splitDuration(beats: number): Array<{ type: NoteObject['type']; dot: boolean }> {
  const out: Array<{ type: NoteObject['type']; dot: boolean }> = []
  let left = beats
  for (const v of NOTE_VALUES) {
    while (left >= v.beats - 1e-6) { out.push({ type: v.type, dot: v.dot }); left -= v.beats }
  }
  return out.length > 0 ? out : [{ type: '32nd', dot: false }]
}

const BEAT_UNIT_QUARTERS: Record<string, number> = {
  breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125,
}

// Quarter notes per minute of one <metronome>, or null when it gives no per-minute
function metronomeQuarters(metronome: Element): string | null {
  const text = metronome.getElementsByTagName('per-minute')[0]?.textContent ?? ''
  const perMinute = parseFloat(text.match(/\d+(?:\.\d+)?/)?.[0] ?? '')
  if (!(perMinute > 0)) return null
  const unit = metronome.getElementsByTagName('beat-unit')[0]?.textContent?.trim() ?? 'quarter'
  let quarters = BEAT_UNIT_QUARTERS[unit] ?? 1
  if (metronome.getElementsByTagName('beat-unit-dot').length > 0) quarters *= 1.5
  return String(Math.round(perMinute * quarters))
}

/**
 * Tempo in quarter notes per minute: the first tempo in document order, whether a
 * <metronome> with a <per-minute> or a <sound tempo="…"> (already quarters per minute;
 * some exporters write only that). Playback BPM counts quarters, so "half = 60" is 120
 * and "dotted quarter = 60" is 90. '' when the score gives none.
 */
export function parseMetronomeTempo(xmlDoc: Document): string {
  const find = (el: Element): string | null => {
    if (el.tagName === 'metronome') return metronomeQuarters(el)
    if (el.tagName === 'sound') {
      const tempo = parseFloat(el.getAttribute('tempo') ?? '')
      return tempo > 0 ? String(Math.round(tempo)) : null
    }
    for (const child of Array.from(el.children)) {
      const found = find(child)
      if (found !== null) return found
    }
    return null
  }
  return xmlDoc.documentElement ? find(xmlDoc.documentElement) ?? '' : ''
}

function parseChordNote(noteEl: Element, keyStr: string): ChordNote | null {
  const pitchNode = noteEl.getElementsByTagName('pitch')[0]
  if (!pitchNode) return null
  const step = pitchNode.getElementsByTagName('step')[0].textContent!
  const alterNode = pitchNode.getElementsByTagName('alter')[0]
  const alter = alterNode ? parseFloat(alterNode.textContent!) : 0
  const octave = parseInt(pitchNode.getElementsByTagName('octave')[0].textContent!)
  return pitchToJianpu(step, alter, octave, keyStr)
}

// MusicXML note types NoteObject has no value for fold into the nearest one
const NOTE_TYPES: Record<string, NoteObject['type']> = {
  whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', '16th': '16th', '32nd': '32nd',
  '64th': '32nd', '128th': '32nd', '256th': '32nd', '512th': '32nd', '1024th': '32nd',
  breve: 'whole', long: 'whole', maxima: 'whole',
}

function keyFromAttributes(attr: Element): string | null {
  const node = attr.getElementsByTagName('fifths')[0]
  if (!node) return null
  return keyMap[parseInt(node.textContent!).toString()] || 'C'
}

// "3/4" from an <attributes> block, or null for senza-misura and compound "3+2" meters
function timeFromAttributes(attr: Element): string | null {
  const beats = attr.getElementsByTagName('beats')[0]?.textContent?.trim() ?? ''
  const beatType = attr.getElementsByTagName('beat-type')[0]?.textContent?.trim() ?? ''
  return /^\d+$/.test(beats) && /^\d+$/.test(beatType) ? `${beats}/${beatType}` : null
}

const staffOf = (n: Element) => n.getElementsByTagName('staff')[0]?.textContent?.trim() || '1'
const voiceOf = (n: Element) => n.getElementsByTagName('voice')[0]?.textContent?.trim() || ''
const isCue = (n: Element) => n.getElementsByTagName('cue').length > 0

// A pitched <note> as the chord machinery needs it: the Jianpu pitch, the absolute
// semitone (to find the highest member and to compare ties) and the note's own tie flags
interface ChordMember { pitch: ChordNote; semi: number; tieStop: boolean; tieStart: boolean }

// One slur drawn from `note` (slurStart) until it is stopped. `dead` = cancelled by a
// slur that starts later while this one was open: the model draws one arc at a time.
interface SlurArc { note: NoteObject; stopped: boolean; dead: boolean }
interface SlurEvent { type: 'start' | 'stop'; number: string }

// The kept-voice note being read: a chord stays open until the next note (or the end of
// the measure) so its members can be sorted before anything is written
interface PendingNote {
  rest: boolean
  pieces: Array<{ type: NoteObject['type']; dot: boolean }>   // more than one → tied pieces
  members: ChordMember[]
  firstTieStop: boolean       // for rests and unpitched hits, which have no members
  tuplet: number | undefined
  articulation: Articulation | undefined
  grace: GraceNote | null
  slurEvents: SlurEvent[]
  marks: TupletMarks          // <tuplet> start / stop on any member
}

/** Position differences below this many quarters are rounding, not music */
const TIMELINE_EPS = 0.1

const durationOf = (el: Element): number | null => {
  const v = parseFloat(el.getElementsByTagName('duration')[0]?.textContent ?? '')
  return Number.isFinite(v) ? v : null
}

// Two-note tremolo (start / stop): <duration> is the sounding length, the <type> and any
// <time-modification> 2:1 only describe how it is drawn. type="single" is one note.
const isPairedTremolo = (el: Element) =>
  Array.from(el.getElementsByTagName('tremolo')).some(t => ['start', 'stop'].includes(t.getAttribute('type') ?? ''))

interface TupletMarks { start: number; stop: number }

function readTupletMarks(el: Element): TupletMarks {
  const marks = { start: 0, stop: 0 }
  const nodes = el.getElementsByTagName('tuplet')
  for (let t = 0; t < nodes.length; t++) {
    const type = nodes[t].getAttribute('type')
    if (type === 'start') marks.start++
    if (type === 'stop') marks.stop++
  }
  return marks
}

// `tuplet` says "N in the time of M"; a group that isn't N notes long (quarter + eighth
// triplet) records its real length on its first note as `tupletLen`, so the bracket closes
// where the group does. Groups never cross a barline: this runs on one measure.
function markTupletLengths(notes: NoteObject[], marks: Map<NoteObject, TupletMarks>) {
  const close = (from: number, to: number) => {
    const count = to - from + 1
    if (count !== notes[from].tuplet) notes[from].tupletLen = count
  }
  const isMultiple = (len: number, n: number) => {
    const l = Math.log2(len / n)
    return Math.abs(l - Math.round(l)) < 1e-9
  }

  // No <tuplet> elements: N notes of one value are a group; otherwise a group is as many
  // notes as it takes to add up to N × 2^k quarters (at least two)
  const guess = (a: number, b: number) => {
    const n = notes[a].tuplet!
    let k = a
    while (k < b) {
      if (k + n <= b && notes.slice(k, k + n).every(x => x.type === notes[k].type && x.dot === notes[k].dot)) { k += n; continue }
      let len = 0
      let j = k
      while (j < b) {
        len += durationBeats(notes[j].type, notes[j].dot)
        j++
        if (j - k >= 2 && isMultiple(len, n)) break
      }
      if (j - k < 2 || !isMultiple(len, n)) return
      close(k, j - 1)
      k = j
    }
  }

  // <tuplet type="start|stop">: the outermost pair of a run is the group
  const marked = (a: number, b: number) => {
    let depth = 0
    let from = a
    for (let k = a; k < b; k++) {
      const m = marks.get(notes[k])
      if (!m) continue
      if (m.start > 0) { if (depth === 0) from = k; depth += m.start }
      if (m.stop > 0 && depth > 0) {
        depth -= m.stop
        if (depth <= 0) { depth = 0; close(from, k) }
      }
    }
  }

  for (let i = 0; i < notes.length;) {
    if (!notes[i].tuplet) { i++; continue }
    let end = i
    while (end < notes.length && notes[end].tuplet) end++
    if (notes.slice(i, end).some(n => marks.has(n))) marked(i, end)
    else for (let a = i; a < end;) {
      let b = a
      while (b < end && notes[b].tuplet === notes[a].tuplet) b++
      guess(a, b)
      a = b
    }
    i = end
  }
}

const restNote = (type: NoteObject['type'], dot = false): NoteObject => (
  { degree: 0, octave: 0, type, dot, tie: false, rest: true, accidental: '', slurStart: false, slurStop: false }
)

function readMember(noteEl: Element, keyStr: string): ChordMember | null {
  const pitchNode = noteEl.getElementsByTagName('pitch')[0]
  if (!pitchNode) return null
  const step = pitchNode.getElementsByTagName('step')[0].textContent!
  const alterNode = pitchNode.getElementsByTagName('alter')[0]
  const alter = alterNode ? parseFloat(alterNode.textContent!) : 0
  const octave = parseInt(pitchNode.getElementsByTagName('octave')[0].textContent!)
  let tieStop = false
  let tieStart = false
  const tieNodes = noteEl.getElementsByTagName('tie')
  for (let t = 0; t < tieNodes.length; t++) {
    if (tieNodes[t].getAttribute('type') === 'stop') tieStop = true
    if (tieNodes[t].getAttribute('type') === 'start') tieStart = true
  }
  return { pitch: pitchToJianpu(step, alter, octave, keyStr), semi: pitchToSemitones(step, alter, octave), tieStop, tieStart }
}

function readSlurEvents(noteEl: Element): SlurEvent[] {
  const events: SlurEvent[] = []
  const nodes = noteEl.getElementsByTagName('slur')
  for (let s = 0; s < nodes.length; s++) {
    const type = nodes[s].getAttribute('type')
    if (type === 'start' || type === 'stop') events.push({ type, number: nodes[s].getAttribute('number')?.trim() || '1' })
  }
  return events
}

// `fallbackKeyStr`: the key for a part that has no key signature of its own. It must be the
// one the header shows, or the degrees count from a different 1 than the label says
export function parseXMLToNoteObjects(xmlDoc: Document, fallbackKeyStr = 'C'): MeasureArray[] {
  const fifthsNodes = xmlDoc.getElementsByTagName('fifths')
  let keyStr = fifthsNodes.length > 0
    ? keyMap[parseInt(fifthsNodes[0].textContent!).toString()] || 'C'
    : fallbackKeyStr
  // Meter in force; a later <time> that differs becomes the measure's _timeSig
  let timeStr = ''
  const firstTime = xmlDoc.getElementsByTagName('time')[0]
  if (firstTime) timeStr = timeFromAttributes(firstTime) ?? ''

  // Only the first voice of the first staff becomes the melody. A piano-style part
  // writes both hands (and <backup> between them), and merging every voice into one
  // line doubled the bar length and scrambled the pitches.
  const pitchedNotes = Array.from(xmlDoc.getElementsByTagName('note')).filter(n => !isCue(n))
  const keepStaff = String(pitchedNotes.reduce((m, n) => Math.min(m, parseInt(staffOf(n)) || 1), Infinity))
  const firstOnStaff = pitchedNotes.find(n => staffOf(n) === keepStaff)
  const firstVoice = firstOnStaff ? voiceOf(firstOnStaff) : ''

  const jianpuMeasures: MeasureArray[] = []
  const measures = xmlDoc.getElementsByTagName('measure')
  let currentDivisions = 1
  // The previous note (and its semitone) when it carried <tie type="start">;
  // `arc` = the slur its pitch-changing tie turned into, when this note ended one
  let tieFrom: { note: NoteObject; semi: number; arc: SlurArc | null } | null = null
  let wedgeType: 'cresc' | 'dim' | null = null
  // Active volta (跳房子) number, carried across measures until an ending closes it
  let activeVolta: number | null = null
  // Grace note waiting for its host: attaches to the NEXT pitched note,
  // surviving measure boundaries (a grace at measure end decorates the next
  // measure's first note)
  let pendingGrace: GraceNote | null = null
  // Key / meter changes announced after the measure's first note take effect next measure
  let pendingKey = null as string | null
  let pendingTime = null as string | null

  // Slurs are tracked by `number`. The model draws one arc at a time (see slurPairs), so
  // when a slur starts on a later note while another is open the earlier one is dropped
  // (nested 1..5 with 2..3 inside shows 2..3); two starts on one note are one arc that
  // ends at the first stop. A grace note's slur opens its number as null: nothing drawn,
  // and its stop (which sits on the host note) must not close the phrase slur.
  const openSlurs = new Map<string, SlurArc | null>()
  const arcs: SlurArc[] = []
  let drawn = null as SlurArc | null
  const startArc = (note: NoteObject, number: string | null): SlurArc => {
    let arc: SlurArc
    if (drawn && drawn.note === note) arc = drawn
    else {
      if (drawn) {
        drawn.dead = true
        const cancelled = drawn
        // the flag stays when another live arc also starts on that note
        if (!arcs.some(a => a !== cancelled && !a.dead && a.note === cancelled.note)) cancelled.note.slurStart = false
      }
      arc = { note, stopped: false, dead: false }
      arcs.push(arc)
      note.slurStart = true
      drawn = arc
    }
    if (number !== null) openSlurs.set(number, arc)
    return arc
  }
  const stopArc = (arc: SlurArc, note: NoteObject) => {
    arc.stopped = true
    note.slurStop = true
    if (drawn === arc) drawn = null
  }
  // On one note stops come first, so a note can end one slur and open the next
  const applySlurs = (note: NoteObject, events: SlurEvent[]) => {
    for (const e of events) {
      if (e.type !== 'stop') continue
      const arc = openSlurs.get(e.number)
      openSlurs.delete(e.number)
      if (arc && !arc.stopped && !arc.dead) stopArc(arc, note)
    }
    for (const e of events) if (e.type === 'start') startArc(note, e.number)
  }
  const applyGraceSlurs = (events: SlurEvent[]) => {
    for (const e of events) if (e.type === 'stop' && openSlurs.get(e.number) === null) openSlurs.delete(e.number)
    for (const e of events) if (e.type === 'start') openSlurs.set(e.number, null)
  }

  for (let i = 0; i < measures.length; i++) {
    const measureNotes: MeasureArray = [] as unknown as MeasureArray
    const kids = Array.from(measures[i].children)

    // The voice to keep here: the part's first voice, or this measure's first
    // voice on the kept staff when the part's first voice is absent from it
    let keepVoice = firstVoice
    const noteEls = kids.filter(k => k.tagName === 'note' && !isCue(k) && staffOf(k) === keepStaff)
    if (noteEls.length > 0 && !noteEls.some(n => voiceOf(n) === firstVoice)) keepVoice = voiceOf(noteEls[0])

    if (pendingKey !== null) {
      if (pendingKey !== keyStr) { keyStr = pendingKey; measureNotes._key = pendingKey }
      pendingKey = null
    }
    if (pendingTime !== null) {
      if (pendingTime !== timeStr) { timeStr = pendingTime; measureNotes._timeSig = pendingTime }
      pendingTime = null
    }

    let noteSeen = false
    const applyAttributes = (attributesNode: Element) => {
      const divNode = attributesNode.getElementsByTagName('divisions')[0]
      if (divNode) currentDivisions = parseInt(divNode.textContent!) || currentDivisions

      const newKey = keyFromAttributes(attributesNode)
      if (newKey !== null && newKey !== keyStr) {
        if (noteSeen) pendingKey = newKey
        else { keyStr = newKey; measureNotes._key = newKey }
      }

      const newTime = timeFromAttributes(attributesNode)
      if (newTime !== null && newTime !== timeStr) {
        if (noteSeen) pendingTime = newTime
        else { timeStr = newTime; measureNotes._timeSig = newTime }
      }
    }

    let repeatStart = false
    let repeatEnd = false
    let endingStart: number | null = null
    let endingCloses = false
    const barlineNodes = measures[i].getElementsByTagName('barline')
    for (let b = 0; b < barlineNodes.length; b++) {
      const repeatNode = barlineNodes[b].getElementsByTagName('repeat')[0]
      if (repeatNode) {
        const dir = repeatNode.getAttribute('direction')
        if (dir === 'forward') repeatStart = true
        if (dir === 'backward') repeatEnd = true
      }
      const endingNode = barlineNodes[b].getElementsByTagName('ending')[0]
      if (endingNode) {
        const type = endingNode.getAttribute('type')
        if (type === 'start') {
          const num = parseInt((endingNode.getAttribute('number') || '').split(',')[0].trim())
          if (!Number.isNaN(num)) endingStart = num
        } else if (type === 'stop' || type === 'discontinue') {
          endingCloses = true
        }
      }
    }

    // Timeline: `pos` runs through the measure in quarters across EVERY voice (a <note>
    // that isn't a chord member or a grace advances it, <backup> / <forward> move it),
    // so a kept note's start is known even when another voice was written first.
    // A measure where some note has no <duration> can't be timed: no gap logic there.
    const timed = kids.every(k => k.tagName !== 'note' || k.getElementsByTagName('grace').length > 0 || durationOf(k) !== null)
    let pos = 0
    let maxPos = 0
    let keptEnd = 0
    let pending = null as PendingNote | null
    const tupletMarks = new Map<NoteObject, TupletMarks>()
    // A typeless rest that is the only note of the measure is a bar rest
    const keptHere = kids.filter(k => k.tagName === 'note' && !isCue(k) && staffOf(k) === keepStaff && voiceOf(k) === keepVoice
      && k.getElementsByTagName('grace').length === 0 && k.getElementsByTagName('chord').length === 0)
    const loneRest = keptHere.length === 1 && keptHere[0].getElementsByTagName('rest').length > 0 && keptHere[0].getElementsByTagName('type').length === 0
      ? keptHere[0] : null

    const pushRests = (beats: number) => {
      for (const v of splitDuration(beats)) measureNotes.push(restNote(v.type, v.dot))
      tieFrom = null
    }

    // Write the chord / note collected so far: highest pitch is the melody, the rest
    // stack below it from high to low
    const flush = () => {
      if (!pending) return
      const p = pending
      pending = null
      const byPitch = p.members.map((m, k) => ({ m, k })).sort((a, b) => b.m.semi - a.m.semi || a.k - b.k)
      const seen = new Set<number>()
      const tones = byPitch.map(x => x.m).filter(m => !seen.has(m.semi) && !!seen.add(m.semi))
      const main = tones[0] ?? null

      // Tied from the previous note when every member says so. Exporters sometimes omit
      // <tie type="stop"/>, so a tie start continues into the next note — but only at the
      // same pitch (the highest one, for a chord). A tie never joins two different
      // pitches; treating one as a tie drew the note as "-". Noteflight exports phrase
      // marks drawn with the tie tool exactly this way, so a pitch change turns the arc
      // into a slur instead.
      const isTieStop = p.members.length > 0 ? p.members.every(m => m.tieStop) : p.firstTieStop
      let tie = isTieStop
      let tieSlurFrom = null as typeof tieFrom
      if (tieFrom && main && !isTieStop) {
        if (main.semi === tieFrom.semi) tie = true
        else tieSlurFrom = tieFrom
      }

      const note: NoteObject = {
        degree: main?.pitch.degree ?? 0,
        octave: main?.pitch.octave ?? 0,
        type: p.pieces[0].type,
        dot: p.pieces[0].dot,
        tie,
        rest: p.rest,
        accidental: main?.pitch.accidental ?? '',
        slurStart: false,
        slurStop: false,
      }
      if (tones.length > 1) note.chordNotes = tones.slice(1).map(m => m.pitch)
      if (p.grace) note.graceNote = p.grace
      if (p.tuplet) note.tuplet = p.tuplet

      let tieArc = null as SlurArc | null
      if (tieSlurFrom) {
        const prev = tieSlurFrom
        if (prev.arc && prev.arc.stopped && !prev.arc.dead && drawn === null) {
          // A chain of these ties is one slur: extend it rather than stopping
          // and restarting on the same note, which the renderer can't draw
          tieArc = prev.arc
          tieArc.stopped = false
          prev.note.slurStop = false
          drawn = tieArc
        } else {
          tieArc = startArc(prev.note, null)
        }
        stopArc(tieArc, note)
      }
      applySlurs(note, p.slurEvents)
      if (p.marks.start > 0 || p.marks.stop > 0) tupletMarks.set(note, p.marks)
      if (p.articulation) note.articulation = p.articulation

      tieFrom = main && main.tieStart ? { note, semi: main.semi, arc: tieArc } : null
      measureNotes.push(note)
      p.pieces.slice(1).forEach(v => {
        // the rest of a long value: same pitch tied on, nothing else repeated
        const piece = p.rest ? restNote(v.type, v.dot) : { ...note, type: v.type, dot: v.dot, tie: true, slurStart: false, slurStop: false }
        delete piece.chordNotes
        delete piece.graceNote
        delete piece.articulation
        if (p.tuplet) piece.tuplet = p.tuplet
        measureNotes.push(piece)
      })
    }

    for (const el of kids) {
      if (el.tagName === 'attributes') { applyAttributes(el); continue }
      if (el.tagName === 'backup' || el.tagName === 'forward') {
        const moved = (durationOf(el) ?? 0) / currentDivisions
        pos = Math.max(0, pos + (el.tagName === 'forward' ? moved : -moved))
        maxPos = Math.max(maxPos, pos)
        continue
      }
      if (el.tagName !== 'note') continue
      noteSeen = true
      const isGrace = el.getElementsByTagName('grace').length > 0
      const isChord = el.getElementsByTagName('chord').length > 0
      const startPos = pos
      if (!isGrace && !isChord) {
        pos += (durationOf(el) ?? 0) / currentDivisions
        maxPos = Math.max(maxPos, pos)
      }
      // Cue notes (small notes quoting another part) and the other voices / staves
      if (isCue(el) || staffOf(el) !== keepStaff || voiceOf(el) !== keepVoice) continue

      if (isGrace) {
        flush()   // the note before it is finished, its slurs must be applied first
        // Consecutive graces: keep only the first (renderer draws a single 倚音)
        const g = parseChordNote(el, keyStr)
        if (g && !pendingGrace) pendingGrace = g
        applyGraceSlurs(readSlurEvents(el))
        continue
      }

      if (isChord) {
        if (pending && !pending.rest) {
          const member = readMember(el, keyStr)
          if (member) pending.members.push(member)
          pending.slurEvents.push(...readSlurEvents(el))
          const m = readTupletMarks(el)
          pending.marks = { start: pending.marks.start + m.start, stop: pending.marks.stop + m.stop }
        }
        continue
      }

      flush()   // (a dropped note leaves nothing pending, so its chord members fall away too)
      if (timed) {
        // A second layer written without <voice> after a <backup> starts inside the
        // notes already kept: drop it. A gap before the note is silence in this voice.
        if (startPos < keptEnd - TIMELINE_EPS) continue
        if (startPos > keptEnd + TIMELINE_EPS) pushRests(startPos - keptEnd)
        keptEnd = pos
      }

      const duration = durationOf(el)
      const beatValue = (duration ?? 0) / currentDivisions

      let noteType: NoteObject['type'] = 'quarter'
      const typeNode = el.getElementsByTagName('type')[0]
      let hasDot = el.getElementsByTagName('dot').length > 0

      const mappedType = typeNode ? NOTE_TYPES[typeNode.textContent!.trim()] : undefined
      if (mappedType) {
        noteType = mappedType
      } else if (duration !== null) {
        if (beatValue >= 3.75) noteType = 'whole'
        else if (beatValue >= 2.75) { noteType = 'half'; hasDot = true }
        else if (beatValue >= 1.75) noteType = 'half'
        else if (beatValue >= 1.25) { noteType = 'quarter'; hasDot = true }
        else if (beatValue >= 0.75) noteType = 'quarter'
        else if (beatValue >= 0.6) { noteType = 'eighth'; hasDot = true }
        else if (beatValue >= 0.35) noteType = 'eighth'
        else if (beatValue >= 0.15) noteType = '16th'
        else noteType = '32nd'
      }

      const restNode = el.getElementsByTagName('rest')[0]
      const isRest = restNode !== undefined
      // A whole-measure rest is a whole rest whatever its <type> or duration say
      // (in 3/4 the duration alone would make it a dotted half)
      const barRest = isRest && (restNode.getAttribute('measure') === 'yes' || el === loneRest)
      if (barRest) { noteType = 'whole'; hasDot = false }
      let pieces = [{ type: noteType, dot: hasDot }]
      const dots = el.getElementsByTagName('dot').length
      const paired = isPairedTremolo(el)
      if (paired && duration !== null && beatValue > 0) {
        pieces = splitDuration(beatValue)
      } else if (dots >= 2 && !barRest) {
        // A NoteObject holds one dot: a double-dotted half (3.5 beats) was read as 3.
        // Tie on the rest of the written length instead.
        const base = BEAT_UNIT_QUARTERS[typeNode?.textContent?.trim() ?? '']
        if (base !== undefined) pieces = splitDuration(base * (2 - 2 ** -dots))
      }

      const first = isRest ? null : readMember(el, keyStr)
      let firstTieStop = false
      const tieNodes = el.getElementsByTagName('tie')
      for (let t = 0; t < tieNodes.length; t++) if (tieNodes[t].getAttribute('type') === 'stop') firstTieStop = true

      let grace: GraceNote | null = null
      if (!isRest && pendingGrace) { grace = pendingGrace; pendingGrace = null }

      let tuplet: number | undefined
      const timeModNode = el.getElementsByTagName('time-modification')[0]
      if (timeModNode) {
        const actualNode = timeModNode.getElementsByTagName('actual-notes')[0]
        const actual = actualNode ? parseInt(actualNode.textContent!) : 0
        if (actual >= 2 && !paired) tuplet = actual
      }

      // A note can carry several <notations> blocks (Finale and MuseScore write the
      // slur in one and the articulation in another), so look at the note as a whole
      const articMap: Record<string, Articulation> = {
        'accent': 'accent',
        'staccato': 'staccato',
        'tenuto': 'tenuto',
        'strong-accent': 'marcato',
      }
      let articulation: Articulation | undefined
      const articulationsNodes = el.getElementsByTagName('articulations')
      for (let n = 0; n < articulationsNodes.length && !articulation; n++) {
        for (let a = 0; a < articulationsNodes[n].children.length; a++) {
          const mapped = articMap[articulationsNodes[n].children[a].tagName.toLowerCase()]
          if (mapped) {
            articulation = mapped
            break
          }
        }
      }
      // <fermata> lives directly under <notations>, outside <articulations>
      if (!articulation && el.getElementsByTagName('fermata').length > 0) articulation = 'fermata'

      pending = {
        rest: isRest,
        pieces,
        members: first ? [first] : [],
        firstTieStop,
        tuplet,
        articulation,
        grace,
        slurEvents: readSlurEvents(el),
        marks: readTupletMarks(el),
      }
    }
    flush()
    // The kept voice stops short of what another voice (or a <forward>) reached. Never past
    // the bar, though: a second voice whose rounded durations add up to 4.25 must not give
    // a voice that already fills its 4/4 bar an extra rest
    const reach = timeStr ? Math.min(maxPos, barBeatsOf(timeStr)) : maxPos
    if (timed && measureNotes.length > 0 && reach - keptEnd >= TIMELINE_EPS) pushRests(reach - keptEnd)
    markTupletLengths(measureNotes, tupletMarks)

    measureNotes._repeatStart = repeatStart
    measureNotes._repeatEnd = repeatEnd

    // Volta: a start opens the ending; the measure carrying stop/discontinue is
    // still part of it, so assign first and clear the cursor afterwards.
    if (endingStart !== null) activeVolta = endingStart
    if (activeVolta !== null) measureNotes._volta = activeVolta
    if (endingCloses) activeVolta = null

    // Directions, dynamics and hairpins written for another staff belong to that staff
    const allDirections = Array.from(measures[i].getElementsByTagName('direction'))
    const directionNodes = allDirections.filter(d => {
      const staff = Array.from(d.children).find(c => c.tagName === 'staff')?.textContent?.trim()
      return !staff || (parseInt(staff) || 1) === parseInt(keepStaff)
    })

    let directionText = ''
    const knownKeywords = ['d.c.', 'd.s.', 'fine', 'coda', 'segno', 'al fine', 'al coda']
    for (let d = 0; d < directionNodes.length && !directionText; d++) {
      const wordsNodes = directionNodes[d].getElementsByTagName('words')
      for (let w = 0; w < wordsNodes.length; w++) {
        const text = wordsNodes[w].textContent!.trim()
        if (knownKeywords.some(kw => text.toLowerCase().includes(kw)) || classifyDirection(text) !== null) {
          directionText = text
          break
        }
      }
    }
    if (!directionText) {
      // No printed words: the sign itself (a D.S. needs its Segno to jump to), then <sound>
      if (directionNodes.some(d => d.getElementsByTagName('segno').length > 0)) directionText = 'Segno'
      else if (directionNodes.some(d => d.getElementsByTagName('coda').length > 0)) directionText = 'Coda'
      else {
        const given = (sound: Element, name: string) => {
          const v = sound.getAttribute(name)?.trim()
          return !!v && v !== 'no'
        }
        for (const sound of Array.from(measures[i].getElementsByTagName('sound'))) {
          const owner = sound.parentNode as Element | null
          if (owner?.tagName === 'direction' && !directionNodes.includes(owner)) continue
          if (sound.getAttribute('dacapo') === 'yes') directionText = 'D.C.'
          else if (given(sound, 'dalsegno')) directionText = 'D.S.'
          else if (given(sound, 'fine')) directionText = 'Fine'
          else if (given(sound, 'segno')) directionText = 'Segno'
          if (directionText) break
        }
      }
    }
    measureNotes._direction = directionText

    let dynamicText = ''
    for (let d = 0; d < directionNodes.length && !dynamicText; d++) {
      const dynamicsNode = directionNodes[d].getElementsByTagName('dynamics')[0]
      if (dynamicsNode && dynamicsNode.children.length > 0) {
        const mark = dynamicsNode.children[0]
        // <other-dynamics>sffz</other-dynamics> carries the mark as text; Route B's &xx holds only letters
        dynamicText = mark.tagName.toLowerCase() === 'other-dynamics'
          ? (mark.textContent ?? '').replace(/[^A-Za-z]/g, '')
          : mark.tagName.toLowerCase()
      }
    }
    measureNotes._dynamic = dynamicText

    // Walk every wedge in order: a hairpin that opens and closes inside this
    // measure must not stay open for the rest of the piece. Such a measure still
    // draws its own hairpin; only the next measure starts clean.
    const wedgeNodes = directionNodes.flatMap(d => Array.from(d.getElementsByTagName('wedge')))
    let openedHere: 'cresc' | 'dim' | null = null
    let closedHere = false
    for (let w = 0; w < wedgeNodes.length; w++) {
      const wType = wedgeNodes[w].getAttribute('type')
      if (wType === 'crescendo') { wedgeType = 'cresc'; openedHere = 'cresc' }
      else if (wType === 'diminuendo') { wedgeType = 'dim'; openedHere = 'dim' }
      else if (wType === 'stop') { wedgeType = null; closedHere = true }
    }
    measureNotes._wedge = wedgeType ?? (closedHere ? openedHere : null)

    // A bar the kept voice is silent in still counts: dropping it shifted every later
    // bar number. Only a pickup's leftover half bar (implicit, nothing in it at all) goes.
    if (measureNotes.length === 0) {
      const leftover = measures[i].getAttribute('implicit') === 'yes' && !kids.some(k => k.tagName === 'note')
        && !repeatStart && !repeatEnd && allDirections.length === 0 && !measureNotes._key && !measureNotes._timeSig
      if (leftover) continue
      measureNotes.push(restNote('whole'))
      tieFrom = null   // a tie cannot reach over a silent bar
    }
    // 弱起: an incomplete first measure (MusicXML marks it implicit or numbers it 0)
    if (jianpuMeasures.length === 0 && (measures[i].getAttribute('implicit') === 'yes' || measures[i].getAttribute('number') === '0')) measureNotes._pickup = true
    jianpuMeasures.push(measureNotes)
  }

  // A slur that never closed would trail an arc across the rest of the piece
  for (const arc of arcs) if (!arc.stopped && !arc.dead) arc.note.slurStart = false

  return jianpuMeasures
}

/**
 * A MIDI file → Jianpu measures. Takes the pitched track with the most notes,
 * snaps onsets to a grid, and writes each note from its onset to the next one,
 * so the bars add up; real silences become rests.
 */
export function midiToJianpu(midi: Midi): {
  measures: MeasureArray[]
  keyStr: string
  timeStr: string
  tempoStr: string
  titleStr: string
} {
  const ppq = midi.header.ppq
  const keySigs = (midi.header.keySignatures || []).slice().sort((a, b) => a.ticks - b.ticks)
  const keyStr = keySigs[0]?.key || 'C'

  let bestTrack = null
  let maxNotes = 0
  for (const track of midi.tracks) {
    // A drum track's "pitches" pick sounds, not notes
    if (track.instrument.percussion || track.channel === 9) continue
    if (track.notes.length > maxNotes) { maxNotes = track.notes.length; bestTrack = track }
  }
  if (!bestTrack) throw new Error('这个 MIDI 里没有可转换的音符（打击乐轨不算）')

  // Chords keep their highest pitch per tick
  const TICK_SNAP = Math.max(2, Math.round(ppq / 120))
  const tickMap = new Map<number, { midi: number; ticks: number; durationTicks: number }>()
  for (const n of bestTrack.notes) {
    const snapped = Math.round(n.ticks / TICK_SNAP) * TICK_SNAP
    if (!tickMap.has(snapped) || n.midi > tickMap.get(snapped)!.midi) tickMap.set(snapped, n)
  }
  const melodyNotes = [...tickMap.values()].sort((a, b) => a.ticks - b.ticks)

  // Grid: 16ths, or 32nds when the file really contains them (onsets sitting
  // exactly on odd 32nd positions)
  const on32nd = melodyNotes.filter(n => {
    const u = n.ticks / (ppq / 8)
    return Math.abs(u - Math.round(u)) < 0.1 && Math.round(u) % 2 === 1
  }).length
  const unit = on32nd >= Math.max(2, melodyNotes.length * 0.05) ? ppq / 8 : ppq / 4
  const unitsPerBeat = ppq / unit

  // Meter: every valid signature in tick order, a later one on the same tick winning.
  // A 1-beat signature is believed only when another follows it (a pickup written as
  // 1/4); a lone 1/4 is how some exporters spell "no meter". 4/4 until the first one.
  interface MeterSegment { startUnit: number; barUnits: number; label: string; beats: number }
  const segments: MeterSegment[] = []
  const rawSigs = (midi.header.timeSignatures ?? [])
    .map((s, k) => ({ ticks: s.ticks, beats: s.timeSignature[0], beatType: s.timeSignature[1], k }))
    .filter(s => Number.isInteger(s.beats) && s.beats >= 1 && s.beats <= 12 && [1, 2, 4, 8, 16].includes(s.beatType))
    .sort((a, b) => a.ticks - b.ticks || a.k - b.k)
  const barUnitsOf = (beats: number, beatType: number) => Math.max(1, Math.round(beats * (4 / beatType) * ppq / unit))
  for (const s of rawSigs) {
    const seg = { startUnit: Math.round(s.ticks / unit), barUnits: barUnitsOf(s.beats, s.beatType), label: `${s.beats}/${s.beatType}`, beats: s.beats }
    if (segments.length > 0 && segments[segments.length - 1].startUnit === seg.startUnit) segments[segments.length - 1] = seg
    else segments.push(seg)
  }
  while (segments.length > 0 && segments[segments.length - 1].beats === 1) segments.pop()
  if (segments.length === 0 || segments[0].startUnit > 0) segments.unshift({ startUnit: 0, barUnits: barUnitsOf(4, 4), label: '4/4', beats: 4 })
  const longestBar = Math.max(...segments.map(g => g.barUnits))

  // Notes landing on the same grid point collapse to the higher one
  const quantized: Array<{ s: number; n: { midi: number; ticks: number; durationTicks: number } }> = []
  for (const n of melodyNotes) {
    const s = Math.round(n.ticks / unit)
    const last = quantized[quantized.length - 1]
    if (last && last.s === s) { if (n.midi > last.n.midi) last.n = n }
    else quantized.push({ s, n })
  }

  // Timeline in grid units: each note runs to the next onset, unless it stops
  // clearly earlier (more than LEGATO_TICKS of silence), in which case it keeps
  // its own length and a rest fills the gap
  const LEGATO_TICKS = ppq / 5
  const events: Array<{ s: number; e: number; midi: number | null }> = []
  if (quantized[0].s > 0) events.push({ s: 0, e: quantized[0].s, midi: null })
  for (let k = 0; k < quantized.length; k++) {
    const { s, n } = quantized[k]
    const next = quantized[k + 1]
    // (a stray never-ending note must not turn into thousands of tied bars)
    const ownEnd = Math.min(s + longestBar * 8, Math.max(s + 1, Math.round((n.ticks + n.durationTicks) / unit)))
    const e = !next ? ownEnd
      : next.n.ticks - (n.ticks + n.durationTicks) <= LEGATO_TICKS ? next.s
      : Math.min(next.s, ownEnd)
    events.push({ s, e, midi: n.midi })
    if (next && e < next.s) events.push({ s: e, e: next.s, midi: null })
  }
  const endUnit = events[events.length - 1].e

  // Bars, from each signature's tick on, each with its own length; a bar the next
  // signature arrives in the middle of ends there
  const bars: Array<{ start: number; end: number; seg: number; natural: boolean }> = []
  segments.forEach((seg, g) => {
    const limit = g + 1 < segments.length ? segments[g + 1].startUnit : Infinity
    for (let cur = seg.startUnit; cur < limit && cur < endUnit;) {
      const end = Math.min(cur + seg.barUnits, limit)
      bars.push({ start: cur, end, seg: g, natural: end - cur === seg.barUnits })
      cur = end
    }
  })

  // A first segment that is one short bar, shorter than the meter after it, is a pickup
  // (弱起 written as 1/4 then 4/4): the header shows the real meter
  let timeStr = segments[0].label
  const pickup = segments.length > 1 && bars.filter(b => b.seg === 0).length === 1
    && bars[0].end - bars[0].start < segments[1].barUnits
  if (pickup) timeStr = segments[1].label

  // Cut the timeline at barlines; a note running across one continues, tied
  const pieces: Array<Array<{ len: number; midi: number | null; tiedIn: boolean }>> = bars.map(() => [])
  let bi = 0
  for (const ev of events) {
    for (let cur = ev.s; cur < ev.e;) {
      while (bi < bars.length - 1 && cur >= bars[bi].end) bi++
      const end = bi === bars.length - 1 ? ev.e : Math.min(ev.e, bars[bi].end)
      pieces[bi].push({ len: end - cur, midi: ev.midi, tiedIn: cur > ev.s })
      cur = end
    }
  }

  // A key signature change belongs to the first measure at or after it
  const keyChanges = new Map<number, string>()
  for (const k of keySigs.slice(1)) {
    const at = bars.findIndex(b => b.start * unit >= k.ticks - ppq / 8)
    if (k.key && at >= 0) keyChanges.set(at, k.key)
  }

  const measures: MeasureArray[] = []
  let currentKey = keyStr
  let meter = timeStr
  for (let mi = 0; mi < bars.length; mi++) {
    const measure = [] as unknown as MeasureArray
    const newKey = keyChanges.get(mi)
    if (newKey && newKey !== currentKey) { currentKey = newKey; measure._key = newKey }
    // The first measure of a changed meter says so; the header covers the opening one
    const label = segments[bars[mi].seg].label
    if (mi > 0 && bars[mi].seg !== bars[mi - 1].seg && label !== meter) { measure._timeSig = label; meter = label }

    const ps = pieces[mi]
    if (ps.length === 1 && ps[0].midi === null && bars[mi].natural && ps[0].len === bars[mi].end - bars[mi].start) {
      measure.push(restNote('whole'))
    } else {
      for (const p of ps) {
        const pitch = p.midi === null ? null : semitoneToJianpu(p.midi - 12, currentKey)
        splitDuration(p.len / unitsPerBeat).forEach((v, vi) => {
          measure.push(pitch
            ? { ...pitch, type: v.type, dot: v.dot, tie: p.tiedIn || vi > 0, rest: false, slurStart: false, slurStop: false }
            : restNote(v.type, v.dot))
        })
      }
    }
    if (mi === 0 && pickup) measure._pickup = true
    measures.push(measure)
  }

  return {
    measures,
    keyStr,
    timeStr,
    tempoStr: midi.header.tempos?.length > 0 ? Math.round(midi.header.tempos[0].bpm).toString() : '',
    titleStr: midi.header.name || '',
  }
}

// The key a mid-piece key change lands on when the whole piece moves by `semitones`;
// spelled like the transpose selector's list, or as the chosen target when it is that key
function shiftKey(keyStr: string, semitones: number, target: string): string {
  const pc = mod(tonicSemiOf(keyStr) + semitones, 12)
  return mod(tonicSemiOf(target), 12) === pc ? target : PREFERRED_KEYS[pc]
}

export function transposeNoteObjects(
  measures: Measure[],
  fromKeyStr: string,
  toKeyStr: string,
): Measure[] {
  if (fromKeyStr === toKeyStr) return measures

  const interval = mod(tonicSemiOf(toKeyStr) - tonicSemiOf(fromKeyStr), 12)

  function reexpress(degree: number, octave: number, accidental: string, fromKey: string, toKey: string) {
    return semitoneToJianpu(jianpuToSemitone(degree, octave, accidental, fromKey), toKey)
  }

  function transposeNote(note: NoteObject, fromKey: string, toKey: string): NoteObject {
    if (note.rest || note.degree === 0) return { ...note }
    const { degree, octave, accidental } = reexpress(note.degree, note.octave, note.accidental, fromKey, toKey)
    const result = { ...note, degree, octave, accidental }
    if (note.chordNotes) {
      result.chordNotes = note.chordNotes.map(cn => reexpress(cn.degree, cn.octave, cn.accidental, fromKey, toKey))
    }
    if (note.graceNote) {
      result.graceNote = reexpress(note.graceNote.degree, note.graceNote.octave, note.graceNote.accidental, fromKey, toKey)
    }
    return result
  }

  // A _key measure switches the source key; its transposed counterpart moves by
  // the same interval as the whole piece
  let fromKey = fromKeyStr
  let toKey = toKeyStr
  return measures.map(measure => {
    if (!Array.isArray(measure)) return measure
    let newKey: string | undefined
    if (measure._key && measure._key !== fromKey) {
      fromKey = measure._key
      const shifted = shiftKey(fromKey, interval, toKeyStr)
      if (shifted !== toKey) { toKey = shifted; newKey = shifted }
    }
    const newMeasure = measure.map(n => transposeNote(n, fromKey, toKey)) as MeasureArray
    // Every property the measure carries (_pickup, and whatever is added next), not a list
    // that has to be kept in step; only _key is the transposition's own to set
    for (const k of Object.keys(measure)) {
      if (!/^\d+$/.test(k)) (newMeasure as unknown as Record<string, unknown>)[k] = (measure as unknown as Record<string, unknown>)[k]
    }
    delete newMeasure._key
    if (newKey) newMeasure._key = newKey
    return newMeasure
  })
}
