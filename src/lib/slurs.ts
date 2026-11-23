import type { Measure, NoteObject } from '@/types/score'

/**
 * The slurs a score can actually show, as start note → stop note. The model has one arc
 * at a time (slurStart / slurStop flags, no numbers), so a start only counts when the
 * next slur event after it is a stop. A start that never closes (its end was edited into
 * a rest, or lives in a voice we don't convert) would otherwise trail an arc across every
 * following line, and make the text editor close it on some later, unrelated slur.
 *
 * On one note the stop comes before the start: `( 1 ( 2 ) 3 )` ends one slur on 2 and
 * opens the next there. Rests never carry a slur.
 */
export function slurPairs(measures: Measure[]): Map<NoteObject, NoteObject> {
  const pairs = new Map<NoteObject, NoteObject>()
  let open: NoteObject | null = null
  for (const m of measures) {
    if (!Array.isArray(m)) continue
    for (const note of m as NoteObject[]) {
      if (note.rest) continue
      if (note.slurStop && open) { pairs.set(open, note); open = null }
      if (note.slurStart) open = note
    }
  }
  return pairs
}
