# 设计文档：OCR 闭环 + MusicXML 表情/倚音导入 + Route B 语法 v3

日期：2026-07-12
分支：`feat/ocr-loop-artic-routeb-v3`
范围：roadmap 三项 —— ① Route C（OCR 结果变成真谱子）② MusicXML `<articulations>` / 倚音导入 ③ Route B 跳房子 / 三连音 / 临时拍号

---

## ① Route C：OCR 结果 → 渲染谱

### 现状与根因

管线已存在：OCR 结果 → OcrSection「渲染为简谱」按钮 → `loadFromText` → `parseFromText` → `renderJianpuSVG`。
但 `src/lib/vision/prompts.ts` 教模型输出的语法与 Route B 格式（`docs/JIANPU_FORMAT.md`）不一致：

| 概念 | OCR 提示词现状 | Route B 要求 | 后果 |
|---|---|---|---|
| 八分 / 十六分音符 | `1_` / `1__` | `1/` / `1//` | 时值全部丢失（`_` 被忽略） |
| 低八度 | `1.`（数字后加点） | `1,` | `1.` 被解析成**附点四分**，悄悄错 |
| 标题行 | 标题与 Key/Time 同一行 | `Title:` 独立行头 | 标题丢失，首行被当谱体 |

### 改动

1. **重写 `JIANPU_OCR_PROMPT` 和 `WESTERN_TO_JIANPU_PROMPT`**（`src/lib/vision/prompts.ts`）
   - 输出格式改为与 JIANPU_FORMAT.md 完全一致：`Title:` / `Key: X   Time: N/M   Tempo: N` 头部行 + `|` 分隔的谱体
   - 时值：`1`＝四分（默认）、`1-`＝二分、`1---`＝全、`1/`＝八分、`1//`＝十六分、`1.`＝附点四分
   - 八度：`1'` 高、`1,` 低；升降号写在前：`#1` `b1`；延音独立 `-`
   - 反复 `|:` `:|`、力度 `&mf`、跳房子 `{1}` `{2}`、三连音 `~3`、临时拍号 `@3/4`（③ 的新语法一并教给模型）
   - 附一个 3 小节完整示例，保留"识别不了就回 `[错误：…]`"的规则
