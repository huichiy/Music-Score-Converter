import type { NoteObject, MeasureArray, Measure, ChordNote, GraceNote, Articulation } from '@/types/score'

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

function parseChordNote(
  noteEl: Element,
  baseTonicStep: string,
  baseTonicAlter: number,
  baseTonicSemi: number,
): ChordNote | null {
  const pitchNode = noteEl.getElementsByTagName('pitch')[0]
  if (!pitchNode) return null
  const step = pitchNode.getElementsByTagName('step')[0].textContent!
  const alterNode = pitchNode.getElementsByTagName('alter')[0]
  const alter = alterNode ? parseFloat(alterNode.textContent!) : 0
  const octave = parseInt(pitchNode.getElementsByTagName('octave')[0].textContent!)
  const noteSemi = pitchToSemitones(step, alter, octave)
  const diatonicDiff = (stepMapDiatonic[step] - stepMapDiatonic[baseTonicStep] + 7) % 7
  const degree = diatonicDiff + 1
  const expectedSemi = baseTonicSemi + scaleDegrees[diatonicDiff]
  const semiDiff = noteSemi - expectedSemi
  const octaveShift = Math.round(semiDiff / 12)
  const remainder = semiDiff - octaveShift * 12
  const accidental = remainder > 0 ? '#' : remainder < 0 ? 'b' : ('' as '#' | 'b' | '')
  return { degree, octave: octaveShift, accidental }
}

