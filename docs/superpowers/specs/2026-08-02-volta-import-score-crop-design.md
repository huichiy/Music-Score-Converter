# 设计文档：MusicXML 跳房子导入 + 总谱框选裁剪

日期：2026-08-02
分支：`feat/volta-import-score-crop`
范围：roadmap 两项 —— #3 MusicXML `<ending>` → `_volta` 导入；#1 Phase 3 OCR「单框·逐行迭代」总谱框选裁剪

---

## #3 MusicXML 跳房子导入（`src/lib/parser.ts`）

### 现状与根因

Route B v3 已实现 `_volta` 数据字段 + 渲染（`{N}` 横括号，`renderVoltaBracket`），手写文本可用。但 `parseXMLToNoteObjects` 只提取了 `<barline>` 里的 `<repeat>`，没读 `<ending>`，所以带跳房子的 MusicXML 导入后 volta 丢失。

### MusicXML `<ending>` 结构

```xml
<measure number="5">
  <barline location="left"><ending number="1" type="start"/></barline>
  ...音符...
  <barline location="right">
    <ending number="1" type="stop"/>   <!-- 或 type="discontinue" -->
    <repeat direction="backward"/>
  </barline>
</measure>
```

- `type="start"` → 该小节开始一个 volta
- `type="stop"`（带下钩收尾）/ `type="discontinue"`（开放收尾）→ 该小节结束 volta；**带 stop/discontinue 的小节本身仍属于该 volta**
- `number` 可能是 `"1"` 或 `"1, 2"`（多遍共用结尾）；我们的 `_volta` 是单个数字，取第一个

### 改动

在小节循环里、现有 `<repeat>` 扫描旁边加 `<ending>` 扫描，用一个游标 `activeVolta: number | null`（在循环外声明，跨小节保持）：

1. 扫本小节所有 `<barline>` 下的 `<ending>`：
   - 见到 `type="start"` → `activeVolta = parseInt(number 的第一段)`
   - 记录是否见到 `type="stop"` 或 `"discontinue"`（记为 `endingCloses`）
2. `activeVolta` 非空 → `measureNotes._volta = activeVolta`
3. 处理完本小节后，若 `endingCloses` → `activeVolta = null`

这样单小节结尾（start+stop 同一小节）和多小节结尾都正确。`number` 解析：`parseInt(numAttr.split(',')[0].trim())`，NaN 则忽略。

### 测试（`scripts/test-parser.ts`）

内联 MusicXML，用现有 linkedom：
- 单小节 volta：`|: … | {1} … :| {2} … ||` 形态，断言各小节 `_volta`
- 多小节 volta：两个连续小节都 `type` 只在首尾，断言中间小节也带 `_volta`
- `number="1, 2"` → `_volta === 1`
- 无 ending 的小节 `_volta === undefined`

### 不做

- MusicXML volta 与 Route B `{N}` 序列化的完整往返已由 v3 覆盖，无需重测序列化。

---

## #1 总谱框选裁剪（单框·逐行迭代）

### 架构

一个**与 OCR 无关**的通用裁剪组件，两处入口复用。裁剪器只做「图源进 → 框内 PNG 出」，不碰 store / OCR。唯一有逻辑的坐标映射抽成纯函数单元测试。

### 纯函数 `src/lib/cropTools.ts`

```ts
export interface Rect { x: number; y: number; w: number; h: number }

/**
 * 把显示坐标系里的选框映射回全分辨率图源的像素矩形。
 * displaySel / displaySize 同一坐标系（裁剪器画布的 CSS 像素）；
 * sourceSize 是全分辨率（PDF 页 @2.0x 渲染尺寸，或图片自然像素）。
 * 结果按 sourceSize 夹紧，四舍五入到整数像素。
 */
export function computeCropRect(displaySel: Rect, displaySize: {w:number;h:number}, sourceSize: {w:number;h:number}): Rect
```

- 比例 `kx = sourceSize.w / displaySize.w`、`ky = sourceSize.h / displaySize.h`
- `sx = round(displaySel.x * kx)` 等；结果夹紧进 `[0, sourceSize.w]` / `[0, sourceSize.h]`，保证 `sx+sw <= sourceW`
- 纯函数，无 DOM，可测

### 组件 `src/components/ImageCropper.tsx`

Props：
```ts
interface ImageCropperProps {
  source: HTMLCanvasElement | File   // PDF 页给 canvas（已按 2.0x 渲染），图片给 File
  title: string                       // 弹窗标题副行，如 "市集.pdf · 第 1 页" 或文件名
  onCrop: (file: File) => void        // 裁出的 PNG File
  onWhole: () => void                 // 「整页/整张送识别」——不裁，用原图
  onCancel: () => void
}
```

