# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Jianpu Converter — Claude Knowledge Base (English)

## Project Overview
React + TypeScript web app that converts MusicXML / MIDI / ABC into Chinese Numbered Musical Notation (Jianpu / 简谱) and OCR-extracts Jianpu / staff-notation from images and PDFs. Built for Chinese orchestra musicians who read Jianpu but not Western staff notation. Hosted on GitHub Pages, with an optional Cloudflare Worker proxy for the default OCR provider.

**Live:** https://huichiy.github.io/Music-Score-Converter/
**Repo:** https://github.com/huichiy/Music-Score-Converter/

**Stack:** React 18 · TypeScript · Vite 6 · Tailwind CSS v4 · Zustand · Radix UI · pdfjs-dist · @tonejs/midi · JSZip · Cloudflare Workers (OCR proxy).

## Local Dev
```bash
npm install
npm run dev        # vite dev server, prints URL (default :5173)
npm run build      # tsc -b && vite build, output in dist/
npm run preview    # serve the built bundle
npm run test       # run scripts/test-roundtrip.ts (Route B serialize/parse + renderer coverage, 46 assertions)
```

- `npm run test` runs via `tsx` (in devDependencies since 2026-07), so it works after a plain `npm install`.
- `node scripts/screenshots.mjs` regenerates the README/docs screenshots via Playwright — the dev server must already be running on port 7790 (`npm run dev -- --port 7790`).
- Imports use the `@/` alias → `src/` (defined in `vite.config.ts`); follow it in new files.
- Vite `base` is `/Music-Score-Converter/` in production builds (GitHub Pages subpath) and `/` in dev.

OCR keys: the app reads `VITE_OCR_WORKER_URL` at build time (the Cloudflare Worker URL). Users can also paste a personal API key in the "OCR 设置" modal (BYOK, stored in `localStorage` under `jianpu.ocr.config.v1`, see `OCR_CONFIG_KEY` in `src/lib/vision/types.ts`). Neither path embeds keys in the bundle.

---

## File Structure
```
Music-Score-Converter/
├── docs/JIANPU_FORMAT.md            — Route B text editor format spec
├── scripts/test-roundtrip.ts        — Route B round-trip tests (npm run test)
├── scripts/screenshots.mjs          — README screenshot capture (Playwright, dev server on :7790)
├── worker/                          — Optional Cloudflare Worker (OCR proxy)
│   ├── src/index.ts                 — OpenAI-shape → Gemini translator
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
│   │   ├── PdfPagePicker.tsx        — PDF thumbnail grid
│   │   └── …Sidebar / Toolbar / TransposeSelect / ExportButtons / PartSelector / ScoreOutput / FileUpload
│   ├── hooks/
│   │   ├── useFileHandler.ts        — File parsing + render orchestration
│   │   └── useOcr.ts                — OCR runner, delegates to vision adapter
│   ├── lib/
│   │   ├── parser.ts                — MusicXML parser, pitch conversion, transposition
│   │   ├── renderer.ts              — SVG layout engine
│   │   ├── editor.ts                — Route B serialize/parse + token positions
│   │   ├── pdfTools.ts              — Lazy pdfjs wrapper
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
├── tests/                           — Manual test fixtures: test_scale.mid, test_score.mxl
├── .github/workflows/deploy.yml     — Pages auto-deploy, injects VITE_OCR_WORKER_URL
├── index.html
├── package.json
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
): string
```
- `measures` — array of `MeasureArray` (note objects) or `{ _multiRest: N }` blocks
- `keyStr` — e.g. `"C"`, `"G"`, `"Bb"`
- `timeStr` — e.g. `"4/4"`, `"3/4"`, `"6/8"`
- `titleStr` — score title, SVG-escaped internally
- `containerWidth` — pass `mainContentRef.current.clientWidth`; pages with the sidebar visible should NOT pass `scoreOutputRef.current.clientWidth` (it's 0 before mount)
- `tempoStr` — BPM string e.g. `"120"`, empty string if no tempo
- `isDark` — overrides the runtime theme check; the text editor's preview pane uses this to keep colours consistent with the app theme

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
}
```

Measure arrays also carry these properties (see `MeasureArray` in `score.ts`):
```ts
measure._repeatStart: boolean
measure._repeatEnd: boolean
measure._direction: string      // e.g. "Fine", "D.C.", "D.S."
measure._dynamic: string        // e.g. "mf", "ff"
measure._wedge: 'cresc' | 'dim' | null
```

Articulations and grace notes are rendered by `src/lib/renderer.ts` (small text/circle/path above the note number) and round-tripped through Route B as `1[>]`, `1[2]`, etc. — see `docs/JIANPU_FORMAT.md`.

---

## Pitch Conversion (3 steps)
1. **Diatonic degree** — compare note step to tonic step using `stepMapDiatonic`
2. **Octave shift** — `Math.round((noteSemi - (baseTonicSemi + scaleDegrees[degree])) / 12)`
3. **Accidental** — compare intended semitone to actual semitone; mismatch → `#` or `b`

