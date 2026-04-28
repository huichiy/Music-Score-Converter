# Jianpu Converter — Claude Knowledge Base (English)

## Project Overview
A client-side web app converting MusicXML/MIDI files into Chinese Numbered Musical Notation (Jianpu / 简谱). Built for Chinese orchestra musicians who read Jianpu but not Western staff notation. Hosted on GitHub Pages. Zero dependencies on backend or build tools.

**Live:** https://huichiy.github.io/Music-Score-Converter/
**Repo:** https://github.com/huichiy/Music-Score-Converter/

## Local Dev
Open index.html directly in browser — no build step, no server needed.

---

## File Structure
```
Music-Score-Converter/
├── index.html        — All markup + CSS
└── js/
    ├── parser.js     — Pitch conversion, shared globals, parseXMLToNoteObjects
    ├── renderer.js   — SVG rendering, collapseRestRuns, renderJianpuSVG
    ├── downloader.js — PNG/JPEG export only
    └── app.js        — UI, MIDI parsing, event handlers
```

**Script load order (critical):** parser.js → renderer.js → downloader.js → app.js

---

## Shared Globals (parser.js)
```js
const scaleDegrees = [0, 2, 4, 5, 7, 9, 11];
const stepMapDiatonic = { 'C': 0, 'D': 1, 'E': 2, 'F': 3, 'G': 4, 'A': 5, 'B': 6 };
const keyMap = { "-7":"Cb","-6":"Gb","-5":"Db","-4":"Ab","-3":"Eb","-2":"Bb","-1":"F",
                 "0":"C","1":"G","2":"D","3":"A","4":"E","5":"B","6":"F#","7":"C#" };
const state = { lastMidiRender: null };
```

---

