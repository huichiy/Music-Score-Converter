import { useState } from 'react'

interface LandingPageProps {
  onLoadSample: () => void
}

const SCALE_NAMES = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti']
const PIPELINE = [
  { n: '01', title: '读取 · Ingest',  desc: '上传 MusicXML、MIDI、ABC 或图片' },
  { n: '02', title: '解析 · Parse',   desc: '提取音符、调性、时值、拍号' },
  { n: '03', title: '映射 · Map',     desc: '音高映射为简谱音级 1–7' },
  { n: '04', title: '渲染 · Render',  desc: '输出 SVG，支持 PNG 导出' },
]

export default function LandingPage({ onLoadSample }: LandingPageProps) {
  const [hoveredNum, setHoveredNum] = useState<number | null>(null)

  const c = {
    border:    'var(--color-border)',
    accent:    'var(--color-accent)',
    muted:     'var(--color-muted)',
    surface:   'var(--color-surface)',
    surface2:  'var(--color-surface-2)',
    fg:        'var(--color-foreground)',
    faint:     'var(--color-faint)',
  }

  return (
    <div className="overflow-y-auto h-full">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <div style={{ padding: '56px 56px 48px', borderBottom: `0.5px solid ${c.border}` }}>

        {/* Eyebrow */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          border: `1px solid ${c.border}`, borderRadius: 999,
          padding: '4px 14px', fontSize: 11, color: c.muted,
          marginBottom: 40,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.accent }} />
          免费 · 无需安装 · 浏览器直接使用
        </div>

        {/* Numbers 1–7 */}
        <div style={{ display: 'flex', marginBottom: 40 }}>
          {[1,2,3,4,5,6,7].map((n) => (
            <div
              key={n}
              onMouseEnter={() => setHoveredNum(n)}
              onMouseLeave={() => setHoveredNum(null)}
              style={{
                fontFamily: "Georgia, 'Noto Serif SC', serif",
                fontSize: 88, fontWeight: 400, lineHeight: 1,
                color: hoveredNum === n ? c.accent : c.muted,
                width: 80, textAlign: 'center',
                transform: hoveredNum === n ? 'translateY(-5px)' : 'none',
                transition: 'color 0.2s, transform 0.2s',
                cursor: 'default', userSelect: 'none',
              }}
            >
              {n}
            </div>
          ))}
        </div>

        {/* Title */}
        <div style={{
          fontFamily: 'Georgia, serif', fontSize: 32, fontWeight: 400,
          color: c.fg, lineHeight: 1.3, marginBottom: 10,
        }}>
          From Staff Lines to{' '}
          <span style={{ color: c.accent }}>简谱</span>
        </div>

        {/* Description */}
        <div style={{ fontSize: 13, color: c.muted, lineHeight: 1.85, maxWidth: 500, marginBottom: 20 }}>
          将西方乐谱转换为中文简谱——专为中乐团演奏者打造。<br />
          Convert Western notation into Jianpu for Chinese orchestra musicians.
        </div>

        {/* Format badges */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {['.musicxml', '.midi', '.abc', '图片 OCR'].map((f) => (
            <div key={f} style={{
              background: c.surface, border: `0.5px solid ${c.border}`,
              borderRadius: 4, padding: '3px 10px',
              fontSize: 11, color: c.muted, fontFamily: 'monospace',
            }}>
              {f}
            </div>
          ))}
          <button
            onClick={onLoadSample}
            style={{
              marginLeft: 8, fontSize: 11, color: c.accent,
              background: 'none', border: 'none', cursor: 'pointer',
              textDecoration: 'underline', padding: 0,
            }}
          >
            → 试试示例
          </button>
        </div>
      </div>

      {/* ── What is Jianpu ────────────────────────────────────── */}
      <div style={{
        padding: '40px 56px',
        borderBottom: `0.5px solid ${c.border}`,
        display: 'flex', gap: 52, alignItems: 'flex-start',
      }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: c.muted, display: 'block', marginBottom: 8 }}>
            WHAT IS JIANPU
          </span>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 400, color: c.fg, marginBottom: 12 }}>
            什么是简谱？
          </div>
          <div style={{ fontSize: 13, color: c.muted, lineHeight: 1.85 }}>
            简谱用数字 1–7 代表音阶，八度用点表示，时值用下划线和横线标记。在中国、东南亚及全球华人音乐圈广泛使用。<br /><br />
            Jianpu uses digits 1–7 for scale degrees, dots for octave shifts, and underlines for duration.
            Widely used across Chinese and Southeast Asian music communities.
          </div>
        </div>

        {/* Scale grid */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
            {[1,2,3,4,5,6,7].map((n) => (
              <div key={n} style={{
                width: 38, height: 38,
                background: n === 1 ? c.accent : c.surface,
                border: `0.5px solid ${n === 1 ? c.accent : c.border}`,
                borderRadius: 8,
                fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 400,
                color: n === 1 ? '#fff' : c.fg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {n}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            {SCALE_NAMES.map((name) => (
              <div key={name} style={{ width: 38, textAlign: 'center', fontSize: 9, color: c.muted }}>
                {name}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: c.muted, lineHeight: 1.9 }}>
            ＿ 下划线 = 八分音符 · eighth note<br />
            · 上方点 = 高八度 · higher octave
          </div>
        </div>
      </div>

      {/* ── Pipeline ──────────────────────────────────────────── */}
      <div style={{ padding: '40px 56px 56px' }}>
        <span style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: c.muted, display: 'block', marginBottom: 8 }}>
          HOW IT WORKS
        </span>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 400, color: c.fg, marginBottom: 20 }}>
          从文件到简谱，四步完成
        </div>
        <div style={{ display: 'flex' }}>
          {PIPELINE.map((step, i) => (
            <PipelineStep key={step.n} step={step} isFirst={i === 0} isLast={i === PIPELINE.length - 1} />
          ))}
        </div>
      </div>

    </div>
  )
}

function PipelineStep({ step, isFirst, isLast }: {
  step: { n: string; title: string; desc: string }
  isFirst: boolean
  isLast: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const c = {
    border: 'var(--color-border)',
    accent: 'var(--color-accent)',
    muted:  'var(--color-muted)',
    fg:     'var(--color-foreground)',
    surface:'var(--color-surface)',
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1, padding: '20px 18px',
        border: `0.5px solid ${c.border}`,
        marginRight: isLast ? 0 : -0.5,
        borderRadius: isFirst ? '8px 0 0 8px' : isLast ? '0 8px 8px 0' : 0,
        background: hovered ? c.surface : 'transparent',
        transition: 'background 0.2s',
        cursor: 'default',
        position: 'relative',
        zIndex: hovered ? 1 : 0,
      }}
    >
      <div style={{
        fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 400,
        color: hovered ? c.accent : c.muted,
        marginBottom: 8, lineHeight: 1,
        transition: 'color 0.2s',
      }}>
        {step.n}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: c.fg, marginBottom: 4 }}>
        {step.title}
      </div>
      <div style={{ fontSize: 11, color: c.muted, lineHeight: 1.6 }}>
        {step.desc}
      </div>
    </div>
  )
}