export function parseXMLToNoteObjects(xmlDoc: Document): MeasureArray[] {
  let fifths = 0
  const fifthsNodes = xmlDoc.getElementsByTagName('fifths')
  if (fifthsNodes.length > 0) {
    fifths = parseInt(fifthsNodes[0].textContent!)
  }

  let keyStr = keyMap[fifths.toString()] || 'C'
  let baseTonicStep = keyStr[0]
  let baseTonicAlter = keyStr.includes('#') ? 1 : keyStr.includes('b') ? -1 : 0
  let baseTonicSemi = pitchToSemitones(baseTonicStep, baseTonicAlter, 4)

  const jianpuMeasures: MeasureArray[] = []
  const measures = xmlDoc.getElementsByTagName('measure')
  let currentDivisions = 1
  let lastNoteWasTieStart = false
  let wedgeType: 'cresc' | 'dim' | null = null
  // Grace note waiting for its host: attaches to the NEXT pitched note,
  // surviving measure boundaries (a grace at measure end decorates the next
  // measure's first note)
  let pendingGrace: GraceNote | null = null

  for (let i = 0; i < measures.length; i++) {
    const measureNotes: MeasureArray = [] as unknown as MeasureArray
    const notes = measures[i].getElementsByTagName('note')

    const attributesNode = measures[i].getElementsByTagName('attributes')[0]
    if (attributesNode) {
      const divNode = attributesNode.getElementsByTagName('divisions')[0]
      if (divNode) currentDivisions = parseInt(divNode.textContent!) || currentDivisions

      const newFifthsNode = attributesNode.getElementsByTagName('fifths')[0]
      if (newFifthsNode) {
        fifths = parseInt(newFifthsNode.textContent!)
        const newKey = keyMap[fifths.toString()] || 'C'
        keyStr = newKey
        baseTonicStep = newKey[0]
        baseTonicAlter = newKey.includes('#') ? 1 : newKey.includes('b') ? -1 : 0
        baseTonicSemi = pitchToSemitones(baseTonicStep, baseTonicAlter, 4)
      }
    }

    let repeatStart = false
    let repeatEnd = false
    const barlineNodes = measures[i].getElementsByTagName('barline')
    for (let b = 0; b < barlineNodes.length; b++) {
      const repeatNode = barlineNodes[b].getElementsByTagName('repeat')[0]
      if (repeatNode) {
        const dir = repeatNode.getAttribute('direction')
        if (dir === 'forward') repeatStart = true
        if (dir === 'backward') repeatEnd = true
      }
    }

    for (let j = 0; j < notes.length; j++) {
      const note = notes[j]

      if (note.getElementsByTagName('grace').length > 0) {
        // Consecutive graces: keep only the first (renderer draws a single 倚音)
        const g = parseChordNote(note, baseTonicStep, baseTonicAlter, baseTonicSemi)
        if (g && !pendingGrace) pendingGrace = g
        continue
      }

      if (note.getElementsByTagName('chord').length > 0) {
        if (measureNotes.length > 0) {
          const prevNote = measureNotes[measureNotes.length - 1]
          if (!prevNote.chordNotes) prevNote.chordNotes = []
          const cn = parseChordNote(note, baseTonicStep, baseTonicAlter, baseTonicSemi)
          if (cn) prevNote.chordNotes.push(cn)
        }
        continue
      }

      const durationNode = note.getElementsByTagName('duration')[0]
      const duration = durationNode ? parseInt(durationNode.textContent!) : 0
      const beatValue = duration / currentDivisions

      let noteType: NoteObject['type'] = 'quarter'
      const typeNode = note.getElementsByTagName('type')[0]
      let hasDot = note.getElementsByTagName('dot').length > 0

      if (typeNode) {
        noteType = typeNode.textContent as NoteObject['type']
      } else if (durationNode) {
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

      const tieNodes = note.getElementsByTagName('tie')
      let isTieStop = false
      let isTieStart = false
      for (let t = 0; t < tieNodes.length; t++) {
        if (tieNodes[t].getAttribute('type') === 'stop') isTieStop = true
        if (tieNodes[t].getAttribute('type') === 'start') isTieStart = true
      }

      const isRest = note.getElementsByTagName('rest').length > 0

      if (lastNoteWasTieStart) isTieStop = true
      lastNoteWasTieStart = isTieStart && !isRest

      const noteObj: NoteObject = {
        degree: 0,
        octave: 0,
        type: noteType,
        dot: hasDot,
        tie: isTieStop,
        rest: isRest,
        accidental: '',
        slurStart: false,
        slurStop: false,
      }

      if (!isRest) {
        const pitchNode = note.getElementsByTagName('pitch')[0]
        if (pitchNode) {
          const step = pitchNode.getElementsByTagName('step')[0].textContent!
          let alter = 0
          const alterNode = pitchNode.getElementsByTagName('alter')[0]
          if (alterNode) alter = parseFloat(alterNode.textContent!)
          const octave = parseInt(pitchNode.getElementsByTagName('octave')[0].textContent!)

          const noteSemi = pitchToSemitones(step, alter, octave)
          const tonicDiatonicAbs = stepMapDiatonic[baseTonicStep] + 4 * 7
          const noteDiatonicAbs = stepMapDiatonic[step] + octave * 7
          let diatonicDiff = noteDiatonicAbs - tonicDiatonicAbs
          let degree = diatonicDiff % 7
          if (degree < 0) degree += 7

          const shift = Math.round((noteSemi - (baseTonicSemi + scaleDegrees[degree])) / 12)
          const intendedSemi = baseTonicSemi + shift * 12 + scaleDegrees[degree]
          const acc: '#' | 'b' | '' = noteSemi > intendedSemi ? '#' : noteSemi < intendedSemi ? 'b' : ''

          noteObj.degree = degree + 1
          noteObj.octave = shift
          noteObj.accidental = acc
        }
      }

      if (!isRest && pendingGrace) {
        noteObj.graceNote = pendingGrace
        pendingGrace = null
      }

      const timeModNode = note.getElementsByTagName('time-modification')[0]
      if (timeModNode) {
        const actualNode = timeModNode.getElementsByTagName('actual-notes')[0]
        const actual = actualNode ? parseInt(actualNode.textContent!) : 0
        if (actual >= 2) noteObj.tuplet = actual
      }

      const notationsNode = note.getElementsByTagName('notations')[0]
      if (notationsNode) {
        const slurNodes = notationsNode.getElementsByTagName('slur')
        for (let s = 0; s < slurNodes.length; s++) {
          const slurType = slurNodes[s].getAttribute('type')
          if (slurType === 'start') noteObj.slurStart = true
          if (slurType === 'stop') noteObj.slurStop = true
        }

        const articulationsNode = notationsNode.getElementsByTagName('articulations')[0]
        if (articulationsNode) {
          const articMap: Record<string, Articulation> = {
            'accent': 'accent',
            'staccato': 'staccato',
            'tenuto': 'tenuto',
            'strong-accent': 'marcato',
          }
          for (let a = 0; a < articulationsNode.children.length; a++) {
            const mapped = articMap[articulationsNode.children[a].tagName.toLowerCase()]
            if (mapped) {
              noteObj.articulation = mapped
              break
            }
          }
        }

        // <fermata> lives directly under <notations>, outside <articulations>
        if (!noteObj.articulation && notationsNode.getElementsByTagName('fermata').length > 0) {
          noteObj.articulation = 'fermata'
        }
      }

      measureNotes.push(noteObj)
    }

    measureNotes._repeatStart = repeatStart
    measureNotes._repeatEnd = repeatEnd

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

    for (let d = 0; d < directionNodes.length; d++) {
      const wedgeNode = directionNodes[d].getElementsByTagName('wedge')[0]
      if (!wedgeNode) continue
      const wType = wedgeNode.getAttribute('type')
      if (wType === 'crescendo') { wedgeType = 'cresc'; break }
      if (wType === 'diminuendo') { wedgeType = 'dim'; break }
      if (wType === 'stop') { wedgeType = null; break }
    }
    measureNotes._wedge = wedgeType

    if (measureNotes.length > 0 || repeatStart || repeatEnd) {
      jianpuMeasures.push(measureNotes)
    }
  }

  return jianpuMeasures
}

export function transposeNoteObjects(
  measures: Measure[],
  fromKeyStr: string,
  toKeyStr: string,
): Measure[] {
  if (fromKeyStr === toKeyStr) return measures

  const fromAlter = fromKeyStr.includes('#') ? 1 : fromKeyStr.includes('b') ? -1 : 0
  const toAlter = toKeyStr.includes('#') ? 1 : toKeyStr.includes('b') ? -1 : 0
  const fromTonicSemi = pitchToSemitones(fromKeyStr[0], fromAlter, 4)
  const toTonicSemi = pitchToSemitones(toKeyStr[0], toAlter, 4)
  const toBaseStep = toKeyStr[0]

  const useFlats = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'].includes(toKeyStr)
  const stepNames = useFlats
    ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
    : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

  function absSemi(degree: number, octave: number, accidental: string): number {
    const accVal = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
    return fromTonicSemi + octave * 12 + scaleDegrees[degree - 1] + accVal
  }

  function reexpress(noteSemi: number) {
    const semInOct = ((noteSemi % 12) + 12) % 12
    const absOct = (noteSemi - semInOct) / 12
    const stepStr = stepNames[semInOct]
    const step = stepStr[0]
    const alter = stepStr.includes('b') ? -1 : stepStr.includes('#') ? 1 : 0
    const tonicDiat = stepMapDiatonic[toBaseStep] + 4 * 7
    const noteDiat = stepMapDiatonic[step] + absOct * 7
    const deg = ((noteDiat - tonicDiat) % 7 + 7) % 7
    const shift = Math.round((noteSemi - (toTonicSemi + scaleDegrees[deg])) / 12)
    const intended = toTonicSemi + shift * 12 + scaleDegrees[deg]
    const acc: '#' | 'b' | '' = noteSemi > intended ? '#' : noteSemi < intended ? 'b' : ''
    return { degree: deg + 1, octave: shift, accidental: acc }
  }

  function transposeNote(note: import('@/types/score').NoteObject) {
    if (note.rest || note.degree === 0) return { ...note }
    const semi = absSemi(note.degree, note.octave, note.accidental)
    const { degree, octave, accidental } = reexpress(semi)
    const result = { ...note, degree, octave, accidental }
    if (note.chordNotes) {
      result.chordNotes = note.chordNotes.map(cn => {
        const cnSemi = absSemi(cn.degree, cn.octave, cn.accidental)
        return reexpress(cnSemi)
      })
    }
    if (note.graceNote) {
      const gSemi = absSemi(note.graceNote.degree, note.graceNote.octave, note.graceNote.accidental)
      result.graceNote = reexpress(gSemi)
    }
    return result
  }

  return measures.map(measure => {
    if (!Array.isArray(measure)) return measure
    const newMeasure = measure.map(transposeNote) as MeasureArray
    newMeasure._repeatStart = measure._repeatStart
    newMeasure._repeatEnd = measure._repeatEnd
    newMeasure._direction = measure._direction
    newMeasure._dynamic = measure._dynamic
    newMeasure._wedge = measure._wedge
    newMeasure._volta = measure._volta
    newMeasure._timeSig = measure._timeSig
    return newMeasure
  })
}
