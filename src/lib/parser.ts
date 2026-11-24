import type { NoteObject, MeasureArray, Measure, ChordNote, GraceNote, Articulation } from '@/types/score'
import type { Midi } from '@tonejs/midi'

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

/**
 * Tempo in quarter notes per minute, from the first <metronome> that has a
 * <per-minute>. Playback BPM counts quarters, so "half = 60" is 120 and
 * "dotted quarter = 60" is 90. '' when the score gives none.
 */
export function parseMetronomeTempo(xmlDoc: Document): string {
  const metronomes = xmlDoc.getElementsByTagName('metronome')
  for (let i = 0; i < metronomes.length; i++) {
    const text = metronomes[i].getElementsByTagName('per-minute')[0]?.textContent ?? ''
    const perMinute = parseFloat(text.match(/\d+(?:\.\d+)?/)?.[0] ?? '')
    if (!(perMinute > 0)) continue
    const unit = metronomes[i].getElementsByTagName('beat-unit')[0]?.textContent?.trim() ?? 'quarter'
    let quarters = BEAT_UNIT_QUARTERS[unit] ?? 1
    if (metronomes[i].getElementsByTagName('beat-unit-dot').length > 0) quarters *= 1.5
    return String(Math.round(perMinute * quarters))
  }
  return ''
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
}

/** Position differences below this many quarters are rounding, not music */
const TIMELINE_EPS = 0.1

