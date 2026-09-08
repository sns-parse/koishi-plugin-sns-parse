/**
 * 推文翻译：Google gtx 免费端点（无 Key、GET-only）。
 *
 * X 网页端的 Grok 翻译走私有通道（translations/show.json 已 404，GraphQL
 * 仅返回 is_translatable 标志），无公开端点可调，故用通用翻译源。
 * 译文存入 ParsedData.translation，经 ${翻译} 模板变量展示，空值行自动隐藏。
 */
import type { ParserRuntime } from '../runtime'
import { debugLog, logger } from './logger'

/** 判断是否需要跳过翻译（目标语系与推文语种相同 / 无语言内容） */
export function shouldSkipTranslate(tweetLang: string | undefined, target: string): boolean {
  if (!tweetLang) return false
  const l = tweetLang.toLowerCase()
  if (l === 'zxx' || l === 'und') return l === 'zxx' // zxx=无语言内容；und=未定则仍尝试
  const t = target.toLowerCase()
  if (t === 'zh') return l === 'zh' || l.startsWith('zh-')
  if (t === 'zh-tw') return l === 'zh-tw' || l === 'zh-hant' || (l.startsWith('zh') && l !== 'zh-cn')
  if (t === 'en') return l === 'en'
  return l === t
}

/** 翻译文本；失败返回 null（调用方保持无译文继续发送）。gtx 优先，MyMemory 兜底 */
export async function translateText(rt: ParserRuntime, text: string, target: string, sourceLang?: string): Promise<string | null> {
  if (!text) return null
  const out = await viaGtx(rt, text, target)
  if (out) return out
  return viaMyMemory(rt, text, target, sourceLang)
}

/** Google gtx 免费端点（无 Key；sl=auto 自动检测源语种） */
async function viaGtx(rt: ParserRuntime, text: string, target: string): Promise<string | null> {
  const url = 'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=auto&dt=t&tl=${encodeURIComponent(target)}` +
    `&q=${encodeURIComponent(text.slice(0, 2000))}`
  try {
    const res = await rt.http.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': rt.config.userAgent },
    })
    const data: any = res.data
    // gtx 响应形如 [[["译文","原文",null,null,10]],null,"fr",...]
    if (Array.isArray(data?.[0])) {
      const out = data[0].map((seg: any) => (typeof seg?.[0] === 'string' ? seg[0] : '')).join('').trim()
      if (out) return out
    }
    debugLog('gtx 翻译响应结构异常，尝试备用通道')
    return null
  } catch (e: any) {
    debugLog(`gtx 翻译失败：${e?.message || e}`)
    return null
  }
}

/** MyMemory 备用（免费无 Key；需已知源语种，不支持 auto） */
async function viaMyMemory(rt: ParserRuntime, text: string, target: string, sourceLang?: string): Promise<string | null> {
  const sl = normalizeLang(sourceLang)
  if (!sl) return null
  const tl = target.toLowerCase()
  const url = 'https://api.mymemory.translated.net/get' +
    `?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${encodeURIComponent(sl + '|' + tl)}`
  try {
    const res = await rt.http.get(url, { timeout: 15000, headers: { 'User-Agent': rt.config.userAgent } })
    const out = res.data?.responseData?.translatedText
    if (typeof out === 'string' && out.trim() && !/^MYMEMORY WARNING/i.test(out)) return out.trim()
    debugLog('MyMemory 翻译响应异常，放弃译文')
    return null
  } catch (e: any) {
    logger.info(`推文翻译失败（跳过译文继续发送）：${e?.message || e}`)
    return null
  }
}

function normalizeLang(lang?: string): string | null {
  if (!lang) return null
  const l = lang.toLowerCase()
  if (l === 'und' || l === 'zxx') return null
  if (l.startsWith('zh')) return 'zh-CN'
  return l.split('-')[0]
}
