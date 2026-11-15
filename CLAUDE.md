# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Jianpu Converter — Claude Knowledge Base (English)

## Project Overview
React + TypeScript web app that converts MusicXML / MIDI / ABC into Chinese Numbered Musical Notation (Jianpu / 简谱) and OCR-extracts Jianpu / staff-notation from images and PDFs. Built for Chinese orchestra musicians who read Jianpu but not Western staff notation. Hosted on GitHub Pages, with an optional Cloudflare Worker proxy for the default OCR provider.

**Live:** https://huichiy.github.io/Music-Score-Converter/
**Repo:** https://github.com/huichiy/Music-Score-Converter/

**Stack:** React 18 · TypeScript · Vite 6 · Tailwind CSS v4 · Zustand · Radix UI · pdfjs-dist · @tonejs/midi · Tone.js (lazy, playback) · JSZip · Cloudflare Workers (OCR proxy).

## Local Dev
```bash
npm install
npm run dev        # vite dev server, prints URL (default :5173)
npm run build      # tsc -b && vite build, output in dist/
npm run preview    # serve the built bundle
npm run test       # six tsx files in sequence, 701 assertions: test-roundtrip (216) · test-parser (38) · test-parser-fixes (116) · test-renderer-fixes (104) · test-playback-fixes (31) · test-ocr-fixes (196)
```

- `npm run test` runs via `tsx` (in devDependencies since 2026-07), so it works after a plain `npm install`. `scripts/test-parser.ts` parses inline MusicXML with `linkedom` (devDependency, tests only — never bundled).
- `node scripts/screenshots.mjs` regenerates the README/docs screenshots via Playwright — the dev server must already be running on port 7790 (`npm run dev -- --port 7790`).
- Imports use the `@/` alias → `src/` (defined in `vite.config.ts`); follow it in new files, with one caveat: **value** imports between files under `src/lib/` must be relative (`./parser`), because the tsx test runner doesn't resolve the alias for value imports. Type-only imports (`import type … from '@/types/score'`) are always fine.
- Vite `base` is `/Music-Score-Converter/` in production builds (GitHub Pages subpath) and `/` in dev.

OCR keys: the app reads `VITE_OCR_WORKER_URL` at build time (the Cloudflare Worker URL). Users can also paste a personal API key in the "OCR 设置" modal (BYOK, stored in `localStorage` under `jianpu.ocr.config.v1`, see `OCR_CONFIG_KEY` in `src/lib/vision/types.ts`). Neither path embeds keys in the bundle.

Local OCR dev: put `VITE_OCR_WORKER_URL=<worker url>` in `.env.local` (gitignored) and restart the dev server — otherwise the 默认 provider is disabled locally and OCR needs BYOK. The production worker URL can be recovered from the deployed Pages bundle if forgotten.

---

## File Structure
```
Music-Score-Converter/
├── docs/JIANPU_FORMAT.md            — Route B text editor format spec
├── scripts/test-roundtrip.ts        — Route B round-trip tests (npm run test)
├── scripts/test-parser.ts           — MusicXML parser tests via linkedom (npm run test, 2nd file)
├── scripts/test-parser-fixes.ts     — audit regressions: MusicXML voices/staves/_key/_timeSig, ABC, MIDI reader, pitch spelling
├── scripts/test-renderer-fixes.ts   — audit regressions: collapse exclusions, data-m / data-rest-m index spaces, beaming, slurs, escaping
├── scripts/test-playback-fixes.ts   — audit regressions: D.C./D.S./Fine, key/meter per measure, nearestNoteStart
├── scripts/test-ocr-fixes.ts        — audit regressions: response extractors, normalize/merge, Worker (fetch stubbed), blocked storage, cropper geometry
├── scripts/screenshots.mjs          — README screenshot capture (Playwright, dev server on :7790)
├── worker/                          — Optional Cloudflare Worker (OCR proxy)
│   ├── src/index.ts                 — OpenAI-shape → Gemini translator (origin 403, Flash-only allowlist, token clamp, body cap)
│   ├── wrangler.toml
│   └── README.md                    — Deploy steps
├── src/
│   ├── App.tsx                      — Two-layer landing/tool entry
│   ├── components/
│   │   ├── EditNotePopup.tsx        — Route A click-to-edit popup
│   │   ├── EditTextOverlay.tsx      — Route B full-screen text editor
│   │   ├── LandingPage.tsx          — Marketing/intro layer (no tool widgets)
│   │   ├── OcrSection.tsx           — OCR drop zone + open settings
│   │   ├── OcrSettings.tsx          — BYOK provider / model / key modal
│   │   ├── PdfPagePicker.tsx        — PDF thumbnail grid (page → ImageCropper)
│   │   ├── ImageCropper.tsx         — box-select crop modal (PDF page / image → cropped PNG)
│   │   ├── PlaybackBar.tsx          — transport strip (play/pause/stop, seek, speed)
│   │   ├── MeasuresPerLineSelect.tsx — 每行小节数 sidebar select (saves to localStorage)
│   │   └── …Sidebar / Toolbar / TransposeSelect / ExportButtons / PartSelector / ScoreOutput / FileUpload
│   ├── hooks/
│   │   ├── useFileHandler.ts        — File parsing + render orchestration
│   │   ├── useOcr.ts                — OCR runner, delegates to vision adapter
│   │   └── usePlayback.ts           — playback orchestration + rAF highlight/progress loop
│   ├── lib/
│   │   ├── parser.ts                — MusicXML parser, MIDI reader (midiToJianpu), pitch conversion, transposition
│   │   ├── renderer.ts              — SVG layout engine
│   │   ├── editor.ts                — Route B serialize/parse + token positions
│   │   ├── pdfTools.ts              — Lazy pdfjs wrapper + canvasToOcrFile (PNG, or JPEG when over 4.5 MB)
│   │   ├── cropTools.ts             — computeCropRect / fitDisplaySize / scaleRect (crop geometry, unit-tested)
│   │   ├── partMatch.ts             — "which part is mine": remembered-instrument matching + localStorage
│   │   ├── layoutPrefs.ts           — measures-per-line options, default (4) + localStorage load/save
│   │   ├── playback.ts              — pure scheduler: expandRepeats + buildPlaybackEvents (beats, unit-tested)
│   │   ├── tonePlayer.ts            — lazy Tone.js audio layer (only file importing tone)
│   │   ├── abcParser.ts             — ABC notation parser
│   │   ├── downloader.ts            — PNG/JPEG export
│   │   ├── utils.ts
│   │   └── vision/                  — Provider-agnostic OCR
│   │       ├── index.ts             — Adapter factory + localStorage persistence
│   │       ├── types.ts             — VisionAdapter + OcrConfig
│   │       ├── prompts.ts           — Shared system/user prompts
│   │       ├── utils.ts
│   │       └── adapters/{gemini,anthropic,openai,groq,custom,openaiCompat}.ts
│   ├── store/scoreStore.ts          — Zustand global state
│   └── types/score.ts               — NoteObject, MeasureArray, ChordNote, Articulation, GraceNote
├── js/                              — LEGACY pre-React vanilla app (tracked for history, NOT built or served — src/ is truth; js/config.js is gitignored)
├── tests/                           — Manual test fixtures: test_scale.mid, test_score.mxl, test_articulations.xml (notations-import verification)
├── .github/workflows/deploy.yml     — Pages auto-deploy, injects VITE_OCR_WORKER_URL
├── index.html
├── package.json
├── tsconfig.json                    — references app / node / scripts projects
├── tsconfig.scripts.json            — type-checks scripts/ (DOM lib + node types + @/ paths + src/vite-env.d.ts)
└── vite.config.ts
```