const durationOf = (el: Element): number | null => {
  const v = parseFloat(el.getElementsByTagName('duration')[0]?.textContent ?? '')
  return Number.isFinite(v) ? v : null
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
      if (isRest && restNode.getAttribute('measure') === 'yes') { noteType = 'whole'; hasDot = false }

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
        if (actual >= 2) tuplet = actual
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
        pieces: [{ type: noteType, dot: hasDot }],
        members: first ? [first] : [],
        firstTieStop,
        tuplet,
        articulation,
        grace,
        slurEvents: readSlurEvents(el),
      }
    }
    flush()
    // The kept voice stops short of what another voice (or a <forward>) reached
    if (timed && measureNotes.length > 0 && maxPos - keptEnd >= TIMELINE_EPS) pushRests(maxPos - keptEnd)

    measureNotes._repeatStart = repeatStart
    measureNotes._repeatEnd = repeatEnd

    // Volta: a start opens the ending; the measure carrying stop/discontinue is
    // still part of it, so assign first and clear the cursor afterwards.
    if (endingStart !== null) activeVolta = endingStart
    if (activeVolta !== null) measureNotes._volta = activeVolta
    if (endingCloses) activeVolta = null

    let directionText = ''
    const directionNodes = measures[i].getElementsByTagName('direction')
    const knownKeywords = ['d.c.', 'd.s.', 'fine', 'coda', 'segno', 'al fine', 'al coda']
    for (let d = 0; d < directionNodes.length; d++) {
      const wordsNodes = directionNodes[d].getElementsByTagName('words')
      for (let w = 0; w < wordsNodes.length; w++) {
        const text = wordsNodes[w].textContent!.trim()
        if (knownKeywords.some(kw => text.toLowerCase().includes(kw))) {
          directionText = text
          break
        }
      }
      if (directionText) break
    }
    measureNotes._direction = directionText

    let dynamicText = ''
    for (let d = 0; d < directionNodes.length; d++) {
      const dynamicsNode = directionNodes[d].getElementsByTagName('dynamics')[0]
      if (dynamicsNode && dynamicsNode.children.length > 0) {
        dynamicText = dynamicsNode.children[0].tagName.toLowerCase()
        break
      }
    }
    measureNotes._dynamic = dynamicText

    // Walk every wedge in order: a hairpin that opens and closes inside this
    // measure must not stay open for the rest of the piece. Such a measure still
    // draws its own hairpin; only the next measure starts clean.
    const wedgeNodes = measures[i].getElementsByTagName('wedge')
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
        && !repeatStart && !repeatEnd && directionNodes.length === 0 && !measureNotes._key && !measureNotes._timeSig
      if (leftover) continue
      measureNotes.push(restNote('whole'))
    }
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
  if (!bestTrack) throw new Error('No notes found in MIDI.')

  // Chords keep their highest pitch per tick
  const TICK_SNAP = Math.max(2, Math.round(ppq / 120))
  const tickMap = new Map<number, { midi: number; ticks: number; durationTicks: number }>()
  for (const n of bestTrack.notes) {
    const snapped = Math.round(n.ticks / TICK_SNAP) * TICK_SNAP
    if (!tickMap.has(snapped) || n.midi > tickMap.get(snapped)!.midi) tickMap.set(snapped, n)
  }
  const melodyNotes = [...tickMap.values()].sort((a, b) => a.ticks - b.ticks)

  // A valid time signature always wins; 4/4 is only the answer when there is none
  let beats = 4
  let beatType = 4
  if (midi.header.timeSignatures?.length > 0) {
    const [rawBeats, rawBeatType] = midi.header.timeSignatures[0].timeSignature
    if ([2, 4, 8, 16].includes(rawBeatType) && rawBeats >= 2 && rawBeats <= 12) {
      beats = rawBeats
      beatType = rawBeatType
    }
  }
  const measureTicks = beats * (4 / beatType) * ppq

  // Grid: 16ths, or 32nds when the file really contains them (onsets sitting
  // exactly on odd 32nd positions)
  const on32nd = melodyNotes.filter(n => {
    const u = n.ticks / (ppq / 8)
    return Math.abs(u - Math.round(u)) < 0.1 && Math.round(u) % 2 === 1
  }).length
  const unit = on32nd >= Math.max(2, melodyNotes.length * 0.05) ? ppq / 8 : ppq / 4
  const unitsPerBeat = ppq / unit
  const measureUnits = Math.round(measureTicks / unit)

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
    const ownEnd = Math.min(s + measureUnits * 8, Math.max(s + 1, Math.round((n.ticks + n.durationTicks) / unit)))
    const e = !next ? ownEnd
      : next.n.ticks - (n.ticks + n.durationTicks) <= LEGATO_TICKS ? next.s
      : Math.min(next.s, ownEnd)
    events.push({ s, e, midi: n.midi })
    if (next && e < next.s) events.push({ s: e, e: next.s, midi: null })
  }

  // Cut the timeline at barlines; a note running across one continues, tied
  const pieces: Array<Array<{ len: number; midi: number | null; tiedIn: boolean }>> = []
  for (const ev of events) {
    for (let cur = ev.s; cur < ev.e;) {
      const mi = Math.floor(cur / measureUnits)
      const end = Math.min(ev.e, (mi + 1) * measureUnits)
      if (!pieces[mi]) pieces[mi] = []
      pieces[mi].push({ len: end - cur, midi: ev.midi, tiedIn: cur > ev.s })
      cur = end
    }
  }

  // A key signature change belongs to the first measure at or after it
  const keyChanges = new Map<number, string>()
  for (const k of keySigs.slice(1)) {
    if (k.key) keyChanges.set(Math.max(0, Math.ceil((k.ticks - ppq / 8) / measureTicks)), k.key)
  }

  const measures: MeasureArray[] = []
  let currentKey = keyStr
  for (let mi = 0; mi < pieces.length; mi++) {
    const measure = [] as unknown as MeasureArray
    const newKey = keyChanges.get(mi)
    if (newKey && newKey !== currentKey) { currentKey = newKey; measure._key = newKey }

    const ps = pieces[mi]
    if (ps.length === 1 && ps[0].midi === null && ps[0].len === measureUnits) {
      measure.push({ degree: 0, octave: 0, type: 'whole', dot: false, tie: false, rest: true, accidental: '', slurStart: false, slurStop: false })
    } else {
      for (const p of ps) {
        const pitch = p.midi === null ? null : semitoneToJianpu(p.midi - 12, currentKey)
        splitDuration(p.len / unitsPerBeat).forEach((v, vi) => {
          measure.push(pitch
            ? { ...pitch, type: v.type, dot: v.dot, tie: p.tiedIn || vi > 0, rest: false, slurStart: false, slurStop: false }
            : { degree: 0, octave: 0, type: v.type, dot: v.dot, tie: false, rest: true, accidental: '', slurStart: false, slurStop: false })
        })
      }
    }
    measures.push(measure)
  }

  return {
    measures,
    keyStr,
    timeStr: `${beats}/${beatType}`,
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
    newMeasure._repeatStart = measure._repeatStart
    newMeasure._repeatEnd = measure._repeatEnd
    newMeasure._direction = measure._direction
    newMeasure._dynamic = measure._dynamic
    newMeasure._wedge = measure._wedge
    newMeasure._volta = measure._volta
    newMeasure._timeSig = measure._timeSig
    if (newKey) newMeasure._key = newKey
    return newMeasure
  })
}
