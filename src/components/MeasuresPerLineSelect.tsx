import { useScoreStore } from '@/store/scoreStore'
import { MEASURES_PER_LINE_OPTIONS, saveMeasuresPerLine } from '@/lib/layoutPrefs'

export default function MeasuresPerLineSelect() {
  const isConverted = useScoreStore((s) => s.isConverted)
  const measuresPerLine = useScoreStore((s) => s.measuresPerLine)
  const setMeasuresPerLine = useScoreStore((s) => s.setMeasuresPerLine)

  if (!isConverted) return null

  const onChange = (n: number) => {
    setMeasuresPerLine(n)
    saveMeasuresPerLine(n)
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
        每行小节数
      </label>
      <div style={{ position: 'relative' }}>
        <select
          value={measuresPerLine}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none appearance-none cursor-pointer"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-foreground)',
            paddingRight: '28px',
          }}
        >
          {MEASURES_PER_LINE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? '自动（按宽度换行）' : `${n} 小节`}
            </option>
          ))}
        </select>
        <span style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 10, color: 'var(--color-muted)', pointerEvents: 'none',
        }}>▾</span>
      </div>
    </div>
  )
}
