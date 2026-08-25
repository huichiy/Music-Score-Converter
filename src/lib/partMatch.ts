// "Which part is mine?" — remembering the user's own instrument.
//
// A Chinese orchestra score has many parts, and auto-detection can only guess
// at ONE default: the melody. That guess is wrong for everyone playing an
// inner or bass voice (大提琴, 中阮, 扬琴, 革胡…), who would otherwise have to
// re-pick their part on every single file.
//
// Rather than interrogating people up front — most uploads are single-part, so
// asking would be pure friction — we learn from behaviour: whatever part you
// choose by hand is remembered, and matched automatically next time.

const MY_PART_KEY = 'jianpu.myPart.v1'

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Index of the part matching `remembered`, or -1 when there is no usable match
 * (the caller then falls back to melody scoring).
 *
 * Exact matches win over substring matches, otherwise a remembered "二胡 II"
 * would settle on "二胡 I" simply because it appears earlier.
 */
export function matchPartIndex(names: string[], remembered: string | null): number {
  if (!remembered) return -1
  const want = normalize(remembered)
  if (!want) return -1

  const norm = names.map(normalize)

  const exact = norm.indexOf(want)
  if (exact !== -1) return exact

  // Either direction: the score may name the part more fully than the user's
  // remembered label ("Cello 大提琴" vs "大提琴"), or less fully.
  return norm.findIndex((n) => n.length > 0 && (n.includes(want) || want.includes(n)))
}

/** The instrument the user last chose by hand, or null. */
export function loadMyPart(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const v = localStorage.getItem(MY_PART_KEY)
    return v && v.trim() ? v : null
  } catch {
    return null
  }
}

/** Remember the part the user just picked, so later scores default to it. */
export function saveMyPart(name: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (name.trim()) localStorage.setItem(MY_PART_KEY, name)
  } catch {
    // Private-mode or quota failures are not worth surfacing — the feature
    // degrades to "auto-detect every time", which is the old behaviour.
  }
}

/** Forget it — the user changed instrument, or wants auto-detection back. */
export function clearMyPart(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(MY_PART_KEY)
  } catch {
    // ignore
  }
}
