import { create } from 'zustand'
import type { Measure, NoteObject } from '@/types/score'

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

  // Conversion UI
  isConverted: boolean
  isConverting: boolean
  errorMsg: string
  transposeKey: string

  // Editor A (click-to-edit)
  editModeA: boolean
  popupNote: { m: number; n: number; note: NoteObject } | null

  // Editor B (text mode)
  editTextVisible: boolean

  // OCR
  ocrFile: File | null
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
  setPartNames: (names: string[]) => void
  setSelectedPartIdx: (idx: number) => void
  setShowPartSelector: (v: boolean) => void
  setShowAutoDetect: (v: boolean) => void
  setIsConverted: (v: boolean) => void
  setIsConverting: (v: boolean) => void
  setErrorMsg: (msg: string) => void
  setTransposeKey: (key: string) => void
  setEditModeA: (on: boolean) => void
  setPopupNote: (note: { m: number; n: number; note: NoteObject } | null) => void
  setEditTextVisible: (v: boolean) => void
  setOcrFile: (file: File | null) => void
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
  isConverted: false,
  isConverting: false,
  errorMsg: '',
  transposeKey: '',
  editModeA: false,
  popupNote: null,
  editTextVisible: false,
  ocrFile: null,
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
  setPartNames: (names) => set({ partNames: names }),
  setSelectedPartIdx: (idx) => set({ selectedPartIdx: idx }),
  setShowPartSelector: (v) => set({ showPartSelector: v }),
  setShowAutoDetect: (v) => set({ showAutoDetect: v }),
  setIsConverted: (v) => set({ isConverted: v }),
  setIsConverting: (v) => set({ isConverting: v }),
  setErrorMsg: (msg) => set({ errorMsg: msg }),
  setTransposeKey: (key) => set({ transposeKey: key }),
  setEditModeA: (on) => set({ editModeA: on }),
  setPopupNote: (note) => set({ popupNote: note }),
  setEditTextVisible: (v) => set({ editTextVisible: v }),
  setOcrFile: (file) => set({ ocrFile: file }),
  setIsOcrAnalyzing: (v) => set({ isOcrAnalyzing: v }),
  setOcrError: (msg) => set({ ocrError: msg }),
  setOcrMode: (mode) => set({ ocrMode: mode }),
  setOcrResult: (text) => set({ ocrResult: text }),
  setIsDark: (v) => set({ isDark: v }),
  reset: () => set({ ...initialState, isDark: document.documentElement.getAttribute('data-theme') === 'dark' }),
}))
