import { describe, it, expect } from 'vitest'
import { flush } from '../src/sender/flush'
import { mockSession, mockHttp, makeRuntime, sentTexts, sentElements } from './helpers'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_BUF = Buffer.from(PNG, 'base64')

function ferretStub(rt: any) {
  rt.ctx['ferret-transform'] = {
    scramble: async (buf: Buffer) => Buffer.concat([Buffer.from('SCR|'), buf.slice(0, 4)]),
    encodeToken: (v: string) => Buffer.from(v, 'utf8').toString('base64url'),
    decodeToken: (t: string) => Buffer.from(t, 'base64url').toString('utf8'),
    seedFrom: () => 1,
  }
}

function nsfwRt(config: any = {}, payloads: any = { code: 200, data: { images: ['https://x/1.jpg'] } }) {
  const rt = makeRuntime({ config })
  ferretStub(rt)
  rt.http = {
    get: async () => ({ data: PNG_BUF }),
  } as any
  ;(rt as any).httpParse = mockHttp(payloads)
  return rt
}

describe('flush + NSFW 端到端', () => {
  it('平台 full：首条仅报混淆数量（不含取件码），混淆图消息为干脆的「解混淆 <token>[图]」', async () => {
    const rt = nsfwRt({
      nsfwPlatformMode: { xiaohongshu: 'full' },
      nsfwPolicy: { imageAction: 'scramble', tokenHintText: '已混淆 ${count} 张图片' },
    })
    rt.http = {
      get: async (url: string) => {
        if (url.includes('xhslink') || url.includes('api')) return { data: { code: 200, data: { title: '图集标题', images: ['https://x/1.jpg', 'https://x/2.jpg'] } } }
        return { data: PNG_BUF }
      },
    } as any
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'xiaohongshu', url: 'https://xhslink.com/X', id: 'X' }])
    // 首条消息：概述 + 数量提示（无任何取件码）
    const firstTexts = sentTexts([session._sent[0]]).join('\n')
    expect(firstTexts).toContain('图集标题')
    expect(firstTexts).toContain('已混淆 2 张图片')
    expect(firstTexts).not.toContain('解混淆 ')
    // 后续消息：每张混淆图独立一条，仅「解混淆 <token>」+ 图片
    const imgMsgs = session._sent.filter((m: any) => Array.isArray(m) && m.some((e: any) => e?.type === 'img'))
    expect(imgMsgs.length).toBe(2)
    for (const m of imgMsgs) {
      const texts = m.filter((e: any) => e?.type === 'text').map((e: any) => e.attrs?.content ?? '')
      expect(texts.every(t => /^解混淆 \S+/.test(t))).toBe(true)
      expect(m.filter((e: any) => e?.type === 'img').length).toBe(1)
    }
  })

  it('受限视频：首条提示不含取件码，取件消息为干脆的「取视频 <token>」', async () => {
    const rt = nsfwRt({
      nsfwPlatformMode: { douyin: 'full' },
      nsfwPolicy: { videoAction: 'redeem', videoCardHint: '受限视频已暂存至 ${until}（${ttl} 分钟内）' },
      nsfwVault: { ttlMinutes: 30, maxItems: 20, maxItemMB: 200, budgetMB: 600 },
    })
    rt.http = {
      get: async (url: string) => {
        if (url.includes('douyin.com') || url.includes('api')) return { data: { code: 200, data: { title: 'T', url: 'https://cdn/v.mp4' } } }
        return { data: PNG_BUF } // 视频字节（小体积）
      },
    } as any
    const session = mockSession({ userId: 'req1' })
    await flush(rt, session as any, [{ type: 'douyin', url: 'https://v.douyin.com/V/', id: 'V' }])
    const els = sentElements(session._sent)
    expect(els.some(c => c?.type === 'video')).toBe(false)      // 无视频元素
    // 首条消息：标题 + 受限提示（无取件码）
    const firstTexts = sentTexts([session._sent[0]]).join('\n')
    expect(firstTexts).toContain('T')
    expect(firstTexts).toContain('受限视频已暂存至')
    expect(firstTexts).not.toContain('取视频 ')
    // 后续消息：干脆的「取视频 <token>」，不含其他内容
    const redeemMsg = session._sent.find((m: any) => Array.isArray(m)
      && m.some((e: any) => e?.type === 'text' && /^取视频 \S+/.test(e.attrs?.content ?? '')))
    expect(redeemMsg).toBeTruthy()
    expect(redeemMsg.filter((e: any) => e?.type !== 'quote').length).toBe(1)
    // token 已入 vault 且绑定请求者
    const { videoVault } = await import('../src/services/nsfw/vault')
    expect(videoVault.size).toBeGreaterThanOrEqual(1)
    videoVault.clear()
  })

  it('多视频推文 + 平台 full：每个封面单独混淆/计数，每个视频各自暂存取件', async () => {
    const multiVideoTweet = {
      __typename: 'Tweet',
      text: 'two clips',
      user: { screen_name: 'mv', name: 'MV' },
      mediaDetails: [
        { type: 'video', media_url_https: 'https://pbs.twimg.com/p1.jpg', video_info: { duration_millis: 5100, variants: [{ bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/v1.mp4' }] } },
        { type: 'video', media_url_https: 'https://pbs.twimg.com/p2.jpg', video_info: { duration_millis: 3200, variants: [{ bitrate: 632000, content_type: 'video/mp4', url: 'https://video.twimg.com/v2.mp4' }] } },
      ],
    }
    const rt = nsfwRt({
      nsfwPlatformMode: { twitter: 'full' },
      nsfwPolicy: { imageAction: 'scramble', videoAction: 'redeem', tokenHintText: '已混淆 ${count} 张图片' },
      gifConvertEnabled: false,
    })
    rt.http = {
      get: async (url: string) => {
        if (url.includes('syndication')) return { data: multiVideoTweet }
        return { data: PNG_BUF }
      },
    } as any
    const session = mockSession({ userId: 'req1' })
    await flush(rt, session as any, [{ type: 'twitter', url: 'https://x.com/mv/status/9', id: '9' }])
    // 无视频/封面原图外发
    const els = sentElements(session._sent)
    expect(els.some(e => e?.type === 'video')).toBe(false)
    expect(els.some(e => e?.type === 'img' && !String(e.attrs?.src ?? '').startsWith('SCR'))).toBe(false)
    // 首条：两个封面都计入混淆数量
    const firstTexts = sentTexts([session._sent[0]]).join('\n')
    expect(firstTexts).toContain('已混淆 2 张图片')
    // 每个封面一条「解混淆」消息
    const scramMsgs = session._sent.filter((m: any) => Array.isArray(m)
      && m.some((e: any) => e?.type === 'text' && /^解混淆 \S+/.test(e.attrs?.content ?? '')))
    expect(scramMsgs.length).toBe(2)
    // 每个视频各自的「取视频」消息
    const redeemMsgs = session._sent.filter((m: any) => Array.isArray(m)
      && m.some((e: any) => e?.type === 'text' && /^取视频 \S+/.test(e.attrs?.content ?? '')))
    expect(redeemMsgs.length).toBe(2)
    const { videoVault } = await import('../src/services/nsfw/vault')
    expect(videoVault.size).toBeGreaterThanOrEqual(2)
    videoVault.clear()
  })

  it('去重层①：同消息相同 URL 只解析一次', async () => {
    let calls = 0
    const rt = nsfwRt({}, {})
    rt.http = {
      get: async (url: string) => {
        if (url.includes('api')) { calls++; return { data: { code: 200, data: { title: 'T', url: 'https://x/v.mp4' } } } }
        return { data: PNG_BUF }
      },
    } as any
    const session = mockSession()
    await flush(rt, session as any, [
      { type: 'douyin', url: 'https://v.douyin.com/D/', id: 'D' },
      { type: 'douyin', url: 'https://v.douyin.com/D/', id: 'D' }, // 尾斜杠差异应视为相同
    ])
    expect(calls).toBe(1)
  })

  it('去重层②：同消息不同 URL 相同内容指纹只发一次', async () => {
    const rt = nsfwRt({}, {})
    rt.http = {
      get: async (url: string) => ({ data: { code: 200, data: { title: '同内容', url: 'https://x/v.mp4' } } }),
    } as any
    const session = mockSession()
    await flush(rt, session as any, [
      { type: 'douyin', url: 'https://v.douyin.com/A/', id: 'A' },
      { type: 'douyin', url: 'https://v.douyin.com/B/', id: 'B' },
    ])
    // 单条整合模式下应只出现一份标题
    const texts = sentTexts(session._sent).join('\n')
    expect((texts.match(/同内容/g) || []).length).toBe(1)
  })

  it('sendStrategy=split：保持旧版逐条行为', async () => {
    const rt = nsfwRt({ sendStrategy: 'split' }, {})
    rt.http = {
      get: async (url: string) => {
        if (url.includes('api')) return { data: { code: 200, data: { title: '图集标题', images: ['https://x/1.jpg'] } } }
        return { data: PNG_BUF }
      },
    } as any
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'xiaohongshu', url: 'https://xhslink.com/X', id: 'X' }])
    // split 模式：文字与图片是分开的两次 send
    expect(session._sent.length).toBeGreaterThanOrEqual(2)
  })

  it('ferret 服务缺失 + 平台 full：图片降级为链接文字（不放原图）', async () => {
    const rt = nsfwRt({ nsfwPlatformMode: { xiaohongshu: 'full' } }, {}) // 无 ferret stub
    delete (rt.ctx as any)['ferret-transform']
    rt.http = {
      get: async (url: string) => {
        if (url.includes('xhslink') || url.includes('api')) return { data: { code: 200, data: { title: '图文', images: ['https://x/1.jpg'] } } }
        return { data: PNG_BUF }
      },
    } as any
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'xiaohongshu', url: 'https://xhslink.com/X', id: 'X' }])
    const allTexts = sentTexts(session._sent).join('\n')
    expect(allTexts).toContain('https://x/1.jpg')                // 链接文字
    const els = sentElements(session._sent)
    expect(els.filter(c => c?.type === 'img').length).toBe(0)    // 无图片元素
  })
})
