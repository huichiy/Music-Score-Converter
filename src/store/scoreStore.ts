import { create } from 'zustand'
import type { Measure, NoteObject } from '@/types/score'
import { loadMeasuresPerLine } from '@/lib/layoutPrefs'

// What a finished load (or a part change, or text import) replaces. Applied in one `set`,
// so no subscriber ever sees the new measures next to the old part list or key.
type ScoreCore = Pick<ScoreStore,
  'originalMeasures' | 'originalKeyStr' | 'originalTimeStr' | 'originalTitleStr' | 'originalTempoStr' |
  'currentMeasures' | 'currentKeyStr' | 'transposeKey'>
export type ScorePatch = ScoreCore & Partial<Pick<ScoreStore,
  'currentFile' | 'parsedXmlDoc' | 'partNames' | 'selectedPartIdx' | 'showPartSelector' | 'showAutoDetect' | 'matchedMyPart'>>

interface ScoreStore {
  // File
  currentFile: File | null
  parsedXmlDoc: Document | null

  // Score state (mirrors old state.* globals)
  originalMeasures: Measure[] | null
  originalKeyStr: string
  originalTimeStr: string
  originalTitleStr: string
  originalTempoStr: string
  currentMeasures: Measure[] | null
  currentKeyStr: string

  // Parts (XML only)
  partNames: string[]
  selectedPartIdx: number
  showPartSelector: boolean
  showAutoDetect: boolean
  matchedMyPart: boolean   // the selected part came from the user's remembered instrument

  // Conversion UI
  isConverted: boolean
  isConverting: boolean
  errorMsg: string
  transposeKey: string
  measuresPerLine: number   // 0 = auto (wrap by width)

  // Editor A (click-to-edit)
  editModeA: boolean
  popupNote: { m: number; n: number; note: NoteObject } | null

  // Editor B (text mode)
  editTextVisible: boolean

  // OCR
  ocrFile: File | null
  ocrSource: File | null   // the whole picture ocrFile was cropped from (ocrFile itself when it is no crop)
  isOcrAnalyzing: boolean
  ocrError: string
  ocrMode: 'jianpu' | 'western'
  ocrResult: string | null // raw text from AI

  // Theme
  isDark: boolean

  // Actions
  setCurrentFile: (file: File | null) => void
  setParsedXmlDoc: (doc: Document | null) => void
  setOriginal: (
    measures: Measure[],
    keyStr: string,
    timeStr: string,
    titleStr: string,
    tempoStr: string,
  ) => void
  setCurrent: (measures: Measure[], keyStr: string) => void
  commitScore: (patch: ScorePatch) => void
  setPartNames: (names: string[]) => void
  setSelectedPartIdx: (idx: number) => void
  setShowPartSelector: (v: boolean) => void
  setShowAutoDetect: (v: boolean) => void
  setMatchedMyPart: (v: boolean) => void
  setIsConverted: (v: boolean) => void
  setIsConverting: (v: boolean) => void
  setErrorMsg: (msg: string) => void
  setTransposeKey: (key: string) => void
  setMeasuresPerLine: (n: number) => void
  setEditModeA: (on: boolean) => void
  setPopupNote: (note: { m: number; n: number; note: NoteObject } | null) => void
  setEditTextVisible: (v: boolean) => void
  setOcrFile: (file: File | null, source?: File) => void
  setIsOcrAnalyzing: (v: boolean) => void
  setOcrError: (msg: string) => void
  setOcrMode: (mode: 'jianpu' | 'western') => void
  setOcrResult: (text: string | null) => void
  setIsDark: (v: boolean) => void
  reset: () => void
}

const initialState = {
  currentFile: null,
  parsedXmlDoc: null,
  originalMeasures: null,
  originalKeyStr: 'C',
  originalTimeStr: '4/4',
  originalTitleStr: '',
  originalTempoStr: '',
  currentMeasures: null,
  currentKeyStr: 'C',
  partNames: [],
  selectedPartIdx: 0,
  showPartSelector: false,
  showAutoDetect: false,
  matchedMyPart: false,
  isConverted: false,
  isConverting: false,
  errorMsg: '',
  transposeKey: '',
  measuresPerLine: loadMeasuresPerLine(),
  editModeA: false,
  popupNote: null,
  editTextVisible: false,
  ocrFile: null,
  ocrSource: null,
  isOcrAnalyzing: false,
  ocrError: '',
  ocrMode: 'jianpu' as const,
  ocrResult: null,
  isDark: document.documentElement.getAttribute('data-theme') === 'dark',
}

export const useScoreStore = create<ScoreStore>()((set) => ({
  ...initialState,

  setCurrentFile: (file) => set({ currentFile: file }),
  setParsedXmlDoc: (doc) => set({ parsedXmlDoc: doc }),
  setOriginal: (measures, keyStr, timeStr, titleStr, tempoStr) =>
    set({ originalMeasures: measures, originalKeyStr: keyStr, originalTimeStr: timeStr, originalTitleStr: titleStr, originalTempoStr: tempoStr }),
  setCurrent: (measures, keyStr) => set({ currentMeasures: measures, currentKeyStr: keyStr }),
  commitScore: (patch) => set({ ...patch, isConverted: true, errorMsg: '' }),
  setPartNames: (names) => set({ partNames: names }),
  setSelectedPartIdx: (idx) => set({ selectedPartIdx: idx }),
  setShowPartSelector: (v) => set({ showPartSelector: v }),
  setShowAutoDetect: (v) => set({ showAutoDetect: v }),
  setMatchedMyPart: (v) => set({ matchedMyPart: v }),
  setIsConverted: (v) => set({ isConverted: v }),
  setIsConverting: (v) => set({ isConverting: v }),
  setErrorMsg: (msg) => set({ errorMsg: msg }),
  setTransposeKey: (key) => set({ transposeKey: key }),
  setMeasuresPerLine: (n) => set({ measuresPerLine: n }),
  setEditModeA: (on) => set({ editModeA: on }),
  setPopupNote: (note) => set({ popupNote: note }),
  setEditTextVisible: (v) => set({ editTextVisible: v }),
  setOcrFile: (file, source) => set({ ocrFile: file, ocrSource: file ? source ?? file : null }),
  setIsOcrAnalyzing: (v) => set({ isOcrAnalyzing: v }),
  setOcrError: (msg) => set({ ocrError: msg }),
  setOcrMode: (mode) => set({ ocrMode: mode }),
  setOcrResult: (text) => set({ ocrResult: text }),
  setIsDark: (v) => set({ isDark: v }),
  // measuresPerLine is read fresh: initialState's value is a snapshot from page
  // load, which would undo a choice the user made since (it IS persisted).
  reset: () => set({
    ...initialState,
    measuresPerLine: loadMeasuresPerLine(),
    isDark: document.documentElement.getAttribute('data-theme') === 'dark',
  }),
}))
