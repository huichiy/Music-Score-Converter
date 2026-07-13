import type { Measure, MeasureArray, NoteObject } from '@/types/score'

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

function escapeSVG(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function collapseRestRuns(measures: Measure[]): Measure[] {
  // Whole-rest measures carrying _volta/_timeSig must stay visible as real
  // measures (the bracket/label would be lost inside a [N] block)
  const isCollapsibleRest = (m: Measure): boolean => {
    if (!Array.isArray(m)) return false
    const arr = m as MeasureArray
    return arr.length === 1 && arr[0].rest && arr[0].type === 'whole'
      && arr._volta === undefined && !arr._timeSig
  }
  const out: Measure[] = []
  let i = 0
  while (i < measures.length) {
    if (isCollapsibleRest(measures[i])) {
      let run = 1
      while (i + run < measures.length && isCollapsibleRest(measures[i + run])) run++
      out.push(run >= 2 ? { _multiRest: run } : measures[i])
      i += run
    } else {
      out.push(measures[i])
      i++
    }
  }
  return out
}

// Tuplet duration correction: N notes in the time of pow2floor(N) (duplet: 2 in 3)
function tupletFactor(n: number | undefined): number {
  if (!n || n < 2) return 1
  if (n === 2) return 3 / 2
  let p = 1
  while (p * 2 <= n) p *= 2
  return p / n
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
  els.push(`<text x="${maxWidth / 2}" y="35" font-family="Inter" font-size="24" font-weight="600" fill="${color}" text-anchor="middle">${escapeSVG(titleStr)}</text>`)
  els.push(`<text x="${startX}" y="65" font-family="Inter" font-size="14" font-weight="500" fill="${color}">Key: 1=${keyStr}   Time: ${timeStr}</text>`)
  if (tempoStr) {
    els.push(`<text x="${startX}" y="82" font-family="Inter" font-size="13" fill="${color}">Tempo: ${tempoStr}</text>`)
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

function renderOctaveDots(els: string[], cx: number, y: number, octave: number, color: string): void {
  if (octave === 1) els.push(`<circle cx="${cx}" cy="${y - 18}" r="1.5" fill="${color}"/>`)
  else if (octave === 2) {
    els.push(`<circle cx="${cx}" cy="${y - 18}" r="1.5" fill="${color}"/>`)
    els.push(`<circle cx="${cx}" cy="${y - 24}" r="1.5" fill="${color}"/>`)
  } else if (octave === -1) {
    els.push(`<circle cx="${cx}" cy="${y + 10}" r="1.5" fill="${color}"/>`)
  } else if (octave === -2) {
    els.push(`<circle cx="${cx}" cy="${y + 10}" r="1.5" fill="${color}"/>`)
    els.push(`<circle cx="${cx}" cy="${y + 16}" r="1.5" fill="${color}"/>`)
  }
}

function renderBeamingUnderlines(
  els: string[], measure: MeasureArray, j: number,
  currentX: number, noteWidth: number, currentY: number,
  cumulative: number[], beatUnit: number, color: string,
): void {
  const linesCnt = getBeamingLines(measure[j].type)
  for (let l = 1; l <= linesCnt; l++) {
    const noteBeat = Math.floor(cumulative[j] / beatUnit)
    const prevBeat = j > 0 ? Math.floor(cumulative[j - 1] / beatUnit) : -1
    const nextBeat = j < measure.length - 1 ? Math.floor(cumulative[j + 1] / beatUnit) : -1
    const connectLeft = j > 0 && getBeamingLines(measure[j - 1].type) >= l && prevBeat === noteBeat
    const connectRight = j < measure.length - 1 && getBeamingLines(measure[j + 1].type) >= l && nextBeat === noteBeat
    const x1 = connectLeft ? currentX : currentX + 2
    const x2 = connectRight ? currentX + noteWidth : currentX + noteWidth - 2
    els.push(`<line x1="${x1}" y1="${currentY + l * 4}" x2="${x2}" y2="${currentY + l * 4}" stroke="${color}" stroke-width="1"/>`)
  }
}

function renderExtensionDashes(
  els: string[], note: NoteObject, currentX: number,
  numXOffset: number, noteWidth: number, currentY: number, color: string,
): number {
  let extraBeats = 0
  if (note.type === 'whole') extraBeats = 3
  else if (note.type === 'half') extraBeats = note.dot ? 2 : 1
  if (extraBeats > 0) {
    const dashStep = (noteWidth - numXOffset) / (extraBeats + 1)
    for (let b = 1; b <= extraBeats; b++) {
      const extChar = note.rest ? '0' : '-'
      els.push(`<text x="${currentX + numXOffset + b * dashStep}" y="${currentY}" font-family="Inter" font-size="18" fill="${color}">${extChar}</text>`)
    }
  }
  return extraBeats
}

function renderMultiRestBracket(
  els: string[], currentX: number, currentY: number,
  N: number, maxWidth: number, color: string,
): number {
  const blockW = Math.min(RENDER_CONFIG.multiRestMaxWidth, maxWidth * 0.4)
  const lineY = currentY - 8
  const lx1 = currentX + 4
  const lx2 = currentX + blockW - 4
  const midX = (lx1 + lx2) / 2
  els.push(`<line x1="${lx1}" y1="${lineY}" x2="${lx2}" y2="${lineY}" stroke="${color}" stroke-width="3"/>`)
  els.push(`<line x1="${lx1}" y1="${lineY - 5}" x2="${lx1}" y2="${lineY + 5}" stroke="${color}" stroke-width="2"/>`)
  els.push(`<line x1="${lx2}" y1="${lineY - 5}" x2="${lx2}" y2="${lineY + 5}" stroke="${color}" stroke-width="2"/>`)
  els.push(`<text x="${midX}" y="${lineY - 7}" font-family="Inter" font-size="12" font-weight="600" fill="${color}" text-anchor="middle">${N}</text>`)
  return blockW
}

function renderArticulation(els: string[], cx: number, y: number, kind: string, color: string, octave: number): void {
  // Push higher when there are octave dots above to avoid collision
  const yAbove = octave >= 2 ? y - 32 : octave >= 1 ? y - 26 : y - 20
  if (kind === 'accent') {
    els.push(`<text x="${cx}" y="${yAbove}" font-family="Inter" font-size="11" font-weight="600" fill="${color}" text-anchor="middle">&gt;</text>`)
  } else if (kind === 'staccato') {
    els.push(`<circle cx="${cx}" cy="${yAbove - 2}" r="1.5" fill="${color}"/>`)
  } else if (kind === 'tenuto') {
    els.push(`<line x1="${cx - 3}" y1="${yAbove - 2}" x2="${cx + 3}" y2="${yAbove - 2}" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>`)
  } else if (kind === 'marcato') {
    els.push(`<text x="${cx}" y="${yAbove}" font-family="Inter" font-size="12" font-weight="700" fill="${color}" text-anchor="middle">^</text>`)
  } else if (kind === 'fermata') {
    els.push(`<path d="M ${cx - 6},${yAbove} Q ${cx},${yAbove - 7} ${cx + 6},${yAbove}" fill="none" stroke="${color}" stroke-width="1.2"/>`)
    els.push(`<circle cx="${cx}" cy="${yAbove - 2}" r="1.2" fill="${color}"/>`)
  }
}

function renderGraceNote(els: string[], x: number, y: number, g: { degree: number; octave: number; accidental: string }, color: string): number {
  // Render a small grace note to the upper-left of the main note position
  // x = main note's left edge; we draw at x - 9 ish
  const gx = x - 10
  const gy = y - 4
  let offset = 0
  if (g.accidental) {
    els.push(`<text x="${gx - 4}" y="${gy - 5}" font-family="Inter" font-size="7" fill="${color}">${g.accidental}</text>`)
    offset = 3
  }
  els.push(`<text x="${gx + offset}" y="${gy}" font-family="Inter" font-size="11" font-style="italic" fill="${color}">${g.degree}</text>`)
  // Octave dot for grace
  if (g.octave >= 1) els.push(`<circle cx="${gx + offset + 3}" cy="${gy - 11}" r="1.2" fill="${color}"/>`)
  if (g.octave <= -1) els.push(`<circle cx="${gx + offset + 3}" cy="${gy + 4}" r="1.2" fill="${color}"/>`)
  return 0
}

function renderVoltaBracket(
  els: string[], x1: number, x2: number, y: number,
  num: number, drawHead: boolean, color: string,
): void {
  const vy = y - 44
  els.push(`<g class="jn-volta">`)
  els.push(`<line x1="${x1}" y1="${vy}" x2="${x2}" y2="${vy}" stroke="${color}" stroke-width="1"/>`)
  if (drawHead) {
    els.push(`<line x1="${x1}" y1="${vy}" x2="${x1}" y2="${vy + 8}" stroke="${color}" stroke-width="1"/>`)
    els.push(`<text x="${x1 + 4}" y="${vy + 12}" font-family="Inter" font-size="10" font-style="italic" fill="${color}">${num}.</text>`)
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
  els.push(`<text x="${mid}" y="${by + 3.5}" font-family="Inter" font-size="10" font-style="italic" fill="${color}" text-anchor="middle">${n}</text>`)
  els.push(`</g>`)
}

function renderNote(
  els: string[], note: NoteObject, currentX: number, currentY: number,
  color: string, mIdx: number, nIdx: number,
): number {
  let displayStr = note.rest ? '0' : note.degree.toString()
  if (note.tie) displayStr = '-'
  let numXOffset = 2
  if (!note.rest && !note.tie && note.accidental) {
    els.push(`<text x="${currentX}" y="${currentY - 8}" font-family="Inter" font-size="10" fill="${color}">${note.accidental}</text>`)
    numXOffset = 8
  }
  // Grace note (倚音) — small number before main
  if (note.graceNote && !note.rest && !note.tie) {
    renderGraceNote(els, currentX, currentY, note.graceNote, color)
  }
  const dataAttrs = ` data-m="${mIdx}" data-n="${nIdx}" class="jn-note"`
  els.push(`<text x="${currentX + numXOffset}" y="${currentY}" font-family="Inter" font-size="18" fill="${color}"${dataAttrs}>${displayStr}</text>`)
  // Articulation above the note
  if (note.articulation && !note.rest && !note.tie) {
    const noteCenterX = currentX + numXOffset + 5
    renderArticulation(els, noteCenterX, currentY, note.articulation, color, note.octave)
  }

  if (note.chordNotes && note.chordNotes.length > 0) {
    // Rows are 16px apart; octave dots need extra 6px per dot so they land in
    // the gap between digits instead of on the neighbouring chord note
    let chordY = currentY
    for (const cn of note.chordNotes) {
      const aboveDots = cn.octave >= 2 ? 2 : cn.octave >= 1 ? 1 : 0
      const belowDots = cn.octave <= -2 ? 2 : cn.octave <= -1 ? 1 : 0
      chordY += 16 + aboveDots * 6
      let chordXOffset = 2
      if (cn.accidental) {
        els.push(`<text x="${currentX}" y="${chordY - 6}" font-family="Inter" font-size="9" fill="${color}">${cn.accidental}</text>`)
        chordXOffset = 7
      }
      els.push(`<text x="${currentX + chordXOffset}" y="${chordY}" font-family="Inter" font-size="16" fill="${color}">${cn.degree}</text>`)
      const dotCx = currentX + chordXOffset + 5
      if (cn.octave >= 1) els.push(`<circle cx="${dotCx}" cy="${chordY - 14}" r="1.5" fill="${color}"/>`)
      if (cn.octave >= 2) els.push(`<circle cx="${dotCx}" cy="${chordY - 20}" r="1.5" fill="${color}"/>`)
      if (cn.octave <= -1) els.push(`<circle cx="${dotCx}" cy="${chordY + 6}" r="1.5" fill="${color}"/>`)
      if (cn.octave <= -2) els.push(`<circle cx="${dotCx}" cy="${chordY + 12}" r="1.5" fill="${color}"/>`)
      chordY += belowDots * 6
    }
  }
  return numXOffset
}

export function renderJianpuSVG(
  measures: Measure[],
  keyStr: string,
  timeStr: string,
  titleStr = 'Untitled',
  containerWidth = 540,
  tempoStr = '',
  isDark?: boolean,
): string {
  const dark = isDark ?? document.documentElement.getAttribute('data-theme') === 'dark'
  const svgColor = dark ? '#FFFFFF' : '#0A0A0A'
  const { noteWidths, durationBeats, lineHeight, startX } = RENDER_CONFIG

  // Mutable: a measure's _timeSig switches the meter from that measure on
  let beatsPerMeasure = parseInt(timeStr.split('/')[0]) || 4
  let beatUnit = 4 / (parseInt(timeStr.split('/')[1]) || 4)
  const timeSigWidth = 24
  const maxWidth = Math.max(RENDER_CONFIG.minWidth, containerWidth - RENDER_CONFIG.padding)
  const paddingTop = tempoStr ? RENDER_CONFIG.paddingTopWithTempo : RENDER_CONFIG.paddingTopDefault

  let currentX = startX
  let currentY = paddingTop + 20
  const svgElements: string[] = []
  let maxTotalWidth = startX
  let maxBottomY = 0

  let slurStartX: number | null = null
  let slurStartY: number | null = null
  // Volta continuity: consecutive measures with the same _volta share one bracket
  let prevVoltaNum: number | null = null

  renderHeader(svgElements, maxWidth, startX, svgColor, titleStr, keyStr, timeStr, tempoStr)
  renderBarline(svgElements, startX, currentY, svgColor, false)

  measures = collapseRestRuns(measures)

  let actualMeasureNum = 1
  let origIdx = 0

  for (let i = 0; i < measures.length; i++) {
    const measure = measures[i]

    if (!Array.isArray(measure) && measure._multiRest) {
      const N = measure._multiRest
      const blockW = Math.min(RENDER_CONFIG.multiRestMaxWidth, maxWidth * 0.4)
      origIdx += N
      if (currentX + blockW > maxWidth && currentX > startX) {
        currentX = startX
        currentY += lineHeight
      }
      if (currentX === startX) {
        svgElements.push(`<text x="${currentX}" y="${currentY - 30}" font-family="Inter" font-size="10" font-style="italic" fill="${svgColor}">${actualMeasureNum}</text>`)
        renderBarline(svgElements, currentX, currentY, svgColor, false)
      }
      currentX += renderMultiRestBracket(svgElements, currentX, currentY, N, maxWidth, svgColor)
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

    const measureArr = measure as MeasureArray

    if (measureArr._timeSig) {
      const tsParts = measureArr._timeSig.split('/')
      beatsPerMeasure = parseInt(tsParts[0]) || beatsPerMeasure
      beatUnit = 4 / (parseInt(tsParts[1]) || 4)
    }

    let measureWidth = 0
    for (const note of measureArr) {
      measureWidth += (noteWidths[note.type] || 40) * (note.dot ? 1.5 : 1) * tupletFactor(note.tuplet) + (!note.tie && note.accidental ? 6 : 0)
    }
    if (measureArr._timeSig) measureWidth += timeSigWidth

    if (currentX + measureWidth > maxWidth && currentX > startX) {
      if (slurStartX !== null) {
        const midX = (slurStartX + currentX) / 2
        const arcY = slurStartY! - 30
        svgElements.push(`<path d="M ${slurStartX},${arcY} Q ${midX},${arcY - 12} ${currentX},${arcY}" fill="none" stroke="${svgColor}" stroke-width="1.2"/>`)
      }
      currentX = startX
      currentY += lineHeight
      if (slurStartX !== null) {
        slurStartX = startX
        slurStartY = currentY
      }
    }

    if (currentX === startX) {
      svgElements.push(`<text x="${currentX}" y="${currentY - 30}" font-family="Inter" font-size="10" font-style="italic" fill="${svgColor}">${actualMeasureNum}</text>`)
      renderBarline(svgElements, currentX, currentY, svgColor, false)
    }

    const measureStartX = currentX

    if (measureArr._timeSig) {
      svgElements.push(`<text x="${currentX + 2}" y="${currentY}" font-family="Inter" font-size="13" font-weight="600" fill="${svgColor}">${measureArr._timeSig}</text>`)
      currentX += timeSigWidth
    }

    if (measureArr._repeatStart) {
      renderRepeatStart(svgElements, currentX, currentY, svgColor)
      currentX += RENDER_CONFIG.repeatSignWidth
    }

    const isWholeMeasureRest = measureArr.length === 1 && measureArr[0].rest && measureArr[0].type === 'whole'
    if (isWholeMeasureRest) {
      const wmWidth = noteWidths['whole']
      const step = wmWidth / beatsPerMeasure
      // Wrap the 4 rest "0"s in a <g> with data-rest-m so text-editor cursor sync
      // can outline the whole group when caret is in the matching 0--- token.
      svgElements.push(`<g class="jn-rest-group" data-rest-m="${i}">`)
      for (let b = 0; b < beatsPerMeasure; b++) {
        svgElements.push(`<text x="${currentX + b * step + 2}" y="${currentY}" font-family="Inter" font-size="18" fill="${svgColor}">0</text>`)
      }
      // Invisible hit/highlight rect spanning the group — gets outlined when active.
      svgElements.push(`<rect class="jn-rest-rect" x="${currentX - 2}" y="${currentY - 18}" width="${wmWidth}" height="26" fill="none" stroke="none" rx="3"/>`)
      svgElements.push(`</g>`)
      currentX += wmWidth
      if (i === measures.length - 1) {
        renderBarline(svgElements, currentX, currentY, svgColor, true)
        if (currentX + 4 > maxTotalWidth) maxTotalWidth = currentX + 4
      } else {
        renderBarline(svgElements, currentX, currentY, svgColor, false)
      }
      if (currentX > maxTotalWidth) maxTotalWidth = currentX
      if (measureArr._volta !== undefined) {
        renderVoltaBracket(svgElements, measureStartX, currentX, currentY, measureArr._volta, prevVoltaNum !== measureArr._volta, svgColor)
      }
      prevVoltaNum = measureArr._volta ?? null
      actualMeasureNum++
      continue
    }

    const cumulative: number[] = []
    {
      let acc = 0
      for (const note of measureArr) {
        cumulative.push(acc)
        acc += (durationBeats[note.type] || 1) * (note.dot ? 1.5 : 1) * tupletFactor(note.tuplet)
      }
    }

    let tupletStartX: number | null = null
    let tupletLeft = 0

    for (let j = 0; j < measureArr.length; j++) {
      const note = measureArr[j]
      const noteWidth = (noteWidths[note.type] || 40) * (note.dot ? 1.5 : 1) * tupletFactor(note.tuplet) + (!note.tie && note.accidental ? 6 : 0)

      if (note.tuplet && tupletLeft === 0) {
        tupletStartX = currentX
        tupletLeft = note.tuplet
      } else if (!note.tuplet) {
        tupletStartX = null
        tupletLeft = 0
      }

      if (note.slurStart && !note.rest) {
        slurStartX = currentX + 2
        slurStartY = currentY
      }

      const numXOffset = renderNote(svgElements, note, currentX, currentY, svgColor, origIdx, j)
      renderExtensionDashes(svgElements, note, currentX, numXOffset, noteWidth, currentY, svgColor)

      let extraBeats = 0
      if (note.type === 'whole') extraBeats = 3
      else if (note.type === 'half') extraBeats = note.dot ? 2 : 1

      if (note.dot && extraBeats === 0) {
        const charWidth = 18 * 0.6
        svgElements.push(`<circle cx="${currentX + numXOffset + charWidth + 3}" cy="${currentY - 4}" r="1.5" fill="${svgColor}"/>`)
      }

      const cx = currentX + numXOffset + 5.5
      if (!note.rest && !note.tie) {
        renderOctaveDots(svgElements, cx, currentY, note.octave, svgColor)
      }

      renderBeamingUnderlines(svgElements, measureArr, j, currentX, noteWidth, currentY, cumulative, beatUnit, svgColor)

      currentX += noteWidth

      if (note.tuplet && tupletLeft > 0) {
        tupletLeft--
        if (tupletLeft === 0 && tupletStartX !== null) {
          renderTupletBracket(svgElements, tupletStartX + 2, currentX - 2, currentY, note.tuplet, svgColor)
          tupletStartX = null
        }
      }

      if (note.slurStop && !note.rest && slurStartX !== null) {
        const slurEndX = currentX - noteWidth + numXOffset + 12
        const arcY = currentY - 30
        const midX = (slurStartX + slurEndX) / 2
        svgElements.push(`<path d="M ${slurStartX},${arcY} Q ${midX},${arcY - 12} ${slurEndX},${arcY}" fill="none" stroke="${svgColor}" stroke-width="1.2"/>`)
        slurStartX = null
        slurStartY = null
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
      renderVoltaBracket(svgElements, measureStartX, currentX, currentY, measureArr._volta, prevVoltaNum !== measureArr._volta, svgColor)
    }
    prevVoltaNum = measureArr._volta ?? null

    if (measureArr._direction) {
      svgElements.push(`<text x="${currentX - 4}" y="${currentY - 20}" font-family="Inter" font-size="11" font-style="italic" font-weight="500" fill="${svgColor}" text-anchor="end">${escapeSVG(measureArr._direction)}</text>`)
    }

    const chordDepth = measureArr.reduce((m, n) => Math.max(m, n.chordNotes?.length ?? 0), 0)
    const chordOffset = chordDepth * 16
    if (chordDepth > 0) maxBottomY = Math.max(maxBottomY, currentY + chordOffset + 36)

    if (measureArr._dynamic) {
      svgElements.push(`<text x="${measureStartX + 2}" y="${currentY + 22 + chordOffset}" font-family="Inter" font-size="12" font-style="italic" font-weight="600" fill="${svgColor}">${escapeSVG(measureArr._dynamic)}</text>`)
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
    origIdx++
  }

  const totalHeight = Math.max(currentY + 40, maxBottomY + 8)
  const finalWidth = Math.max(maxWidth, maxTotalWidth + 20)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${finalWidth}" height="${totalHeight}" viewBox="0 0 ${finalWidth} ${totalHeight}">
    ${svgElements.join('\n')}
  </svg>`
}
