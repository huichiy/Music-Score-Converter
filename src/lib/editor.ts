import type { Articulation, GraceNote, Measure, MeasureArray, NoteObject } from '@/types/score'

// Compute renderer's origIdx for each measure index in the parsed array.
// Mirrors collapseRestRuns + the per-measure origIdx incrementing in renderer.ts.
// Returns a Map: originalMeasureIdx -> origIdx (only for measures that contribute
// to data-m on note elements; whole-rest measures are absent since their `0`s
// have no data-m).
function computeOrigIdxMap(measures: Measure[]): Map<number, number> {
  const map = new Map<number, number>()
  let origIdx = 0
  let i = 0
  while (i < measures.length) {
    const m = measures[i]
    if (!Array.isArray(m) && (m as { _multiRest?: number })._multiRest !== undefined) {
      origIdx += (m as { _multiRest: number })._multiRest
      i++
      continue
    }
    const arr = m as MeasureArray
    const isWholeRest = arr.length === 1 && arr[0].rest && arr[0].type === 'whole'
    if (isWholeRest) {
      // Look ahead for run of consecutive whole-rest measures (collapseRestRuns groups 2+)
      let j = i + 1
      while (j < measures.length) {
        const next = measures[j]
        if (!Array.isArray(next)) break
        if (next.length !== 1 || !next[0].rest || next[0].type !== 'whole') break
        j++
      }
      const runLen = j - i
      if (runLen >= 2) origIdx += runLen
      // single whole-rest: origIdx not incremented (renderer's isWholeMeasureRest path skips it)
      i = j
    } else {
      map.set(i, origIdx)
      origIdx++
      i++
    }
  }
  return map
}

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
  // Dotted whole (6 beats) doesn't fit in standard meters — fall back to whole
  if (type === 'whole') return '---'
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

