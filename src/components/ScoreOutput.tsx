import { useScoreStore } from '@/store/scoreStore'

interface ScoreOutputProps {
  svgHtml: string
  outputRef: React.RefObject<HTMLDivElement>
  onNoteClick: (m: number, n: number) => void
}

export default function ScoreOutput({ svgHtml, outputRef, onNoteClick }: ScoreOutputProps) {
  const editModeA = useScoreStore((s) => s.editModeA)

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editModeA) return
    const target = e.target as Element
    const noteEl = target.closest('[data-m]') as HTMLElement | null
    if (!noteEl) return
    const m = parseInt(noteEl.dataset.m ?? '-1')
    const n = parseInt(noteEl.dataset.n ?? '-1')
    if (m >= 0 && n >= 0) onNoteClick(m, n)
  }

  return (
    <div
      ref={outputRef}
      className={`score-output px-4 py-6 ${editModeA ? 'edit-mode' : ''}`}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
      onClick={handleClick}
    />
  )
}
