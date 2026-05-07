interface LandingPageProps {
  onLoadSample: () => void
}

const features = [
  { icon: '🎼', title: 'MusicXML / MXL', desc: '从 MuseScore、Sibelius 或 Finale 导出的乐谱文件' },
  { icon: '🎹', title: 'MIDI', desc: '标准 MIDI 文件，自动提取旋律声部' },
  { icon: '🎵', title: 'ABC Notation', desc: '开放文本格式的简谱，轻量易编辑' },
  { icon: '📷', title: 'OCR 图片识别', desc: '上传简谱或五线谱图片，AI 自动转录' },
]

export default function LandingPage({ onLoadSample }: LandingPageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-full px-8 py-16 text-center">
      <div className="max-w-xl w-full">
        <h1
          className="text-5xl font-bold mb-4 tracking-tight"
          style={{ color: 'var(--color-foreground)' }}
        >
          简谱转换
        </h1>
        <p className="text-xl mb-2" style={{ color: 'var(--color-muted)' }}>
          Jianpu Converter
        </p>
        <p className="text-base mb-10 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          将 MusicXML、MIDI、ABC 乐谱文件转换为中国简谱，专为中国管弦乐团演奏者设计。
        </p>

        <div className="grid grid-cols-2 gap-3 mb-10 text-left">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl p-4"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="text-2xl mb-2">{f.icon}</div>
              <div className="font-semibold text-sm mb-1">{f.title}</div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                {f.desc}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-3">
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            从侧边栏上传文件，或
          </p>
          <button
            onClick={onLoadSample}
            className="px-6 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            style={{
              background: 'var(--color-accent)',
              color: '#fff',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent)' }}
          >
            试试示例乐谱
          </button>
        </div>
      </div>
    </div>
  )
}
