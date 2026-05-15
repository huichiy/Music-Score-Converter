import type { Articulation, GraceNote, Measure, MeasureArray, NoteObject } from '@/types/score'

// ============================================================================
// Serialize (note objects → text)
// ============================================================================

const ARTIC_TO_SYM: Record<string, string> = {
  accent: '>',
  staccato: '.',
  tenuto: '-',
  marcato: '^',
  fermata: '$',
}

const SYM_TO_ARTIC: Record<string, Articulation> = {
  '>': 'accent',
  '.': 'staccato',
  '-': 'tenuto',
  '^': 'marcato',
  '$': 'fermata',
}

function durationSuffix(type: NoteObject['type'], dot: boolean): string {
  if (type === 'quarter') return dot ? '.' : ''
  if (type === 'half') return dot ? '--' : '-'
  if (type === 'whole') return dot ? '-----' : '---'
  if (type === 'eighth') return dot ? './' : '/'
  if (type === '16th' || type === '32nd') return dot ? './/' : '//'
  return ''
}

function octaveSuffix(oct: number): string {
  if (oct === 2) return "''"
  if (oct === 1) return "'"
  if (oct === -1) return ','
  if (oct === -2) return ',,'
  return ''
}

function graceNoteToText(g: GraceNote): string {
  let s = ''
  if (g.accidental === '#') s += '#'
  else if (g.accidental === 'b') s += 'b'
  s += g.degree.toString()
  s += octaveSuffix(g.octave)
  return s
}

function serializeNote(note: NoteObject): string {
  if (note.tie) return '-'

  let tok = ''
  if (!note.rest) {
    if (note.accidental === '#') tok += '#'
    else if (note.accidental === 'b') tok += 'b'
  }
  tok += note.rest ? '0' : note.degree.toString()
  if (!note.rest) tok += octaveSuffix(note.octave)
  tok += durationSuffix(note.type, note.dot)

  // Grace note bracket (e.g. 1[2])
  if (note.graceNote) tok += `[${graceNoteToText(note.graceNote)}]`

  // Articulation bracket (e.g. 1[>])
  if (note.articulation) {
    const sym = ARTIC_TO_SYM[note.articulation]
    if (sym) tok += `[${sym}]`
  }

  return tok
}

function directionToTag(dir: string): string {
  const d = dir.trim().toLowerCase()
  if (d === 'fine') return '&fine'
  if (d.startsWith('d.c.') || d === 'da capo') return '&dc'
  if (d.startsWith('d.s.') || d === 'dal segno') return '&ds'
  return ''
}

export function serializeToText(
  measures: Measure[],
  keyStr: string,
  timeStr: string,
  tempoStr: string,
  titleStr: string = '',
): string {
  const titleLine = titleStr ? `Title: ${titleStr}\n` : ''
  const header = `${titleLine}Key: ${keyStr}   Time: ${timeStr}${tempoStr ? '   Tempo: ' + tempoStr : ''}`
  let body = ''
  let prevWedge: 'cresc' | 'dim' | null = null
  let inSlur = false

  for (let mi = 0; mi < measures.length; mi++) {
    const measure = measures[mi]

    if (!Array.isArray(measure) && (measure as { _multiRest?: number })._multiRest !== undefined) {
      body += '| '
      body += `[${(measure as { _multiRest: number })._multiRest}] `
      continue
    }

    const m = measure as MeasureArray
    body += m._repeatStart ? '|: ' : '| '

    if (m._dynamic) {
      body += `&${m._dynamic} `
    }

    const currentWedge = m._wedge || null
    if (currentWedge && !prevWedge) {
      body += currentWedge === 'cresc' ? '< ' : '> '
    } else if (!currentWedge && prevWedge) {
      body += '! '
    } else if (currentWedge && prevWedge && currentWedge !== prevWedge) {
      body += '! '
      body += currentWedge === 'cresc' ? '< ' : '> '
    }
    prevWedge = currentWedge

    for (const note of m) {
      if (note.slurStart && !note.rest && !inSlur) {
        body += '( '
        inSlur = true
      }

      body += serializeNote(note) + ' '

      if (note.slurStop && inSlur) {
        body += ') '
        inSlur = false
      }
    }

    const tag = m._direction ? directionToTag(m._direction) : ''
    const isLast = mi === measures.length - 1

    if (m._repeatEnd) {
      body += ':| '
    } else if (tag) {
      body += `||${tag} `
    } else if (isLast) {
      body += '||'
    }
  }

  if (!body.trim().endsWith('|')) body += '|'

  return header + '\n' + body.trim()
}

// ============================================================================
// Parse (text → note objects)
// ============================================================================

type Parsed = {
  measures: Measure[]
  keyStr: string
  timeStr: string
  tempoStr: string
  titleStr: string
}

