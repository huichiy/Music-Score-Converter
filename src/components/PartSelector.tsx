import { useScoreStore } from '@/store/scoreStore'

interface PartSelectorProps {
  onPartChange: (idx: number) => void
}

export default function PartSelector({ onPartChange }: PartSelectorProps) {
  const partNames = useScoreStore((s) => s.partNames)
  const selectedPartIdx = useScoreStore((s) => s.selectedPartIdx)
  const showPartSelector = useScoreStore((s) => s.showPartSelector)
  const showAutoDetect = useScoreStore((s) => s.showAutoDetect)

  if (!showPartSelector) return null

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
        声部
      </label>
      <select
        value={selectedPartIdx}
        onChange={(e) => onPartChange(parseInt(e.target.value))}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none appearance-none cursor-pointer transition-colors"
        style={{
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-foreground)',
        }}
      >
        {showAutoDetect && (
          <option value={selectedPartIdx}>🎯 自动选择: {partNames[selectedPartIdx]}</option>
        )}
        {partNames.map((name, i) => (
          <option key={i} value={i}>{name}</option>
        ))}
      </select>
    </div>
  )
}
