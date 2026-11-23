// Reading a time signature string. "4/4" is the usual shape, but ABC and MusicXML also
// give additive meters ("3+2/8") and ABC gives "none" for free meter.

export interface Meter { beats: number; beatType: number }

/** Numerator (additive parts summed) and denominator; 4/4 when the string can't be read. */
export function parseMeter(timeStr: string | undefined | null): Meter {
  const m = (timeStr ?? '').match(/^\s*(\d+(?:\s*\+\s*\d+)*)\s*\/\s*(\d+)\s*$/)
  if (!m) return { beats: 4, beatType: 4 }
  const beats = m[1].split('+').reduce((sum, p) => sum + parseInt(p), 0)
  // Clamped: the renderer draws one symbol per beat of a silent bar, so a mistyped
  // "44444444/4" would hang the page
  return { beats: Math.min(beats, 64) || 4, beatType: Math.min(parseInt(m[2]), 64) || 4 }
}

/** Bar length in quarter notes: 4/4 → 4, 6/8 → 3, 2/2 → 4, 3+2/8 → 2.5. */
export function barBeatsOf(timeStr: string | undefined | null): number {
  const { beats, beatType } = parseMeter(timeStr)
  return (beats * 4) / beatType
}
