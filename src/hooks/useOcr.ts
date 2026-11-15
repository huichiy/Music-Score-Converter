import { useCallback } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { buildAdapter, buildEnv, loadOcrConfig } from '@/lib/vision'
import {
  normalizeOcrText, extractOcrError, mergeOcrResults, ocrMergeBase, resolveOcrImageType,
  type MergeRecord,
} from '@/lib/vision/utils'

// Identifies the latest OCR run. A run only writes its result if it is still
// the latest AND its file is still the selected one — otherwise the user has
// since reset, picked another file or started over, and a late answer would
// land under the wrong picture.
let currentRun = 0
// Lets a retry of the same picture replace its own contribution (see ocrMergeBase)
let lastMerge: MergeRecord | null = null

/**
 * OCR hook — provider-agnostic. The actual model + endpoint comes from the
 * user's saved BYOK config (or the built-in worker / dev fallback). This hook
 * stays the same regardless of which provider is active.
 */
export function useOcr() {
  const store = useScoreStore()

  const analyzeImage = useCallback(async (file: File): Promise<string> => {
    const config = loadOcrConfig()
    const env = buildEnv()
    const adapter = buildAdapter(config, env)
    const { ocrMode } = useScoreStore.getState()
    return await adapter.transcribe(file, ocrMode)
  }, [])

  const handleOcrFile = useCallback((file: File | null) => {
    if (!file) return
    // Swapping the file mid-run would pair its answer with the wrong picture
    if (useScoreStore.getState().isOcrAnalyzing) return
    // Only formats every provider accepts; an iPhone HEIC photo would otherwise fail deep inside the API call
    const type = resolveOcrImageType(file.name, file.type)
    if (!type) { store.setOcrError('仅支持 PNG / JPG / WebP / GIF 图片（iPhone 的 HEIC 照片请先转成 JPG）'); return }
    // Cropper / PDF-picker output is already re-encoded to fit, so this only bites real uploads
    if (file.size > 5 * 1024 * 1024) { store.setOcrError('图片不能超过 5MB'); return }
    // Some browsers give an empty type; adapters read file.type, so make it explicit
    store.setOcrFile(file.type === type ? file : new File([file], file.name, { type }))
    store.setOcrError('')
  }, [store])

  const runOcr = useCallback(async () => {
    const { ocrFile, isOcrAnalyzing } = useScoreStore.getState()
    if (isOcrAnalyzing) return
    if (!ocrFile) { store.setOcrError('请先选择图片'); return }
    const run = ++currentRun
    const isCurrent = () => run === currentRun && useScoreStore.getState().ocrFile === ocrFile
    store.setIsOcrAnalyzing(true)
    store.setOcrError('')
    // The previous result is kept on purpose: each 框选 crop is one request,
    // and the result box accumulates them (see mergeOcrResults)
    try {
      // Normalize BEFORE storing: what the user sees in the result box is
      // exactly what parseFromText will consume on 渲染为简谱
      const text = normalizeOcrText(await analyzeImage(ocrFile))
      if (!isCurrent()) return
      const sentinel = extractOcrError(text)
      if (sentinel) {
        store.setOcrError(sentinel)
      } else {
        const base = ocrMergeBase(useScoreStore.getState().ocrResult, lastMerge, ocrFile)
        const produced = mergeOcrResults(base, text)
        lastMerge = { source: ocrFile, base, produced }
        store.setOcrResult(produced)
      }
    } catch (err) {
      if (isCurrent()) store.setOcrError((err as Error).message || '识别失败，请重试')
    } finally {
      if (run === currentRun) store.setIsOcrAnalyzing(false)
    }
  }, [store, analyzeImage])

  const resetOcr = useCallback(() => {
    currentRun++   // orphan any run still in flight
    lastMerge = null
    store.setIsOcrAnalyzing(false)
    store.setOcrFile(null)
    store.setOcrError('')
    store.setOcrResult(null)
  }, [store])

  return { handleOcrFile, runOcr, resetOcr }
}
