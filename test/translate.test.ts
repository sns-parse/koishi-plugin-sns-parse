import { describe, it, expect } from 'vitest'
import { shouldSkipTranslate, translateText, langName } from '../src/utils/translate'
import { makeRuntime } from './helpers'

describe('translate — 推文翻译', () => {
  it('langName：语种代码 → 中文语言名', () => {
    expect(langName('fr')).toBe('法语')
    expect(langName('ja')).toBe('日语')
    expect(langName('zh-CN')).toBe('中文')
    expect(langName('und')).toBe('')
    expect(langName(undefined)).toBe('')
    expect(langName('xx')).toBe('xx') // 未知代码原样
  })

  it('shouldSkipTranslate：目标语种相同 / 无语言内容时跳过', () => {
    expect(shouldSkipTranslate('zh', 'zh')).toBe(true)
    expect(shouldSkipTranslate('zh-cn', 'zh')).toBe(true)
    expect(shouldSkipTranslate('zh-TW', 'zh-TW')).toBe(true)
    expect(shouldSkipTranslate('en', 'en')).toBe(true)
    expect(shouldSkipTranslate('fr', 'zh')).toBe(false)
    expect(shouldSkipTranslate('ja', 'zh')).toBe(false)
    expect(shouldSkipTranslate('zxx', 'zh')).toBe(true)   // 无语言内容
    expect(shouldSkipTranslate('und', 'zh')).toBe(false)  // 未定语种仍尝试
    expect(shouldSkipTranslate(undefined, 'zh')).toBe(false)
  })

  it('translateText：解析 gtx 响应拼接译文并署名 Google', async () => {
    const rt = makeRuntime()
    ;(rt as any).http = {
      get: async (url: string) => {
        expect(url).toContain('translate_a/single')
        expect(url).toContain('tl=zh')
        return { data: [[['你好，', 'hello, '], ['世界', 'world']], null, 'en'] }
      },
    }
    const r = await translateText(rt as any, 'hello, world', 'zh')
    expect(r?.text).toBe('你好，世界')
    expect(r?.provider).toBe('Google')
  })

  it('translateText：失败/异常结构返回 null（不影响发送）', async () => {
    const rt1 = makeRuntime()
    ;(rt1 as any).http = { get: async () => { throw new Error('net') } }
    expect(await translateText(rt1 as any, 'x', 'zh')).toBeNull()
    const rt2 = makeRuntime()
    ;(rt2 as any).http = { get: async () => ({ data: { unexpected: true } }) }
    expect(await translateText(rt2 as any, 'x', 'zh')).toBeNull()
    expect(await translateText(rt1 as any, '', 'zh')).toBeNull()
  })

  it('translateText：gtx 失败时回落 MyMemory（需源语种）', async () => {
    const rt = makeRuntime()
    const urls: string[] = []
    ;(rt as any).http = {
      get: async (url: string) => {
        urls.push(url)
        if (url.includes('translate_a/single')) throw new Error('429 rate limited')
        if (url.includes('mymemory')) {
          expect(url).toContain('langpair=fr%7Czh')
          return { data: { responseData: { translatedText: '你好，世界（备用）' } } }
        }
        return {}
      },
    }
    const r = await translateText(rt as any, 'Bonjour', 'zh', 'fr')
    expect(r?.text).toBe('你好，世界（备用）')
    expect(r?.provider).toBe('MyMemory')
    expect(urls.some(u => u.includes('translate_a/single'))).toBe(true)
    // 源语种未知（und）时不走备用
    const rt2 = makeRuntime()
    ;(rt2 as any).http = { get: async () => { throw new Error('net') } }
    expect(await translateText(rt2 as any, 'x', 'zh', 'und')).toBeNull()
  })
})
