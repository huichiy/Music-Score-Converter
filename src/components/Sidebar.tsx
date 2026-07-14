import FileUpload from './FileUpload'
import PartSelector from './PartSelector'
import TransposeSelect from './TransposeSelect'
import ExportButtons from './ExportButtons'
import OcrSection from './OcrSection'

interface SidebarProps {
  onFile: (file: File) => void
  onPartChange: (idx: number) => void
  onTranspose: (key: string) => void
  onOcrScore: (svgHtml: string) => void
  loadFromText: (text: string) => string
  svgRef: React.RefObject<HTMLDivElement | null>
  isDark: boolean
  onThemeToggle: () => void
  onBackToLanding: () => void
}

export default function Sidebar({
  onFile,
  onPartChange,
  onTranspose,
  onOcrScore,
  loadFromText,
  svgRef,
  isDark,
  onThemeToggle,
  onBackToLanding,
}: SidebarProps) {
  return (
    <aside className="app-sidebar flex flex-col overflow-y-auto scrollbar-hide">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div
          onClick={onBackToLanding}
          className="cursor-pointer select-none"
          title="回到首页"
        >
          <div className="font-bold text-base">简谱转换</div>
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>Jianpu Converter</div>
        </div>
        <button
          onClick={onThemeToggle}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-muted)',
            fontSize: '14px',
          }}
          title={isDark ? '切换亮色' : '切换暗色'}
        >
          {isDark ? '☀' : '☾'}
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4 px-4 py-4 flex-1">
        {/* Input section */}
        <FileUpload onFile={onFile} />
        <PartSelector onPartChange={onPartChange} />
        <TransposeSelect onTranspose={onTranspose} />

        {/* Divider: input → output */}
        <div style={{ height: '0.5px', background: 'var(--color-border)', margin: '0 -4px' }} />

        {/* Output section */}
        <ExportButtons svgRef={svgRef} isDark={isDark} />
        <OcrSection onOcrScore={onOcrScore} loadFromText={loadFromText} />
      </div>

      {/* Footer */}
      <div
        className="px-4 py-3 shrink-0"
        style={{
          borderTop: '1px solid var(--color-border)',
          fontSize: '10px',
          color: 'var(--color-muted)',
        }}
      >
        <button
          onClick={onBackToLanding}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }}
        >
          首页
        </button>
        {' · '}
        <a href="https://github.com/huichiy/Music-Score-Converter" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
          GitHub
        </a>
        {' · '}
        <a href="https://ko-fi.com/huichiy" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
          Ko-fi ☕
        </a>
      </div>
    </aside>
  )
}
