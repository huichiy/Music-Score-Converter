import type { usePlayback } from '@/hooks/usePlayback'

interface PlaybackBarProps {
  playback: ReturnType<typeof usePlayback>
}

export default function PlaybackBar({ playback }: PlaybackBarProps) {
  const { status, canPlay, error, play, stop } = playback
  const isPlaying = status === 'playing'

  return (
    <div
      className="flex items-center gap-3 px-4 py-2"
      style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}
    >
      <button
        onClick={() => (isPlaying ? stop() : play())}
        disabled={!canPlay}
        title={isPlaying ? '停止' : '播放'}
        className="rounded-lg cursor-pointer disabled:opacity-40"
        style={{
          width: 34, height: 30,
          background: isPlaying ? 'var(--color-accent)' : 'var(--color-surface)',
          color: isPlaying ? '#fff' : 'var(--color-accent)',
          border: '1px solid var(--color-accent)',
          fontSize: 13,
        }}
      >
        {isPlaying ? '■' : '▶'}
      </button>

      {error && (
        <span className="text-xs" style={{ color: 'var(--color-accent)' }}>{error}</span>
      )}
    </div>
  )
}
