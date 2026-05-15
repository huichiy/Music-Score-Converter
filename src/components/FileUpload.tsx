import { useRef, useState, useCallback } from 'react'
import { useScoreStore } from '@/store/scoreStore'

interface FileUploadProps {
  onFile: (file: File) => void
}

const ACCEPT = '.xml,.mxl,.mid,.midi,.abc'

export default function FileUpload({ onFile }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const currentFile = useScoreStore((s) => s.currentFile)

  const handleFile = useCallback((file: File | null | undefined) => {
    if (!file) return
    useScoreStore.getState().setCurrentFile(file)
    onFile(file)
  }, [onFile])

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }
  const onDragLeave = () => setIsDragging(false)
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFile(e.dataTransfer.files[0])
  }
  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => handleFile(e.target.files?.[0])

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
        乐谱文件
      </label>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition-colors"
        style={{
          borderColor: isDragging ? 'var(--color-accent)' : 'var(--color-border)',
          background: isDragging ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'var(--color-surface-2)',
        }}
      >
        {currentFile ? (
          <div className="space-y-1">
            <div className="text-sm font-medium truncate max-w-full" title={currentFile.name}>
              {currentFile.name}
            </div>
            <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
              点击更换文件
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-sm font-medium">拖放文件到这里</div>
            <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
              或点击选择文件
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--color-muted)', fontSize: '10px' }}>
              XML · MXL · MID · ABC
            </div>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={onInputChange}
        onClick={(e) => { (e.target as HTMLInputElement).value = '' }}
      />
    </div>
  )
}
