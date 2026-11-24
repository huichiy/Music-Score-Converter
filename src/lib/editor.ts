import type { Articulation, ChordNote, GraceNote, Measure, MeasureArray, NoteObject } from '@/types/score'
import { isUnpitched } from '../types/score'
import { blockLengthOf, isCollapsibleRest, isWholeRestMeasure, restRunStart, tupletFactor } from './renderer'
import { classifyDirection } from './directions'
import { barBeatsOf } from './meter'
import { slurPairs } from './slurs'
import { cleanTitle, parseHeaderLine } from './textHeader'

// Compute renderer's origIdx for each measure index in the parsed array.
// Mirrors collapseRestRuns + the per-measure origIdx incrementing in renderer.ts.
// Returns a Map: originalMeasureIdx -> origIdx (only for measures that contribute
// to data-m on note elements; whole-rest measures are absent since their `0`s
// have no data-m).
export function computeOrigIdxMap(measures: Measure[]): Map<number, number> {
  const map = new Map<number, number>()
  let origIdx = 0
  let i = 0
  while (i < measures.length) {
    const m = measures[i]
    if (!Array.isArray(m)) {
      origIdx += blockLengthOf(m)
      i++
      continue
    }
    if (isCollapsibleRest(m)) {
      // Look ahead for run of consecutive collapsible rests (collapseRestRuns groups 2+)
      let j = i + 1
      while (j < measures.length && isCollapsibleRest(measures[j])) j++
      const runLen = j - i
      if (runLen >= 2) origIdx += runLen
      // single whole-rest: origIdx not incremented (renderer's isWholeMeasureRest path skips it)
      i = j
    } else if (isWholeRestMeasure(m)) {
      // Marked whole-rest (repeat sign, dynamic, volta…) renders as a single
      // whole-rest measure: no origIdx increment
      i++
    } else {
      map.set(i, origIdx)
      origIdx++
      i++
    }
  }
  return map
}

// Inverse of computeOrigIdxMap: the renderer's data-m → index into `measures`
// (-1 when no measure carries that data-m). data-m is NOT an array index once a
// whole rest or [N] block sits before the note, so anything that reads a
// clicked note's data-m and looks it up in the measure array must go through this.
export function measureIdxFromOrigIdx(measures: Measure[], origIdx: number): number {
  for (const [arrayIdx, o] of computeOrigIdxMap(measures)) {
    if (o === origIdx) return arrayIdx
  }
  return -1
}

// One note after a popup edit. `updated` is what the popup sends (degree, octave, type,
// dot, accidental, rest); everything else on the note has to follow from it.
export function editedNote(old: NoteObject, updated: Partial<NoteObject>): NoteObject {
  const note: NoteObject = { ...old, ...updated }
  if (note.rest) {
    // A rest has no pitch to tie, double-stop, ornament or slur: left behind they drew
    // "-" or a chord digit under the 0
    note.degree = 0
    note.octave = 0
    note.accidental = ''
    note.tie = false
    note.slurStart = false
    note.slurStop = false
    delete note.chordNotes
    delete note.graceNote
    delete note.articulation
  } else if (old.tie && (note.degree !== old.degree || note.octave !== old.octave || note.accidental !== old.accidental)) {
    // A tie continuation is drawn as "-" and takes its pitch from the note before, so a
    // new pitch on it showed nothing at all; it is a note of its own now
    note.tie = false
  }
  return note
}

// Copy of `measures` with one note patched. The edited measure keeps EVERY own
// property of the old one (_volta, _timeSig, _key, and any `_` field added
// later) — a hand-picked list silently dropped the newer ones.
export function withNoteEdited(
  measures: Measure[],
  measureIdx: number,
  noteIdx: number,
  updated: Partial<NoteObject>,
): Measure[] {
  return measures.map((measure, mi) => {
    if (mi !== measureIdx || !Array.isArray(measure)) return measure
    const old = measure as MeasureArray
    if (!old[noteIdx]) return measure
    const arr = [...old] as unknown as MeasureArray
    for (const key of Object.keys(old)) {
      if (!/^\d+$/.test(key)) (arr as unknown as Record<string, unknown>)[key] = (old as unknown as Record<string, unknown>)[key]
    }
    arr[noteIdx] = editedNote(old[noteIdx], updated)
    return arr
  })
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
  if (type === '16th') return dot ? './/' : '//'
  if (type === '32nd') return dot ? './//' : '///'
  return ''
}

