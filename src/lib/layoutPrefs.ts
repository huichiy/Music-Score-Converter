// How many measures go on each rendered line, remembered per browser.
// 0 = auto: wrap whenever the next measure doesn't fit the width (the original
// behaviour). Chinese orchestra parts are usually printed 4 measures per line,
// which is what a tester asked for, so that is the default.

const MEASURES_PER_LINE_KEY = 'jianpu.measuresPerLine.v1'

export const MEASURES_PER_LINE_OPTIONS = [0, 2, 3, 4, 5, 6]
export const DEFAULT_MEASURES_PER_LINE = 4

export function loadMeasuresPerLine(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_MEASURES_PER_LINE
  try {
    const raw = localStorage.getItem(MEASURES_PER_LINE_KEY)
    // Missing or tampered values fall back to the default
    return raw !== null && MEASURES_PER_LINE_OPTIONS.includes(Number(raw)) ? Number(raw) : DEFAULT_MEASURES_PER_LINE
  } catch {
    return DEFAULT_MEASURES_PER_LINE
  }
}

export function saveMeasuresPerLine(n: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(MEASURES_PER_LINE_KEY, String(n))
  } catch {
    // Private-mode or quota failures: the choice just isn't remembered
  }
}
