import type { ChordNote, Measure, MeasureArray, NoteObject } from '@/types/score'
import { isUnpitched } from '../types/score'
import { parseMeter } from './meter'
import { slurPairs } from './slurs'

const RENDER_CONFIG = {
  noteWidths: {
    whole: 160, half: 80, quarter: 40,
    eighth: 30, '16th': 16, '32nd': 14,
  } as Record<string, number>,
  durationBeats: {
    whole: 4, half: 2, quarter: 1,
    eighth: 0.5, '16th': 0.25, '32nd': 0.125,
  } as Record<string, number>,
  lineHeight: 80,
  paddingTopWithTempo: 100,
  paddingTopDefault: 80,
  startX: 20,
  fontSize: 18,
  minWidth: 300,
  padding: 40,
  repeatSignWidth: 12,
  multiRestMaxWidth: 160,
}

// Width of one digit at font-size 18 (Inter digits are ~0.6em): where a duration dot goes, how long a rest's underline is
const DIGIT_WIDTH = 18 * 0.6
// Room a grace note takes in front of its main note (+ extra when it carries an accidental)
const GRACE_ROOM = 14
const GRACE_ACCIDENTAL_ROOM = 4
// A note with an accidental (or a chord stack with one) draws it at +2 and the digit at +10, so the
// accidental never touches the barline; the note is that much wider
const ACCIDENTAL_ROOM = 8
// A slur continued onto a new line starts here, right of the measure number it would otherwise run through
const SLUR_CONTINUE_DX = 22
// A hairpin reaches baseline + 35; the next line's volta bracket sits at its baseline - 44
const HAIRPIN_CLEARANCE = 8

// Inter is only guaranteed on the page, not inside an exported <img>: without
// fallbacks the PNG/JPEG export renders the whole score in the default serif
const FONT_FAMILY = "Inter, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"

