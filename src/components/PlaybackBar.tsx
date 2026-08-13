import type { usePlayback } from '@/hooks/usePlayback'

interface PlaybackBarProps {
  playback: ReturnType<typeof usePlayback>
}

function fmt(beats: number, effectiveBpm: number): string {
  const sec = Math.max(0, Math.floor((beats / effectiveBpm) * 60))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export default function PlaybackBar({ playback }: PlaybackBarProps) {
  const { status, canPlay, error, play, pause, stop, positionBeats, totalBeats, seekBeat, bpm, rate, setRate } = playback
  const isPlaying = status === 'playing'
  // Wall-clock at the current speed: the score's own tempo scaled by the slider
  const bpmForClock = bpm * rate

  return (
    <div
      className="flex items-center gap-3 px-4 py-2"
      style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}
    >
      <button
        onClick={() => (isPlaying ? pause() : play())}
        disabled={!canPlay}
        title={isPlaying ? '暂停' : status === 'paused' ? '继续' : '播放'}
        className="rounded-lg cursor-pointer disabled:opacity-40 shrink-0"
        style={{
          width: 34, height: 30,
          background: isPlaying ? 'var(--color-accent)' : 'var(--color-surface)',
          color: isPlaying ? '#fff' : 'var(--color-accent)',
          border: '1px solid var(--color-accent)', fontSize: 13,
        }}
      >
        {isPlaying ? '❙❙' : '▶'}
      </button>

      <button
        onClick={stop}
        disabled={!canPlay || status === 'idle'}
        title="停止"
        className="rounded-lg cursor-pointer disabled:opacity-40 shrink-0"
        style={{
          width: 30, height: 30,
          background: 'var(--color-surface)', color: 'var(--color-muted)',
          border: '1px solid var(--color-border)', fontSize: 11,
        }}
      >
        ■
      </button>

      <input
        type="range"
        min={0}
        max={Math.max(1, totalBeats)}
        step={0.01}
        value={Math.min(positionBeats, totalBeats)}
        onChange={(e) => seekBeat(parseFloat(e.target.value))}
        disabled={!canPlay}
        title="拖动跳转"
        style={{ flex: 1, minWidth: 80, accentColor: 'var(--color-accent)', cursor: 'pointer' }}
      />

      <span
        className="text-xs font-mono shrink-0 playback-clock"
        style={{ color: 'var(--color-muted)' }}
      >
        {fmt(positionBeats, bpmForClock)} / {fmt(totalBeats, bpmForClock)}
      </span>

      <div className="flex items-center gap-1.5 shrink-0 playback-speed">
        <span className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>
          {rate.toFixed(1)}×
        </span>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.1}
          value={rate}
          onChange={(e) => setRate(parseFloat(e.target.value))}
          disabled={!canPlay}
          title="播放速度"
          style={{ accentColor: 'var(--color-accent)', cursor: 'pointer' }}
        />
      </div>

      {error && <span className="text-xs shrink-0" style={{ color: 'var(--color-accent)' }}>{error}</span>}
    </div>
  )
}
