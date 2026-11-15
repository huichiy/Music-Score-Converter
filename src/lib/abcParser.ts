import type { GraceNote, MeasureArray, NoteObject } from '@/types/score'
import { keyMap, pitchToJianpu, pitchToSemitones, splitDuration } from './parser'

// Sharps (+) / flats (-) of each major key, and how far a mode's signature sits
// from the major key on the same tonic (Dorian = two flats fewer)
const MAJOR_FIFTHS: Record<string, number> = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, F: -1 }
const MODE_FIFTHS: Record<string, number> = {
  maj: 0, ion: 0, mix: -1, dor: -2, min: -3, aeo: -3, m: -3, phr: -4, lyd: 1, loc: -5,
}

/**
 * ABC `K:` value → the key signature's sharps (+) / flats (-), or null when it
 * can't be read. Jianpu counts degrees from the major key that shares the
 * signature, so "A minor", "Am" and "Ador" give 0, 0 and 1 (C, C and G).
 */
function abcKeyFifths(val: string): number | null {
  const m = val.trim().match(/^([A-G])([#b]?)\s*([A-Za-z]*)/)
  if (!m) return null
  const mode = m[3].toLowerCase().slice(0, 3)
  const fifths = MAJOR_FIFTHS[m[1]] + (m[2] === '#' ? 7 : m[2] === 'b' ? -7 : 0) + (MODE_FIFTHS[mode] ?? 0)
  return fifths >= -7 && fifths <= 7 ? fifths : null
}

function keySignatureAccidentals(fifths: number): Record<string, number> {
  const sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
  const flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F']
  const acc: Record<string, number> = {}
  if (fifths > 0) for (let k = 0; k < fifths; k++) acc[sharpOrder[k]] = 1
  if (fifths < 0) for (let k = 0; k < -fifths; k++) acc[flatOrder[k]] = -1
  return acc
}

function parseDuration(s: string, i: number): { num: number; den: number; consumed: number } {
  const start = i
  let num = 1, den = 1
  const nm = s.slice(i).match(/^(\d+)/)
  if (nm) { num = parseInt(nm[1]); i += nm[1].length }
  if (i < s.length && s[i] === '/') {
    // "/" halves, "//" quarters, "/4" is a quarter too
    let slashes = 0
    while (s[i] === '/') { slashes++; i++ }
    const dm = slashes === 1 ? s.slice(i).match(/^(\d+)/) : null
    if (dm) { den = parseInt(dm[1]); i += dm[1].length }
    else den = 2 ** slashes
  }
  return { num, den, consumed: i - start }
}

interface AbcPitch { step: string; alter: number; octave: number; semi: number; end: number }

export function parseABC(text: string, filename: string): {
  measures: MeasureArray[]
  keyStr: string
  timeStr: string
  titleStr: string
  tempoStr: string
} {
  let titleStr = filename.replace(/\.[^/.]+$/, '')
  let timeStr = '4/4'
  let fifths = 0
  let tempoStr = ''
  let defaultL: number | null = null
  // Multi-voice ABC (V:1, V:2 …): only the first voice is converted
  let firstVoice = null as string | null

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let bodyStart = lines.length

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim()
    if (!line || line.startsWith('%')) continue
    const m = line.match(/^([A-Za-z]):\s*(.*)/)
    if (!m) { bodyStart = li; break }
    const tag = m[1].toUpperCase()
    const val = m[2].trim()
    if (tag === 'T') titleStr = val
    else if (tag === 'M') timeStr = val === 'C' ? '4/4' : val === 'C|' ? '2/2' : val
    else if (tag === 'L') {
      const lm = val.match(/(\d+)\/(\d+)/)
      if (lm) defaultL = parseInt(lm[1]) / parseInt(lm[2])
    } else if (tag === 'Q') {
      const qm = val.match(/(\d+)\s*$/)
      if (qm) tempoStr = qm[1]
    } else if (tag === 'V') {
      if (firstVoice === null) firstVoice = val.split(/\s+/)[0]
    } else if (tag === 'K') {
      fifths = abcKeyFifths(val) ?? 0
      bodyStart = li + 1
      break
    }
  }

  const [mb, md] = timeStr.split('/').map(Number)
  if (!defaultL) defaultL = mb / md < 0.75 ? 1 / 16 : 1 / 8
  let beatsPerUnit = defaultL * 4

  let keyStr = keyMap[fifths.toString()]
  const headerKey = keyStr
  let keySigAcc = keySignatureAccidentals(fifths)

  const measures: MeasureArray[] = []
  const newMeasure = () => [] as unknown as MeasureArray
  let cur = newMeasure()
  let measureAcc: Record<string, number> = {}
  let activeVoice: string | null = firstVoice

  // A `-` seen: the next note continues the tie (only if it is the same pitch)
  let pendingTie = false
  let lastSemi = null as number | null
  // (3 etc.: the next N notes carry tuplet = p
  let tupletN = 0
  let tupletLeft = 0
  let pendingGrace = null as GraceNote | null
  // Broken rhythm: A>B stretches A and shrinks B, so B's length waits here
  let brokenFactor = 1
  // Key / meter changes mid-measure take effect with the next measure; _key and
  // _timeSig are stamped on the measure the first time its key / meter differs
  let timeNow = timeStr
  let stampedKey = keyStr
  let stampedTime = timeStr
  let deferredFifths = null as number | null
  let deferredTime = null as string | null

  const setKey = (f: number) => { keyStr = keyMap[f.toString()]; keySigAcc = keySignatureAccidentals(f) }

  const flush = () => {
    if (cur.length > 0) { measures.push(cur); cur = newMeasure(); measureAcc = {} }
    if (deferredFifths !== null) { setKey(deferredFifths); deferredFifths = null }
    if (deferredTime !== null) { timeNow = deferredTime; deferredTime = null }
  }

  const applyField = (tag: string, val: string) => {
    if (tag === 'V') {
      const id = val.split(/\s+/)[0]
      if (firstVoice === null) firstVoice = id
      activeVoice = id
      return
    }
    if (activeVoice !== firstVoice) return
    if (tag === 'K') {
      const f = abcKeyFifths(val)
      if (f === null) return
      if (cur.length > 0) deferredFifths = f
      else setKey(f)
    } else if (tag === 'L') {
      const lm = val.match(/(\d+)\/(\d+)/)
      if (lm) beatsPerUnit = (parseInt(lm[1]) / parseInt(lm[2])) * 4
    } else if (tag === 'M') {
      const t = val === 'C' ? '4/4' : val === 'C|' ? '2/2' : val
      if (!/^\d+\/\d+$/.test(t)) return
      if (cur.length > 0) deferredTime = t
      else timeNow = t
    }
  }

  const readPitch = (s: string, start: number): AbcPitch | null => {
    let i = start
    let explicit: number | null = null
    if (s[i] === '^') { explicit = s[i + 1] === '^' ? 2 : 1; i += explicit }
    else if (s[i] === '_') { explicit = s[i + 1] === '_' ? -2 : -1; i -= explicit }
    else if (s[i] === '=') { explicit = 0; i++ }
    if (!/[A-Ga-g]/.test(s[i] ?? '')) return null

    const step = s[i].toUpperCase()
    let octave = s[i] >= 'a' ? 5 : 4
    i++
    while (s[i] === "'") { octave++; i++ }
    while (s[i] === ',') { octave--; i++ }

    let alter: number
    if (explicit !== null) {
      alter = explicit
      measureAcc[step] = alter
    } else if (step in measureAcc) {
      alter = measureAcc[step]
    } else {
      alter = keySigAcc[step] || 0
    }
    return { step, alter, octave, semi: pitchToSemitones(step, alter, octave), end: i }
  }

  // `>` / `<` after a note: this note x1.5 or x0.5, the next one the rest of the pair
  const readBroken = (s: string, i: number): { first: number; next: number; end: number } => {
    const c = s[i]
    if (c !== '>' && c !== '<') return { first: 1, next: 1, end: i }
    let j = i
    while (s[j] === c) j++
    const short = 2 ** -(j - i)
    const long = 2 - short
    return { first: c === '>' ? long : short, next: c === '>' ? short : long, end: j }
  }

  // A rest when `pitches` is empty; otherwise the highest pitch is the melody and
  // the rest become chordNotes, like the other parsers' double stops
  const emit = (pitches: AbcPitch[], rawBeats: number) => {
    const beats = rawBeats * brokenFactor
    brokenFactor = 1
    if (cur.length === 0) {
      if (keyStr !== stampedKey) { cur._key = keyStr; stampedKey = keyStr }
      if (timeNow !== stampedTime) { cur._timeSig = timeNow; stampedTime = timeNow }
    }

    const sorted = pitches.slice().sort((a, b) => b.semi - a.semi)
    const top = sorted[0]
    const melody = top ? pitchToJianpu(top.step, top.alter, top.octave, keyStr) : null
    // A tie only joins two notes of the same pitch; anything else would draw the
    // note as "-" and lose its pitch
    const tieIn = pendingTie && top !== undefined && top.semi === lastSemi
    pendingTie = false
    lastSemi = top ? top.semi : null

    splitDuration(beats).forEach((v, vi) => {
      // An unrepresentable length (5 beats) comes out as tied pieces
      const note: NoteObject = melody
        ? { ...melody, type: v.type, dot: v.dot, tie: vi > 0 || tieIn, rest: false, slurStart: false, slurStop: false }
        : { degree: 0, octave: 0, type: v.type, dot: v.dot, tie: false, rest: true, accidental: '', slurStart: false, slurStop: false }
      if (vi === 0) {
        if (sorted.length > 1) note.chordNotes = sorted.slice(1).map(p => pitchToJianpu(p.step, p.alter, p.octave, keyStr))
        if (melody && pendingGrace) { note.graceNote = pendingGrace; pendingGrace = null }
        if (tupletLeft > 0) { note.tuplet = tupletN; tupletLeft-- }
      }
      cur.push(note)
    })
  }

  const scan = (body: string) => {
    let i = 0
    while (i < body.length) {
      const ch = body[i]

      if (/\s/.test(ch)) { i++; continue }

      // Inline field: [K:G] [M:3/4] [L:1/16] [V:2]. Voice switches must be seen
      // even while another voice is being skipped
      const inline = body.slice(i).match(/^\[([A-Za-z]):([^\]]*)\]/)
      if (inline) {
        applyField(inline[1].toUpperCase(), inline[2].trim())
        i += inline[0].length
        continue
      }
      if (activeVoice !== firstVoice) { i++; continue }

      // Barlines, including |] [| || and the repeat forms |: :| ::
      if (ch === '|' || ch === ':' || (ch === '[' && body[i + 1] === '|')) {
        let j = i
        while (j < body.length) {
          const c = body[j]
          if (c === '|' || c === ':') j++
          else if (c === ']' && body[j - 1] === '|') j++
          else if (c === '[' && body[j + 1] === '|') j += 2
          else break
        }
        const bar = body.slice(i, j)
        i = j
        if (!bar.includes('|') && !bar.includes('::')) continue
        const closing = cur.length > 0 ? cur : measures[measures.length - 1]
        if ((bar.includes(':|') || bar.includes('::')) && closing) closing._repeatEnd = true
        flush()
        if (bar.includes('|:') || bar.includes('::')) cur._repeatStart = true
        continue
      }

      // Chord [CEG]2
      if (ch === '[' && /[A-Ga-g^_=]/.test(body[i + 1] ?? '')) {
        const pitches: AbcPitch[] = []
        let innerLen = 1
        let hasTie = false
        let j = i + 1
        while (j < body.length && body[j] !== ']') {
          const p = readPitch(body, j)
          if (!p) { j++; continue }
          j = p.end
          const d = parseDuration(body, j)
          j += d.consumed
          if (pitches.length === 0) innerLen = d.num / d.den
          if (body[j] === '-') { hasTie = true; j++ }
          pitches.push(p)
        }
        if (body[j] === ']') j++
        const d = parseDuration(body, j)
        j += d.consumed
        if (body[j] === '-') { hasTie = true; j++ }
        const br = readBroken(body, j)
        i = br.end
        emit(pitches, innerLen * (d.num / d.den) * beatsPerUnit * br.first)
        brokenFactor = br.next
        pendingTie = hasTie
        continue
      }

      if (ch === '[') {
        // Volta [1 [2 starts a new measure
        if (/\d/.test(body[i + 1] ?? '')) flush()
        i++
        continue
      }

      // Decorations !f! !trill! and +…+ carry letters that must not be read as notes
      if (ch === '!' || ch === '+') {
        const end = body.indexOf(ch, i + 1)
        i = end === -1 ? i + 1 : end + 1
        continue
      }

      // Grace group {gab}: the first note becomes the grace note of the next real one
      if (ch === '{') {
        const end = body.indexOf('}', i + 1)
        const inner = body.slice(i + 1, end === -1 ? undefined : end)
        let first: AbcPitch | null = null
        for (let j = 0; j < inner.length;) {
          const p = readPitch(inner, j)
          if (p) { first = first ?? p; j = p.end } else j++
        }
        if (first && !pendingGrace) pendingGrace = pitchToJianpu(first.step, first.alter, first.octave, keyStr)
        i = end === -1 ? body.length : end + 1
        continue
      }

      // (3CDE puts the next 3 notes in a triplet; a plain ( is a slur, not drawn yet
      if (ch === '(') {
        const tm = body.slice(i).match(/^\((\d+)(?::(\d*))?(?::(\d*))?/)
        if (tm) {
          const p = parseInt(tm[1])
          if (p >= 2) { tupletN = p; tupletLeft = tm[3] ? parseInt(tm[3]) : p }
          i += tm[0].length
        } else {
          i++
        }
        continue
      }

      if (ch === 'z' || ch === 'Z' || ch === 'x') {
        i++
        const d = parseDuration(body, i)
        i += d.consumed
        const br = readBroken(body, i)
        i = br.end
        emit([], (d.num / d.den) * beatsPerUnit * br.first)
        brokenFactor = br.next
        continue
      }

      const p = readPitch(body, i)
      if (!p) { i++; continue }
      i = p.end
      const d = parseDuration(body, i)
      i += d.consumed
      const hasTie = body[i] === '-'
      if (hasTie) i++
      const br = readBroken(body, i)
      i = br.end
      emit([p], (d.num / d.den) * beatsPerUnit * br.first)
      brokenFactor = br.next
      pendingTie = hasTie
    }
  }

  for (let li = bodyStart; li < lines.length; li++) {
    const line = lines[li].replace(/%.*$/, '').replace(/"[^"]*"/g, '').trim()
    if (!line) continue
    // Field lines inside the body (w: lyrics, V: voices, K: key changes …) are not
    // music; "A:|" is a note followed by a repeat bar, not a field
    const field = line.match(/^([A-Za-z]):(?![|:])\s*(.*)$/)
    if (field) {
      if (field[1] === 'X') break // the next tune of the file
      applyField(field[1].toUpperCase(), field[2].trim())
      continue
    }
    if (line.startsWith('+:')) continue
    scan(line)
  }

  if (cur.length > 0) measures.push(cur)
  return { measures, keyStr: headerKey, timeStr, titleStr, tempoStr }
}