function parseDurationSuffix(suffix: string): { type: NoteObject['type']; dot: boolean } {
  if (suffix === '') return { type: 'quarter', dot: false }
  if (suffix === '.') return { type: 'quarter', dot: true }
  if (/^-+$/.test(suffix)) {
    const n = suffix.length
    if (n === 1) return { type: 'half', dot: false }
    if (n === 2) return { type: 'half', dot: true }
    if (n === 3) return { type: 'whole', dot: false }
    return { type: 'whole', dot: n >= 4 }
  }
  if (suffix === '/') return { type: 'eighth', dot: false }
  if (suffix === './') return { type: 'eighth', dot: true }
  if (suffix === '//') return { type: '16th', dot: false }
  if (suffix === './/') return { type: '16th', dot: true }
  return { type: 'quarter', dot: false }
}

function durationBeats(type: NoteObject['type'], dot: boolean): number {
  const base: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 }
  const b = base[type] || 1
  return dot ? b * 1.5 : b
}

function beatsToType(b: number): { type: NoteObject['type']; dot: boolean } {
  if (b >= 5.5) return { type: 'whole', dot: true }
  if (b >= 3.75) return { type: 'whole', dot: false }
  if (b >= 2.75) return { type: 'half', dot: true }
  if (b >= 1.75) return { type: 'half', dot: false }
  if (b >= 1.25) return { type: 'quarter', dot: true }
  if (b >= 0.75) return { type: 'quarter', dot: false }
  if (b >= 0.6) return { type: 'eighth', dot: true }
  if (b >= 0.35) return { type: 'eighth', dot: false }
  return { type: '16th', dot: false }
}

