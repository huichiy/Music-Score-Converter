# 设计文档：Playback（播放简谱）

日期：2026-08-02
分支：`feat/playback`
范围：roadmap 剩余三项之一 —— 把转换/识别出来的简谱播放出来，用耳朵校对，并跟随高亮当前音

---

## 目标与已定决策

用户是笛子演奏者，主要用途是**用耳朵校对** OCR / MusicXML 转换结果，同时也想"像真正演奏一样"听整首。

brainstorm 阶段已定的四件事：

| 决策 | 选择 | 理由 |
|---|---|---|
| 反复记号 | **按反复完整展开**（`|:` `:|` + 跳房子 `{1}` `{2}`） | 用户要听起来像真演奏，不是逐小节念一遍 |
| 跟随高亮 | **要**，高亮当前响的那个音 | 听到错音能立刻看到是哪个；`data-m`/`data-n` 基础设施已存在 |
| 音频引擎 | **Tone.js**（懒加载） | 用户听过 A/B demo 后选定；`Transport` 原生支持暂停/变速/seek，正好承载下面的控件集 |
| v1 控件 | 播放/停止 + 暂停/继续 + 速度滑块 + 进度条（可拖）+ 点音起播 | 用户全选并追加了进度条 |

**关键观察**：暂停/继续、拖进度条、点音起播三者底层是同一个能力「从任意时间点开始播」（seek），不是三个独立功能，所以工作量远小于逐项相加。

---

## 架构：三层 + UI

```
纯逻辑层（无 DOM、无音频，可单元测试）
  src/lib/playback.ts
    expandRepeats()        反复 + 跳房子 → 线性小节表
    buildPlaybackEvents()  → PlaybackEvent[]（时间以「拍」为单位）
        ↓
发声层（薄，懒加载 Tone.js）
  src/lib/tonePlayer.ts    load / play / pause / stop / seekBeat / setRate
        ↓
编排层
  src/hooks/usePlayback.ts 取 store 谱子 → 建事件表 → 驱动播放器 + 高亮 + 进度
        ↓
UI
  src/components/PlaybackBar.tsx  播放键 · 进度条 · 速度滑块
```

**为什么这么分**：主要工作量与风险都在纯逻辑层（反复展开、时值、音高换算），它完全可测且不碰浏览器；发声层薄到可以整层替换（future improvement 里的真实采样只改这一个文件）。

**关键决定：事件表时间用「拍」而不是「秒」。** 速度滑块只需改 `Transport.bpm`，不必重算音乐；单元测试也不必掺入 BPM。

---

## 纯逻辑层（`src/lib/playback.ts`）

### `expandRepeats(measures: Measure[]): ExpandedEntry[]`

```ts
interface ExpandedEntry { measureIdx: number }   // 原始 measures 数组下标
```

线性扫描，遇 `_repeatEnd` 跳回最近的 `_repeatStart`（若前面没有则回到 index 0 —— 标准记谱行为）。第一遍只走 `_volta === 1` 或无 volta 的小节，第二遍只走 `_volta === 2` 或无 volta 的小节。

**必须带 `justJumped` 标记**：跳回去时不能重新执行 `_repeatStart` 的「重置遍数」分支，否则 pass 被打回 1 造成死循环。验证过的推演（`|:` M1 / `{1}:|` M2 / `{2}` M3）：

```
i=0 M1(_repeatStart) → sectionStart=0, pass=1, 输出 M1
i=1 M2 volta1===pass1 → 输出 M2；_repeatEnd && pass===1 → pass=2, i=0, justJumped=true
i=0 M1 有 _repeatStart 但 justJumped → 不重置；输出 M1（无 volta，两遍都响）
i=1 M2 volta1 !== pass2 → 跳过
i=2 M3 volta2===pass2 → 输出 M3
结果：M1 M2 M1 M3 ✓
```

**兜底**：输出长度上限 = 原长 × 4，超出即停止展开（防畸形谱子死循环）。

**`_volta >= 3`**：只跑两遍，故 `{3}` 及以上的小节两遍都不匹配、会被跳过（等于不播）。这是 v1 的已知限制，写入下文「不做」一节；若真遇到需要三遍的谱子再扩展 pass 上限。

`_multiRest` 块原样进入输出（在事件层展开为 N 小节静音）。

