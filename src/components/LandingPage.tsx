import { useState, useMemo } from 'react'
import { renderJianpuSVG } from '@/lib/renderer'
import type { Measure, MeasureArray, NoteObject } from '@/types/score'

interface LandingPageProps {
  onEnterTool: () => void
  onLoadSample: () => void
  isDark: boolean
  onThemeToggle: () => void
}

// ── Sample measures for preview (茉莉花-like, key C, 4/4) ────────
function note(degree: number, octave: number, type: NoteObject['type']): NoteObject {
  return { degree, octave, type, dot: false, tie: false, rest: false, accidental: '', slurStart: false, slurStop: false }
}
function measure(notes: NoteObject[]): MeasureArray {
  const arr = notes as MeasureArray
  arr._repeatStart = false; arr._repeatEnd = false
  arr._direction = ''; arr._dynamic = ''; arr._wedge = null
  return arr
}
const SAMPLE_MEASURES: Measure[] = [
  measure([note(5,0,'quarter'), note(5,0,'quarter'), note(6,0,'quarter'), note(5,0,'quarter')]),
  measure([note(1,1,'quarter'), note(6,0,'quarter'), note(5,0,'half')]),
  measure([note(3,0,'quarter'), note(3,0,'eighth'), note(2,0,'eighth'), note(1,0,'quarter'), note(2,0,'quarter')]),
  measure([note(1,0,'whole')]),
]

// ── Data ─────────────────────────────────────────────────────────
const SCALE_NAMES = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti']
const DEGREE_SIZES = [158, 120, 132, 112, 144, 126, 108]
const DEGREE_ITALIC = [false, false, false, true, false, false, true]

const PIPELINE = [
  { n: '01', title: '读取 · Ingest',  desc: '上传 MusicXML、MIDI、ABC 或图片',
    detail: 'MusicXML (.xml/.mxl) · MIDI (.mid) · ABC Notation (.abc) · 图片 OCR（Groq 视觉）' },
  { n: '02', title: '解析 · Parse',   desc: '提取音符、调性、时值、拍号',
    detail: '解析音高、时值、升降号；支持中途调性变化、多声部、和弦、多小节休止' },
  { n: '03', title: '映射 · Map',     desc: '音高映射为简谱音级 1–7',
    detail: '将西方音高转换为简谱音级，计算八度偏移（上下加点），支持任意目标调转调' },
  { n: '04', title: '渲染 · Render',  desc: '输出 SVG，支持 PNG 导出',
    detail: '矢量 SVG，含重复记号、力度、渐强渐弱、连线；2× 高清 PNG 适合打印' },
]

