// Tests for reading a score file (src/lib/scoreFile.ts): friendly errors decided before or
// during parsing, titles, the part's key fallback, and the transpose selector's options.
// The parse step touches no store, so all of it runs here without a browser.
// Run via: npx tsx scripts/test-audit2-app.ts
//
// linkedom stands in for the browser's DOMParser (devDependency, tests only).

import { DOMParser } from 'linkedom'
import JSZip from 'jszip'
import midiPackage from '@tonejs/midi'
import {
  ScoreFileError, loadErrorMessage, scoreKindOf, checkScoreFile, fileBaseName, titleOrFileName, xmlTitle,
  parseScoreXml, mxlEntryName, parseXmlPart, loadScoreFile, transposeOptions, TRANSPOSE_KEYS,
} from '../src/lib/scoreFile'
import type { XmlParser, MidiReader } from '../src/lib/scoreFile'

// @tonejs/midi ships CommonJS, which Node only exposes through the default import
const { Midi } = midiPackage as unknown as typeof import('@tonejs/midi')
const readMidi: MidiReader = (data) => new Midi(data)

let pass = 0
let fail = 0

function assertEq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}`)
    console.log(`    expected: ${e}`)
    console.log(`    actual:   ${a}`)
  }
}

const sections: Array<{ name: string; fn: () => void | Promise<void> }> = []
const suite = (name: string, fn: () => void | Promise<void>) => { sections.push({ name, fn }) }

const parse: XmlParser = (text) => new DOMParser().parseFromString(text, 'text/xml') as unknown as Document

/** The message a load throws, or the string 'resolved' when it did not throw. */
async function loadMessage(file: File | { name: string; type?: string; size: number }): Promise<string> {
  try {
    await loadScoreFile(file as File, parse, readMidi)
    return 'resolved'
  } catch (err) {
    return err instanceof ScoreFileError ? err.message : `UNEXPECTED ${(err as Error).constructor.name}: ${(err as Error).message}`
  }
}
const textFile = (text: string, name: string, type = '') => new File([text], name, { type })

const NOTE = (step: string, octave: number, dur = 4, type = 'quarter') =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration><type>${type}</type></note>`
const partwise = (head: string, parts: string) =>
  `<?xml version="1.0"?><score-partwise version="3.1">${head}${parts}</score-partwise>`

const SINGLE = partwise(
  '<work><work-title>Tune</work-title></work><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>',
  `<part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${NOTE('C', 4)}${NOTE('D', 4)}${NOTE('E', 4)}${NOTE('F', 4)}</measure></part>`,
)

const NOT_XML = '不是有效的 MusicXML（XML 解析出错），请重新导出'
const NO_NOTES_MIDI = 'MIDI 文件里没有可以转换的音符'

// ───────────────────────────────────────────────────────────────

suite('file kind is decided from the name / type, before reading', () => {
  assertEq('png by extension', scoreKindOf('photo.png'), 'image')
  assertEq('JPG upper case', scoreKindOf('PHOTO.JPG'), 'image')
  assertEq('image by type, odd name', scoreKindOf('scan', 'image/webp'), 'image')
  assertEq('heic', scoreKindOf('IMG_1.heic'), 'image')
  assertEq('pdf by extension', scoreKindOf('score.pdf'), 'pdf')
  assertEq('pdf by type', scoreKindOf('download', 'application/pdf'), 'pdf')
  assertEq('mid / midi', [scoreKindOf('a.mid'), scoreKindOf('a.MIDI')], ['midi', 'midi'])
  assertEq('abc', scoreKindOf('a.abc'), 'abc')
  assertEq('mxl', scoreKindOf('a.mxl'), 'mxl')
  assertEq('xml, musicxml, and anything else go to the XML check', [scoreKindOf('a.xml'), scoreKindOf('a.musicxml'), scoreKindOf('a.txt')], ['xml', 'xml', 'xml'])
})

suite('checkScoreFile: pictures, PDFs and big files are refused up front', () => {
  const msg = (f: { name: string; type?: string; size: number }) => { try { return checkScoreFile(f) } catch (e) { return (e as Error).message } }
  assertEq('image', msg({ name: 'photo.png', type: 'image/png', size: 10 }), '这是图片 / PDF，请用左侧「OCR 图片识别」')
  assertEq('pdf', msg({ name: 'a.pdf', size: 10 }), '这是图片 / PDF，请用左侧「OCR 图片识别」')
  assertEq('a big image still gets the OCR hint, not the size message', msg({ name: 'a.jpg', size: 30 * 1024 * 1024 }), '这是图片 / PDF，请用左侧「OCR 图片识别」')
  assertEq('over 20 MB', msg({ name: 'a.xml', size: 20 * 1024 * 1024 + 1 }), '文件太大（上限 20 MB）')
  assertEq('exactly 20 MB is fine', msg({ name: 'a.xml', size: 20 * 1024 * 1024 }), 'xml')
})

