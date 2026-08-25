import { useCallback } from 'react'
import JSZip from 'jszip'
import { Midi } from '@tonejs/midi'
import { useScoreStore } from '@/store/scoreStore'
import { parseXMLToNoteObjects, transposeNoteObjects, keyMap, scaleDegrees, stepMapDiatonic, pitchToSemitones } from '@/lib/parser'
import { renderJianpuSVG } from '@/lib/renderer'
import { parseABC } from '@/lib/abcParser'
import { parseFromText } from '@/lib/editor'
import type { MeasureArray, NoteObject } from '@/types/score'

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
<work><work-title>Twinkle Twinkle Little Star</work-title></work>
<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type></direction><direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type></direction><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="2"><note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
<measure number="3"><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="4"><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
<measure number="5"><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="6"><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
<measure number="7"><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="8"><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
<measure number="9"><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="10"><note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
<measure number="11"><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="12"><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
</part>
</score-partwise>`

// Melodic parts, scored up. Chinese orchestras are not just 笛子 — plucked
// strings (琵琶/柳琴/古筝) carry the tune as often as the winds and bowed
// strings do, and were previously unrecognised entirely.
// NOTE: matching is substring-based, so never add a bare '阮' here — it would
// also match 大阮/中阮 in PENALTY_KEYWORDS below and score them twice.
const KEYWORDS = [
  '笛','flute','dizi','箫','xiao','唢呐','suona','管子','guanzi','笙','sheng','巴乌','bawu',
  '二胡','erhu','高胡','gaohu','中胡','zhonghu','板胡','banhu','京胡','jinghu',
  '琵琶','pipa','柳琴','liuqin','古筝','筝','guzheng','三弦','sanxian',
  'violin','soprano','melody','oboe','clarinet','trumpet','horn',
  'solo','主旋律','lead','主音','旋律',
]
const PENALTY_KEYWORDS = [
  '大阮','daruan','中阮','zhongruan','革胡','gehu','大提琴','cello',
  '低音','bass','打击','percussion','扬琴','yangqin','伴奏','acc','accompaniment',
]

function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (file.arrayBuffer) return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function fileToText(file: File): Promise<string> {
  if (file.text) return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsText(file, 'UTF-8')
  })
}

export function useFileHandler(mainContentRef: React.RefObject<HTMLElement | null>) {
  const store = useScoreStore()

  const getContainerWidth = () => mainContentRef.current?.clientWidth ?? 540

  const showOutput = useCallback((
    svgResult: string,
    titleStr: string,
    keyStr: string,
    timeStr: string,
  ) => {
    store.setIsConverted(true)
    store.setErrorMsg('')
    // SVG is stored via the output ref — caller sets innerHTML directly
    // We expose the SVG string as return value instead
    return svgResult
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ──────────────────────────────────────────────────────────
  // XML Conversion
  // ──────────────────────────────────────────────────────────
  const renderSelectedPart = useCallback(async (
    xmlDoc: Document,
    partIdx: number,
    currentFile: File | null,
    transposeKey: string,
  ): Promise<string> => {
    const partsList = xmlDoc.getElementsByTagName('part')
    if (partsList.length <= partIdx) throw new Error('Part index out of range')

    const dummyDoc = document.implementation.createDocument(null, 'score-partwise')
    dummyDoc.documentElement.appendChild(xmlDoc.getElementsByTagName('part-list')[0].cloneNode(true))
    dummyDoc.documentElement.appendChild(partsList[partIdx].cloneNode(true))

    let titleStr = 'Untitled'
    const movementTitleNodes = xmlDoc.getElementsByTagName('movement-title')
    const workTitleNodes = xmlDoc.getElementsByTagName('work-title')
    if (movementTitleNodes.length > 0) titleStr = movementTitleNodes[0].textContent ?? 'Untitled'
    else if (workTitleNodes.length > 0) titleStr = workTitleNodes[0].textContent ?? 'Untitled'
    if (titleStr === 'Untitled' && currentFile) titleStr = currentFile.name.replace(/\.[^/.]+$/, '')

    let beats = '4'; let beatType = '4'
    const beatsNodes = dummyDoc.getElementsByTagName('beats')
    if (beatsNodes.length > 0) beats = beatsNodes[0].textContent!
    else { const fb = xmlDoc.getElementsByTagName('beats'); if (fb.length > 0) beats = fb[0].textContent! }
    const beatTypeNodes = dummyDoc.getElementsByTagName('beat-type')
    if (beatTypeNodes.length > 0) beatType = beatTypeNodes[0].textContent!
    else { const fb = xmlDoc.getElementsByTagName('beat-type'); if (fb.length > 0) beatType = fb[0].textContent! }

    let fifths = 0
    const fifthsNodes = dummyDoc.getElementsByTagName('fifths')
    if (fifthsNodes.length > 0) fifths = parseInt(fifthsNodes[0].textContent!)
    else { const fb = xmlDoc.getElementsByTagName('fifths'); if (fb.length > 0) fifths = parseInt(fb[0].textContent!) }
    const keyStr = keyMap[fifths.toString()] || 'C'

    let tempoStr = ''
    const metronomeNodes = xmlDoc.getElementsByTagName('per-minute')
    if (metronomeNodes.length > 0) tempoStr = metronomeNodes[0].textContent!.trim()

    const timeStr = `${beats}/${beatType}`
    const svgMeasures = parseXMLToNoteObjects(dummyDoc)

    store.setOriginal(svgMeasures, keyStr, timeStr, titleStr, tempoStr)

    const targetKey = transposeKey || keyStr
    const displayMeasures = transposeNoteObjects(svgMeasures, keyStr, targetKey)
    store.setCurrent(displayMeasures, targetKey)

    const svgResult = renderJianpuSVG(displayMeasures, targetKey, timeStr, titleStr, getContainerWidth(), tempoStr)
    store.setIsConverted(true)
    return svgResult
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const handleXmlConversion = useCallback(async (file: File): Promise<string> => {
    let xmlText = ''

    if (file.name.toLowerCase().endsWith('.mxl')) {
      const arrayBuffer = await fileToArrayBuffer(file)
      const zip = await JSZip.loadAsync(arrayBuffer)
      let targetFile = null
      const containerFile = zip.files['META-INF/container.xml']
      if (containerFile) {
        const containerXmlText = await containerFile.async('text')
        const containerDoc = new DOMParser().parseFromString(containerXmlText, 'text/xml')
        const rootfile = containerDoc.getElementsByTagName('rootfile')[0]
        if (rootfile) {
          const fullPath = rootfile.getAttribute('full-path')
          if (fullPath && zip.files[fullPath]) targetFile = zip.files[fullPath]
        }
      }
      if (!targetFile) {
        for (const filename in zip.files) {
          if (filename.endsWith('.xml') && filename !== 'META-INF/container.xml') {
            targetFile = zip.files[filename]; break
          }
        }
      }
      if (!targetFile) throw new Error('No XML found in MXL container')
      xmlText = await targetFile.async('text')
    } else {
      xmlText = await fileToText(file)
    }

    const xmlDoc = new DOMParser().parseFromString(xmlText, 'text/xml')
    store.setParsedXmlDoc(xmlDoc)

    const parts = xmlDoc.getElementsByTagName('part')
    const names: string[] = []
    let bestPartIndex = 0; let highestScore = -Infinity

    for (let i = 0; i < parts.length; i++) {
      const id = parts[i].getAttribute('id')
      let partName = `Part ${i + 1}`
      const partList = xmlDoc.getElementsByTagName('part-list')[0]
      if (partList) {
        for (const sp of Array.from(partList.getElementsByTagName('score-part'))) {
          if (sp.getAttribute('id') === id) {
            const nameNode = sp.getElementsByTagName('part-name')[0]
            if (nameNode) partName = nameNode.textContent ?? partName
            break
          }
        }
      }
      names.push(partName)

      let score = 0
      const nameLower = partName.toLowerCase()
      for (const kw of KEYWORDS) { if (nameLower.includes(kw.toLowerCase())) { score += 1000; break } }
      for (const kw of PENALTY_KEYWORDS) { if (nameLower.includes(kw.toLowerCase())) { score -= 2000; break } }

      const notes = parts[i].getElementsByTagName('note')
      let totalPitches = 0; let pitchSum = 0
      const stepMapLocal: Record<string, number> = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }
      for (let j = 0; j < notes.length; j++) {
        const pitchNode = notes[j].getElementsByTagName('pitch')[0]
        if (pitchNode) {
          totalPitches++
          const stepStr = pitchNode.getElementsByTagName('step')[0].textContent!
          const alterNode = pitchNode.getElementsByTagName('alter')[0]
          const alter = alterNode ? parseFloat(alterNode.textContent!) : 0
          const octave = parseInt(pitchNode.getElementsByTagName('octave')[0].textContent!)
          pitchSum += stepMapLocal[stepStr] + alter + octave * 12
        }
      }
      score += totalPitches
      if (totalPitches > 0) score += pitchSum / totalPitches * 2
      if (score > highestScore) { highestScore = score; bestPartIndex = i }
    }

    store.setPartNames(names)
    store.setSelectedPartIdx(bestPartIndex)
    store.setShowPartSelector(parts.length > 1)
    store.setShowAutoDetect(parts.length > 1)

    return renderSelectedPart(xmlDoc, bestPartIndex, file, '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, renderSelectedPart])

  // ──────────────────────────────────────────────────────────
  // MIDI Conversion
  // ──────────────────────────────────────────────────────────
  const handleMidiConversion = useCallback(async (file: File): Promise<string> => {
    const arrayBuffer = await fileToArrayBuffer(file)
    const midi = new Midi(arrayBuffer)

    let keyStr = 'C'
    if (midi.header.keySignatures?.length > 0) keyStr = midi.header.keySignatures[0].key

    let baseTonicStep = keyStr[0]
    let baseTonicAlter = keyStr.includes('#') ? 1 : keyStr.includes('b') ? -1 : 0
    let baseTonicSemi = pitchToSemitones(baseTonicStep, baseTonicAlter, 4)

    let bestTrack = null; let maxNotes = -1
    for (const track of midi.tracks) {
      if (track.notes.length > maxNotes) { maxNotes = track.notes.length; bestTrack = track }
    }
    if (!bestTrack || bestTrack.notes.length === 0) throw new Error('No notes found in MIDI.')

    const TICK_SNAP = Math.max(2, Math.round(midi.header.ppq / 120))
    const tickMap = new Map<number, { midi: number; ticks: number; durationTicks: number }>()
    for (const n of bestTrack.notes) {
      const snapped = Math.round(n.ticks / TICK_SNAP) * TICK_SNAP
      if (!tickMap.has(snapped) || n.midi > tickMap.get(snapped)!.midi) tickMap.set(snapped, n)
    }
    const melodyNotes = [...tickMap.values()].sort((a, b) => a.ticks - b.ticks)

    let beats = 4; let beatType = 4
    if (midi.header.timeSignatures?.length > 0) {
      const rawBeats = midi.header.timeSignatures[0].timeSignature[0]
      const rawBeatType = midi.header.timeSignatures[0].timeSignature[1]
      if ([2, 4, 8, 16].includes(rawBeatType) && rawBeats >= 2 && rawBeats <= 12) {
        beats = rawBeats; beatType = rawBeatType
      }
    }

    const ppq = midi.header.ppq
    let measureTicks = beats * (4 / beatType) * ppq
    const estMeasures = Math.ceil((melodyNotes[melodyNotes.length - 1].ticks + 1) / measureTicks)
    if (melodyNotes.length / Math.max(1, estMeasures) < 1.5) {
      beats = 4; beatType = 4; measureTicks = beats * (4 / beatType) * ppq
    }

    let useFlats = ['F','Bb','Eb','Ab','Db','Gb','Cb'].includes(keyStr)
    let stepNames = useFlats
      ? ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
      : ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

    const sortedKeyChanges = (midi.header.keySignatures || []).slice().sort((a, b) => a.ticks - b.ticks)
    let keyChangeIdx = 1

    const jianpuMeasures: MeasureArray[] = []
    let currentMeasureNotes: NoteObject[] = []
    let currentMeasureIdx = 0

    for (let i = 0; i < melodyNotes.length; i++) {
      const note = melodyNotes[i]
      const noteMeasureIdx = Math.floor(note.ticks / measureTicks)

      while (currentMeasureIdx < noteMeasureIdx) {
        if (currentMeasureNotes.length > 0) {
          jianpuMeasures.push(currentMeasureNotes as unknown as MeasureArray)
          currentMeasureNotes = []
        } else {
          jianpuMeasures.push([{ degree: 0, octave: 0, type: 'whole', dot: false, tie: false, rest: true, accidental: '', slurStart: false, slurStop: false }] as unknown as MeasureArray)
        }
        currentMeasureIdx++
      }

      while (keyChangeIdx < sortedKeyChanges.length && sortedKeyChanges[keyChangeIdx].ticks <= note.ticks) {
        const newKey = sortedKeyChanges[keyChangeIdx].key
        baseTonicStep = newKey[0]
        baseTonicAlter = newKey.includes('#') ? 1 : newKey.includes('b') ? -1 : 0
        baseTonicSemi = pitchToSemitones(baseTonicStep, baseTonicAlter, 4)
        useFlats = ['F','Bb','Eb','Ab','Db','Gb','Cb'].includes(newKey)
        stepNames = useFlats
          ? ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
          : ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
        keyChangeIdx++
      }

      const noteNum = note.midi
      const octave = Math.floor(noteNum / 12) - 1
      const semitone = noteNum % 12
      const stepStr = stepNames[semitone]
      const step = stepStr[0]
      const alter = stepStr.includes('b') ? -1 : stepStr.includes('#') ? 1 : 0

      const noteSemi = pitchToSemitones(step, alter, octave)
      const tonicDiatAbs = stepMapDiatonic[baseTonicStep] + 4 * 7
      const noteDiatAbs = stepMapDiatonic[step] + octave * 7
      const degree = ((noteDiatAbs - tonicDiatAbs) % 7 + 7) % 7
      const shift = Math.round((noteSemi - (baseTonicSemi + scaleDegrees[degree])) / 12)
      const intendedSemi = baseTonicSemi + shift * 12 + scaleDegrees[degree]
      const acc: '#' | 'b' | '' = noteSemi > intendedSemi ? '#' : noteSemi < intendedSemi ? 'b' : ''

      const noteBeats = note.durationTicks / ppq
      let noteType: NoteObject['type'] = 'quarter'; let hasDot = false
      if (noteBeats >= 3.75) noteType = 'whole'
      else if (noteBeats >= 2.75) { noteType = 'half'; hasDot = true }
      else if (noteBeats >= 1.75) noteType = 'half'
      else if (noteBeats >= 1.25) { noteType = 'quarter'; hasDot = true }
      else if (noteBeats >= 0.75) noteType = 'quarter'
      else if (noteBeats >= 0.6) { noteType = 'eighth'; hasDot = true }
      else if (noteBeats >= 0.35) noteType = 'eighth'
      else noteType = '16th'

      currentMeasureNotes.push({ degree: degree + 1, octave: shift, type: noteType, dot: hasDot, tie: false, rest: false, accidental: acc, slurStart: false, slurStop: false })
    }
    if (currentMeasureNotes.length > 0) jianpuMeasures.push(currentMeasureNotes as unknown as MeasureArray)

    let tempoStr = ''
    if (midi.header.tempos?.length > 0) tempoStr = Math.round(midi.header.tempos[0].bpm).toString()

    const titleStr = midi.header.name || file.name.replace(/\.[^/.]+$/, '')
    const timeStr = `${beats}/${beatType}`

    store.setOriginal(jianpuMeasures, keyStr, timeStr, titleStr, tempoStr)
    store.setCurrent(jianpuMeasures, keyStr)
    store.setPartNames(['自动'])
    store.setShowPartSelector(false)
    store.setShowAutoDetect(false)

    const svgResult = renderJianpuSVG(jianpuMeasures, keyStr, timeStr, titleStr, getContainerWidth(), tempoStr)
    store.setIsConverted(true)
    return svgResult
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  // ──────────────────────────────────────────────────────────
  // ABC Conversion
  // ──────────────────────────────────────────────────────────
  const handleAbcConversion = useCallback(async (file: File): Promise<string> => {
    const text = await fileToText(file)
    const { measures, keyStr, timeStr, titleStr, tempoStr } = parseABC(text, file.name)
    if (!measures.length) throw new Error('No notes found in ABC file.')

    store.setOriginal(measures, keyStr, timeStr, titleStr, tempoStr)
    store.setCurrent(measures, keyStr)
    store.setPartNames(['—'])
    store.setShowPartSelector(false)
    store.setShowAutoDetect(false)

    const svgResult = renderJianpuSVG(measures, keyStr, timeStr, titleStr, getContainerWidth(), tempoStr)
    store.setIsConverted(true)
    return svgResult
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  // ──────────────────────────────────────────────────────────
  // Dispatch (router)
  // ──────────────────────────────────────────────────────────
  const convert = useCallback(async (file: File): Promise<string> => {
    if (file.size > 20 * 1024 * 1024) throw new Error('File is too large (max 20 MB).')
    const nameLower = file.name.toLowerCase()
    if (nameLower.endsWith('.mid') || nameLower.endsWith('.midi')) return handleMidiConversion(file)
    if (nameLower.endsWith('.abc')) return handleAbcConversion(file)
    return handleXmlConversion(file)
  }, [handleMidiConversion, handleAbcConversion, handleXmlConversion])

  // ──────────────────────────────────────────────────────────
  // Transpose re-render
  // ──────────────────────────────────────────────────────────
  const transpose = useCallback((targetKey: string): string | null => {
    const { originalMeasures, originalKeyStr, originalTimeStr, originalTitleStr, originalTempoStr } = useScoreStore.getState()
    if (!originalMeasures) return null
    const key = targetKey || originalKeyStr
    const measures = transposeNoteObjects(originalMeasures, originalKeyStr, key)
    useScoreStore.getState().setCurrent(measures, key)
    useScoreStore.getState().setTransposeKey(targetKey)
    return renderJianpuSVG(measures, key, originalTimeStr, originalTitleStr, getContainerWidth(), originalTempoStr)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ──────────────────────────────────────────────────────────
  // Sample
  // ──────────────────────────────────────────────────────────
  const loadSample = useCallback(async (): Promise<string> => {
    const blob = new Blob([SAMPLE_XML], { type: 'application/xml' })
    const file = new File([blob], 'Twinkle Twinkle Little Star.xml', { type: 'application/xml' })
    store.setCurrentFile(file)
    return convert(file)
  }, [store, convert])

  // ──────────────────────────────────────────────────────────
  // Part change (XML only)
  // ──────────────────────────────────────────────────────────
  const changePartAndRender = useCallback(async (partIdx: number): Promise<string | null> => {
    const { parsedXmlDoc, currentFile, transposeKey } = useScoreStore.getState()
    if (!parsedXmlDoc) return null
    store.setSelectedPartIdx(partIdx)
    store.setShowAutoDetect(false)
    return renderSelectedPart(parsedXmlDoc, partIdx, currentFile, transposeKey)
  }, [store, renderSelectedPart])

  const rerenderWithStore = useCallback((): string | null => {
    const { currentMeasures, currentKeyStr, originalTimeStr, originalTitleStr, originalTempoStr } = useScoreStore.getState()
    if (!currentMeasures) return null
    return renderJianpuSVG(currentMeasures, currentKeyStr, originalTimeStr, originalTitleStr, getContainerWidth(), originalTempoStr)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadFromText = useCallback((text: string): string => {
    const { originalKeyStr, originalTimeStr, originalTempoStr, originalTitleStr } = useScoreStore.getState()
    const parsed = parseFromText(text, originalKeyStr, originalTimeStr, originalTempoStr, originalTitleStr)
    const title = parsed.titleStr || originalTitleStr || '简谱导入'
    store.setOriginal(parsed.measures, parsed.keyStr, parsed.timeStr, title, parsed.tempoStr)
    store.setCurrent(parsed.measures, parsed.keyStr)
    store.setTransposeKey('')
    store.setIsConverted(true)
    return renderJianpuSVG(parsed.measures, parsed.keyStr, parsed.timeStr, title, getContainerWidth(), parsed.tempoStr)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  void showOutput
  return { convert, transpose, loadSample, changePartAndRender, renderSelectedPart, rerenderWithStore, loadFromText }
}
