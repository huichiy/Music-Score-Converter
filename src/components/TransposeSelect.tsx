import { useScoreStore } from '@/store/scoreStore'
import { transposeOptions } from '@/lib/scoreFile'

interface TransposeSelectProps {
  onTranspose: (key: string) => void
}

export default function TransposeSelect({ onTranspose }: TransposeSelectProps) {
  const isConverted = useScoreStore((s) => s.isConverted)
  const originalKeyStr = useScoreStore((s) => s.originalKeyStr)
  const transposeKey = useScoreStore((s) => s.transposeKey)

  if (!isConverted) return null

  const currentValue = transposeKey || originalKeyStr

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
        转调
      </label>
      <div style={{ position: 'relative' }}>
        <select
          value={currentValue}
          onChange={(e) => onTranspose(e.target.value === originalKeyStr ? '' : e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none appearance-none cursor-pointer"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-foreground)',
            paddingRight: '28px',
          }}
        >
          {transposeOptions(originalKeyStr).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
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
