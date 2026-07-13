// Shared helpers used by every adapter.

/** Convert a File/Blob to a base64 string (no data: prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/** Inspect a known "image is wrong type" sentinel and rethrow as a friendlier error. */
export function unwrapModeError(text: string): string {
  if (text.startsWith('[错误：') || text.startsWith('[Error:')) {
    throw new Error(text.replace(/^\[错误：|^\[Error:\s*/, '').replace(/\]$/, ''))
  }
  return text
}

/**
 * Normalize raw OCR model output into Route B text (docs/JIANPU_FORMAT.md):
 * - strip markdown code fences
 * - full-width punctuation/digits/space → half-width (｜ ： ． ， ＃ and ０-９)
 * - legacy dialect fallback: `_` → `/` (underscore has no meaning in Route B)
 * - deliberately does NOT touch `1.` — the dot is the dotted-quarter suffix and
 *   cannot be safely disambiguated from a legacy low-octave dot; the prompts
 *   forbid the dot dialect instead.
 */
export function normalizeOcrText(raw: string): string {
  let s = raw.replace(/```[a-zA-Z]*\n?/g, '')
  const charMap: Record<string, string> = {
    '｜': '|', '：': ':', '．': '.', '，': ',', '＃': '#', '　': ' ',
  }
  s = s.replace(/[｜：．，＃　]/g, (c) => charMap[c])
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30))
  s = s.replace(/_/g, '/')
  return s.split('\n').map(l => l.trimEnd()).join('\n').trim()
}

/**
 * If the text is an OCR error sentinel — `[错误：…]` or `[Error: …]` — return
 * the inner message; otherwise null. Accepts half-width colons too because
 * normalizeOcrText converts 全角 punctuation before this check runs.
 */
export function extractOcrError(text: string): string | null {
  const m = text.trim().match(/^\[(?:错误\s*[：:]|Error:)\s*([\s\S]*?)\]$/)
  return m ? m[1].trim() : null
}

/** Get an Error message regardless of error shape. */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try { return JSON.stringify(e) } catch { return String(e) }
}
