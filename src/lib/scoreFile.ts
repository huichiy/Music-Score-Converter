// Reading a score file: the parse half of loading. Nothing here touches the store or
// the DOM — it either returns a complete LoadedScore or throws a ScoreFileError whose
// message is ready to show. useFileHandler commits the result in one step, so a file that
// fails halfway leaves the score on screen exactly as it was.

import JSZip from 'jszip'
import type { Midi } from '@tonejs/midi'
import { parseXMLToNoteObjects, keyMap, midiToJianpu, parseMetronomeTempo, NO_MIDI_NOTES } from './parser'
import { parseABC } from './abcParser'
import { matchPartIndex, loadMyPart } from './partMatch'
import { cleanTitle } from './textHeader'
import type { MeasureArray } from '../types/score'

/** An error whose message is for the user (Simplified Chinese), not for the console. */
export class ScoreFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScoreFileError'
  }
}

/** The message to show for anything a load threw: ours as written, an unexpected one as `fallback`. */
export function loadErrorMessage(err: unknown, fallback = '这个文件无法转换，请换一个文件或重新导出'): string {
  return err instanceof ScoreFileError ? err.message : fallback
}

/** Parses XML text; injected so the browser's DOMParser and linkedom (tests) both work. */
export type XmlParser = (text: string) => Document
/** Builds a Midi from file bytes; injected because @tonejs/midi's named export only exists in the bundler build (Node sees CommonJS). */
export type MidiReader = (data: ArrayBuffer) => Midi

// ── What kind of file is it? Decided from the name / type, before reading a byte ──

export type ScoreKind = 'xml' | 'mxl' | 'midi' | 'abc' | 'image' | 'pdf'

export const MAX_SCORE_BYTES = 20 * 1024 * 1024

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif|svg)$/i

export function scoreKindOf(name: string, type = ''): ScoreKind {
  const lower = name.toLowerCase()
  if (type === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf'
  if (type.startsWith('image/') || IMAGE_EXT.test(lower)) return 'image'
  if (/\.midi?$/.test(lower)) return 'midi'
  if (lower.endsWith('.abc')) return 'abc'
  if (lower.endsWith('.mxl')) return 'mxl'
  // .xml, .musicxml, and anything unrecognised: let the XML check say what is wrong with it
  return 'xml'
}

/** The kind of a file the score reader can attempt; throws for pictures / PDFs and oversize files. */
export function checkScoreFile(file: { name: string; type?: string; size: number }): ScoreKind {
  const kind = scoreKindOf(file.name, file.type)
  if (kind === 'image' || kind === 'pdf') throw new ScoreFileError('这是图片 / PDF，请用左侧「OCR 图片识别」')
  if (file.size > MAX_SCORE_BYTES) throw new ScoreFileError('文件太大（上限 20 MB）')
  return kind
}

// ── Titles ───────────────────────────────────────────────────

/** The file name without its extension, on one line. */
export function fileBaseName(name: string): string {
  return cleanTitle(name.replace(/\.[^/.]+$/, ''))
}

/** `title` when it says something, else the file name: exporters leave <movement-title/> empty. */
export function titleOrFileName(title: string | null | undefined, fileName: string): string {
  return cleanTitle(title ?? '') || fileBaseName(fileName)
}

/** movement-title, then work-title, then the file name — the first one that is not blank. */
export function xmlTitle(xmlDoc: Document, fileName: string): string {
  for (const tag of ['movement-title', 'work-title']) {
    const t = cleanTitle(xmlDoc.getElementsByTagName(tag)[0]?.textContent ?? '')
    if (t) return t
  }
  return fileBaseName(fileName)
}

// ── MusicXML ─────────────────────────────────────────────────

/** Parses and sanity-checks MusicXML text: valid XML, partwise, at least one <part>. */
export function parseScoreXml(xmlText: string, parse: XmlParser): Document {
  const doc = parse(xmlText)
  // Browsers answer broken XML with a <parsererror> element (Firefox makes it the root),
  // linkedom with a document that has no root at all. Either way it is not a score.
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length > 0) {
    throw new ScoreFileError('不是有效的 MusicXML（XML 解析出错），请重新导出')
  }
  // A timewise file also has <part> elements (inside each <measure>), so test it first
  if (doc.getElementsByTagName('score-timewise').length > 0) {
    throw new ScoreFileError('暂不支持 score-timewise 格式，请导出为 partwise 的 MusicXML')
  }
  if (doc.getElementsByTagName('part').length === 0) {
    throw new ScoreFileError('文件里没有乐谱声部，支持 MusicXML / MXL / MIDI / ABC')
  }
  return doc
}