suite('parseScoreXml: what is wrong with an XML file', () => {
  const msg = (text: string) => { try { parseScoreXml(text, parse); return 'ok' } catch (e) { return (e as Error).message } }
  assertEq('a valid score passes', msg(SINGLE), 'ok')
  assertEq('empty file (no root)', msg(''), NOT_XML)
  assertEq('not XML at all', msg('hello world'), NOT_XML)
  assertEq('a <parsererror> as a browser reports it', msg('<score-partwise><parsererror>boom</parsererror></score-partwise>'), NOT_XML)
  assertEq('a <parsererror> as the root (Firefox)', msg('<parsererror>boom</parsererror>'), NOT_XML)
  assertEq('timewise, though its measures hold <part>', msg('<score-timewise><measure number="1"><part id="P1"/></measure></score-timewise>'), '暂不支持 score-timewise 格式，请导出为 partwise 的 MusicXML')
  assertEq('well-formed XML with no part', msg('<html><body>hi</body></html>'), '文件里没有乐谱声部，支持 MusicXML / MXL / MIDI / ABC')
  assertEq('a partwise score without parts', msg('<score-partwise><part-list/></score-partwise>'), '文件里没有乐谱声部，支持 MusicXML / MXL / MIDI / ABC')
})

suite('mxlEntryName', () => {
  assertEq('declared rootfile wins', mxlEntryName(['META-INF/container.xml', 'a.xml', 'b.xml'], 'b.xml'), 'b.xml')
  assertEq('a rootfile the zip does not hold falls back', mxlEntryName(['META-INF/container.xml', 'a.xml'], 'gone.xml'), 'a.xml')
  assertEq('first .xml outside META-INF, any case', mxlEntryName(['META-INF/container.xml', 'Score.MusicXML'], null), 'Score.MusicXML')
  assertEq('no xml at all', mxlEntryName(['META-INF/container.xml', 'cover.png'], null), null)
})

suite('titles', () => {
  const doc = (head: string) => parse(partwise(head, '<part id="P1"/>'))
  assertEq('fileBaseName', fileBaseName('My  Tune.v2.xml'), 'My Tune.v2')
  assertEq('titleOrFileName: text wins, cleaned', titleOrFileName('  A\n Song ', 'x.abc'), 'A Song')
  assertEq('titleOrFileName: blank falls to the file name', titleOrFileName('  ', 'x.abc'), 'x')
  assertEq('titleOrFileName: missing', titleOrFileName(undefined, 'x.mid'), 'x')
  assertEq('movement-title wins', xmlTitle(doc('<work><work-title>W</work-title></work><movement-title>M</movement-title>'), 'f.xml'), 'M')
  assertEq('empty movement-title falls through to work-title', xmlTitle(doc('<work><work-title>W</work-title></work><movement-title></movement-title>'), 'f.xml'), 'W')
  assertEq('self-closing movement-title too', xmlTitle(doc('<work><work-title>W</work-title></work><movement-title/>'), 'f.xml'), 'W')
  assertEq('both empty: the file name', xmlTitle(doc('<work><work-title> </work-title></work><movement-title/>'), 'My Piece.mxl'), 'My Piece')
  assertEq('neither present: the file name', xmlTitle(doc(''), 'My Piece.xml'), 'My Piece')
  assertEq('a title with a line break is one line', xmlTitle(doc('<movement-title>Two\n   Lines</movement-title>'), 'f.xml'), 'Two Lines')
})