function isWholeMeasureRest(m: Measure): boolean {
  if (!Array.isArray(m)) return false
  if (m.length !== 1) return false
  const n = m[0]
  if (!n.rest || n.type !== 'whole') return false
  // Don't collapse if measure carries metadata that needs preserving
  if (m._repeatStart || m._repeatEnd || m._dynamic || m._wedge || m._direction) return false
  return true
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

    // Auto-collapse 2+ consecutive whole-measure rests into [N] block
    if (isWholeMeasureRest(measure)) {
      let runEnd = mi
      while (runEnd + 1 < measures.length && isWholeMeasureRest(measures[runEnd + 1])) runEnd++
      const runLen = runEnd - mi + 1
      if (runLen >= 2) {
        body += `| [${runLen}] `
        mi = runEnd
        continue
      }
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

export type NotePosition = { measureIdx: number; noteIdx: number; start: number; end: number }

type Parsed = {
  measures: Measure[]
  keyStr: string
  timeStr: string
  tempoStr: string
  titleStr: string
  positions: NotePosition[]
}

function parseDurationSuffix(suffix: string): { type: NoteObject['type']; dot: boolean } {
  if (suffix === '') return { type: 'quarter', dot: false }
  if (suffix === '.') return { type: 'quarter', dot: true }
  if (/^-+$/.test(suffix)) {
    const n = suffix.length
    if (n === 1) return { type: 'half', dot: false }
    if (n === 2) return { type: 'half', dot: true }
    // 3+ dashes → whole note (4 beats). More dashes don't add anything since
    // 附点全音符 (6 beats) doesn't fit in standard 4/4 — treat extras as no-op.
    return { type: 'whole', dot: false }
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

type TokenWithPos = { tok: string; start: number; end: number }

function tokenize(text: string, offset: number = 0): TokenWithPos[] {
  const tokens: TokenWithPos[] = []
  const push = (tok: string, start: number, end: number) => tokens.push({ tok, start: start + offset, end: end + offset })
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
          push(text.slice(i, j), i, j)
          i = j
        } else {
          push('||', i, i + 2)
          i += 2
        }
      } else if (text[i + 1] === ':') {
        push('|:', i, i + 2)
        i += 2
      } else {
        push('|', i, i + 1)
        i++
      }
      continue
    }
    if (ch === ':' && text[i + 1] === '|') {
      push(':|', i, i + 2)
      i += 2
      continue
    }

    // Bracket [...]
    if (ch === '[') {
      const end = text.indexOf(']', i)
      if (end === -1) { i++; continue }
      push(text.slice(i, end + 1), i, end + 1)
      i = end + 1
      continue
    }

    // Slur parens / hairpins / hairpin end
    if (ch === '(' || ch === ')' || ch === '<' || ch === '>' || ch === '!') {
      push(ch, i, i + 1)
      i++
      continue
    }

    // Dynamic &xx
    if (ch === '&') {
      let j = i + 1
      while (j < text.length && /[a-zA-Z]/.test(text[j])) j++
      push(text.slice(i, j), i, j)
      i = j
      continue
    }

    // Note/extension token — read until whitespace or special char
    let j = i
    while (j < text.length && !/[\s|:()<>!&\[\]]/.test(text[j])) j++
    if (j === i) { i++; continue }
    push(text.slice(i, j), i, j)
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
  const lines = text.split('\n')

  let keyStr = fallbackKeyStr
  let timeStr = fallbackTimeStr
  let tempoStr = fallbackTempoStr
  let titleStr = fallbackTitleStr

  // Header lines = consecutive lines at top matching Title:/Key:/Time:/Tempo: (max 4)
  let headerEndIdx = 0
  for (let i = 0; i < Math.min(4, lines.length); i++) {
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
    } else if (ln.trim() === '') {
      continue
    } else {
      break
    }
  }

  // Compute byte offset where body begins, so token positions are absolute in `text`
  const headerOffset = headerEndIdx > 0
    ? lines.slice(0, headerEndIdx).join('\n').length + 1
    : 0
  const bodyText = text.slice(headerOffset)
  const tokens = tokenize(bodyText, headerOffset)

  const measures: Measure[] = []
  // Positions captured during parsing with `measureIdx` = ORIGINAL array index (will be
  // remapped to renderer's origIdx after parsing completes via computeOrigIdxMap).
  const positions: NotePosition[] = []
  let current: MeasureArray | null = null
  let lastNote: NoteObject | null = null
  let lastNotePos: { measureIdx: number; noteIdx: number } | null = null
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
    lastNotePos = null
  }

  for (let ti = 0; ti < tokens.length; ti++) {
    const { tok, start, end } = tokens[ti]

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

    // Bracket modifier (articulation/grace note) — must be checked BEFORE multi-rest,
    // because [2] [3] etc. would otherwise collide with multi-rest's [N] regex.
    // A bracket attached to a previous note (lastNote set) is always a modifier.
    if (tok.startsWith('[') && tok.endsWith(']') && lastNote) {
      const inner = tok.slice(1, -1)
      if (SYM_TO_ARTIC[inner]) {
        lastNote.articulation = SYM_TO_ARTIC[inner]
      } else {
        const g = parseGraceNoteText(inner)
        if (g) lastNote.graceNote = g
      }
      // Extend last note's position range to include this bracket modifier
      if (lastNotePos) {
        const lastPos = positions[positions.length - 1]
        if (lastPos && lastPos.measureIdx === lastNotePos.measureIdx && lastPos.noteIdx === lastNotePos.noteIdx) {
          lastPos.end = end
        }
      }
      continue
    }

    // Multi-rest [N] — only at measure start (no lastNote)
    const mrm = tok.match(/^\[(\d+)\]$/)
    if (mrm) {
      if (current && current.length > 0) measures.push(current)
      measures.push({ _multiRest: parseInt(mrm[1]) })
      current = freshMeasure()
      lastNote = null
      continue
    }

    // Bracket token with no preceding note (and not a multi-rest digit) → orphan, ignore
    if (tok.startsWith('[') && tok.endsWith(']')) continue

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
        // Extend last note's text range to include this extension
        if (lastNotePos) {
          const lastPos = positions[positions.length - 1]
          if (lastPos && lastPos.measureIdx === lastNotePos.measureIdx && lastPos.noteIdx === lastNotePos.noteIdx) {
            lastPos.end = end
          }
        }
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
    // measureIdx here is the ORIGINAL array index of current (which is what
    // measures.length will be when current gets flushed). Remapped to renderer's
    // origIdx in the post-processing step below.
    const measureIdx = measures.length
    const noteIdx = current.length
    current.push(note)
    lastNote = note
    lastNotePos = { measureIdx, noteIdx }
    positions.push({ measureIdx, noteIdx, start, end })
  }

  if (current && current.length > 0) measures.push(current)

  // Remap position.measureIdx from "array index" to "renderer origIdx" (data-m on SVG).
  // For notes in whole-rest measures (no data-m in SVG), keep the position but mark
  // with measureIdx = -1 so the cursor-sync logic shows "no highlight" instead of
  // falling back to the previous note (which would be misleading).
  const origIdxMap = computeOrigIdxMap(measures)
  const remappedPositions: NotePosition[] = positions.map(p => {
    const o = origIdxMap.get(p.measureIdx)
    return { ...p, measureIdx: o === undefined ? -1 : o }
  })

  return { measures, keyStr, timeStr, tempoStr, titleStr, positions: remappedPositions }
}
