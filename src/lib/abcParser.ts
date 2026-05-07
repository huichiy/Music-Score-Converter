import type { MeasureArray, NoteObject } from '@/types/score'
import { pitchToSemitones, scaleDegrees, stepMapDiatonic } from './parser'

const ABC_KEY_MAP: Record<string, string> = {
  C:'C', G:'G', D:'D', A:'A', E:'E', B:'B', 'F#':'F#', 'C#':'C#',
  F:'F', Bb:'Bb', Eb:'Eb', Ab:'Ab', Db:'Db', Gb:'Gb', Cb:'Cb',
  Am:'C', Em:'G', Bm:'D', 'F#m':'A', 'C#m':'E', 'G#m':'B', 'D#m':'F#',
  Dm:'F', Gm:'Bb', Cm:'Eb', Fm:'Ab', Bbm:'Db', Ebm:'Gb',
}

const FIFTHS_MAP: Record<string, number> = {
  C:0, G:1, D:2, A:3, E:4, B:5, 'F#':6, 'C#':7,
  F:-1, Bb:-2, Eb:-3, Ab:-4, Db:-5, Gb:-6, Cb:-7,
}

function parseDuration(s: string, i: number): { num: number; den: number; consumed: number } {
  const start = i
  let num = 1, den = 1
  const nm = s.slice(i).match(/^(\d+)/)
  if (nm) { num = parseInt(nm[1]); i += nm[1].length }
  if (i < s.length && s[i] === '/') {
    i++
    const dm = s.slice(i).match(/^(\d+)/)
    if (dm) { den = parseInt(dm[1]); i += dm[1].length }
    else den = 2
  }
  return { num, den, consumed: i - start }
}

function beatsToNoteType(b: number): { type: NoteObject['type']; dot: boolean } {
  if (b >= 3.75) return { type: 'whole', dot: false }
  if (b >= 2.75) return { type: 'half', dot: true }
  if (b >= 1.75) return { type: 'half', dot: false }
  if (b >= 1.25) return { type: 'quarter', dot: true }
  if (b >= 0.75) return { type: 'quarter', dot: false }
  if (b >= 0.6) return { type: 'eighth', dot: true }
  if (b >= 0.35) return { type: 'eighth', dot: false }
  return { type: '16th', dot: false }
}