suite('parseXmlPart', () => {
  // P1 declares G major; P2 has no <key> of its own. The header (taken from the file's first
  // signature) says G, so P2's G4 must be the tonic "1", not a 5 counted from C.
  const TWO = partwise(
    '<part-list><score-part id="P1"><part-name>A</part-name></score-part><score-part id="P2"><part-name>B</part-name></score-part></part-list>',
    `<part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>${NOTE('G', 4)}${NOTE('A', 4)}${NOTE('B', 4)}</measure></part>
     <part id="P2"><measure number="1"><attributes><divisions>4</divisions></attributes>${NOTE('G', 4)}${NOTE('A', 4)}${NOTE('B', 4)}</measure></part>`,
  )
  const doc = parse(TWO)
  const p1 = parseXmlPart(doc, 0, 'two.xml', parse)
  const p2 = parseXmlPart(doc, 1, 'two.xml', parse)
  assertEq('P1 header', [p1.keyStr, p1.timeStr, p1.titleStr], ['G', '3/4', 'two'])
  assertEq('P2 takes the file header', [p2.keyStr, p2.timeStr], ['G', '3/4'])
  assertEq('P1 degrees', p1.measures[0].map((n) => n.degree), [1, 2, 3])
  assertEq('P2 degrees count from the header key', p2.measures[0].map((n) => n.degree), [1, 2, 3])

  const msg = (idx: number, d = doc) => { try { parseXmlPart(d, idx, 'f.xml', parse); return 'ok' } catch (e) { return (e as Error).message } }
  assertEq('a part with no measures', msg(0, parse(partwise('', '<part id="P1"/>'))), '这个声部没有可以转换的小节')
  assertEq('a part that is not there', msg(5), '这个声部没有可以转换的小节')
})

