import { useCallback } from 'react'
import { useScoreStore } from '@/store/scoreStore'
import { buildAdapter, buildEnv, loadOcrConfig } from '@/lib/vision'
import { normalizeOcrText, extractOcrError } from '@/lib/vision/utils'

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
    if (!file.type.startsWith('image/')) { store.setOcrError('请上传图片文件'); return }
    if (file.size > 5 * 1024 * 1024) { store.setOcrError('图片不能超过 5MB'); return }
    store.setOcrFile(file)
    store.setOcrError('')
  }, [store])

  const runOcr = useCallback(async () => {
    const { ocrFile } = useScoreStore.getState()
    if (!ocrFile) { store.setOcrError('请先选择图片'); return }
    store.setIsOcrAnalyzing(true)
    store.setOcrError('')
    store.setOcrResult(null)
    try {
      // Normalize BEFORE storing: what the user sees in the result box is
      // exactly what parseFromText will consume on 渲染为简谱
      const text = normalizeOcrText(await analyzeImage(ocrFile))
      const sentinel = extractOcrError(text)
      if (sentinel) {
        store.setOcrError(sentinel)
      } else {
        store.setOcrResult(text)
      }
    } catch (err) {
      store.setOcrError((err as Error).message || '识别失败，请重试')
    } finally {
      store.setIsOcrAnalyzing(false)
    }
  }, [store, analyzeImage])

  const resetOcr = useCallback(() => {
    store.setOcrFile(null)
    store.setOcrError('')
    store.setOcrResult(null)
  }, [store])

  return { handleOcrFile, runOcr, resetOcr }
}
