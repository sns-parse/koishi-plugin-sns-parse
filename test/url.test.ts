import { describe, it, expect } from 'vitest'
import { linkTypeParser, cleanUrl, extractAllUrlsFromMessage } from '../src/utils/url'
import { collectPlatformLinkRules } from '@sns-parse/core'

const RULES = collectPlatformLinkRules()

describe('cleanUrl', () => {
  it('解码 HTML 实体并去首尾噪声', () => {
    expect(cleanUrl('https://x.com/a&amp;b')).toBe('https://x.com/a&b')
    expect(cleanUrl('"https://x.com/a/"')).toBe('https://x.com/a/')
  })
  it('补全 // 协议为 https', () => {
    expect(cleanUrl('//x.com/a')).toBe('https://x.com/a')
  })
  it('非 http(s) 原样返回', () => {
    expect(cleanUrl('just text')).toBe('just text')
  })
})

describe('linkTypeParser', () => {
  it('识别抖音短链与长链', () => {
    const m = linkTypeParser('看看 https://v.douyin.com/AbCdEf/ 这个', RULES)
    expect(m).toHaveLength(1)
    expect(m[0].type).toBe('douyin')
    expect(m[0].url).toBe('https://v.douyin.com/AbCdEf/')
  })
  it('识别 B 站 BV 号并提取 id', () => {
    const m = linkTypeParser('https://www.bilibili.com/video/BV1xx411c7mD', RULES)
    expect(m[0].type).toBe('bilibili')
    expect(m[0].id).toBe('BV1xx411c7mD')
  })
  it('多链接去重（同 URL 只匹配一次）', () => {
    const m = linkTypeParser('https://v.douyin.com/X/ 和 https://v.douyin.com/X/', RULES)
    expect(m).toHaveLength(1)
  })
  it('toutiao 链接规则已生效', () => {
    const m = linkTypeParser('https://www.toutiao.com/video/7123456789012345', RULES)
    expect(m[0].type).toBe('toutiao')
  })
  it('未知链接不匹配', () => {
    expect(linkTypeParser('https://example.com/nope', RULES)).toHaveLength(0)
  })
})

describe('extractAllUrlsFromMessage', () => {
  it('从 JSON 卡片中提取链接', () => {
    const session = {
      content: '',
      elements: [
        { type: 'json', data: JSON.stringify({ meta: { news: { jumpUrl: 'https://v.douyin.com/AbCd/' } } }) },
      ],
    }
    const m = extractAllUrlsFromMessage(session as any, RULES)
    expect(m).toHaveLength(1)
    expect(m[0].type).toBe('douyin')
  })
  it('xml 卡片直接作为文本匹配', () => {
    const session = { content: '', elements: [{ type: 'xml', data: '某小程序 https://xhslink.com/abc 分享' }] }
    const m = extractAllUrlsFromMessage(session as any, RULES)
    expect(m[0].type).toBe('xiaohongshu')
  })
})
