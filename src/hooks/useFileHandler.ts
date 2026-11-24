import { useCallback, useRef } from 'react'
import { Midi } from '@tonejs/midi'
import { useScoreStore } from '@/store/scoreStore'
import { transposeNoteObjects } from '@/lib/parser'
import { renderJianpuSVG } from '@/lib/renderer'
import { parseFromText } from '@/lib/editor'
import { loadScoreFile, parseXmlPart, ScoreFileError } from '@/lib/scoreFile'
import type { XmlParser, MidiReader } from '@/lib/scoreFile'
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

const parseXml: XmlParser = (text) => new DOMParser().parseFromString(text, 'text/xml')
const readMidi: MidiReader = (data) => new Midi(data)

export function useFileHandler(mainContentRef: React.RefObject<HTMLElement | null>) {
  // Bumped by every file load and every text import. A load that finds a different number
  // when its parse finishes was superseded: it must not commit over what is on screen now.
  const loadRun = useRef(0)

  const getContainerWidth = () => mainContentRef.current?.clientWidth ?? 540

  // Every score render goes through here so the layout settings apply everywhere
  const renderScore = (measures: Measure[], keyStr: string, timeStr: string, titleStr: string, tempoStr: string) =>
    renderJianpuSVG(measures, keyStr, timeStr, titleStr, getContainerWidth(), tempoStr, undefined, useScoreStore.getState().measuresPerLine)

  // ──────────────────────────────────────────────────────────
  // Load a file, in two steps. Step 1 (loadScoreFile) parses and may throw; it touches no
  // store state, so a bad file leaves the score on screen, its part selector and its
  // transposition exactly as they were. Step 2 sets everything at once and renders.
  // Resolves null when a newer load superseded this one (the caller shows nothing).
  // ──────────────────────────────────────────────────────────
  const convert = useCallback(async (file: File): Promise<string | null> => {
    const run = ++loadRun.current
    let loaded
    try {
      loaded = await loadScoreFile(file, parseXml, readMidi)
    } catch (err) {
      if (run !== loadRun.current) return null   // a newer load owns the screen; this complaint is moot
      throw err
    }
    if (run !== loadRun.current) return null

    // Render before committing: if the renderer throws, the store is still untouched
    const svg = renderScore(loaded.measures, loaded.keyStr, loaded.timeStr, loaded.titleStr, loaded.tempoStr)
    useScoreStore.getState().commitScore({
      originalMeasures: loaded.measures,
      originalKeyStr: loaded.keyStr,
      originalTimeStr: loaded.timeStr,
      originalTitleStr: loaded.titleStr,
      originalTempoStr: loaded.tempoStr,
      currentMeasures: loaded.measures,
      currentKeyStr: loaded.keyStr,
      // A new file starts in its own key; the previous file's transposition must not
      // survive into the selector or the next part change
      transposeKey: '',
      currentFile: loaded.file,
      parsedXmlDoc: loaded.xmlDoc,
      partNames: loaded.partNames,
      selectedPartIdx: loaded.selectedPartIdx,
      matchedMyPart: loaded.matchedMyPart,
      showPartSelector: loaded.showPartSelector,
      showAutoDetect: loaded.showAutoDetect,
    })
    return svg
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A reset while a file is still being read must not be undone by that file landing later
  const cancelLoads = useCallback(() => { loadRun.current++ }, [])

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
  const loadSample = useCallback(async (): Promise<string | null> => {
    const blob = new Blob([SAMPLE_XML], { type: 'application/xml' })
    const file = new File([blob], 'Twinkle Twinkle Little Star.xml', { type: 'application/xml' })
    return convert(file)
  }, [convert])

  // ──────────────────────────────────────────────────────────
  // Part change (XML only). Throws a ScoreFileError when the part has nothing to show;
  // nothing is committed then, so the selector falls back to the part still on screen.
  // ──────────────────────────────────────────────────────────
  const changePartAndRender = useCallback(async (partIdx: number): Promise<string | null> => {
    const { parsedXmlDoc, currentFile, transposeKey } = useScoreStore.getState()
    if (!parsedXmlDoc) return null
    let part
    try {
      part = parseXmlPart(parsedXmlDoc, partIdx, currentFile?.name ?? '', parseXml)
    } catch (err) {
      throw err instanceof ScoreFileError ? err : new ScoreFileError('这个声部无法转换，请换一个声部')
    }
    const targetKey = transposeKey || part.keyStr
    const displayMeasures = transposeNoteObjects(part.measures, part.keyStr, targetKey)
    const svg = renderScore(displayMeasures, targetKey, part.timeStr, part.titleStr, part.tempoStr)
    useScoreStore.getState().commitScore({
      originalMeasures: part.measures,
      originalKeyStr: part.keyStr,
      originalTimeStr: part.timeStr,
      originalTitleStr: part.titleStr,
      originalTempoStr: part.tempoStr,
      currentMeasures: displayMeasures,
      currentKeyStr: targetKey,
      transposeKey,
      selectedPartIdx: partIdx,
      showAutoDetect: false,
    })
    return svg
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rerenderWithStore = useCallback((): string | null => {
    const { currentMeasures, currentKeyStr, originalTimeStr, originalTitleStr, originalTempoStr } = useScoreStore.getState()
    if (!currentMeasures) return null
    return renderScore(currentMeasures, currentKeyStr, originalTimeStr, originalTitleStr, originalTempoStr)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Two callers. The text editor edits the loaded score in place, so a header it left
  // out falls back to that score's. OCR text is a different score: it must not inherit
  // the loaded file's title / key / tempo, and the old file's parts must go, or picking
  // a part would re-render the old file over it; and the upload box must stop showing
  // the old file's name. `fresh: true` selects the OCR behaviour.
  const loadFromText = useCallback((text: string, opts?: { fresh?: boolean }): string => {
    const { originalKeyStr, originalTimeStr, originalTempoStr, originalTitleStr } = useScoreStore.getState()
    const fresh = opts?.fresh ?? false
    const parsed = fresh
      ? parseFromText(text)
      : parseFromText(text, originalKeyStr, originalTimeStr, originalTempoStr, originalTitleStr)
    const title = parsed.titleStr || (fresh ? '' : originalTitleStr) || '简谱导入'
    const svg = renderScore(parsed.measures, parsed.keyStr, parsed.timeStr, title, parsed.tempoStr)
    loadRun.current++   // a file still being read must not land on top of this score
    useScoreStore.getState().commitScore({
      originalMeasures: parsed.measures,
      originalKeyStr: parsed.keyStr,
      originalTimeStr: parsed.timeStr,
      originalTitleStr: title,
      originalTempoStr: parsed.tempoStr,
      currentMeasures: parsed.measures,
      currentKeyStr: parsed.keyStr,
      transposeKey: '',
      ...(fresh ? {
        currentFile: null,
        parsedXmlDoc: null,
        partNames: [],
        selectedPartIdx: 0,
        showPartSelector: false,
        showAutoDetect: false,
        matchedMyPart: false,
      } : {}),
    })
    return svg
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { convert, cancelLoads, transpose, loadSample, changePartAndRender, rerenderWithStore, loadFromText }
}