suite('loadScoreFile: MusicXML', async () => {
  const ok = await loadScoreFile(textFile(SINGLE, 'tune.xml'), parse, readMidi)
  assertEq('single part', [ok.titleStr, ok.keyStr, ok.timeStr, ok.partNames, ok.selectedPartIdx, ok.showPartSelector, ok.measures.length], ['Tune', 'C', '4/4', ['Flute'], 0, false, 1])
  assertEq('the loaded file rides along', ok.file.name, 'tune.xml')
  assertEq('.musicxml is read like .xml', (await loadScoreFile(textFile(SINGLE, 'tune.musicxml'), parse, readMidi)).measures.length, 1)

  assertEq('photo.png', await loadMessage(new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' })), '这是图片 / PDF，请用左侧「OCR 图片识别」')
  assertEq('a .xml that is not XML', await loadMessage(textFile('hello', 'a.xml')), NOT_XML)
  assertEq('an empty .xml', await loadMessage(textFile('', 'a.xml')), NOT_XML)
  assertEq('over 20 MB, without reading it', await loadMessage({ name: 'a.xml', size: 21 * 1024 * 1024 }), '文件太大（上限 20 MB）')
  assertEq('a part with no measures', await loadMessage(textFile(partwise('<part-list/>', '<part id="P1"/>'), 'a.xml')), '这个声部没有可以转换的小节')
  // listParts reads <step> without checking it exists: the parsers' own TypeError must not reach the user
  const broken = partwise('<part-list/>', '<part id="P1"><measure number="1"><note><pitch><octave>4</octave></pitch></note></measure></part>')
  assertEq('an unexpected parser failure still gets a Chinese message', await loadMessage(textFile(broken, 'a.xml')), '这个文件无法转换，请确认它是从乐谱软件导出的 MusicXML')
  assertEq('loadErrorMessage passes ours through', loadErrorMessage(new ScoreFileError('x')), 'x')
  assertEq('loadErrorMessage hides the rest', loadErrorMessage(new TypeError('Cannot read properties of undefined')), '这个文件无法转换，请换一个文件或重新导出')
})

suite('loadScoreFile: a multi-part file', async () => {
  const MULTI = partwise(
    '<part-list><score-part id="P1"><part-name>大提琴</part-name></score-part><score-part id="P2"><part-name>笛子</part-name></score-part></part-list>',
    `<part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes>${NOTE('C', 3)}</measure></part><part id="P2"><measure number="1"><attributes><divisions>4</divisions></attributes>${NOTE('C', 5)}</measure></part>`,
  )
  const r = await loadScoreFile(textFile(MULTI, 'orch.xml'), parse, readMidi)
  assertEq('melody scoring picks 笛子', [r.selectedPartIdx, r.partNames, r.showPartSelector, r.showAutoDetect], [1, ['大提琴', '笛子'], true, true])
  assertEq('the document is handed back for later part changes', r.xmlDoc !== null, true)
})

suite('loadScoreFile: .mxl', async () => {
  const container = (path: string) => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="${path}"/></rootfiles></container>`
  const zipOf = async (files: Record<string, string>) => {
    const z = new JSZip()
    for (const [k, v] of Object.entries(files)) z.file(k, v)
    return new File([await z.generateAsync({ type: 'arraybuffer' })], 'a.mxl')
  }
  const viaRoot = await loadScoreFile(await zipOf({ 'META-INF/container.xml': container('score/main.xml'), 'score/main.xml': SINGLE }), parse, readMidi)
  assertEq('declared rootfile', viaRoot.titleStr, 'Tune')
  const viaScan = await loadScoreFile(await zipOf({ 'META-INF/container.xml': container('gone.xml'), 'x.musicxml': SINGLE }), parse, readMidi)
  assertEq('first .xml when the rootfile is missing', viaScan.titleStr, 'Tune')
  const damaged = await loadScoreFile(await zipOf({ 'META-INF/container.xml': '\u0001 not xml', 'x.xml': SINGLE }), parse, readMidi)
  assertEq('a damaged container.xml is skipped', damaged.titleStr, 'Tune')

  assertEq('not a zip', await loadMessage(new File([new Uint8Array([1, 2, 3, 4, 5])], 'a.mxl')), '.mxl 文件损坏，请重新导出')
  assertEq('a zip with no XML', await loadMessage(await zipOf({ 'cover.png': 'x', 'META-INF/container.xml': container('nope.xml') })), '.mxl 文件损坏，请重新导出')
  assertEq('an .mxl whose XML is broken says so', await loadMessage(await zipOf({ 'x.xml': 'not xml' })), NOT_XML)
})

suite('loadScoreFile: MIDI', async () => {
  const midiFile = (setup: (m: InstanceType<typeof Midi>) => void) => {
    const m = new Midi()
    setup(m)
    return new File([m.toArray().slice().buffer as ArrayBuffer], 'tune.mid')
  }
  assertEq('not a MIDI file', await loadMessage(new File([new Uint8Array([1, 2, 3, 4])], 'a.mid')), 'MIDI 文件无法读取')
  assertEq('empty MIDI file', await loadMessage(new File([], 'a.mid')), 'MIDI 文件无法读取')
  assertEq('a MIDI with no notes', await loadMessage(midiFile((m) => { m.addTrack() })), NO_NOTES_MIDI)

  const named = await loadScoreFile(midiFile((m) => { m.header.name = '  Song\n One '; m.addTrack().addNote({ midi: 60, time: 0, duration: 0.5 }) }), parse, readMidi)
  assertEq('MIDI title is cleaned', named.titleStr, 'Song One')
  const unnamed = await loadScoreFile(midiFile((m) => { m.addTrack().addNote({ midi: 60, time: 0, duration: 0.5 }) }), parse, readMidi)
  assertEq('a MIDI without a name takes the file name', [unnamed.titleStr, unnamed.partNames, unnamed.showPartSelector, unnamed.xmlDoc], ['tune', ['自动'], false, null])
  const blank = await loadScoreFile(midiFile((m) => { m.header.name = '   '; m.addTrack().addNote({ midi: 60, time: 0, duration: 0.5 }) }), parse, readMidi)
  assertEq('a blank MIDI name takes the file name', blank.titleStr, 'tune')
})

suite('loadScoreFile: ABC', async () => {
  assertEq('no notes', await loadMessage(textFile('X:1\nT:Empty\nM:4/4\nK:C\n', 'a.abc')), 'ABC 文件里没有音符')
  const ok = await loadScoreFile(textFile('X:1\nT:Reel\nM:4/4\nL:1/4\nK:G\nGABc|\n', 'reel.abc'), parse, readMidi)
  assertEq('ABC loads', [ok.titleStr, ok.keyStr, ok.measures.length, ok.partNames], ['Reel', 'G', 1, ['—']])
  const noT = await loadScoreFile(textFile('X:1\nT:\nM:4/4\nL:1/4\nK:C\nCDEF|\n', 'my tune.abc'), parse, readMidi)
  assertEq('an empty T: line takes the file name', noT.titleStr, 'my tune')
})

suite('transposeOptions', () => {
  const values = (k: string) => transposeOptions(k).map((o) => o.value)
  assertEq('a listed key adds nothing', values('G'), TRANSPOSE_KEYS)
  assertEq('a listed key is labelled 原调 in place', transposeOptions('G').find((o) => o.value === 'G')?.label, 'G (原调)')
  assertEq('only the original key is labelled', transposeOptions('G').filter((o) => o.label.includes('原调')).length, 1)
  assertEq('C# is offered first', values('C#'), ['C#', ...TRANSPOSE_KEYS])
  assertEq('C# is labelled 原调', transposeOptions('C#')[0].label, 'C# (原调)')
  assertEq('Cb is offered first', values('Cb')[0], 'Cb')
  assertEq('the extra option is the only one labelled', transposeOptions('Cb').filter((o) => o.label.includes('原调')).length, 1)
})

// ───────────────────────────────────────────────────────────────

for (const s of sections) {
  console.log(`\n── ${s.name} ──`)
  await s.fn()
}
console.log(`\nResults: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
