import { useCallback } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { buildAdapter, buildEnv, loadOcrConfig } from '@/lib/vision'
import {
  normalizeOcrText, extractOcrError, mergeOcrResults, ocrMergeBase, resolveOcrImageType,
  type MergeRecord,
} from '@/lib/vision/utils'
import { rememberCropSource } from '@/lib/cropTools'

// Identifies the latest OCR run. A run only writes its result if it is still
// the latest AND its file is still the selected one — otherwise the user has
// since reset, cancelled, picked another file or started over, and a late
// answer would land under the wrong picture.
let currentRun = 0
// The request of that run, so 取消 / 重置 also ends the network call instead of
// leaving it to run out its 3 minutes
let currentAbort: AbortController | null = null
// Lets a retry of the same picture replace its own contribution (see ocrMergeBase)
let lastMerge: MergeRecord | null = null

/**
 * OCR hook — provider-agnostic. The actual model + endpoint comes from the
 * user's saved BYOK config (or the built-in worker / dev fallback). This hook
 * stays the same regardless of which provider is active.
 */
export function useOcr() {
  const store = useScoreStore()

  const analyzeImage = useCallback(async (file: File, signal: AbortSignal): Promise<string> => {
    const config = loadOcrConfig()
    const env = buildEnv()
    const adapter = buildAdapter(config, env)
    const { ocrMode } = useScoreStore.getState()
    return await adapter.transcribe(file, ocrMode, signal)
  }, [])

  /**
   * Select `file` for OCR. `source` is the whole picture a crop was cut from
   * (see cropTools.cropSourceOf): 框选区域 opens on it again, so cropping a
   * second row never means cropping the first crop.
   */
  const handleOcrFile = useCallback((file: File | null, source?: File) => {
    if (!file) return
    // Swapping the file mid-run would pair its answer with the wrong picture
    if (useScoreStore.getState().isOcrAnalyzing) return
    // Only formats every provider accepts; an iPhone HEIC photo would otherwise fail deep inside the API call
    const type = resolveOcrImageType(file.name, file.type)
    if (!type) { store.setOcrError('仅支持 PNG / JPG / WebP / GIF 图片（iPhone 的 HEIC 照片请先转成 JPG）'); return }
    // Cropper / PDF-picker output is already re-encoded to fit, so this only bites real uploads
    if (file.size > 5 * 1024 * 1024) { store.setOcrError('图片不能超过 5MB'); return }
    // Some browsers give an empty type; adapters read file.type, so make it explicit
    const stored = file.type === type ? file : new File([file], file.name, { type })
    if (source && source !== stored) rememberCropSource(stored, source)
    store.setOcrFile(stored)
    store.setOcrError('')
  }, [store])

  const runOcr = useCallback(async () => {
    const { ocrFile, isOcrAnalyzing } = useScoreStore.getState()
    if (isOcrAnalyzing) return
    if (!ocrFile) { store.setOcrError('请先选择图片'); return }
    const run = ++currentRun
    const abort = new AbortController()
    currentAbort = abort
    const isCurrent = () => run === currentRun && useScoreStore.getState().ocrFile === ocrFile
    store.setIsOcrAnalyzing(true)
    store.setOcrError('')
    // The previous result is kept on purpose: each 框选 crop is one request,
    // and the result box accumulates them (see mergeOcrResults)
    try {
      // Normalize BEFORE storing: what the user sees in the result box is
      // exactly what parseFromText will consume on 渲染为简谱
      const text = normalizeOcrText(await analyzeImage(ocrFile, abort.signal))
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
      if (currentAbort === abort) currentAbort = null
    }
  }, [store, analyzeImage])

  /**
   * 取消: give up on the run in flight. The file and any result already in the
   * box stay as they are; the late answer (if one ever comes) is dropped by the
   * run token.
   */
  const cancelOcr = useCallback(() => {
    currentRun++
    currentAbort?.abort()
    currentAbort = null
    store.setIsOcrAnalyzing(false)
    store.setOcrError('')
  }, [store])

  const resetOcr = useCallback(() => {
    currentRun++   // orphan any run still in flight
    currentAbort?.abort()
    currentAbort = null
    lastMerge = null
    store.setIsOcrAnalyzing(false)
    store.setOcrFile(null)
    store.setOcrError('')
    store.setOcrResult(null)
  }, [store])

  return { handleOcrFile, runOcr, cancelOcr, resetOcr }
}