// ─────────────────────────────────────────────────────────────────
export default function LandingPage({ onEnterTool, onLoadSample, isDark, onThemeToggle }: LandingPageProps) {
  const [hoveredNum,   setHoveredNum]   = useState<number | null>(null)
  const [hoveredScale, setHoveredScale] = useState<number | null>(null)
  const [expandedStep, setExpandedStep] = useState<number | null>(null)

  const activeNum = hoveredNum ?? hoveredScale

  // Re-render when theme changes so SVG colors stay correct
  const sampleSvg = useMemo(() =>
    renderJianpuSVG(SAMPLE_MEASURES, 'C', '4/4', '茉莉花（片段）', 540, '72', isDark)
  , [isDark])

  const c = {
    border:   'var(--color-border)',
    accent:   'var(--color-accent)',
    muted:    'var(--color-muted)',
    surface:  'var(--color-surface)',
    surface2: 'var(--color-surface-2)',
    fg:       'var(--color-foreground)',
    faint:    'var(--color-faint)',
    bg:       'var(--color-background)',
  }

  return (
    <div className="overflow-y-auto h-full">

      {/* ── Top bar ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 20px',
        borderBottom: `0.5px solid ${c.border}`,
      }}>
        <a
          href="https://github.com/huichiy/Music-Score-Converter"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 11, color: c.muted, textDecoration: 'none',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = c.fg)}
          onMouseLeave={e => (e.currentTarget.style.color = c.muted)}
        >
          GitHub
        </a>
        <button
          onClick={onThemeToggle}
          title={isDark ? '切换亮色' : '切换暗色'}
          style={{
            background: 'none', border: `0.5px solid ${c.border}`,
            borderRadius: 6, padding: '5px 10px',
            fontSize: 13, color: c.muted, cursor: 'pointer',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = c.fg; e.currentTarget.style.borderColor = c.fg }}
          onMouseLeave={e => { e.currentTarget.style.color = c.muted; e.currentTarget.style.borderColor = c.border }}
        >
          {isDark ? '☀' : '☾'}
        </button>
      </div>

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <div style={{
        padding: '48px 52px 40px',
        borderBottom: `0.5px solid ${c.border}`,
        position: 'relative', overflow: 'hidden',
      }}>

        {/* Ghost decorative number — tracks hovered digit, intentional design */}
        <div style={{
          position: 'absolute', right: -8, top: -16,
          fontFamily: "Georgia, 'Noto Serif SC', serif",
          fontSize: 320, fontWeight: 700, lineHeight: 1,
          color: c.fg,
          opacity: activeNum ? (isDark ? 0.12 : 0.07) : (isDark ? 0.05 : 0.03),
          userSelect: 'none', pointerEvents: 'none',
          transition: 'opacity 0.3s',
        }}>
          {activeNum ?? 1}
        </div>

        {/* Eyebrow */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          border: `1px solid ${c.border}`, borderRadius: 999,
          padding: '4px 14px', fontSize: 11, color: c.muted,
          marginBottom: 32,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.accent }} />
          免费 · 无需安装 · 浏览器直接使用
        </div>

        {/* Numbers 1–7 with solfège (Feature A) */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, marginBottom: 4 }}>
          {[1,2,3,4,5,6,7].map((n, i) => (
            <div
              key={n}
              onMouseEnter={() => setHoveredNum(n)}
              onMouseLeave={() => setHoveredNum(null)}
              style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            >
              <div style={{
                fontFamily: "Georgia, 'Noto Serif SC', serif",
                fontSize: DEGREE_SIZES[i], fontWeight: 700,
                fontStyle: DEGREE_ITALIC[i] ? 'italic' : 'normal',
                lineHeight: 1,
                color: activeNum === n ? c.fg : c.muted,
                transform: activeNum === n ? 'translateY(-6px)' : 'none',
                transition: 'color 0.2s, transform 0.2s',
                cursor: 'default', userSelect: 'none',
                padding: '0 6px',
              }}>
                {n}
              </div>

              {/* Accent underline */}
              <div style={{
                height: 3, borderRadius: 2, background: c.accent,
                width: activeNum === n ? '60%' : 0,
                transition: 'width 0.25s ease', marginTop: 4,
              }} />

              {/* Solfège label */}
              <div style={{
                fontSize: 10, letterSpacing: 1, color: c.accent,
                marginTop: 6,
                opacity: hoveredNum === n ? 1 : 0,
                transform: hoveredNum === n ? 'translateY(0)' : 'translateY(-4px)',
                transition: 'opacity 0.2s, transform 0.2s',
                userSelect: 'none',
              }}>
                {SCALE_NAMES[i]}
              </div>
            </div>
          ))}
        </div>

        {/* Title */}
        <div style={{
          fontFamily: "Georgia, 'Noto Serif SC', serif",
          fontSize: 28, fontWeight: 700,
          color: c.fg, lineHeight: 1.3,
          marginTop: 24, marginBottom: 8,
        }}>
          From Staff Lines to <span style={{ color: c.accent }}>简谱</span>
        </div>

        {/* Description */}
        <div style={{ fontSize: 13, color: c.muted, lineHeight: 1.85, maxWidth: 520, marginBottom: 24 }}>
          将西方乐谱转换为中文简谱——专为中乐团演奏者打造。
        </div>

        {/* CTAs — single primary entry into the tool, plus a "try sample" escape hatch */}
        <div style={{ marginTop: 28, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button
            onClick={onEnterTool}
            style={{
              padding: '12px 28px',
              background: c.accent,
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'transform 0.15s, opacity 0.15s, box-shadow 0.15s',
              boxShadow: `0 1px 0 color-mix(in srgb, ${c.accent} 60%, black)`,
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.opacity = '0.94' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.opacity = '1' }}
          >
            开始使用 →
          </button>

          <button
            onClick={onLoadSample}
            style={{
              padding: '11px 18px',
              background: 'none',
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              color: c.muted,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = c.fg; e.currentTarget.style.borderColor = c.fg }}
            onMouseLeave={e => { e.currentTarget.style.color = c.muted; e.currentTarget.style.borderColor = c.border }}
          >
            试试示例
          </button>
        </div>
      </div>

      {/* ── What is Jianpu ────────────────────────────────────────── */}
      <div style={{
        padding: '36px 52px',
        borderBottom: `0.5px solid ${c.border}`,
        display: 'flex', gap: 52, alignItems: 'flex-start', flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <span style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: c.muted, display: 'block', marginBottom: 8, whiteSpace: 'nowrap' }}>
            WHAT IS JIANPU
          </span>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 700, fontStyle: 'italic', color: c.fg, marginBottom: 12 }}>
            什么是简谱？
          </div>
          <div style={{ fontSize: 13, color: c.muted, lineHeight: 1.95 }}>
            简谱用数字 <strong style={{ color: c.fg }}>1–7</strong> 代表音阶，八度用点表示，时值用下划线和横线标记。<br />
            在中国、东南亚及全球华人音乐圈广泛使用。<br /><br />
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
              <span style={{ color: c.fg }}>1̇</span> 上方点 = 高八度
              <span style={{ color: c.fg }}>2̲</span> 下划线 = 八分音符
              <span style={{ color: c.fg }}>0</span> = 休止符
            </span>
          </div>
        </div>

        {/* Scale grid — cross-highlight with hero (Feature A×B) */}
        <div style={{ flexShrink: 0 }}>
          <span style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: c.muted, display: 'block', marginBottom: 10 }}>
            音阶
          </span>
          <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
            {[1,2,3,4,5,6,7].map((n) => {
              const isActive = activeNum === n
              return (
                <div
                  key={n}
                  onMouseEnter={() => setHoveredScale(n)}
                  onMouseLeave={() => setHoveredScale(null)}
                  style={{
                    width: 42, height: 42,
                    background: isActive ? c.accent : c.surface,
                    border: `0.5px solid ${isActive ? c.accent : c.border}`,
                    borderRadius: 8,
                    fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700,
                    color: isActive ? '#fff' : c.fg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'default',
                    transform: isActive ? 'scale(1.1)' : 'scale(1)',
                    transition: 'background 0.15s, border-color 0.15s, color 0.15s, transform 0.15s',
                  }}
                >
                  {n}
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            {SCALE_NAMES.map((name) => (
              <div key={name} style={{ width: 42, textAlign: 'center', fontSize: 9, color: c.muted }}>
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Output preview ────────────────────────────────────────── */}
      <div style={{
        padding: '32px 52px',
        borderBottom: `0.5px solid ${c.border}`,
      }}>
        <span style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: c.muted, display: 'block', marginBottom: 12 }}>
          OUTPUT PREVIEW
        </span>
        <div style={{
          background: c.surface,
          border: `0.5px solid ${c.border}`,
          borderRadius: 8,
          padding: '16px 20px',
          overflowX: 'auto',
        }}>
          <div
            className="score-output"
            dangerouslySetInnerHTML={{ __html: sampleSvg }}
            style={{ minWidth: 0 }}
          />
        </div>
        <div style={{ fontSize: 11, color: c.muted, marginTop: 8 }}>
          实际转换后即显示，可导出 PNG
        </div>
      </div>

      {/* ── Pipeline (Feature C) ──────────────────────────────────── */}
      <div style={{ padding: '36px 52px 52px' }}>
        <span style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: c.muted, display: 'block', marginBottom: 8 }}>
          HOW IT WORKS
        </span>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 700, color: c.fg }}>
            从文件到简谱，四步完成
          </span>
          <span style={{ fontFamily: "Georgia, serif", fontSize: 14, fontStyle: 'italic', color: c.muted, marginLeft: 14 }}>
            Four-step pipeline
          </span>
        </div>
        <div style={{ display: 'flex' }}>
          {PIPELINE.map((step, i) => (
            <PipelineStep
              key={step.n} step={step} index={i}
              isFirst={i === 0} isLast={i === PIPELINE.length - 1}
              isExpanded={expandedStep === i}
              onToggle={() => setExpandedStep(expandedStep === i ? null : i)}
            />
          ))}
        </div>
      </div>

    </div>
  )
}