行为：
- 把 `source` 画进一张适配弹窗的显示画布（`<img>` 或 `<canvas>`，等比缩放到最大宽度，如 640）。记住显示尺寸与全分辨率尺寸。
- 覆盖一个可拖动（框身）+ 四角可缩放的选框，纯 React 状态 + pointer 事件，不引库。框外用 `box-shadow: 0 0 0 9999px rgba(...)` 压暗（stage `overflow:hidden`）。
- 默认选框：满宽、贴顶的一条横带（高约显示高的 18%，总谱最上行通常是笛子）。
- 最小尺寸 `MINW=60, MINH=22`（显示像素）；小于则确认按钮禁用。
- 「框选送识别」：`computeCropRect` → 从全分辨率源 `drawImage(source, sx,sy,sw,sh, 0,0, sw,sh)` 到输出 canvas → `toBlob('image/png')` → `File`（名字带 `_crop`）→ `onCrop`。
- 「整页/整张」→ `onWhole`；「取消」→ `onCancel`。
- 图源载入失败 → 组件内 error 文案（复用现有样式）。

> 全分辨率源：PDF 页由入口方按 `renderPageToCanvas(pdf, n, 2.0)` 传 canvas；图片由组件用 `createImageBitmap`/`<img>` 拿自然像素。裁剪 `drawImage` 直接用这份全分辨率源，保证送 OCR 的是清晰图，不是显示缩略。

### 入口 A：PDF（`src/components/PdfPagePicker.tsx`）

现状：点缩略图 → `pageToFile(pdf,i,2.0)` → 立即 `onSelect`。
改为：点缩略图 → 用 `renderPageToCanvas(pdf,i,2.0)` 取该页全分辨率 canvas → 打开 `ImageCropper`。
- `onCrop(file)` → `onSelect(file)`（进现有 OCR 路径）
- `onWhole()` → 等价现状：`canvas → toBlob → File → onSelect`
- `onCancel()` → 回到缩略图网格

### 入口 B：图片（`src/components/OcrSection.tsx`）

现状：选中图片 → 「开始识别」整张。
改为：当 `ocrFile` 是图片（非 PDF）时，在「开始识别」旁加一个「框选区域」按钮（outline 样式）。
- 点「框选区域」→ 打开 `ImageCropper`（source = 该图 File）
- `onCrop(file)` → `handleOcrFile(file)`（用裁剪结果替换待识别文件）
- `onWhole()` / `onCancel()` → 关闭裁剪器，`ocrFile` 不变
- 不点按钮直接「开始识别」= 整张（现状不变）。**对图片是可选，不打断单声部简谱图的快速流程。**

### 数据流

图源（PDF canvas / 图片 File）→ `ImageCropper` → 裁出 PNG File → 现有 `handleOcrFile` / `onSelect` → `runOcr`（已带 normalize + 8192 token）→ 可编辑结果框（逐行迭代时往下追加）。

### 错误处理

- 选框 < 最小尺寸 → 确认禁用
- 图源渲染/载入失败 → 裁剪器内 error 文案
- 裁剪 `toBlob` 返回 null → 抛「裁剪失败」，回退到裁剪器

### 测试

- `computeCropRect` 单元测试加进 `scripts/test-roundtrip.ts`（已 import `src/lib/*`，不新增测试文件）：比例映射、夹紧边界（框超出源）、最小尺寸、1:1（显示=源）、2.0x 放大
- 拖拽交互、两处入口、真实 PDF/图片裁剪 → 浏览器验证（沿用现有方式）

### 不做（YAGNI）

- 多框、竖向拼接、记住上次框位置、移动端拖拽打磨——等①验证后按反馈再加。

---

## 提交计划

分支 `feat/volta-import-score-crop`，两个功能 commit：

1. `feat(parser): import MusicXML <ending> into _volta`（含 test-parser.ts 测试）
2. `feat(ocr): 总谱框选裁剪 — ImageCropper + cropTools, PDF/图片双入口`（含 cropTools 单元测试）

#3 先做（小、独立、纯 parser）；#1 后做（新组件 + 两处入口）。

## 文档同步（进对应 commit）

- `CLAUDE.md`：
  - 文件结构加 `src/components/ImageCropper.tsx`、`src/lib/cropTools.ts`
  - MusicXML Notations Import 一节加 `<ending>` → `_volta`
  - roadmap：#1 Phase 3 OCR 框选、#3 volta 导入移入 shipped
  - 测试断言数更新
- `README.md`：功能表 + roadmap 补框选裁剪与 volta 导入
- `docs/JIANPU_FORMAT.md`：已知限制里「MusicXML 跳房子导入暂未实现」改为已支持