Always use `parseFloat()` for `alter` reads — MusicXML allows 0.5 quarter-tones.

---

## Key Rendering Rules

### Whole-measure rest
Strict check: `measure.length === 1 && measure[0].rest && measure[0].type === "whole"`
- Renders as repeated `0` symbols, one per beat: `0 0 0 0` in 4/4, `0 0 0` in 3/4
- Mixed-rest measures (partial rests) go through normal note rendering

### Multi-measure rest collapsing
`collapseRestRuns()` in `src/lib/renderer.ts` — collapses 2+ consecutive whole-measure rests into `{ _multiRest: N }` bracket block. Uses the same strict check above.

### Beat-boundary beaming
Pre-compute cumulative beat positions per measure. Only connect beaming underlines when adjacent notes are in the same beat group (`Math.floor(cumulative[j] / beatUnit)`).

### Extension dashes
`dashStep = (noteWidth - numXOffset) / (extraBeats + 1)` — evenly spaced, accounts for accidental offset.

### Octave dots
- Above: `octave === 1` → one dot, `octave === 2` → two dots
- Below: fixed baseline `currentY + 10`, `octave === -1` → one dot, `octave === -2` → two dots
- Chord notes: rows are 16px apart + **6px per octave dot** (above dots push the row down, below dots push the next row down) — without this the dots land on the neighbouring chord digit

### Repeat signs
- `_repeatStart`: thick + thin line + two dots, advances `currentX` by 12px. Record `measureStartX` **before** this block.
- `_repeatEnd`: two dots + thin + thick line, drawn after notes. Skip normal barline when `_repeatEnd` is true to avoid overlap.

### Tempo
Rendered as `Tempo: ${tempoStr}` at y=82. `paddingTop` is `100` when tempo present, `80` otherwise. Unicode music symbols (♩) not supported by Inter font — use plain text.

### Dynamic markings
Rendered at `measureStartX + 2`, `currentY + 22`, italic, font-size 12. `measureStartX` must be captured before `_repeatStart` moves `currentX`.

### SVG height
`totalHeight = currentY + 40` — extra padding for dynamic text at bottom.

### D.C. / D.S. direction text
Rendered at `currentX - 4`, `currentY - 20`, italic, text-anchor end, after closing barline.

---

## Transposition (src/lib/parser.ts)
```ts
function transposeNoteObjects(measures: Measure[], fromKeyStr: string, toKeyStr: string): Measure[]
```
- Returns original `measures` unchanged if `fromKeyStr === toKeyStr`
- For each note: recovers absolute semitone via `fromTonicSemi + octave*12 + scaleDegrees[degree-1] + accVal`
- Re-expresses in `toKey` using the same diatonic arithmetic as the main parser
- Enharmonic spelling follows toKey character (sharp keys → sharps, flat keys → flats)
- Handles chord notes, skips rests, passes through `{ _multiRest: N }` blocks
- All measure-level metadata (`_repeatStart`, `_repeatEnd`, `_direction`, `_dynamic`, `_wedge`) copied to new measure arrays
- Called by `TransposeSelect` via `useFileHandler.transpose()`; `originalMeasures` / `originalKeyStr` in the Zustand store hold the pre-transpose source

---