## renderJianpuSVG Signature
```js
function renderJianpuSVG(measures, keyStr, timeStr, titleStr = "Untitled", containerWidth = 540, tempoStr = "")
```
- `measures` — array of measure arrays (note objects) or `{ _multiRest: N }` blocks
- `keyStr` — e.g. `"C"`, `"G"`, `"Bb"`
- `timeStr` — e.g. `"4/4"`, `"3/4"`, `"6/8"`
- `titleStr` — score title, SVG-escaped internally
- `containerWidth` — pass `mainContent.clientWidth` (NOT `output.clientWidth` — it's 0 when hidden; `mainContent` is the always-visible `<main>` panel)
- `tempoStr` — BPM string e.g. `"120"`, empty string if no tempo

---

## Note Object Structure
```js
{
  degree: 1–7,         // scale degree (0 for rest)
  octave: -2 to 2,     // octave shift relative to tonic register
  type: "whole"|"half"|"quarter"|"eighth"|"16th"|"32nd",
  dot: boolean,
  tie: boolean,        // true = this note is a tie continuation, renders as "-"
  rest: boolean,
  accidental: "#"|"b"|"",
  slurStart: boolean,      // true = start of slur curve above
  slurStop: boolean,       // true = end of slur curve
  chordNotes: [            // optional — chord/double-stop notes stacked below
    { degree, octave, accidental }
  ]
}
```

Measure arrays also carry these properties:
```js
measureNotes._repeatStart = boolean;
measureNotes._repeatEnd = boolean;
measureNotes._direction = string;   // e.g. "D.C. al Fine", ""
measureNotes._dynamic = string;     // e.g. "mf", "ff", ""
measureNotes._wedge = string|null;  // 'cresc' | 'dim' | null — active hairpin for this measure
```

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
`collapseRestRuns()` in renderer.js — collapses 2+ consecutive whole-measure rests into `{ _multiRest: N }` bracket block. Uses the same strict check above.

### Beat-boundary beaming
Pre-compute cumulative beat positions per measure. Only connect beaming underlines when adjacent notes are in the same beat group (`Math.floor(cumulative[j] / beatUnit)`).

### Extension dashes
`dashStep = (noteWidth - numXOffset) / (extraBeats + 1)` — evenly spaced, accounts for accidental offset.

### Octave dots
- Above: `octave === 1` → one dot, `octave === 2` → two dots
- Below: fixed baseline `currentY + 10`, `octave === -1` → one dot, `octave === -2` → two dots

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

## Mid-piece Key Changes (parser.js)
Inside the measure loop, after reading `divisions`, check for new `<fifths>`:
```js
const newFifthsNode = attributesNode.getElementsByTagName("fifths")[0];
if (newFifthsNode) {
    fifths = parseInt(newFifthsNode.textContent);
    const newKey = keyMap[fifths.toString()] || "C";
    keyStr = newKey;               // keyStr must be `let`, not `const`
    baseTonicStep = newKey[0];
    baseTonicAlter = newKey.includes('#') ? 1 : (newKey.includes('b') ? -1 : 0);
    baseTonicSemi = pitchToSemitones(baseTonicStep, baseTonicAlter, 4);
}
```

---

## MIDI Parsing (app.js)
- Chord deduplication: keep highest pitch per tick using `tickMap`
- Time signature validation: reject `beats === 1` or `beats > 12` or invalid `beatType`
- Density heuristic: if avg notes/measure < 1.5, fallback to 4/4
- Tempo: `Math.round(midi.header.tempos[0].bpm).toString()`
- Key: `midi.header.keySignatures[0].key`
- Rest padding: push `{ degree: 0, octave: 0, type: "whole", dot: false, tie: false, rest: true, accidental: '' }`

---

## Export System
- **PNG/JPEG**: 2× canvas pipeline via `document.fonts.ready`
- **TXT**: removed (output too messy)
- **PDF**: removed (Chrome security blocks canvas print from JS)

---

## UI / DOM Rules
- Always use `getElementById('partSelectorContainer')` — never `.parentElement`
- Always pass `mainContent.clientWidth` to `renderJianpuSVG` — `output.clientWidth` is 0 when hidden
- `state.*` for all session data — never `window.*`
- File size guard: reject files > 20MB before parsing

---

## CSS / Theme
- Light (竹简): `--bg: #EFE5D2`, `--text: #1C0F06`, `--sidebar: #E4D4BC`, `--accent: #B01C1C`
- Dark (墨夜): `--bg: #100E08`, `--text: #E8D4A0`, `--sidebar: #140F08`, `--accent: #DC2626`
- Layout: sidebar (`<aside>`) + main content (`<main id="mainContent">`) — sidebar holds upload, options, export
- SVG color driven by `document.documentElement.getAttribute('data-theme')`
- Mobile breakpoint: `@media (max-width: 600px)` — sidebar collapses to top panel
- SVG scaling: `.output-zone svg { max-width: 100%; height: auto; display: block; }`

---

## Architecture Rules (never violate)
| Rule | Reason |
|---|---|
| `parseFloat()` for all `alter` reads | MusicXML allows 0.5 quarter-tones |
| `mainContent.clientWidth` to renderer | `output.clientWidth = 0` when hidden; `mainContent` is always visible sidebar-main layout |
| `getElementById('partSelectorContainer')` | `.parentElement` breaks on DOM restructure |
| `state.*` for session data | Never `window.*` globals |
| `parser.js` loads first | Declares all shared globals |
| `stripRestMeasures` was removed (dead code) | Was never called; would break multi-rest bracket collapsing |
| Never re-add TXT export | Deliberate removal — output too messy |
| Never re-add PDF export | Chrome security blocks canvas print from JS |
| Never override valid 2/4, 3/4, 6/8 | Past regression bug — only reject beats===1 or beats>12 |
| `measureStartX` captured before `_repeatStart` | `_repeatStart` advances `currentX` by 12px |
| Skip normal barline when `_repeatEnd` is true | Prevents double barline + repeat sign overlap |
| `keyStr` must be `let` in parseXMLToNoteObjects | Needs to update on mid-piece key changes |
| `totalHeight = currentY + 40` | `+ 20` clips dynamic text at bottom |

---

## Commit Convention
```
type(scope): description
```
Types: `feat`, `fix`, `refactor`, `docs`, `style`
Scopes: `renderer`, `parser`, `app`, `downloader`, `ui`

---

## What's Next (Roadmap)
- [x] Chord stacking within melody line (double stops)
- [x] Slur curves (连线)
- [x] Ko-fi donation button
- [x] Hairpin dynamics (crescendo/decrescendo)
- [x] MIDI mid-file key change tracking
- [ ] Multi-voice rendering (long term)
- [x] ABC Notation (.abc) input support
- [x] OCR：简谱图片 → 简谱文字转录（Groq Llama 4 Vision，免费，Beta）
- [x] OCR：五线谱图片 → 简谱文字（Groq Llama 4 Vision，免费，Beta）
- [ ] OCR 升级：AI 文字输出 → Jianpu parser → 渲染成简谱 SVG（Route C）

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
- OCR is the strongest potential differentiator long-term but requires backend + AI model — defer until user signals justify the investment
