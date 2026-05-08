import type { Measure, MeasureArray, NoteObject } from '@/types/score'

function serializeNoteToken(note: NoteObject): string {
  if (note.tie) return '-'
  let tok = ''
  if (!note.rest) {
    if (note.accidental === '#') tok += '#'
    else if (note.accidental === 'b') tok += 'b'
  }
  tok += note.rest ? '0' : note.degree.toString()
  if (!note.rest) {
    if (note.octave === 2) tok += "''"
    else if (note.octave === 1) tok += "'"
    else if (note.octave === -1) tok += ','
    else if (note.octave === -2) tok += ',,'
  }
  const typeMap: Record<string, string> = { whole: 'w', half: 'h', quarter: 'q', eighth: 'e', '16th': 'x', '32nd': 'x' }
  const ts = typeMap[note.type] || 'q'
  if (ts !== 'q' || note.dot) tok += ts
  if (note.dot) tok += 'd'
  return tok
}

export function serializeToText(
  measures: Measure[],
  keyStr: string,
  timeStr: string,
  tempoStr: string,
): string {
  const header = `Key: ${keyStr}   Time: ${timeStr}${tempoStr ? '   Tempo: ' + tempoStr : ''}`
  let body = ''
  for (const measure of measures) {
    body += '| '
    if (!Array.isArray(measure) && measure._multiRest !== undefined) {
      body += `[${measure._multiRest}] `
      continue
    }
    for (const note of measure as MeasureArray) body += serializeNoteToken(note) + ' '
  }
  body += '|'
  return header + '\n' + body
}

export function parseFromText(
  text: string,
  fallbackKeyStr = 'C',
  fallbackTimeStr = '4/4',
  fallbackTempoStr = '',
): { measures: Measure[]; keyStr: string; timeStr: string; tempoStr: string } {
  const lines = text.trim().split('\n')
  const header = lines[0] || ''

  let keyStr = fallbackKeyStr
  let timeStr = fallbackTimeStr
  let tempoStr = fallbackTempoStr

  const km = header.match(/Key:\s*([A-G][b#]?)/)
  const tm = header.match(/Time:\s*(\d+\/\d+)/)
  const pm = header.match(/Tempo:\s*(\d+)/)
  if (km) keyStr = km[1]
  if (tm) timeStr = tm[1]
  if (pm) tempoStr = pm[1]

  const dBeats: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }

  function beatsToType(b: number): { type: NoteObject['type']; dot: boolean } {
    if (b >= 3.75) return { type: 'whole', dot: false }
    if (b >= 2.75) return { type: 'half', dot: true }
    if (b >= 1.75) return { type: 'half', dot: false }
    if (b >= 1.25) return { type: 'quarter', dot: true }
    if (b >= 0.75) return { type: 'quarter', dot: false }
    if (b >= 0.6) return { type: 'eighth', dot: true }
    if (b >= 0.35) return { type: 'eighth', dot: false }
    return { type: '16th', dot: false }
  }

  const tokens = lines.slice(1).join(' ').split(/\s+/).filter(Boolean)
  const measures: Measure[] = []
  let current: MeasureArray | null = null
  let lastNote: NoteObject | null = null
  let lastBeats = 0

  for (const tok of tokens) {
    if (tok === '|') {
      if (current !== null && current.length > 0) {
        current._repeatStart = false; current._repeatEnd = false
        current._direction = ''; current._dynamic = ''; current._wedge = null
        measures.push(current)
      }
      current = [] as unknown as MeasureArray
      lastNote = null; lastBeats = 0
      continue
    }
    if (current === null) continue

    if (tok === '-') {
      if (lastNote) {
        lastBeats += 1
        const { type, dot } = beatsToType(lastBeats)
        lastNote.type = type; lastNote.dot = dot
      }
      continue
    }

    const mrm = tok.match(/^\[(\d+)\]$/)
    if (mrm) {
      if (current.length > 0) {
        current._repeatStart = false; current._repeatEnd = false
        current._direction = ''; current._dynamic = ''; current._wedge = null
        measures.push(current)
      }
      measures.push({ _multiRest: parseInt(mrm[1]) })
      current = [] as unknown as MeasureArray
      lastNote = null; lastBeats = 0
      continue
    }

    let i = 0
    let acc: '#' | 'b' | '' = ''
    if (tok[i] === '#') { acc = '#'; i++ }
    else if (tok[i] === 'b' && /[0-7]/.test(tok[i + 1])) { acc = 'b'; i++ }

    if (i >= tok.length || !/[0-7]/.test(tok[i])) continue
    const deg = parseInt(tok[i]); i++
    const isRest = deg === 0

    let oct = 0
    while (i < tok.length && tok[i] === "'") { oct++; i++ }
    while (i < tok.length && tok[i] === ',') { oct--; i++ }

    const typeMap: Record<string, NoteObject['type']> = { w: 'whole', h: 'half', q: 'quarter', e: 'eighth', x: '16th' }
    let noteType: NoteObject['type'] = 'quarter'
    if (i < tok.length && typeMap[tok[i]]) { noteType = typeMap[tok[i]]; i++ }
    let dot = false
    if (i < tok.length && tok[i] === 'd') { dot = true; i++ }

    const note: NoteObject = {
      degree: isRest ? 0 : deg, octave: isRest ? 0 : oct,
      type: noteType, dot, tie: false, rest: isRest,
      accidental: isRest ? '' : acc, slurStart: false, slurStop: false,
    }
    current.push(note)
    lastNote = note
    lastBeats = (dBeats[noteType] || 1) * (dot ? 1.5 : 1)
  }

  if (current && current.length > 0) {
    current._repeatStart = false; current._repeatEnd = false
    current._direction = ''; current._dynamic = ''; current._wedge = null
    measures.push(current)
  }

  return { measures, keyStr, timeStr, tempoStr }
}