2. **新增 `normalizeOcrText(raw: string): string`**（`src/lib/vision/utils.ts`，导出）
   - 去 markdown 代码围栏 ```` ``` ````
   - 全角→半角：`｜`→`|`、`：`→`:`、`．`→`.`、全角数字/空格
   - 旧方言兜底：`_`→`/`（`_` 在 Route B 无含义，无副作用）
   - **不**转换 `1.`（与附点语义冲突，无法安全消歧——靠新提示词避免）
   - 在 `useOcr.runOcr` 中对识别结果统一调用后再入 store（用户在结果框看到的就是将被解析的文本）
3. **错误哨兵识别**：结果匹配 `[错误：…]` / `[Error: …]` 时走 `setOcrError`，不进结果框
4. **OCR 结果框可编辑**（`OcrSection.tsx`）：`readOnly` 移除，`onChange` 写回 `setOcrResult`，识别小错可手改后再渲染
5. **空解析保护**（`OcrSection.handleUseAsScore`）：`parseFromText` 结果 0 小节 → 报「无法解析简谱文本」而非渲染空白

### 不做

- 不为旧 OCR 方言写第二个解析器（维护两套语法不值得）

---

## ② MusicXML 表情记号 + 倚音导入（`src/lib/parser.ts`）

### 改动

1. **`<notations><articulations>`** 子元素 → `NoteObject.articulation`（渲染端已支持，纯提取）：
   `accent`→`accent`、`staccato`→`staccato`、`tenuto`→`tenuto`、`strong-accent`→`marcato`
2. **`<notations><fermata>`**（articulations 之外的直接子元素）→ `fermata`
3. **倚音 `<grace>`**：现状 parser.ts:91 直接 `continue` 丢弃。改为：解析其 pitch（复用 `parseChordNote` 的度数换算，返回结构与 `GraceNote` 相同）暂存为 pending，挂到**下一个真实音符**的 `graceNote`；连续多个 grace 只取第一个；跨小节残留的 pending 挂到下一小节首音
4. **`<time-modification>`** → `NoteObject.tuplet = actual-notes`（与 ③ 的渲染配合，MusicXML 三连音导入后节拍不再变形）
5. **修 bug：`transposeNoteObjects` 不转调 `graceNote`** —— 转调时倚音的 degree/octave/accidental 用与主音相同的 `absSemi`/`reexpress` 重新计算

### 不做

- `<ornaments>`（trill / mordent / turn 等）：需要新字段 + 新渲染符号 + Route B 语法，属 roadmap 第 6 项「笛子装饰音」，本次不碰。CLAUDE.md roadmap 措辞相应拆分。

---

## ③ Route B 语法 v3：跳房子 / 三连音 / 临时拍号

### 语法（tokenizer 不需要改：`{` `~` `@` 目前都落入通用 token，旧文本零破坏）

| 语法 | 含义 | 示例 |
|---|---|---|
| `{N}` | 跳房子：本小节属于第 N 遍结尾（写在小节线后、力度之前）。多小节结尾＝每小节都标；渲染时连续同号自动连成一个括号 | `\|: 1 2 \| {1} 3 4 :\| {2} 5 6 \|\|` |
| `~N` | N 连音：其后 N 个音为一组，时值 ×（时值修正系数），上方画括号+数字。主场景 `~3` 三连音 | `\| ~3 1/ 2/ 3/ 2 3 \|` |
| `@N/M` | 从本小节起变拍号（影响每行折行、下划线分组、整小节休止的 0 数量） | `\| 1 2 3 4 \| @3/4 1 2 3 \|` |

时值修正系数表：`3→2/3`、`5→4/5`、`7→4/7`、`2→3/2`、`6→2/3`，其余 n → `pow2floor(n)/n`。

### 数据模型（`src/types/score.ts`）

```ts
MeasureArray._volta?: number      // 1 | 2 | …
MeasureArray._timeSig?: string    // '3/4'，从本小节起生效
NoteObject.tuplet?: number        // 连音组大小，3 = 三连音
```

### 解析（`editor.ts parseFromText`）

- `/^\{(\d+)\}$/` → `current._volta = N`
- `/^@(\d+\/\d+)$/` → `current._timeSig`
- `/^~(\d+)$/` → pendingTuplet 计数器，其后 N 个音符 `tuplet = N`（休止符也计入组）

### 序列化（`editor.ts serializeToText`）

- 小节头顺序：`|:`/`|` → `{N}` → `@N/M` → `&dyn` → wedge → 音符
- tuplet：连续 `tuplet===N` 的音符按 N 个一组，每组开头发 `~N`
- `isWholeMeasureRest` 的元数据排除名单加 `_volta` `_timeSig`（带元数据的整休小节不折叠进 `[N]`）

### 渲染（`renderer.ts`）

- `beatsPerMeasure` / `beatUnit` 变为可变：小节循环顶部读 `_timeSig` 更新；小节前画小号 `N/M` 文本（约 +20px 宽）
- 跳房子：谱行上方画横括号（起点竖钩 + 横线 + 编号 `N.`），y = currentY − 44；连续同号小节横线相接；换行自然断开。首行与页头的轻微贴近与现有 slur 行为一致，可接受
- 三连音：组上方画小括号 + 数字 N；`cumulative` 节拍累计和小节宽度用修正后的时值（下划线分组随之正确）
- `collapseRestRuns` 的整休判断加 `_timeSig`/`_volta` 排除（其余元数据维持现状不改）

### 转调（`parser.ts transposeNoteObjects`）

- 元数据拷贝清单加 `_volta` `_timeSig`；`tuplet` 随 `{ ...note }` 自动保留

---

## 测试

- `scripts/test-roundtrip.ts` 新增 describe：跳房子 / 三连音 / 临时拍号 round-trip（含与力度、反复混写的组合）
- 新增 `scripts/test-parser.ts`：用 `linkedom`（新 devDependency，仅测试用，不进 bundle）解析内联 MusicXML 字符串，断言 articulations / fermata / grace / time-modification / graceNote 转调
- `package.json` `test` 脚本改为两个测试文件顺序执行
- 手动验收：`npm run dev` 拿一张简谱图跑 OCR → 渲染；`tests/test_score.mxl` 导入检查表情记号

## 文档同步（同批 commit）

- `docs/JIANPU_FORMAT.md`：新增跳房子 / 连音 / 临时拍号三节，更新已知限制
- `CLAUDE.md`：NoteObject/MeasureArray 字段、renderer 规则、roadmap（三项移入 shipped，ornaments 措辞拆分）、OCR 提示词与 Route B 格式联动的架构规则
- `README.md`：功能表补 Route C 与新语法

## 提交计划

分支 `feat/ocr-loop-artic-routeb-v3`，按依赖顺序 3 个功能 commit + 文档：

1. `feat(editor): Route B v3 — volta {N}, tuplet ~N, temp time sig @N/M`（含渲染与测试）
2. `feat(parser): import MusicXML articulations, fermata, grace notes, tuplets`（含转调修复与测试）
3. `feat(ocr): align OCR prompts with Route B format; editable result + normalize`（Route C 闭环）

③ 先做是因为 ① 的新提示词要教模型 v3 语法、② 的 tuplet 导入要靠 ③ 的渲染。
