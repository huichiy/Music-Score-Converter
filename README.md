# 简谱 Jianpu Converter

A sleek, client-side web application built to instantly convert MusicXML and MIDI files into Chinese Numbered Musical Notation (Jianpu / 简谱).

Built by a Chinese orchestra flute player, for Chinese orchestra musicians.

## Live Demo
👉 **[Try the Web App Here](https://huichiy.github.io/Music-Score-Converter/)**

---

## Features

- **Zero Install, Works Offline** — The entire application is a single `index.html` file. No server, no Python dependencies, no installations. Just open it in your browser.
- **MusicXML & MIDI Support** — Drop in `.xml`, `.mxl`, `.mid`, or `.midi` files to parse.
- **Auto Melody Detection** — Uploading a full orchestra score? The app automatically analyzes tracks by note density, average pitch, and instrument keyword recognition to auto-select the main melody line. Supports Chinese instrument names (笛, 二胡, 高胡, 琵琶...) and Western instruments (violin, flute, oboe...). Accompaniment instruments (大阮, 低音, 扬琴...) are penalized in scoring.
- **Smart Note Parsing** — Correctly handles key signatures, accidentals, flat/sharp contexts, ties, dotted notes, and rhythmic durations. Outputs authentic Jianpu notation with proper dashes (延音线), underlines (减时线), and octave dots.
- **Multiple Export Formats** — Download your generated Jianpu as `.TXT` raw text, `.PDF` via native browser print stylesheet, or `.PNG` / `.JPEG` via built-in canvas renderer.
- **Premium Minimalist UI** — Clean, distraction-free interface inspired by Notion and Linear. Supports light and dark themes. Uses Inter and Ma Shan Zheng (马善政) calligraphy fonts.

---

## How to Use

1. Visit the [live demo](https://huichiy.github.io/Music-Score-Converter/) or download `index.html` and open it in any modern browser (Chrome, Safari, Edge, Firefox).
2. Drag and drop your `.xml`, `.mxl`, `.mid`, or `.midi` file into the upload zone — or click **Browse files**.
3. Click **Convert to Jianpu**.
4. For multi-part scores, use the auto-detected part dropdown to switch between instruments.
5. Export using the `.TXT`, `.PDF`, `.PNG`, or `.JPEG` buttons.

---

## Tech Stack

- Vanilla HTML / CSS / JavaScript — zero frameworks, zero build tools
- [@tonejs/midi](https://github.com/Tonejs/Midi) — MIDI file parsing
- [JSZip](https://stuk.github.io/jszip/) — MXL compressed file extraction
- [Ma Shan Zheng](https://fonts.google.com/specimen/Ma+Shan+Zheng) — Chinese calligraphy font
- [Inter](https://fonts.google.com/specimen/Inter) — UI typography
- Hosted on GitHub Pages

---

## Known Limitations

- **Single melody line only** — chord voices and harmony notes are intentionally skipped to produce a clean melody line
- **Mid-piece key changes not supported** — only the first key signature is read
- **MIDI triplets** — approximate to nearest binary duration (quarter, eighth, etc.)
- **PDF export** — uses the browser's native print dialog; output quality depends on browser

---

## Background

华乐演奏者（尤其是旋律乐器如笛子、二胡）平时使用简谱，但网络上大多数乐谱资源是五线谱格式，人工转谱费时且容易出错。本项目旨在通过自动化减少这一工作量，让华乐爱好者能更高效地获取可用的简谱。

---

# 简谱转换器

这是一个现代化、纯前端的网页应用，将 MusicXML 和 MIDI 格式的乐谱快速转换为中文数字简谱。

## 在线体验
👉 **[点击使用](https://huichiy.github.io/Music-Score-Converter/)**

## 核心功能

- **无需安装，支持离线** — 整个应用构建在单一 `index.html` 文件中，无需服务器或依赖，浏览器直接打开即用
- **支持 MusicXML 与 MIDI** — 支持 `.xml`、`.mxl`、`.mid`、`.midi` 格式
- **智能旋律识别** — 自动分析各声部的音符密度、平均音高及乐器关键词权重（支持笛、二胡、高胡、琵琶等华乐器名），自动选中主旋律声部，同时对大阮、低音、扬琴等伴奏声部进行降权
- **精准乐理解析** — 正确处理调号、临时升降号、附点音符、延音线，输出包含增时线、减时线与八度点的标准简谱格式
- **多格式导出** — 支持导出为 `.TXT` 纯文本、`.PDF`（调用浏览器打印）、`.PNG` 与 `.JPEG`（Canvas 渲染）
- **极简 UI** — 深色/浅色主题切换，Inter + 马善政毛笔字体

## 使用方法

1. 打开[在线版本](https://huichiy.github.io/Music-Score-Converter/)或下载 `index.html` 用浏览器打开
2. 将乐谱文件拖入上传区，或点击 **Browse files** 选择文件
3. 点击 **Convert to Jianpu** 开始转换
4. 多声部乐谱可通过下拉菜单切换声部
5. 使用右侧按钮导出为所需格式

## 已知限制

- 仅支持单旋律线，和弦声部会被自动跳过
- 不支持乐曲中途变调
- MIDI 三连音会近似为最接近的二进制时值
- PDF 依赖浏览器原生打印对话框
