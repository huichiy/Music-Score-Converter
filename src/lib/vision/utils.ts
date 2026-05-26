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

/** Get an Error message regardless of error shape. */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try { return JSON.stringify(e) } catch { return String(e) }
}