// One mark per octave, no cap. Anything outside ±2 used to serialize to an
// empty string, so a 大提琴 / 革胡 part at octave -3 silently jumped three
// octaves the moment the text editor round-tripped it. `octaveFromMarks`
// already parsed arbitrary run lengths — only this side was truncating.
function octaveSuffix(oct: number): string {
  if (oct > 0) return "'".repeat(oct)
  if (oct < 0) return ','.repeat(-oct)
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
  // Tie continuation: one dash per beat so the duration survives round-trip
  // (parse rebuilds the tie note from the dash count at measure start)
  if (note.tie) return '-'.repeat(Math.max(1, Math.round(durationBeats(note.type, note.dot))))

  // A percussion hit has a length and nothing else: X, no octave / accidental / chord.
  // It used to be written 0 and came back as a rest
  const unpitched = isUnpitched(note)
  let tok = ''
  if (!note.rest && !unpitched) {
    if (note.accidental === '#') tok += '#'
    else if (note.accidental === 'b') tok += 'b'
  }
  tok += note.rest ? '0' : unpitched ? 'X' : note.degree.toString()
  if (!note.rest && !unpitched) {
    tok += octaveSuffix(note.octave)
    // Chord notes (double stops): 5:3, 6:#4,:1 — duration suffix applies to the whole chord
    if (note.chordNotes) {
      for (const cn of note.chordNotes) {
        tok += ':'
        if (cn.accidental === '#') tok += '#'
        else if (cn.accidental === 'b') tok += 'b'
        tok += cn.degree.toString() + octaveSuffix(cn.octave)
      }
    }
  }
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

// Only the directions Route B has a tag for; Coda / "To Coda" / free text have none.
// Goes through the shared classifier so "Da Capo al Fine" is written, not dropped.
function directionToTag(dir: string): string {
  switch (classifyDirection(dir)) {
    case 'fine': return '&fine'
    case 'dc': return '&dc'
    case 'ds': return '&ds'
    case 'segno': return '&segno'
    default: return ''
  }
}

export function serializeToText(
  measures: Measure[],
  keyStr: string,
  timeStr: string,
  tempoStr: string,
  titleStr: string = '',
): string {
  // One line: a line break in a title ("望春風\n胡阮" from MusicXML) would end the
  // header there and read "Time: 4/4" as notes
  const title = cleanTitle(titleStr)
  const titleLine = title ? `Title: ${title}\n` : ''
  const header = `${titleLine}Key: ${keyStr}   Time: ${timeStr}${tempoStr ? '   Tempo: ' + tempoStr : ''}`
  let body = ''
  let prevWedge: 'cresc' | 'dim' | null = null
  // Only slurs that close are written: an open start with no end would swallow the next one
  const pairs = slurPairs(measures)
  const slurEnds = new Set(pairs.values())

  for (let mi = 0; mi < measures.length; mi++) {
    const measure = measures[mi]

    if (!Array.isArray(measure) && (measure as { _multiRest?: number })._multiRest !== undefined) {
      body += '| '
      body += `[${(measure as { _multiRest: number })._multiRest}] `
      continue
    }

    // Auto-collapse 2+ consecutive whole-measure rests into [N] block. A rest
    // carrying any marking is left out (shared predicate with the renderer)
    if (isCollapsibleRest(measure)) {
      let runEnd = mi
      while (runEnd + 1 < measures.length && isCollapsibleRest(measures[runEnd + 1])) runEnd++
      const runLen = runEnd - mi + 1
      if (runLen >= 2) {
        body += `| [${runLen}] `
        mi = runEnd
        continue
      }
    }

    const m = measure as MeasureArray
    body += m._repeatStart ? '|: ' : '| '

    // v3 measure-head markers, fixed order: {N} → @N/M → &dyn → wedge
    // (a mid-piece key change `_key` has no Route B syntax yet, so it is not
    // written out; the header `Key:` is the only key the text can express)
    if (m._volta !== undefined) {
      body += `{${m._volta}} `
    }
    if (m._timeSig) {
      body += `@${m._timeSig} `
    }

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

    // Tuplet groups: a run of notes sharing tuplet === N is written as groups, each
    // prefixed with ~N (or ~N:K when the group is K notes, not N)
    let tupletN = 0
    let tupletRemaining = 0

    for (let ni = 0; ni < m.length; ni++) {
      const note = m[ni]
      if (note.tuplet) {
        if (tupletRemaining === 0 || note.tuplet !== tupletN) {
          tupletN = note.tuplet
          // A group never runs past the notes that share its tuplet
          let run = 0
          while (ni + run < m.length && m[ni + run].tuplet === tupletN) run++
          const size = Math.min(note.tupletLen ?? tupletN, run)
          tupletRemaining = size
          // A short run that the barline closes needs no :K — ~N reads back the same
          // without inventing a tupletLen. A note after it would be swallowed, so :K there
          const explicit = size !== tupletN && (note.tupletLen !== undefined || ni + run < m.length)
          body += explicit ? `~${tupletN}:${size} ` : `~${tupletN} `
        }
        tupletRemaining--
      } else {
        tupletN = 0
        tupletRemaining = 0
      }

      // A slur is written from its pair: start before the note, end after it. A note
      // that ends one slur and opens the next gets both: `( 2 )` inside `( 1 ... 3 )`
      if (pairs.has(note)) body += '( '

      body += serializeNote(note) + ' '

      if (slurEnds.has(note)) body += ') '
    }

    const tag = m._direction ? directionToTag(m._direction) : ''
    const isLast = mi === measures.length - 1

    if (m._repeatEnd) {
      body += tag ? `:|${tag} ` : ':| '
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

export type NotePosition = {
  measureIdx: number    // renderer's origIdx for note (data-m), or -1 for unhighlightable individual notes (e.g. whole-rest)
  noteIdx: number       // index within measure
  start: number         // text offset of token start
  end: number           // text offset of token end (inclusive)
  restMeasureIdx?: number  // when this token lives inside a whole-rest measure, the array index of that measure (for data-rest-m highlight)
}

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
  if (suffix === '///') return { type: '32nd', dot: false }
  if (suffix === './//') return { type: '32nd', dot: true }
  return { type: 'quarter', dot: false }
}

export function durationBeats(type: NoteObject['type'], dot: boolean): number {
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
  if (b >= 0.2) return { type: '16th', dot: false }
  return { type: '32nd', dot: false }
}

function octaveFromMarks(marks: string | undefined): number {
  if (!marks) return 0
  return marks[0] === "'" ? marks.length : -marks.length
}

function parseGraceNoteText(s: string): GraceNote | null {
  const m = s.match(/^([#b])?([1-7])('+|,+)?$/)
  if (!m) return null
  return {
    accidental: (m[1] as '#' | 'b') || '',
    degree: parseInt(m[2]),
    octave: octaveFromMarks(m[3]),
  }
}

type TokenWithPos = { tok: string; start: number; end: number }

// `[N]` is capped: the renderer draws a block as N measures' worth of rests
const MAX_MULTI_REST = 999

// What may follow a note: dashes | . | ./ .// .///  | / // ///. A suffix never starts with a
// digit, which is what lets `1234` and `1/2/` be cut into notes without backtracking.
const NOTE_SUFFIX = '(?:-+|\\.(?:/{1,3})?|/{1,3})?'
const NOTE_OCTAVE = "(?:'+|,+)"
const NOTE_SRC = `(?:[#b]?[0-7]${NOTE_OCTAVE}?(?::[#b]?[1-7]${NOTE_OCTAVE}?)*|[Xx])${NOTE_SUFFIX}`
const NOTE_AT = new RegExp(NOTE_SRC, 'y')
const X_NOTE = new RegExp(`^[Xx](${NOTE_SUFFIX})$`)
const VOLTA_AT = /\{\d+\}/y

/**
 * A chunk that is ENTIRELY notes written without spaces (`1234`, `1/2/`, `#1b2'`), cut into
 * those notes with their offsets in the chunk. Null when any part of it is not a note: such
 * a chunk keeps its old reading (first note only, or ignored), so `6/8` stays a single 6.
 */
function splitGluedNotes(chunk: string): { text: string; start: number; end: number }[] | null {
  const out: { text: string; start: number; end: number }[] = []
  let p = 0
  while (p < chunk.length) {
    NOTE_AT.lastIndex = p
    const m = NOTE_AT.exec(chunk)
    if (!m) return null
    out.push({ text: m[0], start: p, end: p + m[0].length })
    p += m[0].length
  }
  return out.length > 0 ? out : null
}

// Where the number after `~` (or `~N:`) ends. Digits followed by a space, ':' or the end are
// the whole number (`~10`); glued to what follows (`~31/`) only the first digit counts and
// the rest is notes.
function tupletNumberEnd(text: string, from: number): number {
  let j = from
  while (j < text.length && /\d/.test(text[j])) j++
  if (j === from) return from
  return j >= text.length || /[\s:]/.test(text[j]) ? j : from + 1
}

// Where a closing barline's direction tag (`&fine`) ends, or `from` when there is none. Only
// the known tags belong to the barline: in `:|&mf 1 2` the `&mf` is the next bar's dynamic.
const DIRECTION_OF_TAG: Record<string, string> = { fine: 'Fine', dc: 'D.C.', ds: 'D.S.', segno: 'Segno' }
const DIRECTION_TAG_AT = /&([a-zA-Z]+)/y
function directionTagEnd(text: string, from: number): number {
  DIRECTION_TAG_AT.lastIndex = from
  const m = DIRECTION_TAG_AT.exec(text)
  return m && DIRECTION_OF_TAG[m[1]] ? from + m[0].length : from
}

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
        const j = directionTagEnd(text, i + 2)
        push(text.slice(i, j), i, j)
        i = j
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
      // `:|&fine`: a repeat end that also carries a direction is one token
      const j = directionTagEnd(text, i + 2)
      push(text.slice(i, j), i, j)
      i = j
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

    // Volta {N} is a token of its own even when notes are glued to it: `{1}5 6 7 1`
    if (ch === '{') {
      VOLTA_AT.lastIndex = i
      const vm = VOLTA_AT.exec(text)
      if (vm) {
        push(vm[0], i, i + vm[0].length)
        i += vm[0].length
        continue
      }
    }

    // Tuplet ~N, and ~N:K for a group of K notes
    if (ch === '~') {
      let j = tupletNumberEnd(text, i + 1)
      if (j > i + 1) {
        if (text[j] === ':' && /\d/.test(text[j + 1] || '')) j = tupletNumberEnd(text, j + 1)
        push(text.slice(i, j), i, j)
        i = j
        continue
      }
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

    // Note/extension token — read until whitespace or special char.
    // ':' stays inside the token only as a chord joiner (next char is #, b, or a degree),
    // so `5:3` is one token but `5 :| ` still tokenizes the repeat-end barline.
    let j = i
    while (j < text.length) {
      const c = text[j]
      if (/[\s|()<>!&\[\]]/.test(c)) break
      if (c === ':') {
        if (/[#b1-7]/.test(text[j + 1] || '')) { j++; continue }
        break
      }
      j++
    }
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

function wholeRestMeasure(): MeasureArray {
  const m = freshMeasure()
  m.push(emptyNote(0, 0, '', 'whole', false, true))
  return m
}

// What a closing barline token adds to the measure it ends
type Close = { repeat?: boolean; direction?: string }

function applyClose(m: MeasureArray, close?: Close) {
  if (close?.repeat) m._repeatEnd = true
  if (close?.direction) m._direction = close.direction
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

  // Header lines = the first lines parseHeaderLine accepts (Title:/Key:/Time:/Tempo:, any
  // case, `1=G`, ♭B…), max 4; blank lines between them are skipped and not counted. It is
  // the reader OCR merging uses too, so a header-looking line is never read as notes.
  let headerEndIdx = 0
  let headerLines = 0
  for (let i = 0; i < lines.length && headerLines < 4; i++) {
    const fields = parseHeaderLine(lines[i])
    if (fields) {
      headerEndIdx = i + 1
      headerLines++
      if (fields.title) titleStr = fields.title
      if (fields.key) keyStr = fields.key
      if (fields.time) timeStr = fields.time
      if (fields.tempo) tempoStr = fields.tempo
    } else if (lines[i].trim() === '') {
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
  // Last pitched note across measure boundaries — source for tie continuations
  // (flushMeasure resets lastNote, but a tie needs the previous measure's pitch)
  let lastRealNote: NoteObject | null = null
  let lastNotePos: { measureIdx: number; noteIdx: number } | null = null
  let pendingDynamic = ''
  let activeWedge: 'cresc' | 'dim' | null = null
  let pendingSlurStart = false
  // Tuplet marker ~N (or ~N:K): the following K notes (N when there is no :K; rests
  // included) get tuplet = N, and the first of them tupletLen = K when K isn't N
  let pendingTupletN = 0
  let pendingTupletRemaining = 0
  let pendingTupletLen = 0
  let pendingTupletFirst = false

  // A closing mark with no notes in front of it ends the measure BEFORE it: `1 2 3 4 | :|`
  // used to lose the repeat. Right after a `[N]` block (afterRestBlock) the last rest is
  // split off the block to carry it: `[4] :|` = a block of 3, then a rest that closes the repeat.
  const closeLast = (close: Close, afterRestBlock: boolean) => {
    const last = measures[measures.length - 1]
    if (!last) return
    if (Array.isArray(last)) { applyClose(last, close); return }
    if (!afterRestBlock) return
    const n = last._multiRest
    measures.pop()
    if (n - 1 >= 2) measures.push({ _multiRest: n - 1 })
    else if (n - 1 === 1) measures.push(wholeRestMeasure())
    const tail = wholeRestMeasure()
    applyClose(tail, close)
    measures.push(tail)
  }

  const flushMeasure = (close?: Close, afterRestBlock = false) => {
    if (current && current.length > 0) {
      applyClose(current, close)
      measures.push(current)
    } else if (close) {
      closeLast(close, afterRestBlock)
    }
    current = freshMeasure()
    if (pendingDynamic) {
      current._dynamic = pendingDynamic
      pendingDynamic = ''
    }
    if (activeWedge) current._wedge = activeWedge
    lastNote = null
    lastNotePos = null
    // Tuplet groups don't cross barlines
    pendingTupletN = 0
    pendingTupletRemaining = 0
    pendingTupletLen = 0
    pendingTupletFirst = false
  }

  // A tuplet slot and a pending `(` belong to the next note, however it is written
  const takePendings = (note: NoteObject, isRest: boolean) => {
    if (pendingTupletRemaining > 0) {
      note.tuplet = pendingTupletN
      if (pendingTupletFirst) {
        if (pendingTupletLen) note.tupletLen = pendingTupletLen
        pendingTupletFirst = false
      }
      pendingTupletRemaining--
    }
    if (pendingSlurStart && !isRest) {
      note.slurStart = true
      pendingSlurStart = false
    }
  }

  // One note token: [#/b]?digit(octave)?(duration)?, a chord (':'-joined, duration at the
  // end: 5:3, 6:#4,:1-) or X (unpitched). Glued chunks are cut before they get here.
  const addNote = (tok: string, start: number, end: number) => {
    if (!current) current = freshMeasure()
    let acc: '#' | 'b' | '' = ''
    let deg = -1
    let oct = 0
    let suffix = ''
    let chordNotes: ChordNote[] | undefined
    const xm = tok.match(X_NOTE)

    if (xm) {
      deg = 0
      suffix = xm[1]
    } else if (tok.includes(':')) {
      const mainM = tok.split(':')[0].match(/^([#b])?([1-7])('+|,+)?$/)
      const parts = tok.split(':')
      if (mainM) {
        const cns: ChordNote[] = []
        let ok = true
        for (let pi = 1; pi < parts.length; pi++) {
          const isLast = pi === parts.length - 1
          const cm = parts[pi].match(/^([#b])?([1-7])('+|,+)?(.*)$/)
          if (!cm || (!isLast && cm[4])) { ok = false; break }
          cns.push({ accidental: (cm[1] as '#' | 'b') || '', degree: parseInt(cm[2]), octave: octaveFromMarks(cm[3]) })
          if (isLast) suffix = cm[4] || ''
        }
        if (ok) {
          acc = (mainM[1] as '#' | 'b') || ''
          deg = parseInt(mainM[2])
          oct = octaveFromMarks(mainM[3])
          chordNotes = cns
        }
      }
      if (deg === -1) return // malformed chord token → ignore
    } else {
      const noteMatch = tok.match(/^([#b])?([0-7])('+|,+)?(.*)$/)
      if (!noteMatch) return
      acc = (noteMatch[1] as '#' | 'b') || ''
      deg = parseInt(noteMatch[2])
      oct = octaveFromMarks(noteMatch[3])
      suffix = noteMatch[4] || ''
    }

    // X is degree 0 without being a rest: an unpitched hit
    const isRest = deg === 0 && !xm
    const { type, dot } = parseDurationSuffix(suffix)

    const note = emptyNote(deg, oct, acc, type, dot, isRest)
    if (chordNotes && chordNotes.length > 0) note.chordNotes = chordNotes
    takePendings(note, isRest)
    // measureIdx here is the ORIGINAL array index of current (which is what
    // measures.length will be when current gets flushed). Remapped to renderer's
    // origIdx in the post-processing step below.
    const measureIdx = measures.length
    const noteIdx = current.length
    current.push(note)
    lastNote = note
    if (!isRest) lastRealNote = note
    lastNotePos = { measureIdx, noteIdx }
    positions.push({ measureIdx, noteIdx, start, end })
  }

  // True when the token before this one was a `[N]` rest block
  let afterRest = false

  for (let ti = 0; ti < tokens.length; ti++) {
    const { tok, start, end } = tokens[ti]
    const prevWasRestBlock = afterRest
    afterRest = false

    if (tok === '|') {
      flushMeasure()
      continue
    }
    if (tok === '|:') {
      flushMeasure()
      if (current) current._repeatStart = true
      continue
    }
    if (tok === ':|' || tok.startsWith(':|&')) {
      flushMeasure({ repeat: true, direction: DIRECTION_OF_TAG[tok.slice(3)] }, prevWasRestBlock)
      continue
    }
    if (tok === '||') {
      flushMeasure()
      continue
    }
    if (tok.startsWith('||&')) {
      const direction = DIRECTION_OF_TAG[tok.slice(3)]
      flushMeasure(direction ? { direction } : undefined, prevWasRestBlock)
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
      // `[0]` would be a block the renderer can't draw
      const n = Math.min(parseInt(mrm[1]), MAX_MULTI_REST)
      if (n === 0) continue
      // The measure being built is empty here and may already carry markings (`|: [4]`,
      // `@3/4 [4]`, `&f [4]`, `{1} [2]`, `< [4]`). They go on real rest measures: a repeat
      // start, meter or dynamic on the first rest, the rest of the block after it; a volta
      // or an active hairpin on EVERY rest, because both are per measure.
      let head: MeasureArray | null = null
      if (current && current.length > 0) measures.push(current)
      else head = current
      const spansEvery = !!head && (head._volta !== undefined || !!head._wedge)
      const marksFirst = !!head && (head._repeatStart || !!head._timeSig || !!head._dynamic)
      if (head && (spansEvery || marksFirst)) {
        const first = wholeRestMeasure()
        if (head._repeatStart) first._repeatStart = true
        if (head._timeSig) first._timeSig = head._timeSig
        if (head._dynamic) first._dynamic = head._dynamic
        if (head._volta !== undefined) first._volta = head._volta
        if (head._wedge) first._wedge = head._wedge
        measures.push(first)
        if (spansEvery) {
          for (let k = 1; k < n; k++) {
            const rest = wholeRestMeasure()
            if (head._volta !== undefined) rest._volta = head._volta
            if (head._wedge) rest._wedge = head._wedge
            measures.push(rest)
          }
        } else if (n - 1 >= 2) {
          measures.push({ _multiRest: n - 1 })
        } else if (n - 1 === 1) {
          measures.push(wholeRestMeasure())
        }
      } else {
        measures.push({ _multiRest: n })
      }
      current = freshMeasure()
      lastNote = null
      afterRest = true
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

    // v3: volta {N}
    const voltaM = tok.match(/^\{(\d+)\}$/)
    if (voltaM) {
      if (!current) current = freshMeasure()
      current._volta = parseInt(voltaM[1])
      continue
    }

    // v3: temp time signature @N/M (applies from this measure on)
    const timeSigM = tok.match(/^@(\d+\/\d+)$/)
    if (timeSigM) {
      if (!current) current = freshMeasure()
      current._timeSig = timeSigM[1]
      continue
    }

    // v3: tuplet marker ~N, or ~N:K for a group of K notes (quarter + eighth triplet = ~3:2)
    const tupletM = tok.match(/^~(\d+)(?::(\d+))?$/)
    if (tupletM) {
      pendingTupletN = parseInt(tupletM[1])
      const k = tupletM[2] ? parseInt(tupletM[2]) : pendingTupletN
      pendingTupletRemaining = pendingTupletN < 1 ? 0 : k >= 1 ? k : pendingTupletN
      pendingTupletLen = pendingTupletRemaining !== pendingTupletN ? pendingTupletRemaining : 0
      pendingTupletFirst = true
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
      if (lastNote) {
        // Extend the previous note or rest by one beat per dash
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
      } else {
        // Dash(es) at measure start = tie continuation of the previous measure's
        // last pitched note, one beat per dash
        const src = lastRealNote
        const { type, dot } = beatsToType(tok.length)
        const note = emptyNote(src?.degree ?? 1, src?.octave ?? 0, src?.accidental ?? '', type, dot, false)
        note.tie = true
        // It is a note like any other: it fills a tuplet slot and takes a pending `(`
        takePendings(note, false)
        const measureIdx = measures.length
        const noteIdx = current.length
        current.push(note)
        lastNote = note
        lastRealNote = note
        lastNotePos = { measureIdx, noteIdx }
        positions.push({ measureIdx, noteIdx, start, end })
      }
      continue
    }

    // A note, or several written without spaces (`1234`, `1/2/`), each with its own text range
    const pieces = splitGluedNotes(tok)
    if (pieces && pieces.length > 1) {
      for (const piece of pieces) addNote(piece.text, start + piece.start, start + piece.end)
    } else {
      addNote(tok, start, end)
    }
  }

  if (current && current.length > 0) measures.push(current)

  // 弱起: a first measure shorter than its bar. Route B has no syntax for it, so it is read
  // off the lengths. A whole rest, a [N] block and a lone measure are not a pickup.
  const firstMeasure = measures[0]
  if (measures.length > 1 && Array.isArray(firstMeasure) && !isWholeRestMeasure(firstMeasure)) {
    let length = 0
    for (const n of firstMeasure) length += durationBeats(n.type, n.dot) * tupletFactor(n.tuplet)
    // Tolerance: tuplet sums are inexact (a full triplet bar can add up to 3.9999999999999996)
    if (length > 1e-9 && length < barBeatsOf(firstMeasure._timeSig ?? timeStr) - 1e-9) firstMeasure._pickup = true
  }

  // Remap position.measureIdx from "array index" to "renderer origIdx" (data-m on SVG).
  // For notes in whole-rest measures (no per-note data-m, but their <g> wrapper has
  // data-rest-m), set measureIdx = -1 AND record restMeasureIdx = array index so the
  // cursor-sync logic can highlight the rest group instead of the previous note.
  const origIdxMap = computeOrigIdxMap(measures)
  const remappedPositions: NotePosition[] = positions.map(p => {
    const o = origIdxMap.get(p.measureIdx)
    if (o !== undefined) return { ...p, measureIdx: o }
    // No origIdx → this note is inside a whole-rest measure (or some other unhighlightable spot).
    // Check if the original measure is a whole-rest; if so attach restMeasureIdx.
    // restMeasureIdx is the renderer's data-rest-m: the array index of the rest's
    // group — for a rest inside a collapsed run, the run's first measure
    const arrayIdx = p.measureIdx
    const m = measures[arrayIdx]
    return isWholeRestMeasure(m)
      ? { ...p, measureIdx: -1, restMeasureIdx: isCollapsibleRest(m) ? restRunStart(measures, arrayIdx) : arrayIdx }
      : { ...p, measureIdx: -1 }
  })

  return { measures, keyStr, timeStr, tempoStr, titleStr, positions: remappedPositions }
}
