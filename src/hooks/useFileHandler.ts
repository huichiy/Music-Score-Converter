import { useCallback } from 'react'
import JSZip from 'jszip'
import { Midi } from '@tonejs/midi'
import { useScoreStore } from '@/store/scoreStore'
import { parseXMLToNoteObjects, transposeNoteObjects, keyMap, midiToJianpu, parseMetronomeTempo } from '@/lib/parser'
import { renderJianpuSVG } from '@/lib/renderer'
import { parseABC } from '@/lib/abcParser'
import { parseFromText } from '@/lib/editor'
import { matchPartIndex, loadMyPart } from '@/lib/partMatch'
import type { Measure } from '@/types/score'

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

  // Every score render goes through here so the layout settings apply everywhere
  const renderScore = (measures: Measure[], keyStr: string, timeStr: string, titleStr: string, tempoStr: string) =>
    renderJianpuSVG(measures, keyStr, timeStr, titleStr, getContainerWidth(), tempoStr, undefined, useScoreStore.getState().measuresPerLine)

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
    // <part-list> is only a name table; a file without one still renders
    const partListNode = xmlDoc.getElementsByTagName('part-list')[0]
    if (partListNode) dummyDoc.documentElement.appendChild(partListNode.cloneNode(true))
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

    // Quarter notes per minute: "half = 60" is 120, which is what playback counts
    const tempoStr = parseMetronomeTempo(xmlDoc)

    const timeStr = `${beats}/${beatType}`
    const svgMeasures = parseXMLToNoteObjects(dummyDoc)

    store.setOriginal(svgMeasures, keyStr, timeStr, titleStr, tempoStr)

    const targetKey = transposeKey || keyStr
    const displayMeasures = transposeNoteObjects(svgMeasures, keyStr, targetKey)
    store.setCurrent(displayMeasures, targetKey)

    const svgResult = renderScore(displayMeasures, targetKey, timeStr, titleStr, tempoStr)
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
          const lower = filename.toLowerCase()
          if (!lower.startsWith('meta-inf/') && (lower.endsWith('.xml') || lower.endsWith('.musicxml'))) {
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

    // The user's own instrument beats melody scoring. Scoring can only guess at
    // one default (the melody), which is wrong for everyone playing an inner or
    // bass voice — so once they've picked their part by hand, honour it.
    const mine = matchPartIndex(names, loadMyPart())
    const chosenIdx = mine !== -1 ? mine : bestPartIndex

    store.setPartNames(names)
    store.setSelectedPartIdx(chosenIdx)
    store.setMatchedMyPart(mine !== -1)
    store.setShowPartSelector(parts.length > 1)
    store.setShowAutoDetect(parts.length > 1 && mine === -1)
    // A new file starts in its own key; the previous file's transposition must not
    // survive into the selector or the next part change
    store.setTransposeKey('')

    return renderSelectedPart(xmlDoc, chosenIdx, file, '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, renderSelectedPart])

  // ──────────────────────────────────────────────────────────
  // MIDI Conversion
  // ──────────────────────────────────────────────────────────
  const handleMidiConversion = useCallback(async (file: File): Promise<string> => {
    const arrayBuffer = await fileToArrayBuffer(file)
    const midi = new Midi(arrayBuffer)
    const { measures: jianpuMeasures, keyStr, timeStr, tempoStr, titleStr: midiTitle } = midiToJianpu(midi)
    const titleStr = midiTitle || file.name.replace(/\.[^/.]+$/, '')

    store.setOriginal(jianpuMeasures, keyStr, timeStr, titleStr, tempoStr)
    store.setCurrent(jianpuMeasures, keyStr)
    store.setParsedXmlDoc(null)
    store.setTransposeKey('')
    store.setPartNames(['自动'])
    store.setShowPartSelector(false)
    store.setShowAutoDetect(false)

    const svgResult = renderScore(jianpuMeasures, keyStr, timeStr, titleStr, tempoStr)
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
    store.setParsedXmlDoc(null)
    store.setTransposeKey('')
    store.setPartNames(['—'])
    store.setShowPartSelector(false)
    store.setShowAutoDetect(false)

    const svgResult = renderScore(measures, keyStr, timeStr, titleStr, tempoStr)
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
    return renderScore(measures, key, originalTimeStr, originalTitleStr, originalTempoStr)
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
    return renderScore(currentMeasures, currentKeyStr, originalTimeStr, originalTitleStr, originalTempoStr)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Two callers. The text editor edits the loaded score in place, so a header it left
  // out falls back to that score's. OCR text is a different score: it must not inherit
  // the loaded file's title / key / tempo, and the old file's parts must go, or picking
  // a part would re-render the old file over it. `fresh: true` selects the OCR behaviour.
  const loadFromText = useCallback((text: string, opts?: { fresh?: boolean }): string => {
    const { originalKeyStr, originalTimeStr, originalTempoStr, originalTitleStr } = useScoreStore.getState()
    const fresh = opts?.fresh ?? false
    const parsed = fresh
      ? parseFromText(text)
      : parseFromText(text, originalKeyStr, originalTimeStr, originalTempoStr, originalTitleStr)
    const title = parsed.titleStr || (fresh ? '' : originalTitleStr) || '简谱导入'
    store.setOriginal(parsed.measures, parsed.keyStr, parsed.timeStr, title, parsed.tempoStr)
    store.setCurrent(parsed.measures, parsed.keyStr)
    store.setTransposeKey('')
    if (fresh) {
      store.setParsedXmlDoc(null)
      store.setPartNames([])
      store.setSelectedPartIdx(0)
      store.setShowPartSelector(false)
      store.setShowAutoDetect(false)
      store.setMatchedMyPart(false)
    }
    store.setIsConverted(true)
    return renderScore(parsed.measures, parsed.keyStr, parsed.timeStr, title, parsed.tempoStr)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  void showOutput
  return { convert, transpose, loadSample, changePartAndRender, renderSelectedPart, rerenderWithStore, loadFromText }
}