function escapeSVG(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// A measure that is nothing but one whole rest — drawn as a row of `0`s
export function isWholeRestMeasure(m: Measure): boolean {
  return Array.isArray(m) && m.length === 1 && m[0].rest && m[0].type === 'whole'
}

// Whole-rest measures that may merge into a [N] block. One that carries ANY
// marking must stay a real measure or the marking vanishes: volta bracket,
// time/key label, repeat signs, dynamic, hairpin, D.C./Fine text.
// editor.ts (computeOrigIdxMap, serializer) imports this instead of keeping
// its own copy — the two must agree exactly or the data-m index space drifts.
export function isCollapsibleRest(m: Measure): boolean {
  if (!isWholeRestMeasure(m)) return false
  const a = m as MeasureArray
  return a._volta === undefined && !a._timeSig && !a._key
    && !a._repeatStart && !a._repeatEnd && !a._dynamic && !a._wedge && !a._direction
}

// Collapse runs of 2+ collapsible rests into { _multiRest: N }. `first[k]` is
// the index in the INPUT array of output item k's first measure (a parsed
// `[N]` block is one input entry, a collapsed run is N) — the shared index
// space for data-rest-m and the text editor's restMeasureIdx.
export function collapseRestRunsIndexed(measures: Measure[]): { items: Measure[]; first: number[] } {
  const items: Measure[] = []
  const first: number[] = []
  let i = 0
  while (i < measures.length) {
    first.push(i)
    if (isCollapsibleRest(measures[i])) {
      let run = 1
      while (i + run < measures.length && isCollapsibleRest(measures[i + run])) run++
      items.push(run >= 2 ? { _multiRest: run } : measures[i])
      i += run
    } else {
      items.push(measures[i])
      i++
    }
  }
  return { items, first }
}

export function collapseRestRuns(measures: Measure[]): Measure[] {
  return collapseRestRunsIndexed(measures).items
}

// Index of the first measure of the collapsible-rest run that contains
// measures[i] (i itself for a lone rest)
export function restRunStart(measures: Measure[], i: number): number {
  let s = i
  while (s > 0 && isCollapsibleRest(measures[s - 1])) s--
  return s
}

// Tuplet duration correction: N notes in the time of pow2floor(N). A power of two can't
// be that (4 in the time of 4 is no tuplet): those belong to compound meter, where a
// duplet is 2 in the time of 3, a quadruplet 4 in 3, an octuplet 8 in 6
export function tupletFactor(n: number | undefined): number {
  if (!n || n < 2) return 1
  if (n === 2) return 3 / 2
  let p = 1
  while (p * 2 <= n) p *= 2
  return p === n ? 3 / 4 : p / n
}

function getBeamingLines(type: string): number {
  if (type === 'eighth') return 1
  if (type === '16th') return 2
  if (type === '32nd') return 3
  return 0
}

function renderHeader(
  els: string[], maxWidth: number, startX: number, color: string,
  titleStr: string, keyStr: string, timeStr: string, tempoStr: string,
): void {
  els.push(`<text x="${maxWidth / 2}" y="30" font-family="${FONT_FAMILY}" font-size="24" font-weight="600" fill="${color}" text-anchor="middle">${escapeSVG(titleStr)}</text>`)
  // The first staff sits at y = 100 / 120 and its measure number at baseline - 30: the key and tempo
  // lines stay above that (they used to be drawn right on top of it)
  els.push(`<text x="${startX}" y="54" font-family="${FONT_FAMILY}" font-size="14" font-weight="500" fill="${color}">Key: 1=${escapeSVG(keyStr)}   Time: ${escapeSVG(timeStr)}</text>`)
  if (tempoStr) {
    els.push(`<text x="${startX}" y="71" font-family="${FONT_FAMILY}" font-size="13" fill="${color}">Tempo: ${escapeSVG(tempoStr)}</text>`)
  }
}

function renderBarline(els: string[], x: number, y: number, color: string, isFinal: boolean): void {
  els.push(`<line x1="${x}" y1="${y - 15}" x2="${x}" y2="${y + 5}" stroke="${color}" stroke-width="1"/>`)
  if (isFinal) {
    els.push(`<line x1="${x + 4}" y1="${y - 15}" x2="${x + 4}" y2="${y + 5}" stroke="${color}" stroke-width="3"/>`)
  }
}

function renderRepeatStart(els: string[], x: number, y: number, color: string): void {
  els.push(`<line x1="${x}" y1="${y - 15}" x2="${x}" y2="${y + 5}" stroke="${color}" stroke-width="3"/>`)
  els.push(`<line x1="${x + 4}" y1="${y - 15}" x2="${x + 4}" y2="${y + 5}" stroke="${color}" stroke-width="1"/>`)
  els.push(`<circle cx="${x + 8}" cy="${y - 7}" r="2" fill="${color}"/>`)
  els.push(`<circle cx="${x + 8}" cy="${y - 1}" r="2" fill="${color}"/>`)
}

function renderRepeatEnd(els: string[], x: number, y: number, color: string): void {
  els.push(`<circle cx="${x - 8}" cy="${y - 7}" r="2" fill="${color}"/>`)
  els.push(`<circle cx="${x - 8}" cy="${y - 1}" r="2" fill="${color}"/>`)
  els.push(`<line x1="${x - 4}" y1="${y - 15}" x2="${x - 4}" y2="${y + 5}" stroke="${color}" stroke-width="1"/>`)
  els.push(`<line x1="${x}" y1="${y - 15}" x2="${x}" y2="${y + 5}" stroke="${color}" stroke-width="3"/>`)
}

// One dot per octave, stacked 6px apart. Deliberately NOT capped at 2: a
// 大提琴 / 革胡 / 大阮 part sits three octaves below the tonic often enough that
// capping silently drew the wrong pitch (a C2 looked like a mid-register note).
// Beam underlines sit at y + 4 per line, so below-dots start under the last one
// (a 16th's 2nd / a 32nd's 3rd line used to cut through the first dot).
function renderOctaveDots(els: string[], cx: number, y: number, octave: number, color: string, beamLines = 0): void {
  const belowStart = y + 10 + Math.max(0, beamLines - 1) * 4
  for (let i = 0; i < Math.abs(octave); i++) {
    const cy = octave > 0 ? y - 18 - i * 6 : belowStart + i * 6
    els.push(`<circle cx="${cx}" cy="${cy}" r="1.5" fill="${color}"/>`)
  }
}

// Beam group length in quarter-beats. Simple meters beam per beat (4 / beat
// type); compound meters (6/8, 9/8, 12/8) beam per dotted beat, i.e. 3 eighths.
function beamGroupLength(beats: number, beatType: number): number {
  return beatType === 8 && beats % 3 === 0 ? 1.5 : 4 / beatType
}

// Which beam group a position (in quarter-beats) falls into. Tuplet durations
// are inexact floats (6 sixteenth-sextuplets sum to 0.9999999999999999), so a
// note exactly on a group boundary must not floor into the previous group.
function beamGroupOf(pos: number, groupLen: number): number {
  return Math.floor(pos / groupLen + 1e-9)
}

// naturalWidth = noteWidth before line stretching: an underline that ends here
// keeps that length, so a stretched lone eighth doesn't look beamed to its neighbour
function renderBeamingUnderlines(
  els: string[], measure: MeasureArray, j: number,
  currentX: number, noteWidth: number, naturalWidth: number, currentY: number,
  cumulative: number[], beamGroup: number, color: string,
): void {
  const linesCnt = getBeamingLines(measure[j].type)
  for (let l = 1; l <= linesCnt; l++) {
    const noteBeat = beamGroupOf(cumulative[j], beamGroup)
    const prevBeat = j > 0 ? beamGroupOf(cumulative[j - 1], beamGroup) : -1
    const nextBeat = j < measure.length - 1 ? beamGroupOf(cumulative[j + 1], beamGroup) : -1
    const connectLeft = j > 0 && getBeamingLines(measure[j - 1].type) >= l && prevBeat === noteBeat
    const connectRight = j < measure.length - 1 && getBeamingLines(measure[j + 1].type) >= l && nextBeat === noteBeat
    const x1 = connectLeft ? currentX : currentX + 2
    const x2 = connectRight ? currentX + noteWidth : currentX + naturalWidth - 2
    els.push(`<line x1="${x1}" y1="${currentY + l * 4}" x2="${x2}" y2="${currentY + l * 4}" stroke="${color}" stroke-width="1"/>`)
  }
}

// Beats a note lasts beyond its own digit, drawn as dashes (0s for a rest). A dotted whole is
// 6 beats: the digit plus 5, not plus 3. The dash drawing and the "no duration dot" test both
// read this, so they cannot disagree.
function extraBeatsOf(note: NoteObject): number {
  if (note.type === 'whole') return note.dot ? 5 : 3
  if (note.type === 'half') return note.dot ? 2 : 1
  return 0
}

function renderExtensionDashes(
  els: string[], note: NoteObject, currentX: number,
  numXOffset: number, noteWidth: number, currentY: number, color: string,
): number {
  const extraBeats = extraBeatsOf(note)
  if (extraBeats > 0) {
    const dashStep = (noteWidth - numXOffset) / (extraBeats + 1)
    for (let b = 1; b <= extraBeats; b++) {
      const extChar = note.rest ? '0' : '-'
      els.push(`<text x="${currentX + numXOffset + b * dashStep}" y="${currentY}" font-family="${FONT_FAMILY}" font-size="18" fill="${color}">${extChar}</text>`)
    }
  }
  return extraBeats
}

function renderMultiRestBracket(
  els: string[], currentX: number, currentY: number,
  N: number, blockW: number, color: string,
): number {
  const lineY = currentY - 8
  const lx1 = currentX + 4
  const lx2 = currentX + blockW - 4
  const midX = (lx1 + lx2) / 2
  els.push(`<line x1="${lx1}" y1="${lineY}" x2="${lx2}" y2="${lineY}" stroke="${color}" stroke-width="3"/>`)
  els.push(`<line x1="${lx1}" y1="${lineY - 5}" x2="${lx1}" y2="${lineY + 5}" stroke="${color}" stroke-width="2"/>`)
  els.push(`<line x1="${lx2}" y1="${lineY - 5}" x2="${lx2}" y2="${lineY + 5}" stroke="${color}" stroke-width="2"/>`)
  els.push(`<text x="${midX}" y="${lineY - 7}" font-family="${FONT_FAMILY}" font-size="12" font-weight="600" fill="${color}" text-anchor="middle">${N}</text>`)
  return blockW
}

function renderArticulation(els: string[], cx: number, y: number, kind: string, color: string, octave: number): void {
  // One octave dot per 6px, uncapped like the dots themselves: the mark rides above the topmost one
  const yAbove = y - 20 - 6 * Math.max(0, octave)
  if (kind === 'accent') {
    els.push(`<text x="${cx}" y="${yAbove}" font-family="${FONT_FAMILY}" font-size="11" font-weight="600" fill="${color}" text-anchor="middle">&gt;</text>`)
  } else if (kind === 'staccato') {
    els.push(`<circle cx="${cx}" cy="${yAbove - 2}" r="1.5" fill="${color}"/>`)
  } else if (kind === 'tenuto') {
    els.push(`<line x1="${cx - 3}" y1="${yAbove - 2}" x2="${cx + 3}" y2="${yAbove - 2}" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>`)
  } else if (kind === 'marcato') {
    els.push(`<text x="${cx}" y="${yAbove}" font-family="${FONT_FAMILY}" font-size="12" font-weight="700" fill="${color}" text-anchor="middle">^</text>`)
  } else if (kind === 'fermata') {
    els.push(`<path d="M ${cx - 6},${yAbove} Q ${cx},${yAbove - 7} ${cx + 6},${yAbove}" fill="none" stroke="${color}" stroke-width="1.2"/>`)
    els.push(`<circle cx="${cx}" cy="${yAbove - 2}" r="1.2" fill="${color}"/>`)
  }
}

function renderGraceNote(els: string[], x: number, y: number, g: { degree: number; octave: number; accidental: string }, color: string): void {
  // Small grace note drawn inside the room graceRoomOf() reserved at the main note's left edge `x`.
  // It used to hang 10px LEFT of x, which on a bar's first note is the previous measure (or the margin).
  const gx = x
  const gy = y - 4
  let offset = 3
  if (g.accidental) {
    els.push(`<text x="${gx + 1}" y="${gy - 5}" font-family="${FONT_FAMILY}" font-size="7" fill="${color}">${g.accidental}</text>`)
    offset = 7
  }
  els.push(`<text x="${gx + offset}" y="${gy}" font-family="${FONT_FAMILY}" font-size="11" font-style="italic" fill="${color}">${g.degree}</text>`)
  // Octave dots for the grace note — one per octave (5px apart, the glyph is
  // smaller than a melody note). Previously drew at most one, so a 倚音 two
  // octaves out was already displayed at the wrong pitch.
  for (let d = 0; d < Math.abs(g.octave); d++) {
    const cy = g.octave > 0 ? gy - 11 - d * 5 : gy + 4 + d * 5
    els.push(`<circle cx="${gx + offset + 3}" cy="${cy}" r="1.2" fill="${color}"/>`)
  }
}

function renderVoltaBracket(
  els: string[], x1: number, x2: number, y: number,
  num: number, drawHead: boolean, color: string, labelShift = 0,
): void {
  const vy = y - 44
  els.push(`<g class="jn-volta">`)
  els.push(`<line x1="${x1}" y1="${vy}" x2="${x2}" y2="${vy}" stroke="${color}" stroke-width="1"/>`)
  if (drawHead) {
    els.push(`<line x1="${x1}" y1="${vy}" x2="${x1}" y2="${vy + 8}" stroke="${color}" stroke-width="1"/>`)
    // At a line start the label would sit on the measure number (same height, x = 20): labelShift is that number's width
    els.push(`<text x="${x1 + 4 + labelShift}" y="${vy + 12}" font-family="${FONT_FAMILY}" font-size="10" font-style="italic" fill="${color}">${num}.</text>`)
  }
  els.push(`</g>`)
}

function renderTupletBracket(els: string[], x1: number, x2: number, y: number, n: number, color: string): void {
  const by = y - 28
  const mid = (x1 + x2) / 2
  els.push(`<g class="jn-tuplet">`)
  els.push(`<line x1="${x1}" y1="${by}" x2="${mid - 6}" y2="${by}" stroke="${color}" stroke-width="1"/>`)
  els.push(`<line x1="${mid + 6}" y1="${by}" x2="${x2}" y2="${by}" stroke="${color}" stroke-width="1"/>`)
  els.push(`<line x1="${x1}" y1="${by}" x2="${x1}" y2="${by + 5}" stroke="${color}" stroke-width="1"/>`)
  els.push(`<line x1="${x2}" y1="${by}" x2="${x2}" y2="${by + 5}" stroke="${color}" stroke-width="1"/>`)
  els.push(`<text x="${mid}" y="${by + 3.5}" font-family="${FONT_FAMILY}" font-size="10" font-style="italic" fill="${color}" text-anchor="middle">${n}</text>`)
  els.push(`</g>`)
}

// What a note draws, as predicates both the drawing and the width/extent maths read
// (a second copy is how a stale `accidental` on a rest once took up width it never drew)
const drawsGrace = (n: NoteObject) => !!n.graceNote && !n.rest && !n.tie
const drawsOctaveDots = (n: NoteObject) => !n.rest && !n.tie && !isUnpitched(n)

// Room reserved in front of a note for its grace note, inside the note's own width
function graceRoomOf(note: NoteObject): number {
  return drawsGrace(note) ? GRACE_ROOM + (note.graceNote!.accidental ? GRACE_ACCIDENTAL_ROOM : 0) : 0
}

// An accidental on the note OR on any chord row opens the accidental column for the whole stack,
// so every digit of a double stop lines up. A tie draws no accidentals; a rest draws nothing.
function hasStackAccidental(note: NoteObject): boolean {
  if (note.rest || note.tie) return false
  return !!note.accidental || !!note.chordNotes?.some(cn => !!cn.accidental)
}

interface ChordRow { cn: ChordNote; y: number }

// Where a note's chord rows go, as baseline offsets, and how far down the stack reaches.
// renderNote draws from this and chordExtent reads `height`, so the next line and the dynamic
// always move by exactly what was drawn. A rest has no rows (an edited-away note can still carry
// stale chordNotes). Rows are 16px apart; octave dots need 6px per dot so they land in the gap
// between digits instead of on the neighbouring row. Beam underlines (4px each) would run through
// the first row, and so would the main note's own low-octave dots (first one at +10): start below both.
function chordRowsOf(note: NoteObject): { rows: ChordRow[]; height: number } {
  if (note.rest || !note.chordNotes || note.chordNotes.length === 0) return { rows: [], height: 0 }
  let y = getBeamingLines(note.type) * 4
  if (drawsOctaveDots(note) && note.octave < 0) y += -note.octave * 6 + 4
  const rows: ChordRow[] = []
  for (const cn of note.chordNotes) {
    // A tie's rows are "-": no octave, so no room for dots
    const above = note.tie ? 0 : Math.max(0, cn.octave)
    const below = note.tie ? 0 : Math.max(0, -cn.octave)
    y += 16 + above * 6
    rows.push({ cn, y })
    y += below * 6
  }
  return { rows, height: y }
}

function renderNote(
  els: string[], note: NoteObject, currentX: number, currentY: number,
  color: string, mIdx: number, nIdx: number,
): number {
  const graceRoom = graceRoomOf(note)
  const colX = currentX + graceRoom
  // Where the digit sits, relative to the note's left edge (grace room included)
  const numXOffset = graceRoom + (hasStackAccidental(note) ? 10 : 2)
  const displayStr = note.tie ? '-' : note.rest ? '0' : isUnpitched(note) ? 'X' : note.degree.toString()
  if (!note.rest && !note.tie && note.accidental) {
    els.push(`<text x="${colX + 2}" y="${currentY - 8}" font-family="${FONT_FAMILY}" font-size="10" fill="${color}">${note.accidental}</text>`)
  }
  // Grace note (倚音) — small number before main
  if (drawsGrace(note)) {
    renderGraceNote(els, currentX, currentY, note.graceNote!, color)
  }
  const dataAttrs = ` data-m="${mIdx}" data-n="${nIdx}" class="jn-note"`
  els.push(`<text x="${currentX + numXOffset}" y="${currentY}" font-family="${FONT_FAMILY}" font-size="18" fill="${color}"${dataAttrs}>${displayStr}</text>`)
  // Articulation above the note
  if (note.articulation && !note.rest && !note.tie) {
    const noteCenterX = currentX + numXOffset + 5
    renderArticulation(els, noteCenterX, currentY, note.articulation, color, note.octave)
  }

  for (const { cn, y } of chordRowsOf(note).rows) {
    const chordY = currentY + y
    const digitX = currentX + numXOffset
    if (note.tie) {
      // A tied chord continues every voice: a "-" per row, not digits that read as a new attack
      els.push(`<text x="${digitX}" y="${chordY}" font-family="${FONT_FAMILY}" font-size="16" fill="${color}">-</text>`)
      continue
    }
    if (cn.accidental) {
      els.push(`<text x="${colX + 2}" y="${chordY - 6}" font-family="${FONT_FAMILY}" font-size="9" fill="${color}">${cn.accidental}</text>`)
    }
    els.push(`<text x="${digitX}" y="${chordY}" font-family="${FONT_FAMILY}" font-size="16" fill="${color}">${cn.degree}</text>`)
    // Same uncapped rule as the melody line above
    const dotCx = digitX + 5
    for (let d = 0; d < Math.abs(cn.octave); d++) {
      const cy = cn.octave > 0 ? chordY - 14 - d * 6 : chordY + 6 + d * 6
      els.push(`<circle cx="${dotCx}" cy="${cy}" r="1.5" fill="${color}"/>`)
    }
  }
  return numXOffset
}

// Vertical space a note's chord rows take below its baseline
function chordExtent(note: NoteObject): number {
  return chordRowsOf(note).height
}

function noteWidthOf(note: NoteObject): number {
  const { noteWidths } = RENDER_CONFIG
  return (noteWidths[note.type] || 40) * (note.dot ? 1.5 : 1) * tupletFactor(note.tuplet)
    + (hasStackAccidental(note) ? ACCIDENTAL_ROOM : 0) + graceRoomOf(note)
}

// What a whole-measure rest looks like in a meter: how many symbols, whether each carries a
// duration dot, how many beam underlines. 6/8 is two dotted rests, 2/2 four zeros (half-note
// beats), 5/8 five eighth rests (one underline each), 3/16 three 16th rests (two each).
function wholeRestSymbols(beats: number, beatType: number): { count: number; dotted: boolean; beamLines: number } {
  switch (beatType) {
    case 1: return { count: beats * 4, dotted: false, beamLines: 0 }
    case 2: return { count: beats * 2, dotted: false, beamLines: 0 }
    case 8: return beats % 3 === 0
      ? { count: beats / 3, dotted: true, beamLines: 0 }
      : { count: beats, dotted: false, beamLines: 1 }
    case 16: return { count: beats, dotted: false, beamLines: 2 }
    case 32: return { count: beats, dotted: false, beamLines: 3 }
    default: return { count: beats, dotted: false, beamLines: 0 }
  }
}

// A layout item's width before stretching: `flex` stretches when a line is
// justified (notes, multi-rest block), `fixed` doesn't (time-sig label, repeat sign)
interface ItemWidth { flex: number; fixed: number }

interface LinePlan { lineStart: boolean[]; scale: number[] }

// Fixed measures per line: start a new line every `perLine` items, or earlier
// when the next item would overflow the width (narrow screens stay readable
// instead of shrinking the whole score). Each line's flex widths are then
// stretched to fill the width so barlines end flush right; a short last line
// keeps the previous line's stretch rather than spreading a few measures out.
function planLines(widths: ItemWidth[], available: number, perLine: number): LinePlan {
  const lineStart = widths.map(() => false)
  const scale = widths.map(() => 1)
  let prevScale = 1
  let i = 0
  while (i < widths.length) {
    lineStart[i] = true
    let flex = 0
    let fixed = 0
    let j = i
    while (j < widths.length && j - i < perLine) {
      if (j > i && flex + fixed + widths[j].flex + widths[j].fixed > available) break
      flex += widths[j].flex
      fixed += widths[j].fixed
      j++
    }
    const full = j < widths.length || j - i === perLine
    let s = flex > 0 ? (available - fixed) / flex : 1
    if (!full) s = Math.min(s, prevScale)
    // A lone measure wider than the line overflows as before; never squash notes
    s = Math.max(1, s)
    for (let k = i; k < j; k++) scale[k] = s
    prevScale = s
    i = j
  }
  return { lineStart, scale }
}

// How many measures a multi-rest block stands for. Every non-array measure is such a block, so
// bad data ({ _multiRest: 0 }, a negative, NaN, a missing field) is a block of no length, not a
// crash. editor.ts's computeOrigIdxMap adds the same max(0, N) to its data-m count.
function blockLengthOf(m: Measure): number {
  const n = (m as { _multiRest?: unknown } | null)?._multiRest
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0
}

function renderSlurArc(els: string[], x1: number, x2: number, y: number, color: string): void {
  const arcY = y - 30
  const midX = (x1 + x2) / 2
  els.push(`<path d="M ${x1},${arcY} Q ${midX},${arcY - 12} ${x2},${arcY}" fill="none" stroke="${color}" stroke-width="1.2"/>`)
}

export function renderJianpuSVG(
  measures: Measure[],
  keyStr: string,
  timeStr: string,
  titleStr = 'Untitled',
  containerWidth = 540,
  tempoStr = '',
  isDark?: boolean,
  measuresPerLine = 0,
): string {
  const dark = isDark ?? document.documentElement.getAttribute('data-theme') === 'dark'
  const svgColor = dark ? '#FFFFFF' : '#0A0A0A'
  const { noteWidths, durationBeats, lineHeight, startX } = RENDER_CONFIG

  // Mutable: a measure's _timeSig switches the meter from that measure on
  let meter = parseMeter(timeStr)
  let beamGroup = beamGroupLength(meter.beats, meter.beatType)
  const timeSigWidth = 24
  // "1=D" label for a mid-piece key change, drawn before the measure like the time sig
  const keySigWidth = 32
  const maxWidth = Math.max(RENDER_CONFIG.minWidth, containerWidth - RENDER_CONFIG.padding)
  const paddingTop = tempoStr ? RENDER_CONFIG.paddingTopWithTempo : RENDER_CONFIG.paddingTopDefault

  let currentX = startX
  let currentY = paddingTop + 20
  const svgElements: string[] = []
  let maxTotalWidth = startX
  let maxBottomY = 0

  // The slurs that can actually be drawn (start note → its stop note). A start with no end
  // never opens an arc, so it cannot trail across every following line.
  const slurEnds = slurPairs(measures)
  // The one arc currently open: where it stops, and where its visible piece starts on this line
  const slur: { stop: NoteObject | null; x: number; y: number } = { stop: null, x: 0, y: 0 }
  // Volta continuity: consecutive measures with the same _volta share one bracket
  let prevVoltaNum: number | null = null

  renderHeader(svgElements, maxWidth, startX, svgColor, titleStr, keyStr, timeStr, tempoStr)
  renderBarline(svgElements, startX, currentY, svgColor, false)

  // `restIdx[i]` = index of measures[i] in the array the caller passed in (before
  // collapsing), so data-rest-m matches the text editor's restMeasureIdx
  const collapsed = collapseRestRunsIndexed(measures)
  // A multi-rest block of no length is not a measure: dropped before line planning so it costs no
  // slot, width or line break (and takes no part in the data-m count beyond its max(0, N))
  const kept: Measure[] = []
  const restIdx: number[] = []
  collapsed.items.forEach((m, k) => {
    if (!Array.isArray(m) && blockLengthOf(m) < 1) return
    kept.push(m)
    restIdx.push(collapsed.first[k])
  })
  measures = kept

  const itemWidth = (m: Measure): ItemWidth => {
    if (!Array.isArray(m)) {
      return { flex: Math.min(RENDER_CONFIG.multiRestMaxWidth, maxWidth * 0.4), fixed: 0 }
    }
    return {
      flex: m.reduce((sum, note) => sum + noteWidthOf(note), 0),
      fixed: (m._timeSig ? timeSigWidth : 0) + (m._key ? keySigWidth : 0)
        + (m._repeatStart ? RENDER_CONFIG.repeatSignWidth : 0),
    }
  }
  // 0 = auto: wrap whenever the next measure doesn't fit (ragged right edge)
  const plan = measuresPerLine > 0 ? planLines(measures.map(itemWidth), maxWidth - startX, measuresPerLine) : null

  // A pickup (弱起) measure is drawn but not counted: numbering starts at 0 and the label is skipped
  const first = measures[0]
  let actualMeasureNum = Array.isArray(first) && first._pickup ? 0 : 1
  let origIdx = 0
  // Deepest chord stack / hairpin on the current line: the next line starts that much lower
  let lineChordExtra = 0

  // Start a new line. An open slur is closed at the line's end and picks up again after the
  // measure number (startX + 22 — from startX it ran straight through it). Both the measure and
  // the multi-rest branch wrap through here.
  const wrapLine = () => {
    if (slur.stop) renderSlurArc(svgElements, slur.x, currentX, slur.y, svgColor)
    currentX = startX
    currentY += lineHeight + lineChordExtra
    lineChordExtra = 0
    if (slur.stop) {
      slur.x = startX + SLUR_CONTINUE_DX
      slur.y = currentY
    }
  }
  // The italic measure number and the barline at a line's start; returns how many digits of
  // number were printed (none for a pickup's 0), which a volta label on this measure must clear
  const startLine = (): number => {
    let digits = 0
    if (actualMeasureNum > 0) {
      svgElements.push(`<text x="${currentX}" y="${currentY - 30}" font-family="${FONT_FAMILY}" font-size="10" font-style="italic" fill="${svgColor}">${actualMeasureNum}</text>`)
      digits = String(actualMeasureNum).length
    }
    renderBarline(svgElements, currentX, currentY, svgColor, false)
    return digits
  }

  for (let i = 0; i < measures.length; i++) {
    const measure = measures[i]
    const lineScale = plan ? plan.scale[i] : 1

    if (!Array.isArray(measure)) {
      const N = blockLengthOf(measure)
      const blockW = Math.min(RENDER_CONFIG.multiRestMaxWidth, maxWidth * 0.4)
      origIdx += N
      if (plan ? plan.lineStart[i] && i > 0 : currentX + blockW > maxWidth && currentX > startX) wrapLine()
      if (currentX === startX) startLine()
      // Same data-rest-m group as a single whole rest, keyed by the block's first measure
      svgElements.push(`<g class="jn-rest-group" data-rest-m="${restIdx[i]}">`)
      svgElements.push(`<rect class="jn-rest-rect" x="${currentX + 2}" y="${currentY - 28}" width="${blockW * lineScale - 4}" height="26" fill="none" stroke="none" rx="3"/>`)
      currentX += renderMultiRestBracket(svgElements, currentX, currentY, N, blockW * lineScale, svgColor)
      svgElements.push(`</g>`)
      if (i === measures.length - 1) {
        renderBarline(svgElements, currentX, currentY, svgColor, true)
        if (currentX + 4 > maxTotalWidth) maxTotalWidth = currentX + 4
      } else {
        renderBarline(svgElements, currentX, currentY, svgColor, false)
      }
      if (currentX > maxTotalWidth) maxTotalWidth = currentX
      actualMeasureNum += N
      prevVoltaNum = null
      continue
    }

    const measureArr = measure

    if (measureArr._timeSig) {
      meter = parseMeter(measureArr._timeSig)
      beamGroup = beamGroupLength(meter.beats, meter.beatType)
    }

    let measureWidth = 0
    for (const note of measureArr) measureWidth += noteWidthOf(note)
    if (measureArr._timeSig) measureWidth += timeSigWidth
    if (measureArr._key) measureWidth += keySigWidth

    if (plan ? plan.lineStart[i] && i > 0 : currentX + measureWidth > maxWidth && currentX > startX) wrapLine()

    const numberDigits = currentX === startX ? startLine() : 0

    const measureStartX = currentX

    if (measureArr._key) {
      svgElements.push(`<text x="${currentX + 2}" y="${currentY}" font-family="${FONT_FAMILY}" font-size="13" font-weight="600" fill="${svgColor}">1=${escapeSVG(measureArr._key)}</text>`)
      currentX += keySigWidth
    }

    if (measureArr._timeSig) {
      svgElements.push(`<text x="${currentX + 2}" y="${currentY}" font-family="${FONT_FAMILY}" font-size="13" font-weight="600" fill="${svgColor}">${escapeSVG(measureArr._timeSig)}</text>`)
      currentX += timeSigWidth
    }

    if (measureArr._repeatStart) {
      renderRepeatStart(svgElements, currentX, currentY, svgColor)
      currentX += RENDER_CONFIG.repeatSignWidth
    }

    // A lone whole rest draws its own row of 0s here, then shares the closing
    // barline / repeat sign / volta / direction / dynamic / hairpin code below
    // with every other measure (it used to `continue` and drop those markings)
    const isWholeMeasureRest = isWholeRestMeasure(measureArr)
    if (isWholeMeasureRest) {
      const wmWidth = noteWidths['whole'] * lineScale
      // One symbol per beat the meter counts in (6/8: two dotted rests, 5/8: five eighth rests…)
      const sym = wholeRestSymbols(meter.beats, meter.beatType)
      const step = wmWidth / sym.count
      // Wrap the rest "0"s in a <g> with data-rest-m so text-editor cursor sync
      // can outline the whole group when caret is in the matching 0--- token.
      svgElements.push(`<g class="jn-rest-group" data-rest-m="${restIdx[i]}">`)
      for (let b = 0; b < sym.count; b++) {
        const zx = currentX + b * step + 2
        svgElements.push(`<text x="${zx}" y="${currentY}" font-family="${FONT_FAMILY}" font-size="18" fill="${svgColor}">0</text>`)
        // Same dot as a dotted note's, same underlines as a short note's
        if (sym.dotted) {
          svgElements.push(`<circle cx="${zx + DIGIT_WIDTH + 3}" cy="${currentY - 4}" r="1.5" fill="${svgColor}"/>`)
        }
        for (let l = 1; l <= sym.beamLines; l++) {
          svgElements.push(`<line x1="${zx}" y1="${currentY + l * 4}" x2="${zx + DIGIT_WIDTH}" y2="${currentY + l * 4}" stroke="${svgColor}" stroke-width="1"/>`)
        }
      }
      // Invisible hit/highlight rect spanning the group — gets outlined when active.
      svgElements.push(`<rect class="jn-rest-rect" x="${currentX - 2}" y="${currentY - 18}" width="${wmWidth}" height="26" fill="none" stroke="none" rx="3"/>`)
      svgElements.push(`</g>`)
      currentX += wmWidth
    }

    const cumulative: number[] = []
    {
      let acc = 0
      for (const note of measureArr) {
        cumulative.push(acc)
        acc += (durationBeats[note.type] || 1) * (note.dot ? 1.5 : 1) * tupletFactor(note.tuplet)
      }
    }

    // Tuplet group in progress: where it began, how many notes it still wants, the digit to print.
    // Its length is the first note's `tupletLen` when the group isn't `tuplet` notes long
    // (a quarter + eighth triplet has 2).
    let tupletStartX: number | null = null
    let tupletLeft = 0
    let tupletDigit = 0

    // The row of 0s above already stands in for a whole-rest measure's single note
    const noteCount = isWholeMeasureRest ? 0 : measureArr.length
    for (let j = 0; j < noteCount; j++) {
      const note = measureArr[j]
      const naturalWidth = noteWidthOf(note)
      const noteWidth = naturalWidth * lineScale

      if (note.tuplet && tupletLeft === 0) {
        tupletStartX = currentX
        tupletLeft = note.tupletLen ?? note.tuplet
        tupletDigit = note.tuplet
      } else if (!note.tuplet) {
        tupletStartX = null
        tupletLeft = 0
      }

      const numXOffset = renderNote(svgElements, note, currentX, currentY, svgColor, origIdx, j)

      // Stop BEFORE start: a note can end one slur and open the next (MusicXML
      // <slur stop/><slur start/>). Starting first overwrote the open arc's
      // origin, so the first arc was lost and the second one drawn from nowhere.
      if (slur.stop === note) {
        const slurEndX = currentX + numXOffset + 12
        // At least 8px long: a slur continued from the line above that closes on this line's
        // first note would otherwise start (startX + 22) right of its own end
        renderSlurArc(svgElements, Math.min(slur.x, slurEndX - 8), slurEndX, slur.y, svgColor)
        slur.stop = null
      }
      const pairedStop = slurEnds.get(note)
      if (pairedStop) {
        slur.stop = pairedStop
        slur.x = currentX + graceRoomOf(note) + 2
        slur.y = currentY
      }

      const extraBeats = renderExtensionDashes(svgElements, note, currentX, numXOffset, noteWidth, currentY, svgColor)

      if (note.dot && extraBeats === 0) {
        svgElements.push(`<circle cx="${currentX + numXOffset + DIGIT_WIDTH + 3}" cy="${currentY - 4}" r="1.5" fill="${svgColor}"/>`)
      }

      const cx = currentX + numXOffset + 5.5
      if (drawsOctaveDots(note)) {
        renderOctaveDots(svgElements, cx, currentY, note.octave, svgColor, getBeamingLines(note.type))
      }

      renderBeamingUnderlines(svgElements, measureArr, j, currentX, noteWidth, naturalWidth, currentY, cumulative, beamGroup, svgColor)

      currentX += noteWidth

      if (note.tuplet && tupletLeft > 0) {
        tupletLeft--
        if (tupletLeft === 0 && tupletStartX !== null) {
          renderTupletBracket(svgElements, tupletStartX + 2, currentX - 2, currentY, tupletDigit, svgColor)
          tupletStartX = null
        }
      }
    }

    if (i === measures.length - 1 && !measureArr._repeatEnd) {
      renderBarline(svgElements, currentX, currentY, svgColor, true)
      if (currentX + 4 > maxTotalWidth) maxTotalWidth = currentX + 4
    } else if (!measureArr._repeatEnd) {
      renderBarline(svgElements, currentX, currentY, svgColor, false)
    }

    if (measureArr._repeatEnd) {
      renderRepeatEnd(svgElements, currentX, currentY, svgColor)
    }

    if (currentX > maxTotalWidth) maxTotalWidth = currentX

    if (measureArr._volta !== undefined) {
      const labelShift = numberDigits > 0 ? numberDigits * 6 + 4 : 0
      renderVoltaBracket(svgElements, measureStartX, currentX, currentY, measureArr._volta, prevVoltaNum !== measureArr._volta, svgColor, labelShift)
    }
    prevVoltaNum = measureArr._volta ?? null

    if (measureArr._direction) {
      svgElements.push(`<text x="${currentX - 4}" y="${currentY - 20}" font-family="${FONT_FAMILY}" font-size="11" font-style="italic" font-weight="500" fill="${svgColor}" text-anchor="end">${escapeSVG(measureArr._direction)}</text>`)
    }

    const chordOffset = measureArr.reduce((m, n) => Math.max(m, chordExtent(n)), 0)
    if (chordOffset > 0) maxBottomY = Math.max(maxBottomY, currentY + chordOffset + 36)
    // A hairpin reaches baseline + 35 + chord stack: the next line's volta bracket (its baseline - 44) needs room
    lineChordExtra = Math.max(lineChordExtra, chordOffset + (measureArr._wedge ? HAIRPIN_CLEARANCE : 0))

    if (measureArr._dynamic) {
      svgElements.push(`<text x="${measureStartX + 2}" y="${currentY + 22 + chordOffset}" font-family="${FONT_FAMILY}" font-size="12" font-style="italic" font-weight="600" fill="${svgColor}">${escapeSVG(measureArr._dynamic)}</text>`)
    }

    if (measureArr._wedge) {
      const hairpinY = currentY + 30 + chordOffset
      const hairpinH = 5
      const mStartX = measureStartX + 4
      const mEndX = currentX - 4
      if (measureArr._wedge === 'cresc') {
        svgElements.push(`<line x1="${mStartX}" y1="${hairpinY}" x2="${mEndX}" y2="${hairpinY - hairpinH}" stroke="${svgColor}" stroke-width="1" opacity="0.7"/>`)
        svgElements.push(`<line x1="${mStartX}" y1="${hairpinY}" x2="${mEndX}" y2="${hairpinY + hairpinH}" stroke="${svgColor}" stroke-width="1" opacity="0.7"/>`)
      } else {
        svgElements.push(`<line x1="${mStartX}" y1="${hairpinY - hairpinH}" x2="${mEndX}" y2="${hairpinY}" stroke="${svgColor}" stroke-width="1" opacity="0.7"/>`)
        svgElements.push(`<line x1="${mStartX}" y1="${hairpinY + hairpinH}" x2="${mEndX}" y2="${hairpinY}" stroke="${svgColor}" stroke-width="1" opacity="0.7"/>`)
      }
    }

    actualMeasureNum++
    // A lone whole rest has no data-m of its own and does not advance origIdx
    // (computeOrigIdxMap mirrors this)
    if (!isWholeMeasureRest) origIdx++
  }

  const totalHeight = Math.max(currentY + 40, maxBottomY + 8)
  // Stretched lines leave float noise (1194.0000000000002) in the width
  const finalWidth = Math.ceil(Math.max(maxWidth, maxTotalWidth + 20))

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${finalWidth}" height="${totalHeight}" viewBox="0 0 ${finalWidth} ${totalHeight}">
    ${svgElements.join('\n')}
  </svg>`
}