// ── PipelineStep ─────────────────────────────────────────────────
function PipelineStep({ step, isFirst, isLast, isExpanded, onToggle }: {
  step: { n: string; title: string; desc: string; detail: string }
  index: number
  isFirst: boolean
  isLast: boolean
  isExpanded: boolean
  onToggle: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const c = {
    border:   'var(--color-border)',
    accent:   'var(--color-accent)',
    muted:    'var(--color-muted)',
    fg:       'var(--color-foreground)',
    surface:  'var(--color-surface)',
    surface2: 'var(--color-surface-2)',
  }

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        border: `0.5px solid ${isExpanded ? c.accent : c.border}`,
        marginRight: isLast ? 0 : -0.5,
        borderRadius: isFirst ? '8px 0 0 8px' : isLast ? '0 8px 8px 0' : 0,
        background: isExpanded ? c.surface2 : hovered ? c.surface : 'transparent',
        transition: 'background 0.2s, border-color 0.2s',
        cursor: 'pointer',
        position: 'relative', zIndex: hovered || isExpanded ? 1 : 0,
        overflow: 'hidden',
      }}
    >
      {/* Red left accent bar */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: isExpanded ? 3 : 0,
        background: c.accent,
        transition: 'width 0.2s ease',
        borderRadius: isFirst ? '8px 0 0 8px' : 0,
      }} />

      <div style={{ padding: '20px 18px', paddingLeft: isExpanded ? 21 : 18 }}>
        <div style={{
          fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 700,
          color: isExpanded ? c.accent : hovered ? c.accent : c.muted,
          marginBottom: 8, lineHeight: 1,
          transition: 'color 0.2s',
          display: 'flex', alignItems: 'baseline', gap: 6,
        }}>
          {step.n}
          <span style={{ fontSize: 12, fontWeight: 400, opacity: isExpanded ? 1 : 0, transition: 'opacity 0.2s', color: c.accent }}>
            −
          </span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: c.fg, marginBottom: 4 }}>{step.title}</div>
        <div style={{ fontSize: 11, color: c.muted, lineHeight: 1.6 }}>{step.desc}</div>

        <div style={{ maxHeight: isExpanded ? 80 : 0, overflow: 'hidden', transition: 'max-height 0.3s ease' }}>
          <div style={{
            fontSize: 11, color: c.muted, lineHeight: 1.7,
            marginTop: 12, paddingTop: 12,
            borderTop: `0.5px solid ${c.border}`,
          }}>
            {step.detail}
          </div>
        </div>
      </div>
    </div>
  )
}
