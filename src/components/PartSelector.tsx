import { useScoreStore } from '@/store/scoreStore'
import { saveMyPart, clearMyPart, loadMyPart } from '@/lib/partMatch'

interface PartSelectorProps {
  onPartChange: (idx: number) => void
}

export default function PartSelector({ onPartChange }: PartSelectorProps) {
  const partNames = useScoreStore((s) => s.partNames)
  const selectedPartIdx = useScoreStore((s) => s.selectedPartIdx)
  const showPartSelector = useScoreStore((s) => s.showPartSelector)
  const showAutoDetect = useScoreStore((s) => s.showAutoDetect)
  const matchedMyPart = useScoreStore((s) => s.matchedMyPart)
  const setMatchedMyPart = useScoreStore((s) => s.setMatchedMyPart)

  if (!showPartSelector) return null

  // Picking a part by hand IS the signal that this is the user's instrument —
  // remember it so every later score defaults here instead of to the melody.
  const handleChange = (idx: number) => {
    const name = partNames[idx]
    if (name) {
      saveMyPart(name)
      setMatchedMyPart(true)
    }
    onPartChange(idx)
  }

  const handleForget = () => {
    clearMyPart()
    setMatchedMyPart(false)
  }

  const remembered = loadMyPart()

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
        声部
      </label>
      <select
        value={selectedPartIdx}
        onChange={(e) => handleChange(parseInt(e.target.value))}
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

      {matchedMyPart && remembered && (
        <div className="flex items-center justify-between gap-2" style={{ fontSize: 10, color: 'var(--color-muted)' }}>
          <span>已记住你的声部：{remembered}</span>
          <button
            onClick={handleForget}
            title="改回自动选择主旋律"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--color-accent)',
              fontSize: 10,
              textDecoration: 'underline',
            }}
          >
            忘记
          </button>
        </div>
      )}
    </div>
  )
}
