import { useState, useEffect } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import type { NoteObject } from '@/types/score'

interface EditNotePopupProps {
  onConfirm: (m: number, n: number, updated: Partial<NoteObject>) => void
  onClose: () => void
}

const DEGREES = [1, 2, 3, 4, 5, 6, 7]
const TYPES = ['whole', 'half', 'quarter', 'eighth', '16th'] as const

export default function EditNotePopup({ onConfirm, onClose }: EditNotePopupProps) {
  const popupNote = useScoreStore((s) => s.popupNote)

  const [degree, setDegree] = useState(1)
  const [octave, setOctave] = useState(0)
  const [type, setType] = useState<NoteObject['type']>('quarter')
  const [dot, setDot] = useState(false)
  const [accidental, setAccidental] = useState<'#' | 'b' | ''>('')
  const [isRest, setIsRest] = useState(false)

  useEffect(() => {
    if (!popupNote) return
    const n = popupNote.note
    setDegree(n.rest ? 0 : n.degree)
    setOctave(n.octave)
    setType(n.type)
    setDot(n.dot)
    setAccidental(n.accidental)
    setIsRest(n.rest)
  }, [popupNote])

  if (!popupNote) return null

  const handleConfirm = () => {
    onConfirm(popupNote.m, popupNote.n, {
      degree: isRest ? 0 : degree,
      octave,
      type,
      dot,
      accidental: isRest ? '' : accidental,
      rest: isRest,
    })
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '16px',
    padding: '24px',
    width: '320px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--color-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    display: 'block',
    marginBottom: '6px',
  }

  const selectStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-foreground)',
    borderRadius: '8px',
    padding: '6px 10px',
    fontSize: '13px',
    outline: 'none',
    cursor: 'pointer',
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: '15px' }}>编辑音符</div>

        {/* Rest toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
          <input
            type="checkbox"
            checked={isRest}
            onChange={(e) => setIsRest(e.target.checked)}
            style={{ accentColor: 'var(--color-accent)', width: '14px', height: '14px' }}
          />
          休止符
        </label>

        {!isRest && (
          <>
            {/* Degree */}
            <div>
              <span style={labelStyle}>音级</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                {DEGREES.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDegree(d)}
                    style={{
                      flex: 1,
                      padding: '6px 0',
                      borderRadius: '6px',
                      border: `1px solid ${degree === d ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: degree === d ? 'var(--color-accent)' : 'var(--color-surface-2)',
                      color: degree === d ? '#fff' : 'var(--color-foreground)',
                      fontSize: '13px',
                      cursor: 'pointer',
                      fontWeight: degree === d ? 700 : 400,
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Octave */}
            <div>
              <span style={labelStyle}>八度</span>
              {/* ±3 so low parts (大提琴 / 革胡 / 大阮) are reachable — they sit
                  three octaves below the tonic often enough to matter */}
              <div style={{ display: 'flex', gap: '4px' }}>
                {([-3, -2, -1, 0, 1, 2, 3] as const).map((o) => (
                  <button
                    key={o}
                    onClick={() => setOctave(o)}
                    style={{
                      flex: 1,
                      padding: '6px 0',
                      borderRadius: '6px',
                      border: `1px solid ${octave === o ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: octave === o ? 'var(--color-accent)' : 'var(--color-surface-2)',
                      color: octave === o ? '#fff' : 'var(--color-foreground)',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    {o > 0 ? `+${o}` : o}
                  </button>
                ))}
              </div>
            </div>

            {/* Accidental */}
            <div>
              <span style={labelStyle}>升降号</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                {(['#', '', 'b'] as const).map((a) => (
                  <button
                    key={a || 'nat'}
                    onClick={() => setAccidental(a)}
                    style={{
                      flex: 1,
                      padding: '6px 0',
                      borderRadius: '6px',
                      border: `1px solid ${accidental === a ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: accidental === a ? 'var(--color-accent)' : 'var(--color-surface-2)',
                      color: accidental === a ? '#fff' : 'var(--color-foreground)',
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    {a === '#' ? '♯' : a === 'b' ? '♭' : '♮'}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Note type */}
        <div>
          <span style={labelStyle}>时值</span>
          <select value={type} onChange={(e) => setType(e.target.value as NoteObject['type'])} style={selectStyle}>
            <option value="whole">全音符</option>
            <option value="half">二分音符</option>
            <option value="quarter">四分音符</option>
            <option value="eighth">八分音符</option>
            <option value="16th">十六分音符</option>
          </select>
        </div>

        {/* Dot */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
          <input
            type="checkbox"
            checked={dot}
            onChange={(e) => setDot(e.target.checked)}
            style={{ accentColor: 'var(--color-accent)', width: '14px', height: '14px' }}
          />
          附点
        </label>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleConfirm}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: '8px',
              background: 'var(--color-accent)',
              color: '#fff',
              border: 'none',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            确认
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: '8px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-muted)',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