### `buildPlaybackEvents(expanded, measures, keyStr, timeStr): PlaybackEvent[]`

```ts
interface PlaybackEvent {
  startBeat: number    // 从头累计的拍数
  durBeats: number
  midi: number
  measureIdx: number   // 渲染器 origIdx（= SVG 的 data-m），高亮用
  noteIdx: number      // = data-n
}
```

音乐细节，逐条：

- **音高**：`midi = tonicSemi + octave*12 + scaleDegrees[degree-1] + accVal + 12`（MIDI 中央 C = 60，而 `pitchToSemitones('C',0,4) = 48`，故 +12）。这套算术已存在于 `parser.ts` 的 `transposeNoteObjects` 内部闭包 `absSemi`；**提取为共用导出函数，不写第二份**。
- **延音线 `tie`**：延长前一个事件的 `durBeats`，**不产生新事件**（否则长音会听成断开的两下）。
- **和弦 `chordNotes`**：同一 `startBeat` 上产生多个事件（主音 + 每个和弦音）。
- **连音 `tuplet`**：时值 × `tupletFactor(n)`。该函数现为 `renderer.ts` 私有，**导出复用**。
- **临时拍号 `_timeSig`**：从该小节起改变每小节拍数与 beatUnit。
- **`{_multiRest: N}`**：推进 N 个小节的静音，不产生事件。
- **休止符**：不产生事件，但推进时间。
- **倚音 `graceNote`**：主音前一个短音（固定 0.125 拍），占主音时值的前段。
- **附点**：×1.5。
- **表情记号**：v1 不影响发声（staccato 缩短、accent 加重列入 future improvement）。

### 高亮下标必须与渲染器对齐

SVG 的 `data-m` 是渲染器的 `origIdx`：它跳过整小节休止、把连续休止折叠成 `_multiRest`。`editor.ts` 的 `computeOrigIdxMap` 正是这个映射，但目前是私有函数。**导出并复用，不抄第二份**——CLAUDE.md 已因 `collapseRestRuns` 记录过「两份逻辑漂移」的教训。

整小节休止无法定位到单个音符（其 `0` 没有 `data-m`），高亮走该组的 `data-rest-m` `<g>`，与 EditTextOverlay 现有做法一致。

---

## 发声层（`src/lib/tonePlayer.ts`）

懒加载，沿用 `pdfTools.ts` 的 `ensurePdfJs()` 写法：只在首次播放时 `await import('tone')`，主 bundle 不受影响。首次播放需由用户手势触发 `Tone.start()`（浏览器自动播放限制）——入口本就是按钮，天然满足。

```ts
interface Player {
  load(events: PlaybackEvent[], bpm: number): Promise<void>
  play(): void
  pause(): void
  stop(): void
  seekBeat(beat: number): void
  setRate(rate: number): void
  positionBeats(): number     // 给 rAF 循环读
  totalBeats: number
  dispose(): void
}
```

对外全部以「拍」为单位，上层无需思考秒。

**控件 → Transport 映射**：

| 控件 | 实现 |
|---|---|
| 播放 | `Transport.start()` |
| 暂停 / 继续 | `Transport.pause()` / `.start()` |
| 停止 | `Transport.stop()` + 清事件 + 归零 |
| 播到结尾 | 自动停止并**归零**（进度条回到起点、清除高亮），等同用户按停止；不循环 |
| 拖进度条 / 点音起播 | seek（`Transport` 位置赋值） |
| 速度滑块 | `Transport.bpm.value = baseBpm × rate`，范围 0.5×–1.5× |

事件以 **tick 排程**（`startBeat × Transport.PPQ`），使变速与 seek 由 Transport 原生处理，无需重建事件表。

**音色**：默认 `FMSynth`（A/B demo 中标「偏吹管」的预设，贴合笛子）；和弦需 `PolySynth` 包一层。换音色是一行改动。

**BPM 来源**：`originalTempoStr` 有值则用，否则默认 90。

> Tone.js 具体 API 细节（Part / Ticks / PPQ 的确切用法）在实现时以真实 build 验证后钉定；本节固定的是**契约**：拍为单位、Transport 驱动、tick 排程。

---

## 编排层与 UI

### `src/hooks/usePlayback.ts`