## Mid-piece Key Changes (src/lib/parser.ts)
Inside the measure loop, after reading `divisions`, check for new `<fifths>`:
```ts
const newFifthsNode = attributesNode.getElementsByTagName('fifths')[0]
if (newFifthsNode) {
  fifths = parseInt(newFifthsNode.textContent!)
  const newKey = keyMap[fifths.toString()] || 'C'
  keyStr = newKey                  // keyStr must be `let`, not `const`
  baseTonicStep = newKey[0]
  baseTonicAlter = newKey.includes('#') ? 1 : (newKey.includes('b') ? -1 : 0)
  baseTonicSemi = pitchToSemitones(baseTonicStep, baseTonicAlter, 4)
}
```

---

## MIDI Parsing (src/hooks/useFileHandler.ts)
- Chord deduplication: keep highest pitch per tick using `tickMap`
- Time signature validation: reject `beats === 1` or `beats > 12` or invalid `beatType`
- Density heuristic: if avg notes/measure < 1.5, fallback to 4/4
- Tempo: `Math.round(midi.header.tempos[0].bpm).toString()`
- Key: `midi.header.keySignatures[0].key`
- Rest padding: a single whole rest per measure, then `collapseRestRuns` may merge them in the renderer

---

## OCR System (src/lib/vision/)
Provider-agnostic adapter pattern. `VisionAdapter.transcribe(file, mode)` is the single contract; adapters live in `src/lib/vision/adapters/`.

Resolution order in `buildAdapter(config, env)`:
1. BYOK (config.provider !== 'auto' + config.apiKey) → call provider directly from browser
2. `provider: 'auto'` + `VITE_OCR_WORKER_URL` → Custom adapter pointing at the Worker
3. No worker URL + `VITE_GROQ_API_KEY` env → legacy Groq direct fallback for dev
4. Otherwise throw a friendly "未配置 OCR" error

**Keys never enter the bundle.** The Worker holds the production Gemini key as a Cloudflare secret; BYOK keys live in `localStorage` under `jianpu.ocr.config.v1`.

Anthropic browser-direct calls require the header `anthropic-dangerous-direct-browser-access: true` — already set in the Anthropic adapter.

---

## PDF Input (src/lib/pdfTools.ts + src/components/PdfPagePicker.tsx)
- `pdfjs-dist` is dynamically imported (lazy chunk ~280 KB + 1.2 MB worker) only when the user drops a PDF
- `loadPdf(file)` → `PDFDocumentProxy`
- `pageToFile(pdf, n, baseName, 2.0)` → `File('.png', image/png)` that drops into the existing OCR pipeline
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
- Mobile breakpoint: `@media (max-width: 600px)` — sidebar collapses to top panel; EditTextOverlay drawer becomes a fullscreen overlay
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
| `totalHeight = currentY + 40` | `+ 20` clips dynamic text at bottom |
| OCR keys never in the bundle | Either Worker proxy or `localStorage` BYOK; never `import.meta.env.VITE_*_KEY` for real keys |

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
- [x] Route B live preview + bidirectional cursor sync
- [x] Landing/tool layer split (LandingPage is intro-only; CTA enters tool)
- [x] Mobile responsive (sidebar collapse + EditTextOverlay drawer overlay)
- [x] Whole-rest cursor highlight in Route B (data-rest-m wrapper)
- [x] PDF input + page picker (lazy pdfjs-dist)
- [x] BYOK multi-provider OCR — Gemini / Anthropic / OpenAI / Groq / Custom (OpenAI-compatible)
- [x] Cloudflare Worker proxy — default OCR uses Gemini 2.5 Flash with the key off the bundle
- [x] Round-trip test suite (`npm run test`, 46 assertions)

### Pending
- [ ] Phase 3 OCR: box-select UI to extract one instrument from a 总谱 PDF
- [ ] Playback (Tone.js) — hear the score as it's converted
- [ ] Volta (跳房子) + Tuplets (三连音) + temp time signatures in Route B
- [ ] 笛子 ornaments — parse MusicXML `<ornaments>` + render symbols; Route B syntax extension: `1[tr]` 颤音, `1[~]` 波音, `1[又]` 叠音, `1[打]` 打音, `1[*]` 花舌
- [ ] Multi-voice rendering (long term — architectural change)
- [ ] Route C: OCR text → Jianpu parser → rendered SVG (close the loop so OCR result becomes a real score)
- [ ] MusicXML parser: extract `<ornaments>` / `<articulations>` so they survive import (currently dropped)

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
