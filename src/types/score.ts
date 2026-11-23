export interface ChordNote {
  degree: number
  octave: number
  accidental: '#' | 'b' | ''
}

export type Articulation = 'accent' | 'staccato' | 'tenuto' | 'marcato' | 'fermata' | ''

export interface GraceNote {
  degree: number
  octave: number
  accidental: '#' | 'b' | ''
}

export interface NoteObject {
  degree: number          // 1–7; 0 = rest, or an unpitched hit (percussion, drawn X) when `rest` is false
  octave: number
  type: 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd'
  dot: boolean
  tie: boolean
  rest: boolean
  accidental: '#' | 'b' | ''
  slurStart: boolean
  slurStop: boolean
  chordNotes?: ChordNote[]
  articulation?: Articulation
  graceNote?: GraceNote | null
  tuplet?: number
  tupletLen?: number      // on a tuplet group's FIRST note, when the group isn't `tuplet` notes long: how many it has (quarter + eighth triplet = 2)
}

/** Percussion hit with no pitch (MusicXML <unpitched>): written X in Jianpu, has a length but no degree. */
export function isUnpitched(n: NoteObject): boolean {
  return !n.rest && !n.tie && n.degree === 0
}

export interface MeasureArray extends Array<NoteObject> {
  _repeatStart?: boolean
  _repeatEnd?: boolean
  _direction?: string
  _dynamic?: string
  _wedge?: 'cresc' | 'dim' | null
  _volta?: number
  _timeSig?: string
  _key?: string          // mid-piece key change: degrees from this measure on are relative to this key, e.g. 'D'
  _pickup?: boolean      // 弱起: an incomplete first measure, drawn but not counted in the measure numbers
}

export interface MultiRestBlock {
  _multiRest: number
}

export type Measure = MeasureArray | MultiRestBlock

export function isMeasureArray(m: Measure): m is MeasureArray {
  return Array.isArray(m)
}

export function isMultiRest(m: Measure): m is MultiRestBlock {
  return !Array.isArray(m) && '_multiRest' in m
}
