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
  degree: number
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
}

export interface MeasureArray extends Array<NoteObject> {
  _repeatStart?: boolean
  _repeatEnd?: boolean
  _direction?: string
  _dynamic?: string
  _wedge?: 'cresc' | 'dim' | null
  _volta?: number
  _timeSig?: string
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