function parseGraceNoteText(s: string): GraceNote | null {
  const m = s.match(/^([#b])?([1-7])('+|,+)?$/)
  if (!m) return null
  let oct = 0
  if (m[3]) {
    if (m[3][0] === "'") oct = m[3].length
    else oct = -m[3].length
  }
  return {
    accidental: (m[1] as '#' | 'b') || '',
    degree: parseInt(m[2]),
    octave: oct,
  }
}

function tokenize(text: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) { i++; continue }

    // Barlines
    if (ch === '|') {
      if (text[i + 1] === '|') {
        if (text[i + 2] === '&') {
          let j = i + 2
          while (j < text.length && !/\s/.test(text[j])) j++
          tokens.push(text.slice(i, j))
          i = j
        } else {
          tokens.push('||')
          i += 2
        }
      } else if (text[i + 1] === ':') {
        tokens.push('|:')
        i += 2
      } else {
        tokens.push('|')
        i++
      }
      continue
    }
    if (ch === ':' && text[i + 1] === '|') {
      tokens.push(':|')
      i += 2
      continue
    }

    // Bracket [...]
    if (ch === '[') {
      const end = text.indexOf(']', i)
      if (end === -1) { i++; continue }
      tokens.push(text.slice(i, end + 1))
      i = end + 1
      continue
    }

    // Slur parens / hairpins / hairpin end
    if (ch === '(' || ch === ')' || ch === '<' || ch === '>' || ch === '!') {
      tokens.push(ch)
      i++
      continue
    }

    // Dynamic &xx
    if (ch === '&') {
      let j = i + 1
      while (j < text.length && /[a-zA-Z]/.test(text[j])) j++
      tokens.push(text.slice(i, j))
      i = j
      continue
    }

    // Note/extension token — read until whitespace or special char
    let j = i
    while (j < text.length && !/[\s|:()<>!&\[\]]/.test(text[j])) j++
    if (j === i) { i++; continue }
    tokens.push(text.slice(i, j))
    i = j
  }
  return tokens
}

function emptyNote(deg: number, oct: number, acc: '#' | 'b' | '', type: NoteObject['type'], dot: boolean, isRest: boolean): NoteObject {
  return {
    degree: isRest ? 0 : deg,
    octave: isRest ? 0 : oct,
    type,
    dot,
    tie: false,
    rest: isRest,
    accidental: isRest ? '' : acc,
    slurStart: false,
    slurStop: false,
  }
}

function freshMeasure(): MeasureArray {
  const arr = [] as unknown as MeasureArray
  arr._repeatStart = false
  arr._repeatEnd = false
  arr._direction = ''
  arr._dynamic = ''
  arr._wedge = null
  return arr
}

export function parseFromText(
  text: string,
  fallbackKeyStr = 'C',
  fallbackTimeStr = '4/4',
  fallbackTempoStr = '',
  fallbackTitleStr = '',
): Parsed {
  const lines = text.trim().split('\n')

  let keyStr = fallbackKeyStr
  let timeStr = fallbackTimeStr
  let tempoStr = fallbackTempoStr
  let titleStr = fallbackTitleStr

  // Header lines = consecutive lines at top matching Title:/Key:/Time:/Tempo: (max 3)
  let headerEndIdx = 0
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const ln = lines[i]
    if (/^(Title|Key|Time|Tempo)\s*:/.test(ln)) {
      headerEndIdx = i + 1
      const tlm = ln.match(/Title:\s*(.+?)\s*$/)
      const km = ln.match(/Key:\s*([A-G][b#]?)/)
      const tm = ln.match(/Time:\s*(\d+\/\d+)/)
      const pm = ln.match(/Tempo:\s*(\d+)/)
      if (tlm) titleStr = tlm[1]
      if (km) keyStr = km[1]
      if (tm) timeStr = tm[1]
      if (pm) tempoStr = pm[1]
    } else {
      break
    }
  }

  const bodyText = lines.slice(headerEndIdx).join(' ')
  const tokens = tokenize(bodyText)

  const measures: Measure[] = []
  let current: MeasureArray | null = null
  let lastNote: NoteObject | null = null
  let pendingRepeatStart = false
  let pendingDynamic = ''
  let activeWedge: 'cresc' | 'dim' | null = null
  let pendingSlurStart = false

  const flushMeasure = (closeKind?: 'repeat' | 'fine' | 'dc' | 'ds' | 'final') => {
    if (current && current.length > 0) {
      if (closeKind === 'repeat') current._repeatEnd = true
      if (closeKind === 'fine') current._direction = 'Fine'
      if (closeKind === 'dc') current._direction = 'D.C.'
      if (closeKind === 'ds') current._direction = 'D.S.'
      measures.push(current)
    }
    current = freshMeasure()
    if (pendingRepeatStart) {
      current._repeatStart = true
      pendingRepeatStart = false
    }
    if (pendingDynamic) {
      current._dynamic = pendingDynamic
      pendingDynamic = ''
    }
    if (activeWedge) current._wedge = activeWedge
    lastNote = null
  }

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti]

    if (tok === '|') {
      flushMeasure()
      continue
    }
    if (tok === '|:') {
      flushMeasure()
      if (current) current._repeatStart = true
      continue
    }
    if (tok === ':|') {
      flushMeasure('repeat')
      continue
    }
    if (tok === '||') {
      flushMeasure('final')
      continue
    }
    if (tok.startsWith('||&')) {
      const tag = tok.slice(3)
      if (tag === 'fine') flushMeasure('fine')
      else if (tag === 'dc') flushMeasure('dc')
      else if (tag === 'ds') flushMeasure('ds')
      else flushMeasure('final')
      continue
    }

    // Multi-rest [N]
    const mrm = tok.match(/^\[(\d+)\]$/)
    if (mrm) {
      if (current && current.length > 0) measures.push(current)
      measures.push({ _multiRest: parseInt(mrm[1]) })
      current = freshMeasure()
      lastNote = null
      continue
    }

    // Bracket modifier: articulation or grace note — applies to lastNote
    if (tok.startsWith('[') && tok.endsWith(']')) {
      if (!lastNote) continue
      const inner = tok.slice(1, -1)
      if (SYM_TO_ARTIC[inner]) {
        lastNote.articulation = SYM_TO_ARTIC[inner]
      } else {
        const g = parseGraceNoteText(inner)
        if (g) lastNote.graceNote = g
      }
      continue
    }

    if (tok === '(') {
      pendingSlurStart = true
      continue
    }
    if (tok === ')') {
      if (lastNote) lastNote.slurStop = true
      continue
    }

    if (tok === '<') {
      activeWedge = 'cresc'
      if (current) current._wedge = 'cresc'
      continue
    }
    if (tok === '>') {
      activeWedge = 'dim'
      if (current) current._wedge = 'dim'
      continue
    }
    if (tok === '!') {
      activeWedge = null
      // If '!' appears at measure start (before any notes), clear current wedge — boundary transition
      if (current && current.length === 0) current._wedge = null
      continue
    }

    if (tok.startsWith('&')) {
      const dyn = tok.slice(1)
      if (current) current._dynamic = dyn
      else pendingDynamic = dyn
      continue
    }

    if (!current) current = freshMeasure()

    // Extension token (standalone dashes)
    if (/^-+$/.test(tok)) {
      if (lastNote && !lastNote.rest) {
        const curBeats = durationBeats(lastNote.type, lastNote.dot)
        const newBeats = curBeats + tok.length
        const { type, dot } = beatsToType(newBeats)
        lastNote.type = type
        lastNote.dot = dot
      }
      continue
    }

    // Regular note token: [#/b]?digit(octave)?(duration)?
    const noteMatch = tok.match(/^([#b])?([0-7])('+|,+)?(.*)$/)
    if (!noteMatch) continue
    const acc = (noteMatch[1] as '#' | 'b') || ''
    const deg = parseInt(noteMatch[2])
    const isRest = deg === 0
    let oct = 0
    if (noteMatch[3]) {
      if (noteMatch[3][0] === "'") oct = noteMatch[3].length
      else oct = -noteMatch[3].length
    }
    const suffix = noteMatch[4] || ''
    const { type, dot } = parseDurationSuffix(suffix)

    const note = emptyNote(deg, oct, acc, type, dot, isRest)
    if (pendingSlurStart && !isRest) {
      note.slurStart = true
      pendingSlurStart = false
    }
    current.push(note)
    lastNote = note
  }

  if (current && current.length > 0) measures.push(current)

  return { measures, keyStr, timeStr, tempoStr, titleStr }
}