从 store 读 `currentMeasures` / `currentKeyStr` / `originalTimeStr` / `originalTempoStr`（即**播放当前显示的谱子**，转调后音高随之改变），建事件表 → `load()` → 暴露 `{ isPlaying, isPaused, progress, rate, play, pause, stop, seekBeat, setRate, currentEvent }`。

一个 `requestAnimationFrame` 循环读 `positionBeats()`，同时驱动两件事：高亮当前音、推进进度条。

### `src/components/PlaybackBar.tsx`

独立窄条，贴在 Toolbar 下方、谱子上方，转换完成后常驻（Toolbar 已挤满，不再塞控件）：

```
[▶] [■]  ●━━━━━━━━━━━━━━━━━━  0:12 / 1:04     速度 1.0x ━━●━━
```

- 进度条可拖动 → `seekBeat(fraction × totalBeats)`
- 速度滑块 0.5×–1.5×
- 移动端（`@media (max-width: 600px)`）：隐藏时间读数、滑块缩短，保证按钮与进度条可用

### 点音起播与「点击编辑」的冲突

- `editModeA === true` → 点击照旧弹编辑框（**现有行为不变**）
- `editModeA === false` → 点音符 = seek 到该音并播放

因为编辑模式关闭时点音符目前**什么都不做**，这是纯新增，无回归风险。

### 高亮样式

`src/index.css` 新增 `.score-output .jn-note-playing`（不复用 EditTextOverlay 的 `jn-note-current`，避免两处样式互相牵连），整小节休止用对应的 rest-group 变体。

---

## 错误处理

- Tone.js 加载失败 → 友好提示，按钮恢复可点
- 空谱 / 无事件 → 播放按钮禁用
- 自动播放被拦 → 由用户手势内 `Tone.start()` 解决
- 重置 / 组件卸载 / 切换谱子 → `dispose()` 播放器 + 取消 rAF（否则旧音继续响）

---

## 测试

**单元测试**（加进 `scripts/test-roundtrip.ts`，它已 import `src/lib/*`；当前 130 断言）：

- `expandRepeats`：普通反复、跳房子 1/2、只有 `:|` 无 `|:`、无反复时原样返回、死循环兜底触发
- `buildPlaybackEvents`：附点与连音时值、**延音线合并为单个长音**、和弦同 `startBeat`、休止推进时间但不发声、`_multiRest` 静音、临时拍号改变小节拍数、各调音高（含转调后）、倚音短音
- origIdx 映射与渲染器 `data-m` 一致（跨整小节休止 / 多小节休止）

**浏览器 / Playwright 验证**：声音本身无法断言，但可断言高亮类在移动、进度在推进、seek 后位置正确、变速生效、点音起播、移动端布局。

---

## 实施顺序

每步都有可验证产出，风险高的在前：

1. 纯逻辑层 + 单元测试（无 UI）
2. 发声层 + 播放/停止键 → **第一次能听到声音**
3. 跟随高亮
4. seek 层：进度条 + 暂停/继续 + 点音起播
5. 速度滑块
6. 文档同步

---

## 文档同步（进对应 commit）

- `CLAUDE.md`：技术栈行加 `tone`；文件结构加 `playback.ts` / `tonePlayer.ts` / `usePlayback.ts` / `PlaybackBar.tsx`；新增 Playback 一节（反复展开算法与 `justJumped` 坑、拍为单位、origIdx 复用）；架构规则表加「`computeOrigIdxMap` / `tupletFactor` / 音高算术只留一份，复用勿抄」；roadmap 移入 shipped；测试断言数更新
- `README.md`：功能表 + 技术栈表加 Tone.js 播放；roadmap 移入 shipped（中英双语）

---

## 不做（YAGNI / future improvement）

- **真实笛子采样**（brainstorm 的方案 C）：最像真笛子，但要托管音频文件，GitHub Pages 每次加载都要下载，体积与复杂度跳一档。记入 roadmap，等 v1 跑通、确有需求再做。
- 表情记号影响发声（staccato 缩短、accent 加重）
- 节拍器、循环播放某段、多声部同时发声
- **三遍及以上的反复**：v1 只跑两遍，`{3}` 及以上的 volta 小节会被跳过
- **`D.C.` / `D.S.` 跳转**不参与展开（`_direction` 只是渲染文字，v1 播放忽略）
