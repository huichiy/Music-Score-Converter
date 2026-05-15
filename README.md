# 简谱 Jianpu Converter

> A client-side web application that converts MusicXML, MIDI, and ABC notation files into Chinese Numbered Musical Notation (Jianpu / 简谱).
> Built by a Chinese orchestra flute player, for Chinese orchestra musicians.

**[🎼 Try the Live Demo](https://huichiy.github.io/Music-Score-Converter/)**

![Demo Screenshot](docs/demo.png)

---

## Motivation

Musicians in Chinese orchestras — especially melody instrument players such as 笛子、二胡、高胡 — primarily read Jianpu (简谱).

However, most sheet music available online is distributed in Western staff notation.

Manual transnotation:

- is slow
- introduces mistakes
- interrupts rehearsal workflow

As a flute player in a Chinese orchestra, I built this tool to automate that conversion so musicians can spend less time copying notes and more time playing.

---

## Features

| Feature | Details |
|---|---|
| **MusicXML, MIDI & ABC Support** | Accepts `.xml`, `.mxl`, `.mid`, `.midi`, `.abc` |
| **Auto Melody Detection** | Scores multi-part files by instrument name keywords, note density, and average pitch. Recognises Chinese instrument names (笛, 二胡, 高胡, 琵琶) and penalizes accompaniment parts (大阮, 低音, 扬琴) |
| **Accurate Music Theory** | Handles key signatures, mid-piece key changes, accidentals, flat/sharp contexts, ties across measures, dotted notes, and all standard rhythmic durations |
| **Authentic Jianpu Output** | Renders proper 延音线 (extension dashes), 减时线 (beaming underlines with beat-boundary grouping), and octave dots above/below numbers |
| **Tempo & Dynamic Markings** | Extracts BPM from MusicXML `<metronome>` and MIDI header; renders fixed dynamics (`p`, `f`, `mf`, `ff`, `sfz`, etc.) and hairpin dynamics (cresc/dim) |
| **Repeat & Direction Markings** | Renders `\|:` and `:\|` repeat barlines; extracts and displays D.C., D.S., Fine, and al Coda direction text |
| **Slurs & Chord Stacks** | Curved slur lines above connected notes; double-stop chord notes stacked under the melody |
| **Articulations & Grace Notes** | Renders accent, staccato, tenuto, marcato, fermata, and grace notes (倚音) above the corresponding number |
| **Transposition** | Dropdown selector transposes the score to any target key — essential for 笛子 players switching instrument lengths |
| **Click-to-Edit (Route A)** | Click any number in the rendered score to open a popup and change pitch, duration, accidental, or octave; re-renders instantly |
| **Text Editor (Route B)** | Toolbar `≡` button opens a dedicated full-screen editor with a 番茄简谱-aligned text format, live preview underneath, and bidirectional cursor sync between text and rendered notes |
| **Image OCR — Jianpu Recognition** | Upload a Jianpu image (`.jpg`, `.png`) — AI reads and transcribes the numbered notation (Beta) |
| **Image OCR — Staff to Jianpu** | Upload a Western staff notation image — AI converts it to Jianpu text (Beta) |
| **SVG Score Rendering** | Output is a fully scalable SVG with correct measure layout, barlines, line wrapping, and multi-measure rest brackets |
| **Multiple Export Formats** | `.PNG` and `.JPEG` via Canvas renderer |
| **Try with Sample File** | One-click demo with a built-in sample score — no file upload needed to try the tool |
| **Two Themes** | A warm light theme and a dark theme; the SVG output re-renders on theme switch |
| **Mobile Responsive** | Sidebar collapses to a compact top panel on small screens |

---

## Tech Stack

![React](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat&logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

| Library | Purpose |
|---|---|
| [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | UI framework + static types |
| [Vite 6](https://vitejs.dev/) | Dev server + build tooling |
| [Tailwind CSS v4](https://tailwindcss.com/) | Utility-first styling |
| [Zustand](https://zustand-demo.pmnd.rs/) | Lightweight global state |
| [Radix UI](https://www.radix-ui.com/) | Accessible primitives (dialog, select, tooltip) |
| [@tonejs/midi](https://github.com/Tonejs/Midi) | MIDI file parsing |
| [JSZip](https://stuk.github.io/jszip/) | `.mxl` compressed file extraction |
| [Groq API](https://groq.com/) | Vision AI for image OCR (Llama 4 Scout) |
| GitHub Pages | Hosting |

All parsing, rendering, and export run **entirely client-side** — no backend, no file upload to any server.

---

## Project Structure

```
Music-Score-Converter/
├── docs/
│   └── JIANPU_FORMAT.md      — Route B text editor format spec
├── src/
│   ├── components/
│   │   ├── EditNotePopup.tsx     — Route A click-to-edit popup
│   │   ├── EditTextOverlay.tsx   — Route B full-screen text editor
│   │   ├── ExportButtons.tsx     — PNG / JPEG export
│   │   ├── FileUpload.tsx        — Drag & drop / file picker
│   │   ├── LandingPage.tsx       — Pre-conversion welcome screen
│   │   ├── OcrSection.tsx        — AI image OCR panel
│   │   ├── PartSelector.tsx      — Multi-part MusicXML selector
│   │   ├── ScoreOutput.tsx       — Rendered SVG container
│   │   ├── Sidebar.tsx           — Upload + options + export sidebar
│   │   ├── Toolbar.tsx           — Top toolbar with editor entry points
│   │   └── TransposeSelect.tsx   — Key transposition dropdown
│   ├── hooks/
│   │   ├── useFileHandler.ts     — File parsing + render orchestration
│   │   └── useOcr.ts             — OCR API integration
│   ├── lib/
│   │   ├── abcParser.ts          — ABC notation parser
│   │   ├── editor.ts             — Route B text serialize / parse + position tracking
│   │   ├── parser.ts             — MusicXML parser + pitch conversion + transposition
│   │   ├── renderer.ts           — SVG layout engine
│   │   ├── downloader.ts         — PNG / JPEG export
│   │   └── utils.ts              — Shared helpers
│   ├── store/
│   │   └── scoreStore.ts         — Zustand global state
│   ├── types/
│   │   └── score.ts              — Note / measure / chord type definitions
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── package.json
└── vite.config.ts
```

---

## How It Works

### 1. File Parsing

- **MusicXML / MXL** — The `.mxl` container is decompressed via JSZip, reading `META-INF/container.xml` to locate the root XML file. The XML is then parsed with the browser's native `DOMParser` to extract key signature (`<fifths>`), time signature (`<beats>`, `<beat-type>`), tempo (`<per-minute>`), dynamics (`<dynamics>`), hairpins (`<wedge>`), repeat barlines, slurs, direction markings, and all `<note>` elements per measure.
- **MIDI** — Parsed via `@tonejs/midi`. Key signature and tempo are read from the header. The track with the highest note count is selected as the melody line. Simultaneous notes (chords) are deduplicated by keeping the highest pitch. Notes are mapped to measures using tick position and PPQ.
- **ABC** — Custom ABC notation parser handles header fields (`K:`, `M:`, `Q:`, `T:`), accidentals (`^`, `_`, `=`), octave markers (`'`, `,`), and standard durations.

### 2. Pitch Conversion

Each note undergoes a three-step conversion:
1. **Diatonic degree** — The note's step (C, D, E...) is compared against the tonic step to find its scale degree (1–7)
2. **Octave shift** — Calculated as `Math.round((noteSemi - (tonicSemi + scaleDegrees[degree])) / 12)` to determine how many octaves above or below the tonic register the note sits
3. **Accidental** — The intended semitone at the calculated octave is compared to the actual semitone; any mismatch produces a `#` or `b` prefix

Mid-piece key changes are handled by re-reading `<fifths>` inside each measure's `<attributes>` block and updating the tonic on the fly.

### 3. Editing

Two parallel editing routes:

- **Route A — Click-to-edit popup**: Each rendered number carries `data-m` / `data-n` attributes pointing back to its measure/note index. Clicking opens a popup with degree, duration, accidental, and octave controls; confirming patches the note object and re-renders the SVG.
- **Route B — Text editor**: The score is serialized into a compact text format (see [`docs/JIANPU_FORMAT.md`](docs/JIANPU_FORMAT.md)). The editor offers a live preview (180ms debounce), a togglable format reference drawer, and **bidirectional cursor sync** — caret movement in the text highlights the matching note in the preview, and clicking a note in the preview jumps the caret onto its token.

The text format is aligned with the 番茄简谱 convention so users familiar with that ecosystem can paste scripts directly:
- `1/` eighth, `1//` sixteenth, `1.` dotted quarter, `1-` half, `1---` whole
- `&mf` `<` `>` `!` for dynamics and hairpins
- `|:` `:|` `||&fine` `||&dc` for repeats and directions
- `(1 2 3)` slurs, `1[>]` `1[.]` articulations, `1[2]` grace notes
- `[N]` multi-measure rest compression

### 4. SVG Rendering

A custom layout engine in `renderer.ts` iterates over note objects and:
- Pre-calculates each measure's pixel width based on note durations
- Wraps lines when a measure would exceed `maxWidth` (derived from container width)
- Draws barlines, measure numbers, octave dots, beaming underlines grouped by beat boundary, and extension dashes for held notes
- Collapses runs of 2+ consecutive whole-measure rests into a numbered bracket block
- Renders repeat signs, D.C./D.S. direction text, tempo, dynamic markings, hairpins, slur arcs, articulations (accent / staccato / tenuto / marcato / fermata), and grace notes

### 5. Export

| Format | Method |
|---|---|
| `.PNG` / `.JPEG` | SVG serialized → Blob URL → drawn onto a 2× Canvas via `document.fonts.ready` to ensure font loading before rasterization |

---

## Getting Started

**Option A — Live Demo**
Visit **[huichiy.github.io/Music-Score-Converter](https://huichiy.github.io/Music-Score-Converter/)**

**Option B — Run Locally**

```bash
git clone https://github.com/huichiy/Music-Score-Converter.git
cd Music-Score-Converter
npm install
npm run dev
```

Then visit the URL Vite prints (defaults to `http://localhost:5173`).

To produce a production build:

```bash
npm run build       # type-check + bundle into dist/
npm run preview     # serve the built bundle locally
```

---

## Known Limitations

| Limitation | Reason |
|---|---|
| **Single melody line only** | Chord voices and harmony notes are intentionally folded into stacked chord notes; full multi-voice rendering is not yet supported |
| **MIDI triplets approximate** | MIDI has no semantic triplet encoding; durations are snapped to nearest binary value |
| **MIDI key detection** | Relies on the key signature event in the MIDI header; files exported without this metadata default to C major |
| **No volta / 跳房子** | First-time / second-time endings (`["1." ... ]`) are not yet parsed or rendered |
| **No tuplets** | Triplet / quintuplet groupings are not yet supported in the text format |
| **Flute-specific ornaments** | 颤音 / 波音 / 叠音 / 打音 / 花舌 etc. are intentionally not rendered — most are inferred by performers from context |

---

## Roadmap

- [x] Mid-piece key change detection and re-mapping
- [x] Repeat signs and D.C. / D.S. markings (段落反复记号)
- [x] Tempo (速度) and dynamic markings (力度记号) in output
- [x] Hairpin dynamics (crescendo / decrescendo)
- [x] Slur curves (连音线) above connected notes
- [x] Chord stacking (double stops)
- [x] Articulations (accent, staccato, tenuto, marcato, fermata)
- [x] Grace notes (倚音)
- [x] Mobile-optimised layout and touch interactions
- [x] Transposition (转调) — dropdown selector
- [x] ABC Notation (.abc) input support
- [x] Image OCR — Jianpu image transcription (Beta, Groq Llama 4 Vision)
- [x] Image OCR — Western staff notation → Jianpu (Beta)
- [x] Route A click-to-edit popup editor
- [x] Route B text editor with live preview + bidirectional cursor sync
- [ ] Playback (Tone.js) — hear the score as it's converted
- [ ] Volta / 跳房子 (first / second time endings)
- [ ] Tuplets — triplets, quintuplets, etc.
- [ ] Flute-specific ornaments — 颤音 / 波音 / 叠音 / 打音 / 花舌
- [ ] Multi-voice rendering — duet parts side by side

---

## 中文说明

**[🎼 在线体验](https://huichiy.github.io/Music-Score-Converter/)**

![Demo Screenshot](docs/demo.png)

---

### 项目动机

华乐团的乐手——尤其是笛子、二胡、高胡等旋律乐器演奏者——主要使用简谱。

然而，网上大多数乐谱都是以西洋五线谱形式发布的。

手动转谱：

- 耗时
- 容易出错
- 打断排练流程

作为一名华乐团的笛子演奏者，我开发了这个工具来自动转换乐谱，让乐手们可以减少抄谱的时间，把更多的时间投入到演奏中。

---

### 功能列表

| 功能 | 说明 |
|---|---|
| **支持 MusicXML、MIDI 与 ABC** | 接受 `.xml`、`.mxl`、`.mid`、`.midi`、`.abc` |
| **智能旋律识别** | 综合乐器名称关键词、音符密度与平均音高自动评分选择主旋律声部 |
| **精准乐理解析** | 处理调号、中途变调、临时升降号、跨小节延音线、附点音符及所有标准时值 |
| **标准简谱输出** | 输出包含增时线、按拍分组的减时线与高低八度点 |
| **速度与力度** | 提取 BPM；渲染固定力度（`p` `f` `mf` `ff` `sfz` 等）与渐强渐弱 hairpin |
| **反复与指示** | 渲染 `\|:` `:\|` 反复纵线；显示 D.C.、D.S.、Fine、al Coda |
| **连线与和弦** | 连音线弧形；双音/和弦垂直堆叠在主旋律下方 |
| **表情记号与倚音** | 重音、staccato、tenuto、marcato、fermata、倚音 |
| **转调** | 下拉菜单一键转到目标调——笛子换调必备 |
| **点击编辑（Route A）** | 点击渲染谱面上任何数字，弹出 popup 改音高 / 时值 / 升降号 / 八度 |
| **文本编辑器（Route B）** | 工具栏 `≡` 按钮打开全屏编辑器：上下分栏，文本在上，实时预览在下，光标双向同步；格式说明可侧滑抽屉显示。文本格式对齐番茄简谱约定 |
| **图片识别 — 简谱识别** | 上传简谱图片，AI 自动转录（Beta）|
| **图片识别 — 五线谱转简谱** | 上传五线谱图片，AI 自动转换（Beta）|
| **SVG 乐谱渲染** | 输出可缩放 SVG，自动换行、多小节休止括号 |
| **多格式导出** | `.PNG` 与 `.JPEG`（Canvas 渲染） |
| **内置示例试用** | 一键加载示例乐谱 |
| **双色主题** | 浅色与深色主题，切换时 SVG 实时重新渲染 |
| **移动端适配** | 小屏自动折叠侧边栏 |

---

### 技术栈

![React](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat&logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

| 库 | 用途 |
|---|---|
| React 18 + TypeScript | UI 框架 + 静态类型 |
| Vite 6 | 开发服务器与打包 |
| Tailwind CSS v4 | 原子化样式 |
| Zustand | 轻量全局状态 |
| Radix UI | 无障碍组件原语 |
| @tonejs/midi | MIDI 解析 |
| JSZip | `.mxl` 解压 |
| Groq API | 视觉 AI（Llama 4 Scout）|
| GitHub Pages | 部署 |

所有解析、渲染、导出**全部在浏览器端完成**，无后端、不上传文件。

---

### 工作原理

#### 1. 文件解析
- **MusicXML / MXL** — JSZip 解压 `.mxl`，`DOMParser` 提取调号、变调、拍号、速度、力度、hairpin、反复、连线、指示标记、音符
- **MIDI** — `@tonejs/midi` 读取，选最长音轨为旋律，同时音保留最高音
- **ABC** — 自研 parser 处理头部字段、升降号、八度标记、时值

#### 2. 音高转换
三步：音级（1–7）→ 八度位移 → 临时升降号。中途变调实时跟随 `<fifths>` 更新。

#### 3. 编辑
- **Route A**：点击 SVG 数字 → 弹出 popup 改属性 → 即时重渲染
- **Route B**：序列化为 [简谱文本格式](docs/JIANPU_FORMAT.md) → 上下分栏编辑器：文本上、实时预览下、180ms 防抖。**光标双向同步**——文本光标移到音符 token 时预览对应数字高亮；点击预览数字时文本光标跳到对应 token

文本格式参考番茄简谱约定，方便熟悉番茄的用户直接粘贴：
- `1/` 八分、`1//` 十六分、`1.` 附点四分、`1-` 二分、`1---` 全音符
- `&mf` 力度、`<` `>` `!` 渐强渐弱
- `|:` `:|` `||&fine` `||&dc` 反复与段落
- `(1 2 3)` 连线、`1[>]` `1[.]` 表情、`1[2]` 倚音
- `[N]` 多小节休止压缩

#### 4. SVG 渲染
自定义排版引擎：预计算小节宽度 → 自动换行 → 绘制纵线、小节编号、八度点、减时线、增时线、连续休止合并括号、反复符号、指示文字、力度、hairpin、连音弧、表情、倚音

#### 5. 导出
SVG 序列化为 Blob → 等 `document.fonts.ready` → 绘制到 2× Canvas → PNG / JPEG

---

### 本地运行

```bash
git clone https://github.com/huichiy/Music-Score-Converter.git
cd Music-Score-Converter
npm install
npm run dev
```

打开 Vite 提示的 URL（默认 `http://localhost:5173`）。

生产构建：

```bash
npm run build       # 类型检查 + 打包到 dist/
npm run preview     # 本地预览生产 bundle
```

---

### 已知限制

| 限制 | 原因 |
|---|---|
| **单旋律线** | 和弦折叠为垂直堆叠，完整多声部尚未支持 |
| **MIDI 三连音近似** | MIDI 无三连音语义，时值对齐至最近二进制 |
| **MIDI 调号依赖文件头** | 无调号元数据时默认 C 大调 |
| **暂不支持跳房子** | 第一次/第二次结尾标记暂未解析 |
| **暂不支持连音/多连音** | 三连音、五连音等暂未支持 |
| **暂不支持笛子专属技巧** | 颤音 / 波音 / 叠音 / 打音 / 花舌等暂不渲染——演奏者按语境补 |

---

### 路线图

- [x] 中途变调检测与重新映射
- [x] 段落反复记号（D.C. / D.S.）
- [x] 速度与力度标记输出
- [x] 渐强渐弱 hairpin
- [x] 连音线
- [x] 和弦堆叠（双音）
- [x] 表情记号（accent / staccato / tenuto / marcato / fermata）
- [x] 倚音（grace note）
- [x] 移动端布局优化
- [x] 转调
- [x] ABC Notation 输入
- [x] 图片识别 — 简谱图片转录（Beta）
- [x] 图片识别 — 五线谱图片转简谱（Beta）
- [x] Route A 点击式编辑器
- [x] Route B 文本编辑器（实时预览 + 光标双向同步）
- [ ] Playback 播放（Tone.js）
- [ ] 跳房子（volta）
- [ ] 三连音 / 多连音
- [ ] 笛子专属技巧（颤音 / 波音 / 叠音 / 打音 / 花舌）
- [ ] 多声部并排渲染

---

## License

MIT