/** The entry of an .mxl container that holds the score: the declared rootfile, else the first .xml. */
export function mxlEntryName(entries: string[], rootfile?: string | null): string | null {
  if (rootfile && entries.includes(rootfile)) return rootfile
  return entries.find((name) => {
    const lower = name.toLowerCase()
    return !lower.startsWith('meta-inf/') && (lower.endsWith('.xml') || lower.endsWith('.musicxml'))
  }) ?? null
}

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

const STEP_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Every part's display name, and the index of the one most likely to carry the melody. */
export function listParts(xmlDoc: Document): { names: string[]; bestIndex: number } {
  const parts = xmlDoc.getElementsByTagName('part')
  const names: string[] = []
  let bestIndex = 0
  let highest = -Infinity

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
    let totalPitches = 0
    let pitchSum = 0
    for (let j = 0; j < notes.length; j++) {
      const pitchNode = notes[j].getElementsByTagName('pitch')[0]
      if (pitchNode) {
        totalPitches++
        const stepStr = pitchNode.getElementsByTagName('step')[0].textContent!
        const alterNode = pitchNode.getElementsByTagName('alter')[0]
        const alter = alterNode ? parseFloat(alterNode.textContent!) : 0
        const octave = parseInt(pitchNode.getElementsByTagName('octave')[0].textContent!)
        pitchSum += STEP_SEMITONE[stepStr] + alter + octave * 12
      }
    }
    score += totalPitches
    if (totalPitches > 0) score += pitchSum / totalPitches * 2
    if (score > highest) { highest = score; bestIndex = i }
  }
  return { names, bestIndex }
}

export interface ParsedPart {
  measures: MeasureArray[]
  keyStr: string
  timeStr: string
  titleStr: string
  tempoStr: string
}

/** One part of a MusicXML document as measures plus its header; throws when it has no measures. */
export function parseXmlPart(xmlDoc: Document, partIdx: number, fileName: string, parse: XmlParser): ParsedPart {
  const partsList = xmlDoc.getElementsByTagName('part')
  if (partIdx < 0 || partIdx >= partsList.length) throw new ScoreFileError('这个声部没有可以转换的小节')

  const partDoc = parse('<score-partwise/>')
  // <part-list> is only a name table; a file without one still renders
  const partListNode = xmlDoc.getElementsByTagName('part-list')[0]
  if (partListNode) partDoc.documentElement.appendChild(partListNode.cloneNode(true))
  partDoc.documentElement.appendChild(partsList[partIdx].cloneNode(true))

  const titleStr = xmlTitle(xmlDoc, fileName)

  // Header: this part's own signature, else the file's first one
  let beats = '4'
  let beatType = '4'
  const beatsNodes = partDoc.getElementsByTagName('beats')
  if (beatsNodes.length > 0) beats = beatsNodes[0].textContent!
  else { const fb = xmlDoc.getElementsByTagName('beats'); if (fb.length > 0) beats = fb[0].textContent! }
  const beatTypeNodes = partDoc.getElementsByTagName('beat-type')
  if (beatTypeNodes.length > 0) beatType = beatTypeNodes[0].textContent!
  else { const fb = xmlDoc.getElementsByTagName('beat-type'); if (fb.length > 0) beatType = fb[0].textContent! }

  let fifths = 0
  const fifthsNodes = partDoc.getElementsByTagName('fifths')
  if (fifthsNodes.length > 0) fifths = parseInt(fifthsNodes[0].textContent!)
  else { const fb = xmlDoc.getElementsByTagName('fifths'); if (fb.length > 0) fifths = parseInt(fb[0].textContent!) }
  const keyStr = keyMap[fifths.toString()] || 'C'

  // Quarter notes per minute: "half = 60" is 120, which is what playback counts
  const tempoStr = parseMetronomeTempo(xmlDoc)

  // keyStr is the fallback for a part with no <key> of its own: its degrees must count
  // from the key the header shows, not from C
  const measures = parseXMLToNoteObjects(partDoc, keyStr)
  if (measures.length === 0) throw new ScoreFileError('这个声部没有可以转换的小节')

  return { measures, keyStr, timeStr: `${beats}/${beatType}`, titleStr, tempoStr }
}

// ── The whole file ───────────────────────────────────────────

/** Everything a successfully read file contributes to the store. */
export interface LoadedScore extends ParsedPart {
  file: File
  xmlDoc: Document | null
  partNames: string[]
  selectedPartIdx: number
  matchedMyPart: boolean
  showPartSelector: boolean
  showAutoDetect: boolean
}

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

async function readMxlText(file: File, parse: XmlParser): Promise<string> {
  const broken = () => new ScoreFileError('.mxl 文件损坏，请重新导出')
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await fileToArrayBuffer(file))
  } catch {
    throw broken()   // not a zip at all
  }
  let rootfile: string | null = null
  const container = zip.files['META-INF/container.xml']
  if (container) {
    try {
      const containerDoc = parse(await container.async('text'))
      rootfile = containerDoc.getElementsByTagName('rootfile')[0]?.getAttribute('full-path') ?? null
    } catch { /* a damaged container.xml only loses the shortcut: fall back to the first .xml */ }
  }
  const entry = mxlEntryName(Object.keys(zip.files), rootfile)
  if (!entry) throw broken()
  try {
    return await zip.files[entry].async('text')
  } catch {
    throw broken()
  }
}

