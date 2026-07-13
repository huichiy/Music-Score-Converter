// Shared prompts — kept identical across providers so model swaps don't drift
// the output format. If you tweak these, retest each adapter AND keep the
// syntax examples in lockstep with docs/JIANPU_FORMAT.md (the output is fed
// straight into editor.ts parseFromText — see the prompt contract tests in
// scripts/test-roundtrip.ts).

export const JIANPU_OCR_PROMPT = `你是简谱专家。仔细分析这张简谱图片，逐小节转录乐谱内容。

严格规则：
- 只输出简谱文本，不要任何解释、说明、markdown 代码块或其他文字
- 如果图片不是简谱（例如是五线谱），只回复：[错误：图片不是简谱，请切换到"五线谱→简谱"模式]
- 看不清的内容跳过，不要编造音符

头部行（第一行起）：
Title: 曲名          ← 图里有标题才输出这行
Key: C   Time: 4/4   Tempo: 120   ← Tempo 没有就省略

谱体：小节用 | 分隔，音符之间用空格，结尾用 ||

音高：
- 数字 1-7 是音级，0 是休止符
- 高八度在数字后加撇号（1' 2'），低八度加逗号（1, 2,）——低八度不要用点
- 升降号写在数字前：#1 b7

时值：
- 1 = 四分音符（默认）
- 1- 二分音符（每个横线延长一拍），1--- 全音符
- 1/ 八分音符，1// 十六分音符——不要用下划线
- 1. 附点四分音符（点是附点，不是低八度）
- 跨小节延音：下一小节开头写 -（一拍一个 -）

以下记号图里出现才写：
- 反复：|: 开始，:| 结束
- 跳房子：小节线后写 {1} {2}
- 力度：小节开头 &mf &f &p 等
- 渐强渐弱：< 渐强开始，> 渐弱开始，! 结束
- 连线：( 1 2 3 )
- 三连音：~3 后跟 3 个音，如 ~3 1/ 2/ 3/
- 中途变拍号：小节开头 @3/4
- 表情：1[>] 重音，1[.] 顿音，1[$] 延长号
- 倚音：1[2]（2 是装饰音）

完整示例（3 小节）：
Title: 小星星
Key: C   Time: 4/4   Tempo: 100
|: 1 1 5 5 | {1} 6 6 5- :| {2} ~3 6/ 6/ 6/ 5 4 4 ||`

export const WESTERN_TO_JIANPU_PROMPT = `You are a music expert converting Western staff notation to Jianpu (简谱).
Numbers 1-7 are scale degrees relative to the printed key signature (1 = tonic/Do).

Strict rules:
- Output ONLY the Jianpu text. No explanations, no markdown code fences.
- If the image is not Western staff notation, reply only with: [Error: Image is not staff notation. Please switch to 简谱识别 mode.]
- Skip anything you cannot read clearly; never invent notes.

Header lines (from the first line):
Title: name              ← only if a title is visible
Key: C   Time: 4/4   Tempo: 120   ← omit Tempo if not printed

Body: measures separated by |, notes separated by spaces, end with ||

Pitch:
- Digits 1-7 are scale degrees, 0 is a rest
- Octave up: apostrophe (1' 2'); octave down: comma (1, 2,) — never a dot for low octave
- Accidentals go BEFORE the digit: #1 b7

Duration:
- 1 = quarter note (default)
- 1- half note (each dash adds one beat), 1--- whole note
- 1/ eighth note, 1// sixteenth note — never use underscores
- 1. dotted quarter (the dot is a duration dot, not an octave mark)
- Tie across a barline: start the next measure with - (one - per beat)

Write these only when present in the image:
- Repeats: |: to open, :| to close
- Volta endings: {1} {2} right after the barline
- Dynamics at measure start: &mf &f &p
- Hairpins: < crescendo start, > diminuendo start, ! stop
- Slurs: ( 1 2 3 )
- Triplet: ~3 followed by three notes, e.g. ~3 1/ 2/ 3/
- Mid-piece time signature change: @3/4 at measure start
- Articulations: 1[>] accent, 1[.] staccato, 1[$] fermata
- Grace notes: 1[2]

Complete example (3 measures):
Title: Example
Key: G   Time: 4/4
|: 1 1 5 5 | {1} 6 6 5- :| {2} ~3 6/ 6/ 6/ 5 4 4 ||`

import type { OcrMode } from './types'

export function systemPromptFor(mode: OcrMode): string {
  return mode === 'jianpu' ? JIANPU_OCR_PROMPT : WESTERN_TO_JIANPU_PROMPT
}

export function userPromptFor(mode: OcrMode): string {
  return mode === 'jianpu'
    ? '请识别并转录这张简谱图片。'
    : '请将这张五线谱转换为简谱。'
}
