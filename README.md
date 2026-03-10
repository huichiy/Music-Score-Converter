# Jianpu Converter (简谱转换器)

A sleek, client-side web application built to instantly convert MusicXML and MIDI files into Chinese Numbered Musical Notation (Jianpu / 简谱).

## Live Demo
👉 **[Try the Web App Here]([https://your-username.github.io/Music-Score-Converter/](https://huichiy.github.io/Music-Score-Converter/))**

## Features
- **Zero Install, Works Offline:** The entire application is a single `index.html` file. No server, no Python dependencies, no installations. Just open it in your browser.
- **MusicXML & MIDI Support:** Drop in `.xml`, `.mxl`, `.mid`, or `.midi` files to parse.
- **Auto Melody Detection:** Uploading a full orchestra score? The app automatically analyzes tracks by note density, average pitch, and instrument keyword recognition to auto-select the main melody.
- **Smart Note Parsing:** Maps complex diatonic steps, accidentals, flats/sharps against key signatures, and ties/dotted rhythms directly into authentic Jianpu notations (with proper dashes and underlines).
- **Multiple Exports:** Download your generated Jianpu score as `.TXT` raw text, clean `.PDF` (via native browser print stylesheets), or exactly as seen via canvas screenshot for `.PNG` and `.JPEG` image formats.
- **Premium Minimalist UI:** Clean, distraction-free interface inspired by modern design tools (Notion/Linear) supporting both Light and Dark dynamic themes.

## How to use
1. Download or clone this repository to get the `index.html` file.
2. Double click `index.html` to open it in any modern web browser (Chrome, Safari, Edge, Firefox).
3. Drag and drop your `.xml`, `.mxl`, `.mid`, or `.midi` file into the upload box.
4. Click **Convert to Jianpu**.
5. Switch the active part using the auto-detected dropdown, or click the download buttons to export!

---

# 简谱转换器 (Jianpu Converter)

这是一个现代化、纯前端的网页应用，旨在将 MusicXML 和 MIDI 格式的五线谱文件快速、精准地转换为中文数字简谱。

## Live Demo / 在线体验
👉 **[Try the Web App Here]([https://your-username.github.io/Music-Score-Converter/](https://huichiy.github.io/Music-Score-Converter/))**

## 核心功能
- **无需安装，支持离线运行：** 整个应用全部使用原生的 HTML/JS/CSS 构建在一个单独的 `index.html` 文件中。无需后端服务器或复杂的代码依赖，只需在浏览器中打开即可使用。
- **支持 MusicXML 与 MIDI：** 直接拖拽上传 `.xml`、`.mxl`、`.mid` 或 `.midi` 乐谱文件。
- **智能旋律轨道识别：** 当上传多声部的管弦乐总谱时，应用会自动分析各个轨道的音符密度、平均音高，并通过“笛”、“二胡”、“violin” 等中西乐器关键词的权重加分算法，自动帮您提取并选中主旋律声部，同时扣除“大阮”、“低音”等伴奏声部的权重。
- **精准的乐理打谱解析：** 能正确处理调号、临时升降号（支持降号调计算），不仅能抓取绝对音高转换为正确的首调数字音符，还能精准将时值转换为标准的简谱格式（包含增时线、减时线、附点及延音线处理）。
- **图片与 PDF 导出：** 支持一键将简谱导出为 `.TXT` 纯文本，无缝唤起浏览器打印生成 `.PDF`，或者使用内置的 Canvas 引擎瞬间生成排版整齐的 `.PNG` 与 `.JPEG` 格式图片。
- **极简优雅 UI：** 使用了极简的排版和设计语言，搭配平滑的动画效果与 `Inter` / `马善政毛笔楷书` 字体支持，提供舒适的阅谱环境，并内置一键切换的 深色/浅色 主题。

## 使用方法
1. 获取项目目录中的 `index.html` 文件。
2. 双击通过任何现代浏览器（Chrome、Safari、Edge 等电脑浏览器）打开。
3. 将您的乐谱文件拖放到中央的虚线框内。
4. 点击 **Convert to Jianpu** 开始转换。
5. 在下方阅读生成的简谱，您也可以使用下拉菜单切换轨道，按需导出为 PDF 或图片！
