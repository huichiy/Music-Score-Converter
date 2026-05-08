import { useScoreStore } from '@/store/scoreStore'

interface TransposeSelectProps {
  onTranspose: (key: string) => void
}

const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F']

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
      <select
        value={currentValue}
        onChange={(e) => onTranspose(e.target.value === originalKeyStr ? '' : e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none appearance-none cursor-pointer"
        style={{
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-foreground)',
        }}
      >
        {KEYS.map((k) => (
          <option key={k} value={k}>
            {k}{k === originalKeyStr ? ' (原调)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