---

## Shared Constants (src/lib/parser.ts)
```ts
const scaleDegrees = [0, 2, 4, 5, 7, 9, 11]
const stepMapDiatonic = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
const keyMap = {
  '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
  '0':  'C',  '1':  'G',  '2':  'D',  '3':  'A',  '4':  'E',  '5':  'B',  '6': 'F#', '7': 'C#',
}
```

Session state lives in the Zustand store (`src/store/scoreStore.ts`) — no more module-level `state` object. Read via `useScoreStore((s) => s.foo)`, write via the matching setter.

---

## renderJianpuSVG Signature
```ts
function renderJianpuSVG(
  measures: Measure[],
  keyStr: string,
  timeStr: string,
  titleStr = "Untitled",
  containerWidth = 540,
  tempoStr = "",
  isDark?: boolean,
  measuresPerLine = 0,
): string
```
- `measures` — array of `MeasureArray` (note objects) or `{ _multiRest: N }` blocks
- `keyStr` — e.g. `"C"`, `"G"`, `"Bb"`
- `timeStr` — e.g. `"4/4"`, `"3/4"`, `"6/8"`
- `titleStr` — score title, SVG-escaped internally
- `containerWidth` — pass `mainContentRef.current.clientWidth`; pages with the sidebar visible should NOT pass `scoreOutputRef.current.clientWidth` (it's 0 before mount)
- `tempoStr` — BPM string e.g. `"120"`, empty string if no tempo
- `isDark` — overrides the runtime theme check; the text editor's preview pane uses this to keep colours consistent with the app theme
- `measuresPerLine` — `0` = auto (wrap by width, the original layout); `N` = fixed N per line, justified (see **Measures per line** below). App callers pass the store's `measuresPerLine`: `useFileHandler` routes every render through its `renderScore` helper, and `EditTextOverlay` passes it to the preview

---

## Note Object Structure
See `src/types/score.ts`.
```ts
interface NoteObject {
  degree: number          // 1–7 scale degree (0 for rest)
  octave: number          // -2 .. 2, relative to tonic register
  type: 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd'
  dot: boolean
  tie: boolean            // tie continuation; renders as "-"
  rest: boolean
  accidental: '#' | 'b' | ''
  slurStart: boolean      // start of slur curve above
  slurStop: boolean       // end of slur curve
  chordNotes?: ChordNote[]                              // double-stops stacked below the melody
  articulation?: 'accent' | 'staccato' | 'tenuto' | 'marcato' | 'fermata' | ''
  graceNote?: GraceNote | null                          // 倚音 attached to this note
  tuplet?: number                                       // tuplet group size (3 = triplet); Route B `~N`
}
```

Measure arrays also carry these properties (see `MeasureArray` in `score.ts`):
```ts
measure._repeatStart: boolean
measure._repeatEnd: boolean
measure._direction: string      // e.g. "Fine", "D.C.", "D.S."
measure._dynamic: string        // e.g. "mf", "ff"
measure._wedge: 'cresc' | 'dim' | null
measure._volta: number | undefined    // 跳房子 ending number; Route B `{N}`
measure._timeSig: string | undefined  // temp time signature from this measure on, e.g. '3/4'; Route B `@N/M`
measure._key: string | undefined      // mid-piece key change: degrees from this measure on are relative to this key, e.g. 'D'. No Route B syntax yet
```

`_key` contract: set only on the measure where the key actually changes (never repeated, never on measure 0 — the header key covers that). Producers: MusicXML `<fifths>`, ABC `K:` (field line or inline `[K:]`), MIDI key-signature events. Consumers: `transposeNoteObjects` (switches source key, shifts the label by the same interval), renderer (bold `1=X` label, +32px fixed width), playback (key resolved per measure), `isCollapsibleRest` (a `_key` rest never merges). `serializeToText` **drops** it — opening such a score in the text editor and applying re-reads every degree in the header key.

Articulations and grace notes are rendered by `src/lib/renderer.ts` (small text/circle/path above the note number) and round-tripped through Route B as `1[>]`, `1[2]`, etc. — see `docs/JIANPU_FORMAT.md`.

---

## Pitch Conversion (src/lib/parser.ts — the ONE copy)
- `pitchToJianpu(step, alter, octave, key)` — a **spelled** pitch (MusicXML, ABC): the letter decides the degree, so Bb in C is `b7` and A# is `#6`. Steps: diatonic degree from `stepMapDiatonic`; octave shift `Math.round((noteSemi - (tonicSemi + scaleDegrees[degree])) / 12)`; accidental from intended vs actual semitone.
- `semitoneToJianpu(semi, key)` — an **unspelled** semitone (MIDI, transposition): in-scale pitches are plain degrees by semitone distance (B in Gb is `4`, not `#3`; F in F# is `7`); only out-of-scale pitches fall back to a letter (flat names in flat keys, sharp names elsewhere).
- `jianpuToSemitone` / `noteToMidi` (= +12) / `tonicSemiOf` go the other way. Semitone space: C4 = 48.

Always use `parseFloat()` for `alter` reads — MusicXML allows 0.5 quarter-tones.

---

## Key Rendering Rules

### Whole-measure rest
Strict check `isWholeRestMeasure()` (renderer.ts): `measure.length === 1 && measure[0].rest && measure[0].type === "whole"`. MusicXML `<rest measure="yes">` is forced to `whole` whatever its duration says.
- Renders as repeated `0` symbols, one per beat: `0 0 0 0` in 4/4, `0 0 0` in 3/4
- Mixed-rest measures (partial rests) go through normal note rendering
- A lone whole rest shares the closing code with every other measure (barline, repeat sign, volta, direction, dynamic, hairpin) — it used to `continue` early and drop them. It has no `data-m` and does **not** advance `origIdx`; its `0`s sit in `<g class="jn-rest-group" data-rest-m="…">`

### Multi-measure rest collapsing
`collapseRestRuns()` in `src/lib/renderer.ts` — collapses 2+ consecutive whole-measure rests into `{ _multiRest: N }` bracket block. The predicate is the exported `isCollapsibleRest()`: the strict check above **minus any marked rest** — `_volta`, `_timeSig`, `_key`, `_repeatStart`, `_repeatEnd`, `_dynamic`, `_wedge`, `_direction` (the marking would vanish inside a `[N]` block). `editor.ts` (`computeOrigIdxMap`, `serializeToText`'s `[N]` auto-collapse) **imports** this predicate rather than copying it — a second copy is how the data-m index space drifted before.

**Two index spaces, don't mix them:**
- `data-m` = renderer `origIdx` (whole rests skip, a `[N]` block adds N). Anything that turns a clicked note's `data-m` into a `currentMeasures` index goes through `measureIdxFromOrigIdx()` (editor.ts) — Route A does. Playback events carry `origIdx` too.
- `data-rest-m` = index into the array the renderer was **given** (before collapsing); a collapsed run (and its `[N]` block group) is keyed by its first measure. `collapseRestRunsIndexed()` returns that mapping; the text editor's `restMeasureIdx` uses `restRunStart()` to match.

### Beat-boundary beaming
Pre-compute cumulative beat positions per measure. Only connect beaming underlines when adjacent notes are in the same beam group: `beamGroupLength()` = `4 / beatType` for simple meters, **1.5 (three eighths) for compound 6/8, 9/8, 12/8**. `beamGroupOf()` adds `1e-9` before flooring — tuplet sums are inexact (six sextuplet 16ths = 0.9999999999999999).

### Extension dashes
`dashStep = (noteWidth - numXOffset) / (extraBeats + 1)` — evenly spaced, accounts for accidental offset.

### Octave dots
- **One dot per octave, never capped.** Above: start `currentY - 18`, step −6 per dot. Below: start `currentY + 10`, step +6. Chord notes use the same rule from their own baselines (−14 / +6); grace notes too, at 5px spacing since the glyph is smaller.
- The cap used to be ±2 in all three places, which **silently drew the wrong pitch**: a 大提琴 / 革胡 / 大阮 part sits three octaves below the tonic routinely, and `octave: -3` rendered zero dots — indistinguishable from the tonic octave. Grace notes were worse: capped at one dot, so even ±2 was wrong. Don't reintroduce a cap.
- Chord notes: rows are 16px apart + **6px per octave dot** (`Math.max(0, cn.octave)` above / `Math.max(0, -cn.octave)` below) — without this the dots land on the neighbouring chord digit. The first row starts below the beam lines (`getBeamingLines × 4`); melody below-dots also start under the last beam line.
- `chordExtent()` mirrors that stepping: a line's deepest chord stack pushes the **next line** down (`lineChordExtra`) and the dynamic text below it.

### Repeat signs
- `_repeatStart`: thick + thin line + two dots, advances `currentX` by 12px. Record `measureStartX` **before** this block.
- `_repeatEnd`: two dots + thin + thick line, drawn after notes. Skip normal barline when `_repeatEnd` is true to avoid overlap.

### Tempo
Rendered as `Tempo: ${tempoStr}` at y=82. `paddingTop` is `100` when tempo present, `80` otherwise. Unicode music symbols (♩) not supported by Inter font — use plain text.

### Fonts and escaping
Every `<text>` uses `FONT_FAMILY` (Inter + system fallbacks): Inter is only guaranteed on the page, not inside the exported `<img>`, so a bare `font-family="Inter"` exported in serif. Every user-derived string in the SVG (title, key, time, tempo, `_key`, `_timeSig`, `_direction`, `_dynamic`) goes through `escapeSVG`.

### Dynamic markings
Rendered at `measureStartX + 2`, `currentY + 22`, italic, font-size 12. `measureStartX` must be captured before `_repeatStart` moves `currentX`.

### SVG height
`totalHeight = currentY + 40` — extra padding for dynamic text at bottom.

### D.C. / D.S. direction text
Rendered at `currentX - 4`, `currentY - 20`, italic, text-anchor end, after closing barline.

### Route B v3: volta / tuplet / temp time signature (renderer)
- **Volta `{N}`** — horizontal bracket at `currentY - 44` from `measureStartX` to measure end, wrapped in `<g class="jn-volta">`; hook + `N.` label only drawn when the previous measure's `_volta` differs (consecutive same-number measures join into one visual bracket; line wraps break it naturally).
- **Tuplet `~N`** — note durations (beam `cumulative` AND pixel widths) are multiplied by `tupletFactor(n)`: `2→3/2`, else `pow2floor(n)/n` (3→2/3, 5→4/5, 6→2/3, 7→4/7). Bracket + italic digit drawn above the group in `<g class="jn-tuplet">` at `currentY - 28`. Groups close after exactly N notes and never cross barlines.
- **Temp time sig `@N/M`** — `beatsPerMeasure` / `beamGroup` are `let` and update at the top of the measure loop from `_timeSig`; a bold `N/M` label is drawn before the measure (+24px width, added to `measureWidth` too). Affects beat grouping and whole-rest `0` count from that measure on.
- **Key change `_key`** — bold `1=X` label drawn before the time-sig label (+32px, `fixed` width in line planning).
- **Slurs** — stop is handled **before** start, so a note that ends one slur and opens the next (`<slur stop/><slur start/>`) draws both arcs; the serializer writes it the same way (`( 1 ( 2 ) 3 )` — note 2 closes the first slur and opens the second).

### Measures per line (`measuresPerLine > 0`)
- Requested by an orchestra tester ("五 bar 一行真的丑，求求 4 bar 一行"); Chinese orchestra parts are usually printed 4 per line, so **4 is the default** (`DEFAULT_MEASURES_PER_LINE` in `src/lib/layoutPrefs.ts`, remembered under `jianpu.measuresPerLine.v1`). Auto (`0`) keeps the old wrap-by-width output byte-for-byte; a test pins that.
- `planLines()` runs before the measure loop on the collapsed (`collapseRestRuns`) array, so a multi-rest block counts as one item. A line takes up to N items and **breaks early when the next one would overflow**: narrow screens get fewer per line instead of a shrunken score.
- Each line stretches its `flex` widths (notes, whole-rest, multi-rest block) by `(available - fixed) / flex` so the closing barline lands on `maxWidth`; `fixed` parts (time-sig label, repeat sign) don't stretch. A short **last** line reuses the previous line's stretch (a one-line score stays natural); a lone measure wider than the line overflows rather than squashing (stretch is never < 1).
- Beam underlines that **connect** to the next note span the stretched width; one that **ends** (a lone eighth, a group's last note) keeps its natural length via `naturalWidth`, otherwise it reads as beamed to its neighbour.

---

## Transposition (src/lib/parser.ts)
```ts
function transposeNoteObjects(measures: Measure[], fromKeyStr: string, toKeyStr: string): Measure[]
```
- Returns original `measures` unchanged if `fromKeyStr === toKeyStr`
- **Keeps absolute pitch** (same as before the audit): every note is `semitoneToJianpu(jianpuToSemitone(note, fromKey), toKey)` — the same sound rewritten under a new `1=`. C→Gb turns C F B into `#4,` `7,` `4`
- Enharmonic spelling: in-scale pitches by semitone distance; out-of-scale ones follow toKey character (flat keys → flats)
- A `_key` measure switches the source key; its transposed `_key` moves by the same interval as the whole piece (`shiftKey`, spelled like the TransposeSelect list, or as the target itself when it is that key)
- Handles chord notes, skips rests, passes through `{ _multiRest: N }` blocks
- All measure-level metadata (`_repeatStart`, `_repeatEnd`, `_direction`, `_dynamic`, `_wedge`, `_volta`, `_timeSig`, and the shifted `_key`) copied to new measure arrays; `tuplet` survives via the `{ ...note }` spread; `graceNote` is re-expressed through the same `reexpress` math as the main pitch (it must transpose, not pass through)
- Route A edits (`withNoteEdited` in editor.ts) copy **every** own `_` property of the edited measure, and `handleNoteConfirm` rebases `original*` on the edit — otherwise the next transpose (which starts from `originalMeasures`) would throw the edit away
- Called by `TransposeSelect` via `useFileHandler.transpose()`; `originalMeasures` / `originalKeyStr` in the Zustand store hold the pre-transpose source

---

## MusicXML Import (src/lib/parser.ts)
- **One voice only:** the lowest-numbered staff, and the part's first `<voice>` on it (or that measure's first voice when the part's first voice is absent). Merging a piano part's both hands and `<backup>` voices doubled bar lengths. `<cue>` notes are skipped.
- Children of each `<measure>` are walked **in document order**, so an `<attributes>` key/time change before the first note applies to this measure, one after a note applies to the next. A change emits `_key` / `_timeSig` only when it differs from what is in force.
- Note types MusicXML has but NoteObject doesn't fold: 64th+ → `32nd`, `breve`/`long` → `whole`.
- Every `<notations>` block of a note is read (Finale/MuseScore split slurs and articulations across several). A hairpin that opens and closes in one measure still draws there but doesn't leak into the next.
- Tempo: `parseMetronomeTempo` → **quarter notes per minute** (playback counts quarters): `half = 60` → 120, dotted quarter = 60 → 90.
- `.mxl`: the container's rootfile, else the first `.xml`/`.musicxml` outside `META-INF/` (case-insensitive). A file without `<part-list>` still renders.
- `<notations><articulations>` children map to `NoteObject.articulation`: `accent`→accent, `staccato`→staccato, `tenuto`→tenuto, `strong-accent`→marcato (first mapped child wins)
- `<notations><fermata>` (direct child, outside `<articulations>`) → `fermata`, only when no articulation was found
- `<grace>` notes: pitch converted via `parseChordNote` and held in `pendingGrace`, attached to the **next pitched note** (survives measure boundaries; consecutive graces keep only the first)
- `<time-modification><actual-notes>N</actual-notes>` → `NoteObject.tuplet = N` (rests included) — pairs with the Route B v3 tuplet renderer so imported triplets keep correct beat math
- `<barline><ending>` → `MeasureArray._volta`: `type="start"` opens (number `"1, 2"` → first int), `type="stop"`/`"discontinue"` closes; the closing measure is still tagged. Carried across measures via an `activeVolta` cursor.
- `<tie>`: an explicit `type="stop"` marks a tie continuation. A `type="start"` with no stop continues into the next note **only at the same semitone** (exporters omit stops). Before a different pitch it becomes a slur instead (`slurStart` on the first note, `slurStop` on the second), and a run of these merges into one slur, tracked by the `tieFrom` cursor. Rests never continue a tie.
- `<ornaments>` (trill/mordent/turn) are **not** imported — that's the 笛子 ornaments roadmap item

---

## Mid-piece Key Changes (src/lib/parser.ts)
`applyAttributes()` reads `<fifths>` per `<attributes>` block; a new key sets `keyStr` (must be `let`) and stamps `measure._key` (see the `_key` contract above), deferred to the next measure via `pendingKey` when notes already came first. Every later pitch goes through `pitchToJianpu(…, keyStr)`.

## ABC (src/lib/abcParser.ts)
- `K:` → key-signature fifths via mode offsets (`Ador` = G, `Am` = C, `Dmix` = G…); Jianpu counts from the major key sharing the signature. Body `K:` / `M:` / `L:` field lines and inline `[K:…]` fields apply mid-tune (key/meter from the next measure when the current one already has notes → `_key` / `_timeSig`).
- Ties `-` join only same-pitch notes; `|:` `:|` `::` set repeats; `[1` `[2` start a measure (voltas not tagged yet); chords `[CEG]` → top note + `chordNotes`; `(3` tuplets; `{g}` grace; `>` `<` broken rhythm; `/`, `//`, `/4` durations; unrepresentable lengths become tied pieces via `splitDuration`. `!…!` / `+…+` decorations and `"…"` chord symbols are skipped. Multi-voice: only the first `V:`. A second `X:` ends the tune.

---

## MIDI Parsing (`midiToJianpu` in src/lib/parser.ts; useFileHandler only calls it)
- Track: the pitched track with the most notes (percussion / channel 10 skipped). Chords: highest pitch per tick (`tickMap`)
- Time signature validation: reject `beats === 1` or `beats > 12` or invalid `beatType`; a valid signature always wins (the old density heuristic that forced 4/4 is **gone** — it overrode valid signatures of sparse files)
- Onsets snap to a 16th grid (32nd when the file really has odd-32nd onsets). Each note runs to the next onset unless a gap > `ppq/5` follows (then its own length + a rest), so bars add up
- The timeline is cut at barlines: a note crossing one continues as `tie` pieces; lengths split via `splitDuration`. A fully silent bar is one whole rest (`collapseRestRuns` may merge them)
- Pitch: `semitoneToJianpu`; later key-signature events → `_key` on the first measure at/after them
- Tempo: `Math.round(midi.header.tempos[0].bpm).toString()`; key: `keySignatures[0].key` (tonejs names the major key of the signature)

---

## OCR System (src/lib/vision/)
Provider-agnostic adapter pattern. `VisionAdapter.transcribe(file, mode)` is the single contract; adapters live in `src/lib/vision/adapters/`.

Resolution order in `buildAdapter(config, env)`:
1. BYOK (config.provider !== 'auto' + config.apiKey) → call provider directly from browser
2. `provider: 'auto'` + `VITE_OCR_WORKER_URL` → Custom adapter pointing at the Worker
3. No worker URL + `VITE_GROQ_API_KEY` env → legacy Groq direct fallback for dev
4. Otherwise throw a friendly "未配置 OCR" error

**Keys never enter the bundle.** The Worker holds the production Gemini key as a Cloudflare secret; BYOK keys live in `localStorage` under `jianpu.ocr.config.v1`.

Anthropic browser-direct calls require the header `anthropic-dangerous-direct-browser-access: true` — already set in the Anthropic adapter. Anthropic ids are `claude-sonnet-5-5` (default) / `claude-haiku-5-5`; `gemini-2.0-flash` is gone. `sanitizeOcrConfig` drops retired saved ids (claude-3-5-*, Pro on auto); an unknown saved provider falls back to the default. The Anthropic request sends **no `temperature`** (these models 400 on any non-default sampling value) and `max_tokens: 16000` (they think by default, against that cap).

**Unusable replies are errors, never results.** Every adapter reads its response through `extractGeminiText` / `extractAnthropicText` / `extractOpenAIText` (utils.ts): all text parts joined (Gemini thought parts dropped); empty, safety-blocked/refused and truncated (`MAX_TOKENS` / `max_tokens` / `length`) throw a Chinese message. The Worker's `geminiToText` does the same with the same wording.

**Runs and accumulation (useOcr.ts):** a module-level run token (`currentRun`) — a reply only lands if it is still the latest run AND its file is still selected; `resetOcr` orphans in-flight runs; uploads/drops are refused while analyzing. Results **accumulate** across crops via `mergeOcrResults` (body appended; header fields `prev` already has are dropped, missing ones folded into `prev`'s header). Re-running the same picture while the box still equals the last output replaces that contribution (`ocrMergeBase`). Accepted inputs: PNG / JPEG / WebP / GIF (`resolveOcrImageType`, extension fallback for an empty `type`; HEIC rejected).

**Worker (worker/src/index.ts):** `ALLOWED_ORIGINS` is a `[vars]` entry in `wrangler.toml` (not a secret) — `https://huichiy.github.io` + localhost 5173/7790. Any other Origin, or none, gets **403** before anything else, preflight included; unset or `*` means open (local `wrangler dev` only). Model forced to `ALLOWED_MODELS` (Flash only), `max_tokens` clamped to 8192, bodies over 15 MB → 413 (streamed count, not just Content-Length), requests without a PNG/JPEG/WebP/GIF image → 400, key sent as `x-goog-api-key` header. Changes only go live after `wrangler deploy`.

**Route C loop (OCR → rendered score):** the prompts in `prompts.ts` teach the model to emit exact Route B format (`Title:`/`Key:` headers, `1/` eighths, `1,` low octave, v3 `{N}` `~N` `@N/M`) so the result feeds `parseFromText` directly. `useOcr.runOcr` pipes every result through `normalizeOcrText` (fence-stripping, 全角→半角; on body lines only: look-alike `’ ′`→`'`, `－ — –`→`-`, `（）`→`()`, legacy `_`→`/` — header lines like `Title: my_song` are left alone) **before** it reaches the store — the text in the result box is exactly what will be parsed. `extractOcrError` routes `[错误：…]`/`[Error: …]` sentinels to `setOcrError` instead of the result box. The result textarea is editable; `OcrSection.handleUseAsScore` refuses to render when `parseFromText` yields 0 measures, and calls `loadFromText(text, { fresh: true })`: an OCR score must not inherit the loaded file's title/key/tempo, and the old file's parts/XML are cleared (else picking a part re-renders the old file). The text editor calls `loadFromText(text)` (fresh false: missing headers fall back to the loaded score's).

---

## Playback (src/lib/playback.ts + src/lib/tonePlayer.ts + src/hooks/usePlayback.ts)
Two layers, deliberately split so the audio backend is replaceable:

- **Pure scheduler** (`playback.ts`, unit-tested): `expandRepeats()` unrolls `|:` `:|` + `{N}` voltas into performance order (two passes; pass 1 takes `{1}`, pass 2 takes `{2}`; `_volta >= 3` never plays). **The `justJumped` flag is load-bearing** — without it the section's `|:` resets the pass counter on the jump back and playback loops forever. A `:|` without its own `|:` repeats from the end of the previous section (`A :| B :|` = A A B B). **D.C. / D.S.** (case-insensitive prefix of `_direction`, so MusicXML's "D.C. al Fine" counts): one jump per performance, to measure 0 or the nearest `Segno` word (start when none); after it repeats are not retaken, only each volta bracket's last ending plays, and `Fine` ends the piece (ignored on the way down). Coda / To Coda are not handled. Output carries original measure indices; a runaway guard caps expansion at 4× score length. `buildPlaybackEvents()` then emits `PlaybackEvent[]` with times in **beats** (quarter = 1), handling dots, tuplets, rests as silent time, ties (extend the still-sounding events, never re-attack), chords (same `startBeat`), multi-rests, temp time signatures, and grace notes (`GRACE_BEATS = 0.125`, borrowed from the front of the main note). Key (`_key`) and meter (`_timeSig`) are resolved **in score order** and looked up per measure index, so a repeat or D.C. back to earlier music uses the key/meter in force there. `nearestNoteStart()` picks, for a clicked note that sounds more than once, the occurrence closest to the current position.
- **Audio layer** (`tonePlayer.ts`): the ONLY file that imports `tone`, and it does so lazily (`await import('tone')`, same pattern as pdfjs in pdfTools) so the main bundle is unaffected. Events are scheduled in **Transport ticks**, which is what makes the speed slider (`Transport.bpm`) and seeking work without rebuilding the event list. `PolySynth(FMSynth)` so chords sound together. `Tone.start()` must run inside a user gesture (the play button).
- `positionBeats()` reports the **audible** position (`getTicksAtTime(Tone.immediate())`, not `transport.ticks`, which runs ~100 ms lookAhead early), holding a seek target until the jump is audible. `stop(letRing)`: the natural end skips `releaseAll()` so the last note keeps its release.
- **Orchestration** (`usePlayback.ts`): one `requestAnimationFrame` loop serves both the follow highlight and the progress bar. Auto-stops (`halt(true)`, letting the last note ring) and resets at the end. Changing scores calls `stop()` and reuses the existing player (deliberately — avoids AudioContext churn); only unmounting disposes it. Start races are guarded: one shared in-flight `createPlayer()` promise, a run counter bumped by every stop/score change (a superseded `play()` returns after its awaits), and a stopped player resumes from the slider position.

Times are in beats everywhere except inside the player: tempo belongs to playback, not to the music. Highlight uses `.jn-note-playing`, deliberately a separate class from the text editor's `jn-note-current` so the two features never fight over styling. There is no rest-measure highlight: rests emit no events, so nothing ever targets one (an earlier `data-rest-m` fallback was removed as unreachable — it also mixed index spaces: `data-rest-m` indexes the renderer's input array while events carry `origIdx`). Clicking a note seeks there only when `editModeA` is off, so edit mode keeps owning the click.

## My Part (src/lib/partMatch.ts + src/components/PartSelector.tsx)
Auto-detection can only guess ONE default — the melody — and that guess is wrong for everyone playing an inner or bass voice (大提琴, 中阮, 扬琴, 革胡). Rather than asking up front (most uploads are single-part, so a first-run question is pure friction), the app **learns from behaviour**: whatever part the user picks by hand is saved to `localStorage` under `jianpu.myPart.v1`, and `matchPartIndex()` selects it on every later score, ahead of melody scoring. Tiers: exact, then whole-word prefix, then any substring — otherwise a remembered `二胡 II` settles on `二胡 I`, and `Flute` picks `Alto Flute` over `Flute 2`. Generic names (`Part 2`, `Track 3`, `P1`, `声部`) are never remembered (`isGenericPartName`): they name a slot, not an instrument. No match returns -1 and the melody scoring stands. The selector then shows 「已记住你的声部：X」 with a 忘记 link that restores auto-detection.

## Box-Select Crop (src/components/ImageCropper.tsx + src/lib/cropTools.ts)
Generic, OCR-agnostic crop step so users can extract one instrument's row from a 总谱 before OCR. `ImageCropper` takes `source: HTMLCanvasElement | File` (PDF page rendered @2.0x, or an uploaded image), shows a draggable/resizable box (pure React pointer events, no library, dim-outside via `box-shadow`), and on confirm maps the display selection to full-resolution pixels via `computeCropRect` (the only logic-bearing piece, unit-tested in test-roundtrip.ts), crops with `drawImage`, and hands back a `File` via `canvasToOcrFile` (PNG, or JPEG on white when the PNG passes 4.5 MB, so it clears the 5 MB image limit). The preview is sized to the measured container (`fitDisplaySize`; a fixed 640px clipped on phones) and the box rescales with it (`scaleRect`). Two entry points: PdfPagePicker (clicking a page opens the cropper; 整页 button = whole page) and OcrSection (optional 框选区域 button for images; not shown for PDFs, which route through the picker). The cropper renders as a **sibling** of PdfPagePicker's `onClick={onCancel}` backdrop (via fragment), not a child, so its backdrop click doesn't bubble up and close the picker. Single-box, iterate: the editable OCR result box accumulates multiple crops.

## PDF Input (src/lib/pdfTools.ts + src/components/PdfPagePicker.tsx)
- `pdfjs-dist` is dynamically imported (lazy chunk ~280 KB + 1.2 MB worker) only when the user drops a PDF
- `loadPdf(file)` → `PDFDocumentProxy`
- `pageToFile(pdf, n, baseName, 2.0)` → `File` (via `canvasToOcrFile`) that drops into the existing OCR pipeline
- PDFs over 20 MB are rejected at OcrSection before the picker opens

---

## Export System
- **PNG/JPEG**: 2× canvas pipeline via `document.fonts.ready`
- **TXT**: removed (output too messy)
- **PDF**: removed (Chrome security blocks canvas print from JS — input PDFs go through OCR instead)

---

## UI / DOM Rules
- Always pass `mainContentRef.current.clientWidth` to `renderJianpuSVG` — `scoreOutputRef.current.clientWidth` is 0 before mount
- Read state via `useScoreStore(s => s.foo)`; never `window.*` globals
- File size guards: 20 MB for source files; 5 MB for direct images; 20 MB for PDFs

---

## CSS / Theme
- Light + dark themes driven by `document.documentElement.getAttribute('data-theme')`; CSS variables defined in `src/index.css`
- Theme toggle in Toolbar (tool layer) and LandingPage top bar
- Mobile-first CSS: base rules are the narrow-screen layout; `@media (min-width: 640px)` scales up to desktop (sidebar becomes a fixed 256px column). There is no `max-width` mobile query — put narrow-screen styles in the base and undo them at 640px (see `.app-sidebar` and `.playback-clock`)
- SVG scaling: `.score-output svg { max-width: 100%; height: auto; display: block; }`

---

## Architecture Rules (never violate)
| Rule | Reason |
|---|---|
| `parseFloat()` for all `alter` reads | MusicXML allows 0.5 quarter-tones |
| `mainContentRef.current.clientWidth` to renderer | `scoreOutputRef` is 0 before mount |
| Read/write state through Zustand store | Never use `window.*` globals or module-level mutable state |
| Bracket modifier check before multi-rest in `parseFromText` | Otherwise grace notes `1[2]` get eaten by the `[N]` multi-rest regex |
| `stripRestMeasures` was removed (dead code) | Was never called; would break multi-rest bracket collapsing |
| Never re-add TXT/PDF *export* | TXT output was too messy; PDF export is Chrome-blocked. PDF *input* (via OCR) is fine. |
| Never override valid 2/4, 3/4, 6/8 | Past regression bug — only reject beats===1 or beats>12 |
| `measureStartX` captured before `_repeatStart` | `_repeatStart` advances `currentX` by 12px |
| Skip normal barline when `_repeatEnd` is true | Prevents double barline + repeat sign overlap |
| `keyStr` must be `let` in parseXMLToNoteObjects | Needs to update on mid-piece key changes |
| A tie only continues into a note of the same pitch; otherwise it becomes a slur | Noteflight exports phrase marks drawn with the tie tool as a dangling `<tie type="start"/>` before a different pitch. The old rule (any note after a tie start is a tie) drew those notes as `-` and lost their pitch everywhere: renderer, text editor and playback. A tester's score lost 14 notes this way (issue #1) |
| Renderer and serializer close a slur **before** opening one | A note can end one slur and start the next (MusicXML `<slur stop/><slur start/>`). Handling start first overwrote the open arc's origin: the first arc vanished and the second was drawn from nowhere. The tie→slur conversion still extends one slur across consecutive pitch-changing ties instead of chaining |
| `totalHeight = currentY + 40` | `+ 20` clips dynamic text at bottom |
| OCR keys never in the bundle | Either Worker proxy or `localStorage` BYOK; never `import.meta.env.VITE_*_KEY` for real keys |
| OCR prompts must emit Route B format, verbatim | The result is fed straight into `parseFromText`; prompt syntax drift silently corrupts durations/octaves. Contract tests in `scripts/test-roundtrip.ts` pin the format — keep prompts, `docs/JIANPU_FORMAT.md`, and those tests in lockstep |
| Never offer Gemini Pro on the `auto` (Worker) provider | The shared Worker key is free-tier — no Pro quota, instant 429. Pro lives only under BYOK `gemini`. `sanitizeOcrConfig` also drops stale saved model ids on load |
| OCR adapters send `max_tokens` 8192 (Anthropic: 16000) | Gemini 2.5 Flash counts THINKING tokens against `maxOutputTokens` — 2048 truncated a 16-measure score to 3 measures; Claude 5.5 models think by default too. The Worker clamps to 8192 (`MAX_OUTPUT_TOKENS`), so raising the client above that needs a Worker change + redeploy |
| No `temperature` / `top_p` / `top_k` on Anthropic requests | Claude Sonnet / Haiku 5.5 reject any non-default sampling value with a 400 — `temperature: 0` silently broke every BYOK Claude call when the default model moved to `claude-sonnet-5-5` |
| `normalizeOcrText` runs before the OCR result enters the store | The result box must show exactly what will be parsed; never normalize at render time |
| Pitch math, `tupletFactor`, `computeOrigIdxMap`, `durationBeats`, `isCollapsibleRest` have exactly ONE copy | Pitch math lives in parser.ts (`pitchToJianpu` / `semitoneToJianpu` / `jianpuToSemitone`) and is used by MusicXML, ABC, MIDI, transposition and playback; editor.ts imports `isCollapsibleRest` from renderer.ts. A second copy drifts — see the `collapseRestRuns` lesson above |
| Every `localStorage` access — including a `typeof localStorage` guard — sits inside `try` | With storage blocked (Chrome "block all cookies", some in-app browsers) the global getter itself throws; prefs are read at store init, so one escaped throw white-screens the app. BYOK config falls back to an in-memory copy for the session |
| Worker: allowed Origins only, Flash only, never Pro | The key is shared and free-tier; an unchecked `model` was also interpolated into the upstream URL. The Origin check stops other websites, not scripts — the README's Cloudflare rate-limit rule is the real cap |
| Playback times are in beats; only `tonePlayer` knows seconds/BPM | Lets the speed slider change `Transport.bpm` without re-deriving the music, and keeps the scheduler unit-testable without tempo |
| `expandRepeats` must keep the `justJumped` flag | Without it `|:` resets the pass counter on the jump back → infinite loop |
| Playback accumulates written durations; it never pads a short measure to the bar | Padding would fill a dropped/misread note with phantom silence — the exact error playback exists to expose. An under-filled measure just compresses |
| **Value** imports inside `src/lib/` must be relative (`./parser`), not `@/lib/parser` | The tsx test runner doesn't resolve Vite's alias for value imports, so `@/lib/*` breaks `npm run test`. Type-only `@/types/score` imports are fine (erased). Precedent: `src/lib/vision/index.ts` |

---

## Doc Maintenance Policy

This file is **load-bearing**: future Claude sessions reload it cold and use it to understand the project. README.md is user-facing.

**When to update what** (do this in the same commit as the feature, not after):

| Change | Update CLAUDE.md? | Update README? |
|---|---|---|
| New file/component | ✓ project structure section | ✓ if user-visible |
| New data field on `NoteObject` / `MeasureArray` | ✓ types section | — |
| New roadmap-level feature shipped | ✓ roadmap "shipped" list | ✓ features table + roadmap |
| Architectural rule learned the hard way | ✓ architecture rules table | — |
| New dependency added | ✓ stack line | ✓ tech stack table |
| Bug fix, refactor inside a file, small tweak | — | — |

If a section of CLAUDE.md ever contradicts the actual code, **fix the doc, not the code** (the doc is a snapshot, the code is truth).

---

## Commit Convention
```
type(scope): description
```
Types: `feat`, `fix`, `refactor`, `docs`, `style`
Scopes: `renderer`, `parser`, `app`, `downloader`, `ui`

---

## What's Next (Roadmap)

### Shipped
- [x] Chord stacking within melody line (double stops)
- [x] Slur curves (连线)
- [x] Ko-fi donation button
- [x] Hairpin dynamics (crescendo/decrescendo)
- [x] MIDI mid-file key change tracking
- [x] ABC Notation (.abc) input support
- [x] 转调 (Transposition) — dropdown selector
- [x] OCR: 简谱 / 五线谱 image → Jianpu text (Beta)
- [x] Route A click-to-edit popup
- [x] Route B text editor (toolbar `≡`)
- [x] Route B format v2 — 番茄式 syntax (`1/` `1.` `1-`), dynamics `&mf`, hairpins `<>!`, repeats `|: :|`, Fine/D.C./D.S., slurs `()`, articulations `1[>]`, grace notes `1[2]` — all round-trip
- [x] Route B format v2.1 — chords/double stops `5:3`, 32nd notes `1///`, cross-barline ties (measure-start `-` per beat), rest extension `0 - - -`
- [x] Route B format v3 — volta `{N}` 跳房子, tuplets `~N` 连音 (duration-corrected beaming), temp time signatures `@N/M` — all round-trip + render
- [x] Route B live preview + bidirectional cursor sync
- [x] Landing/tool layer split (LandingPage is intro-only; CTA enters tool)
- [x] Mobile responsive (sidebar collapse + EditTextOverlay drawer overlay)
- [x] Whole-rest cursor highlight in Route B (data-rest-m wrapper)
- [x] PDF input + page picker (lazy pdfjs-dist)
- [x] BYOK multi-provider OCR — Gemini / Anthropic / OpenAI / Groq / Custom (OpenAI-compatible)
- [x] Cloudflare Worker proxy — default OCR uses Gemini 2.5 Flash with the key off the bundle
- [x] Round-trip test suite (`npm run test`, 701 assertions across six files)
- [x] Audit fixes (2026-11, ~60 bugs): MusicXML voices/staves/cue, `_key` key changes end to end, `_timeSig` from MusicXML/ABC, ABC syntax (modes, ties, chords, tuplets, broken rhythm), MIDI reader rewrite, D.C./D.S./Fine playback, locked-down Worker, OCR result accumulation + honest errors, blocked-storage safety
- [x] Playback (Tone.js) — full repeat/volta expansion, follow highlight, pause/seek/click-a-note/speed slider
- [x] MusicXML import: `<articulations>` / fermata / grace notes (倚音) / `<time-modification>` tuplets — plus graceNote transposition fix
- [x] MusicXML import: `<ending>` (跳房子/volta) → `_volta`
- [x] Route C: OCR → Route B text → rendered SVG loop — prompts emit exact Route B format (incl. v3), `normalizeOcrText`, editable result box, error sentinels, empty-parse guard

- [x] Phase 3 OCR: box-select crop — extract one instrument's row from a 总谱 PDF/image before OCR (single-box, iterate)
- [x] Orchestra pilot feedback (2026-10): MusicXML pitch-changing ties → slurs (#1), measures-per-line setting with justified lines, default 4 (#2), upload-area export hint (#3)

### Pending
- [ ] 笛子 ornaments — parse MusicXML `<ornaments>` + render symbols; Route B syntax extension: `1[tr]` 颤音, `1[~]` 波音, `1[又]` 叠音, `1[打]` 打音, `1[*]` 花舌
- [ ] Multi-voice rendering (long term — architectural change)

---

## Market & Strategy

### Positioning
This is a **portfolio project**, not a revenue target. Its value is demonstrating the ability to independently ship a complete, polished product with domain depth.

### Google Trends (as of 2026-04)
- Keywords "简谱转换" and "musicxml to jianpu" show **near-zero global search volume** over 20 years
- Only 4 non-zero data points across 267 months
- Interpretation: demand exists but is too niche for Google Trends to capture; users may search via Baidu or not know such tools exist

### Competitive Landscape
| Project | Stars | Type | Weakness vs us |
|---|---|---|---|
| ssb22/jianpu-ly | 107 | Python CLI + Lilypond | High barrier — requires Lilypond |
| felixhao28/react-jianpu | 80 | React component | Render only — no conversion |
| lzh9102/musicxml_to_jianpu | 49 | Python CLI | Experimental, limited features |
| OrpheusNet | 23 | Python OCR | Nearly dormant |
| MuseScore jianpu plugins | — | QML plugin | Low activity, version-locked |

**Our differentiator:** Only modern web-based converter with zero install, full MusicXML support, and polished UI.

### Key Decisions
- Do not pursue direct monetization — market is too small
- Ko-fi donations are fine as passive income ($0–50/mo expected)
- Focus on community sharing (Reddit, HN, Chinese orchestra groups) to collect real user feedback
- OCR is now shipped — default uses Gemini 2.5 Flash via a Cloudflare Worker proxy (free tier covers ~1500 req/day), with BYOK paths to upgrade to Claude / GPT-4o / Pro models without leaking our key
- Phase 3 OCR (box-select on 总谱 PDF) is the highest-leverage next OCR feature — it's the original "give me just the 笛子 part" workflow the user actually wants