export function parseABC(text: string, filename: string): {
  measures: MeasureArray[]
  keyStr: string
  timeStr: string
  titleStr: string
  tempoStr: string
} {
  let titleStr = filename.replace(/\.[^/.]+$/, '')
  let timeStr = '4/4'
  let keyStr = 'C'
  let tempoStr = ''
  let defaultL: number | null = null

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
    } else if (tag === 'K') {
      const raw = val.split(/[\s,]/)[0]
      keyStr = ABC_KEY_MAP[raw] || ABC_KEY_MAP[raw.replace(/maj$/i, '')] || 'C'
      bodyStart = li + 1
      break
    }
  }

  const [mb, md] = timeStr.split('/').map(Number)
  if (!defaultL) defaultL = mb / md < 0.75 ? 1 / 16 : 1 / 8
  const beatsPerUnit = defaultL * 4

  const fifths = FIFTHS_MAP[keyStr] || 0
  const sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
  const flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F']
  const keySigAcc: Record<string, number> = {}
  if (fifths > 0) for (let k = 0; k < fifths; k++) keySigAcc[sharpOrder[k]] = 1
  if (fifths < 0) for (let k = 0; k < -fifths; k++) keySigAcc[flatOrder[k]] = -1

  const baseTonicStep = keyStr[0]
  const baseTonicAlter = keyStr.includes('#') ? 1 : keyStr.includes('b') ? -1 : 0
  const baseTonicSemi = pitchToSemitones(baseTonicStep, baseTonicAlter, 4)

  const body = lines.slice(bodyStart).join('\n')
    .replace(/%[^\n]*/g, '')
    .replace(/"[^"]*"/g, '')

  const measures: MeasureArray[] = []
  let currentMeasure: MeasureArray = [] as unknown as MeasureArray
  let measureAcc: Record<string, number> = {}
  let pendingTie = false

  let i = 0
  while (i < body.length) {
    const ch = body[i]

    if (/[\s\n]/.test(ch)) { i++; continue }

    if (ch === '|') {
      if (currentMeasure.length > 0) { measures.push(currentMeasure); currentMeasure = [] as unknown as MeasureArray; measureAcc = {} }
      i++
      while (i < body.length && /[|:\]]/.test(body[i])) i++
      continue
    }

    if (ch === ':' && i + 1 < body.length && body[i + 1] === '|') {
      if (currentMeasure.length > 0) { measures.push(currentMeasure); currentMeasure = [] as unknown as MeasureArray; measureAcc = {} }
      i += 2
      while (i < body.length && /[|:\]]/.test(body[i])) i++
      continue
    }

    if (ch === '[') {
      if (body[i + 1] === '|') {
        if (currentMeasure.length > 0) { measures.push(currentMeasure); currentMeasure = [] as unknown as MeasureArray; measureAcc = {} }
        i += 2
        while (i < body.length && body[i] === ']') i++
        continue
      }
      if (/\d/.test(body[i + 1])) {
        if (currentMeasure.length > 0) { measures.push(currentMeasure); currentMeasure = [] as unknown as MeasureArray; measureAcc = {} }
        i++; continue
      }
      i++; continue
    }
    if (ch === ']') { i++; continue }

    if (ch === 'z' || ch === 'Z' || ch === 'x') {
      i++
      const { num, den, consumed } = parseDuration(body, i)
      i += consumed
      const beatDur = (num / den) * beatsPerUnit
      const { type, dot } = beatsToNoteType(beatDur)
      currentMeasure.push({ degree: 0, octave: 0, type, dot, tie: false, rest: true, accidental: '', slurStart: false, slurStop: false })
      continue
    }

    let explicitAcc: number | null = null
    if (ch === '^') {
      explicitAcc = body[i + 1] === '^' ? 2 : 1
      i += body[i + 1] === '^' ? 2 : 1
    } else if (ch === '_') {
      explicitAcc = body[i + 1] === '_' ? -2 : -1
      i += body[i + 1] === '_' ? 2 : 1
    } else if (ch === '=') {
      explicitAcc = 0
      i++
    }

    const noteCh = body[i]
    if (!/[A-Ga-g]/.test(noteCh)) { i++; continue }

    const stepLetter = noteCh.toUpperCase()
    const isLower = noteCh >= 'a' && noteCh <= 'g'
    i++

    let noteOctave = isLower ? 5 : 4
    while (i < body.length && body[i] === "'") { noteOctave++; i++ }
    while (i < body.length && body[i] === ',') { noteOctave--; i++ }

    const { num, den, consumed } = parseDuration(body, i)
    i += consumed

    if (i < body.length && body[i] === '-') { pendingTie = true; i++ }

    let alter: number
    if (explicitAcc !== null) {
      alter = Math.max(-1, Math.min(1, explicitAcc))
      measureAcc[stepLetter] = alter
    } else if (stepLetter in measureAcc) {
      alter = measureAcc[stepLetter]
    } else {
      alter = keySigAcc[stepLetter] || 0
    }

    const noteSemi = pitchToSemitones(stepLetter, alter, noteOctave)
    const tonicDiatAbs = stepMapDiatonic[baseTonicStep] + 4 * 7
    const noteDiatAbs = stepMapDiatonic[stepLetter] + noteOctave * 7
    const degree = ((noteDiatAbs - tonicDiatAbs) % 7 + 7) % 7
    const shift = Math.round((noteSemi - (baseTonicSemi + scaleDegrees[degree])) / 12)
    const intendedSemi = baseTonicSemi + shift * 12 + scaleDegrees[degree]
    const accStr: '#' | 'b' | '' = noteSemi > intendedSemi ? '#' : noteSemi < intendedSemi ? 'b' : ''

    const beatDur = (num / den) * beatsPerUnit
    const { type, dot } = beatsToNoteType(beatDur)

    currentMeasure.push({
      degree: degree + 1, octave: shift, type, dot,
      tie: pendingTie, rest: false, accidental: accStr,
      slurStart: false, slurStop: false,
    })
    pendingTie = false
  }

  if (currentMeasure.length > 0) measures.push(currentMeasure)
  return { measures, keyStr, timeStr, titleStr, tempoStr }
}
