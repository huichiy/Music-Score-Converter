// Route B header lines (`Title:` / `Key:` / `Time:` / `Tempo:`). One reader for the text
// editor and for OCR merging, so a line one of them calls a header is never read as
// notes by the other.

const FIELD = '(?:Title|Key|Time|Tempo)\\s*[:：]'
export const HEADER_LINE_RE = new RegExp(`^\\s*${FIELD}`, 'i')

export interface HeaderFields { title?: string; key?: string; time?: string; tempo?: string }

/** One line, whitespace collapsed: a line break inside a title would end the header early. */
export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim()
}

// "G", "Bb", "B♭", "F♯", and the printed forms "1=G", "♭B", "bB", "#F"
function readKey(s: string): string | undefined {
  const m = s.match(/^\s*(?:1\s*=\s*)?([b♭#♯]?)\s*([A-G])([b♭#♯]?)/)
  if (!m) return undefined
  const acc = m[1] || m[3]
  return m[2] + (acc === 'b' || acc === '♭' ? 'b' : acc === '#' || acc === '♯' ? '#' : '')
}

function readTime(s: string): string | undefined {
  const m = s.match(/^\s*(\d+)\s*\/\s*(\d+)/)
  if (m) return `${m[1]}/${m[2]}`
  if (/^\s*C\s*\|/.test(s)) return '2/2'
  if (/^\s*C\b/.test(s)) return '4/4'
  return undefined
}

// "120", "♩=120", "1/4=120", "c. 100": the number after the last "=", else the first one
function readTempo(s: string): string | undefined {
  const tail = s.includes('=') ? s.slice(s.lastIndexOf('=') + 1) : s
  const n = parseFloat(tail.match(/\d+(?:\.\d+)?/)?.[0] ?? '')
  return n > 0 ? String(Math.round(n)) : undefined
}

/**
 * The fields on one header line, or null when it isn't one. A `Title:` line is all
 * title; Key / Time / Tempo may share a line (`Key: C   Time: 4/4   Tempo: 120`).
 */
export function parseHeaderLine(line: string): HeaderFields | null {
  if (!HEADER_LINE_RE.test(line)) return null
  const title = line.match(/^\s*Title\s*[:：]\s*(.*)$/i)
  if (title) {
    const t = cleanTitle(title[1])
    return t ? { title: t } : {}
  }
  const out: HeaderFields = {}
  const re = new RegExp(`(Key|Time|Tempo)\\s*[:：]([\\s\\S]*?)(?=\\b${FIELD}|$)`, 'gi')
  for (const m of line.matchAll(re)) {
    const name = m[1].toLowerCase()
    if (name === 'key') out.key ??= readKey(m[2])
    else if (name === 'time') out.time ??= readTime(m[2])
    else out.tempo ??= readTempo(m[2])
  }
  return out
}
