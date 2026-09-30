import { describe, it, expect } from 'vitest'
import { parseBilibili, extractBiliTarget } from '@sns-parse/platform-bilibili'
import { collectPlatformDefinitions } from '@sns-parse/core'
import { linkTypeParser } from '../src/utils/url'

const VIEW_DATA = {
  bvid: 'BV1GJ411x7h7', aid: 80433022,
  title: '测试视频标题', desc: '这是简介',
  pic: 'http://i1.hdslb.com/bfs/archive/cover.jpg',
  pubdate: 1577835803, duration: 213,
  owner: { mid: 486906719, name: '测试UP主', face: 'https://i2.hdslb.com/bfs/face/av.jpg' },
  stat: { view: 106379546, reply: 234805, favorite: 1543353, share: 495301, like: 2934212, danmaku: 1, coin: 1 },
  pages: [{ page: 1, cid: 137649199, duration: 213, part: 'P1' }],
}

/** 标准 mock：预热 set-cookie(buvid3) → SPI(b_3/b_4) → view/playurl 按 handler */
function biliHttp(handler: (u: string, cfg?: any) => any) {
  return {
    get: async (u: string, cfg?: any) => {
      if (u === 'https://www.bilibili.com/') {
        return { status: 200, headers: { 'set-cookie': ['buvid3=WARM3; Path=/; Domain=.bilibili.com'] }, data: '<html>' }
      }
      if (u.includes('frontend/finger/spi')) {
        return { status: 200, data: { code: 0, data: { b_3: 'BUV3', b_4: 'BUV4' } } }
      }
      if (u.includes('web-interface/view')) return { status: 200, data: { code: 0, data: VIEW_DATA } }
      if (u.includes('player/playurl')) return { status: 200, data: { code: 0, data: { quality: 64, durl: [{ url: 'https://upos-sz-mirror.bilivideo.com/v.mp4?deadline=1', size: 51973319, length: 213000 }] } } }
      return handler(u, cfg)
    },
  } as any
}

describe('bilibili URL 归一', () => {
  it('extractBiliTarget 提取 BV/av 与分P', () => {
    expect(extractBiliTarget('https://www.bilibili.com/video/BV1GJ411x7h7?p=2&t=1')).toEqual({ kind: 'bv', id: 'BV1GJ411x7h7', p: 2 })
    expect(extractBiliTarget('https://www.bilibili.com/video/av80433022')).toEqual({ kind: 'av', id: '80433022', p: 1 })
    expect(extractBiliTarget('https://www.bilibili.com/bangumi/play/ep123')).toBeNull()
  })
  it('rules 识别视频链与短链', () => {
    const all = collectPlatformDefinitions().flatMap(d => d.rules.map(pattern => ({ pattern, type: d.type })))
    const m = linkTypeParser('看 https://www.bilibili.com/video/BV1GJ411x7h7 和 https://b23.tv/NhMCVLR', all)
    expect(m.filter(x => x.type === 'bilibili').length).toBe(2)
  })
})

describe('bilibili 原生解析', () => {
  it('BV 视频：元数据 + html5 单文件直链映射', async () => {
    const p = await parseBilibili('https://www.bilibili.com/video/BV1GJ411x7h7', biliHttp(() => { throw new Error('unexpected') }))
    expect(p.type).toBe('video')
    expect(p.video).toContain('v.mp4')
    expect(p.videos[0].quality).toBe('720P')
    expect(p.title).toBe('测试视频标题')
    expect(p.author).toBe('测试UP主')
    expect(p.uid).toBe('486906719')
    expect(p.avatar).toBe('https://i2.hdslb.com/bfs/face/av.jpg')
    expect(p.cover).toBe('https://i1.hdslb.com/bfs/archive/cover.jpg')
    expect(p.duration).toBe(213)
    expect(p.like).toBe(2934212)
    expect(p.comment).toBe(234805)
    expect(p.collect).toBe(1543353)
    expect(p.share).toBe(495301)
    expect(p.play).toBe(106379546)
    expect(p.publishTime).toBe(1577835803000)
    expect(p.desc).toBe('这是简介')
  })

  it('b23.tv 短链：跟随重定向后解析', async () => {
    const http = biliHttp(u => {
      if (u.includes('b23.tv/NhMCVLR')) return { status: 302, request: { res: { responseUrl: 'https://www.bilibili.com/video/BV1uoad6sEEd?buvid=X&p=1' } }, data: '' }
      throw new Error('unexpected: ' + u)
    })
    const p = await parseBilibili('https://b23.tv/NhMCVLR', http)
    expect(p.type).toBe('video')
    expect(p.video).toContain('v.mp4')
  })

  it('短链指向非视频：明确报错', async () => {
    const http = biliHttp(() => ({ status: 200, request: { res: { responseUrl: 'https://www.bilibili.com/bangumi/play/ep123' } }, data: '<html>no video</html>' }))
    await expect(parseBilibili('https://b23.tv/xxxx', http)).rejects.toThrow(/不是 B 站视频/)
  })

  it('412 风控：强刷 buvid 后重试成功', async () => {
    let viewCalls = 0
    const http = {
      get: async (u: string) => {
        if (u === 'https://www.bilibili.com/') return { status: 200, headers: { 'set-cookie': ['buvid3=W; Path=/'] }, data: '' }
        if (u.includes('frontend/finger/spi')) return { status: 200, data: { code: 0, data: { b_3: 'B3', b_4: 'B4' } } }
        if (u.includes('web-interface/view')) {
          viewCalls++
          if (viewCalls === 1) return { status: 412, data: null }
          return { status: 200, data: { code: 0, data: VIEW_DATA } }
        }
        if (u.includes('player/playurl')) return { status: 200, data: { code: 0, data: { quality: 32, durl: [{ url: 'https://upos-sz-mirror.bilivideo.com/retry.mp4' }] } } }
        throw new Error('unexpected: ' + u)
      },
    } as any
    const p = await parseBilibili('https://www.bilibili.com/video/BV1GJ411x7h7', http)
    expect(viewCalls).toBe(2)
    expect(p.video).toContain('retry.mp4')
  })

  it('视频不存在：code -404 明确报错', async () => {
    const http = {
      get: async (u: string) => {
        if (u === 'https://www.bilibili.com/') return { status: 200, headers: {}, data: '' }
        if (u.includes('frontend/finger/spi')) return { status: 200, data: { code: 0, data: { b_3: 'B3', b_4: 'B4' } } }
        if (u.includes('web-interface/view')) return { status: 200, data: { code: -404, message: '啥都木有' } }
        throw new Error('unexpected: ' + u)
      },
    } as any
    await expect(parseBilibili('https://www.bilibili.com/video/BV1GJ411x7h7', http)).rejects.toThrow(/不存在或已失效/)
  })
})
