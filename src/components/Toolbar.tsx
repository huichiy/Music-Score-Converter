import { useScoreStore } from '@/store/scoreStore'

interface ToolbarProps {
  onEditModeA: () => void
  onEditModeB: () => void
  onReset: () => void
}

export default function Toolbar({ onEditModeA, onEditModeB, onReset }: ToolbarProps) {
  const originalTitleStr = useScoreStore((s) => s.originalTitleStr)
  const originalKeyStr = useScoreStore((s) => s.originalKeyStr)
  const originalTimeStr = useScoreStore((s) => s.originalTimeStr)
  const currentKeyStr = useScoreStore((s) => s.currentKeyStr)
  const transposeKey = useScoreStore((s) => s.transposeKey)
  const editModeA = useScoreStore((s) => s.editModeA)
  const editTextVisible = useScoreStore((s) => s.editTextVisible)

  const displayKey = transposeKey || currentKeyStr || originalKeyStr

  const btnBase = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer'

  return (
    <div
      className="flex items-center justify-between px-4 py-3 gap-4"
      style={{
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      {/* Score info */}
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="font-semibold text-base truncate">{originalTitleStr || '未命名'}</h2>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-xs px-2 py-0.5 rounded-md font-mono"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}
          >
            {displayKey}
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-md font-mono"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}
          >
            {originalTimeStr || '4/4'}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onEditModeA}
          className={btnBase}
          style={{
            background: editModeA ? 'var(--color-accent)' : 'var(--color-surface-2)',
            color: editModeA ? '#fff' : 'var(--color-muted)',
            border: '1px solid var(--color-border)',
          }}
          title="点击音符编辑"
        >
          ✏ 点击编辑
        </button>
        <button
          onClick={onEditModeB}
          className={btnBase}
          style={{
            background: editTextVisible ? 'var(--color-accent)' : 'var(--color-surface-2)',
            color: editTextVisible ? '#fff' : 'var(--color-muted)',
            border: '1px solid var(--color-border)',
          }}
          title="文本编辑模式"
        >
          ≡ 文本
        </button>

        {/* Reset — destructive, separated, minimal */}
        <button
          onClick={onReset}
          title="重置 / 返回"
          style={{
            marginLeft: 6,
            background: 'none',
            border: 'none',
            padding: '4px 6px',
            cursor: 'pointer',
            color: 'var(--color-faint)',
            fontSize: 16,
            lineHeight: 1,
            borderRadius: 4,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-faint)')}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
