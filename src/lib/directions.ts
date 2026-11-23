// The one classifier for a measure's direction text (Fine / D.C. / D.S. / Segno / Coda).
// Import (what to keep), playback (where to jump) and Route B (which tag to write) all
// use it. Two copies drifted before: playback followed "Da Capo al Fine", the text
// editor dropped it, so opening and saving a score changed how it was performed.

export type DirectionKind = 'fine' | 'dc' | 'ds' | 'segno' | 'tocoda' | 'coda' | null

/**
 * Case-insensitive match on how the text STARTS, because MusicXML keeps the printed
 * words ("D.C. al Fine", "DS al Coda", "Da Capo") and engravers differ on the dots.
 */
export function classifyDirection(text: string | undefined | null): DirectionKind {
  const d = (text ?? '').trim().toLowerCase()
  if (!d) return null
  if (/^fine\b/.test(d)) return 'fine'
  if (/^(d\.?\s*c\b|da\s+capo\b)/.test(d)) return 'dc'
  if (/^(d\.?\s*s\b|dal\s+segno\b)/.test(d)) return 'ds'
  if (/^(segno\b|𝄋)/u.test(d)) return 'segno'
  if (/^to\s+coda\b/.test(d)) return 'tocoda'
  if (/^(coda\b|𝄌)/u.test(d)) return 'coda'
  return null
}
