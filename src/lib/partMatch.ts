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
 * Names the app invents when a score doesn't name its parts ("Part 2", "Track 3",
 * MuseScore's "P1"). They say nothing about the instrument, and "Part 2" in one
 * score is a different instrument in the next — remembering one would auto-select
 * that index in every unnamed score.
 */
export function isGenericPartName(name: string): boolean {
  return /^(?:part|track|musicxml part|声部|音轨)\s*\d*$/i.test(name.trim())
    || /^p\d+$/i.test(name.trim())
}

// "Flute" is a whole-word prefix of "Flute 2" but only an inner substring of
// "Alto Flute". After an ASCII letter, a prefix must end at a word boundary
// ("Flute" must not claim "Fluted"); CJK has no spaces, so any prefix counts.
function isPrefixMatch(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (!longer.startsWith(shorter)) return false
  return !/[a-z0-9]$/.test(shorter) || !/^[a-z0-9]/.test(longer.slice(shorter.length))
}

/**
 * Index of the part matching `remembered`, or -1 when there is no usable match
 * (the caller then falls back to melody scoring).
 *
 * Tiers, best first: exact, then prefix, then any substring. Exact beats
 * substring, otherwise a remembered "二胡 II" would settle on "二胡 I" simply
 * because it appears earlier; prefix beats inner substring, so a remembered
 * "Flute" picks "Flute 2" rather than "Alto Flute".
 */
export function matchPartIndex(names: string[], remembered: string | null): number {
  if (!remembered) return -1
  const want = normalize(remembered)
  if (!want) return -1

  const norm = names.map(normalize)

  const exact = norm.indexOf(want)
  if (exact !== -1) return exact

  const prefix = norm.findIndex((n) => n.length > 0 && isPrefixMatch(n, want))
  if (prefix !== -1) return prefix

  // Either direction: the score may name the part more fully than the user's
  // remembered label ("Cello 大提琴" vs "大提琴"), or less fully.
  return norm.findIndex((n) => n.length > 0 && (n.includes(want) || want.includes(n)))
}

/** The instrument the user last chose by hand, or null. */
export function loadMyPart(): string | null {
  // No `typeof localStorage` guard outside the try: with storage blocked the
  // global getter itself throws, and this runs while a score is loading.
  try {
    const v = localStorage.getItem(MY_PART_KEY)
    // An auto-generated name saved by an older build would select that index in every unnamed score
    return v && v.trim() && !isGenericPartName(v) ? v : null
  } catch {
    return null
  }
}

/** Remember the part the user just picked, so later scores default to it. */
export function saveMyPart(name: string): void {
  try {
    if (name.trim() && !isGenericPartName(name)) localStorage.setItem(MY_PART_KEY, name)
  } catch {
    // Private-mode or quota failures are not worth surfacing — the feature
    // degrades to "auto-detect every time", which is the old behaviour.
  }
}

/** Forget it — the user changed instrument, or wants auto-detection back. */
export function clearMyPart(): void {
  try {
    localStorage.removeItem(MY_PART_KEY)
  } catch {
    // ignore
  }
}
