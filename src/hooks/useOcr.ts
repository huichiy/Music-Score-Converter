import { useCallback } from 'react'
import { useScoreStore } from '@/store/scoreStore'

const JIANPU_OCR_PROMPT = `你是简谱专家。仔细分析这张简谱图片，逐小节转录乐谱内容。

严格规则：
- 只输出简谱文本，不要任何解释、说明、注释或其他文字
- 如果图片不是简谱（例如是五线谱），只回复：[错误：图片不是简谱，请切换到"五线谱→简谱"模式]

输出格式：
第一行：标题（如有）、Key: X、Time: X/X
之后按小节输出，用 | 分隔小节。
- 数字 1-7 代表音级，0 代表休止符
- 高八度音符后加 '（如 1' 2'），低八度后加 .（如 1. 2.）
- 八分音符后加 _，十六分音符后加 __
- 延音用 -`

const WESTERN_TO_JIANPU_PROMPT = `You are a music expert converting Western staff notation to Jianpu (简谱).
In Jianpu, numbers 1-7 represent scale degrees relative to the key (1=Do/tonic).

Strict rules:
- Output ONLY the Jianpu notation lines. No explanations, no markdown.
- If the image is not Western staff notation, reply only with: [Error: Image is not staff notation. Please switch to 简谱识别 mode.]

Output format:
- First line: Title (if visible), Key: X, Time: X/X
- Then music measure by measure, separated by |
- 1-7 for scale degrees, 0 for rest
- Add ' after a number for next higher octave
- Add . after a number for next lower octave
- Add _ for eighth notes, __ for sixteenth notes
- Use - for held beats`

export function useOcr() {
  const store = useScoreStore()

  const analyzeImage = useCallback(async (file: File): Promise<string> => {
    const apiKey = import.meta.env.VITE_GROQ_API_KEY
    if (!apiKey) throw new Error('VITE_GROQ_API_KEY is not set.')

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const { ocrMode } = useScoreStore.getState()
    const mediaType = file.type || 'image/jpeg'
    const systemPrompt = ocrMode === 'jianpu' ? JIANPU_OCR_PROMPT : WESTERN_TO_JIANPU_PROMPT
    const userText = ocrMode === 'jianpu' ? '请识别并转录这张简谱图片。' : '请将这张五线谱转换为简谱。'

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens: 2048,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
              { type: 'text', text: userText },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      throw new Error((errBody as { error?: { message?: string } }).error?.message || `API error ${res.status}`)
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const text = data.choices?.[0]?.message?.content || '（无输出）'

    if (text.startsWith('[错误：') || text.startsWith('[Error:')) {
      throw new Error(text.replace(/^\[错误：|^\[Error:\s*/, '').replace(/\]$/, ''))
    }

    return text
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
      const text = await analyzeImage(ocrFile)
      store.setOcrResult(text)
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