async function loadXmlScore(file: File, isMxl: boolean, parse: XmlParser): Promise<LoadedScore> {
  const xmlText = isMxl ? await readMxlText(file, parse) : await fileToText(file)
  const xmlDoc = parseScoreXml(xmlText, parse)
  const { names, bestIndex } = listParts(xmlDoc)

  // The user's own instrument beats melody scoring. Scoring can only guess at
  // one default (the melody), which is wrong for everyone playing an inner or
  // bass voice — so once they've picked their part by hand, honour it.
  const mine = matchPartIndex(names, loadMyPart())
  const selectedPartIdx = mine !== -1 ? mine : bestIndex
  const part = parseXmlPart(xmlDoc, selectedPartIdx, file.name, parse)

  return {
    ...part,
    file,
    xmlDoc,
    partNames: names,
    selectedPartIdx,
    matchedMyPart: mine !== -1,
    showPartSelector: names.length > 1,
    showAutoDetect: names.length > 1 && mine === -1,
  }
}

async function loadMidiScore(file: File, readMidi: MidiReader): Promise<LoadedScore> {
  let midi: Midi
  try {
    midi = readMidi(await fileToArrayBuffer(file))
  } catch {
    throw new ScoreFileError('MIDI 文件无法读取')
  }
  let result: ReturnType<typeof midiToJianpu>
  try {
    result = midiToJianpu(midi)
  } catch (err) {
    // Anything but "no notes" is a file it could not follow; don't call that an empty one
    throw new ScoreFileError((err as Error).message === NO_MIDI_NOTES ? NO_MIDI_NOTES : 'MIDI 文件无法读取')
  }
  if (result.measures.length === 0) throw new ScoreFileError(NO_MIDI_NOTES)
  return {
    file,
    measures: result.measures,
    keyStr: result.keyStr,
    timeStr: result.timeStr,
    tempoStr: result.tempoStr,
    titleStr: titleOrFileName(result.titleStr, file.name),
    xmlDoc: null,
    partNames: ['自动'],
    selectedPartIdx: 0,
    matchedMyPart: false,
    showPartSelector: false,
    showAutoDetect: false,
  }
}

async function loadAbcScore(file: File): Promise<LoadedScore> {
  const parsed = parseABC(await fileToText(file), file.name)
  if (!parsed.measures.length) throw new ScoreFileError('ABC 文件里没有音符')
  return {
    file,
    measures: parsed.measures,
    keyStr: parsed.keyStr,
    timeStr: parsed.timeStr,
    tempoStr: parsed.tempoStr,
    titleStr: titleOrFileName(parsed.titleStr, file.name),
    xmlDoc: null,
    partNames: ['—'],
    selectedPartIdx: 0,
    matchedMyPart: false,
    showPartSelector: false,
    showAutoDetect: false,
  }
}

/**
 * Reads a score file into a LoadedScore. Touches no store state and may throw — always
 * a ScoreFileError, so the caller can show the message as it is.
 */
export async function loadScoreFile(file: File, parse: XmlParser, readMidi: MidiReader): Promise<LoadedScore> {
  const kind = checkScoreFile(file)
  try {
    if (kind === 'midi') return await loadMidiScore(file, readMidi)
    if (kind === 'abc') return await loadAbcScore(file)
    return await loadXmlScore(file, kind === 'mxl', parse)
  } catch (err) {
    if (err instanceof ScoreFileError) throw err
    // A malformed file the parsers did not anticipate (a <pitch> with no <step>, …)
    throw new ScoreFileError(
      kind === 'midi' ? 'MIDI 文件无法读取'
      : kind === 'abc' ? 'ABC 文件无法读取'
      : '这个文件无法转换，请确认它是从乐谱软件导出的 MusicXML',
    )
  }
}

// ── Transpose selector ───────────────────────────────────────

export const TRANSPOSE_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F']

/**
 * The selector's options. A score written in a key the list does not offer (C#, Cb, …) gets
 * its own key as an extra first option — otherwise the select has no matching value and
 * shows "C" for a score that is not in C.
 */
export function transposeOptions(originalKey: string): { value: string; label: string }[] {
  const options = TRANSPOSE_KEYS.map((k) => ({ value: k, label: k === originalKey ? `${k} (原调)` : k }))
  if (TRANSPOSE_KEYS.includes(originalKey)) return options
  return [{ value: originalKey, label: `${originalKey} (原调)` }, ...options]
}
