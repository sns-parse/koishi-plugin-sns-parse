import { describe, it, expect } from 'vitest'
import { flush } from '../src/sender/flush'
import { mockSession, mockHttp, makeRuntime, sentTexts, sentElements } from './helpers'

/**
 * 注意：parseApiResponse 的 fallback 读取 data.url 作为视频、data.cover 作为封面、
 * data.title 作为标题。测试 payload 须用这些键（或通过 fieldMapping 映射）。
 */

describe('flush 端到端（mock session + mock http，无需 Koishi bot）', () => {
  it('视频：发送文字 + 封面（默认单条整合模式）', async () => {
    const rt = makeRuntime({
      http: mockHttp(() => ({ code: 200, data: { title: '视频标题', url: 'https://x/v.mp4', cover: 'https://x/c.jpg' } })),
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'douyin', url: 'https://v.douyin.com/A/', id: 'A' }])
    expect(sentTexts(session._sent).some(t => t.includes('标题：'))).toBe(true)   // 文字消息
    expect(sentElements(session._sent).some(c => c?.type === 'img')).toBe(true)   // 封面图片元素
  })

  it('主 API 失败 → 回退到备用/专属 API', async () => {
    let calls = 0
    const rt = makeRuntime({
      http: mockHttp((endpoint) => {
        calls++
        if (endpoint.includes('short_videos')) return { code: 500, msg: 'err' } // 主 API 故障
        return { code: 200, data: { title: '回退视频', url: 'https://x/v.mp4' } } // 备用/专属成功
      }),
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'douyin', url: 'https://v.douyin.com/B/', id: 'B' }])
    expect(calls).toBeGreaterThan(1)                                              // 调用了多个 API
    expect(sentTexts(session._sent).some(t => t.includes('标题：'))).toBe(true)
  })

  it('第三方 API 无状态码字段 → 视为成功（同步上游 v1.6.6）', async () => {
    const rt = makeRuntime({
      http: mockHttp(() => ({ data: { title: '无码响应', url: 'https://x/v.mp4' } })),
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'douyin', url: 'https://v.douyin.com/N/', id: 'N' }])
    expect(sentTexts(session._sent).some(t => t.includes('无码响应'))).toBe(true)
  })

  it('动图推文（关闭 GIF 转换）：按视频发送', async () => {
    const gifTweet = {
      __typename: 'Tweet',
      text: 'loop',
      user: { screen_name: 'g', name: 'G' },
      mediaDetails: [{
        type: 'animated_gif',
        media_url_https: 'https://pbs.twimg.com/p.jpg',
        video_info: { duration_millis: 4000, variants: [{ bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/g.mp4' }] },
      }],
    }
    const rt = makeRuntime({
      config: { gifConvertEnabled: false },
      http: mockHttp(gifTweet),
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'twitter', url: 'https://x.com/g/status/1', id: '1' }])
    expect(sentElements(session._sent).some(e => e?.type === 'video')).toBe(true)
  })

  it('推文翻译：外语推文附译文行', async () => {
    const frTweet = {
      __typename: 'Tweet',
      lang: 'fr',
      text: 'Bonjour le monde',
      user: { screen_name: 'fr', name: 'FR' },
      photos: [{ url: 'https://pbs.twimg.com/p.jpg' }],
    }
    const rt = makeRuntime({
      config: { tweetTranslateEnabled: true, tweetTranslateLang: 'zh', unifiedMessageFormat: '简介：${简介}\n翻译：${翻译}\n作者：${作者}' },
      http: mockHttp((url: string) => {
        if (url.includes('syndication')) return frTweet
        if (url.includes('translate_a/single')) {
          return [[['你好，世界', 'Bonjour le monde']], null, 'fr']
        }
        return {}
      }),
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'twitter', url: 'https://x.com/fr/status/7', id: '7' }])
    const texts = sentTexts(session._sent).join('\n')
    expect(texts).toContain('Bonjour le monde')
    expect(texts).toContain('你好，世界')
  })

  it('推文翻译：目标语种与推文语种相同则不调用翻译', async () => {
    let translateCalled = false
    const zhTweet = {
      __typename: 'Tweet',
      lang: 'zh',
      text: '中文推文',
      user: { screen_name: 'zh', name: 'ZH' },
      photos: [{ url: 'https://pbs.twimg.com/p.jpg' }],
    }
    const rt = makeRuntime({
      config: { tweetTranslateEnabled: true, tweetTranslateLang: 'zh', unifiedMessageFormat: '简介：${简介}' },
      http: mockHttp((url: string) => {
        if (url.includes('translate_a/single')) { translateCalled = true; return {} }
        if (url.includes('syndication')) return zhTweet
        return {}
      }),
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'twitter', url: 'https://x.com/zh/status/8', id: '8' }])
    expect(translateCalled).toBe(false)
    expect(sentTexts(session._sent).join('\n')).toContain('中文推文')
  })

  it('多视频推文：两条视频各自独立发送', async () => {
    const multiVideoTweet = {
      __typename: 'Tweet',
      text: 'two clips',
      user: { screen_name: 'mv', name: 'MV' },
      mediaDetails: [
        {
          type: 'video',
          media_url_https: 'https://pbs.twimg.com/p1.jpg',
          video_info: { duration_millis: 5100, variants: [{ bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/v1.mp4' }] },
        },
        {
          type: 'video',
          media_url_https: 'https://pbs.twimg.com/p2.jpg',
          video_info: { duration_millis: 3200, variants: [{ bitrate: 632000, content_type: 'video/mp4', url: 'https://video.twimg.com/v2.mp4' }] },
        },
      ],
    }
    const rt = makeRuntime({
      config: { gifConvertEnabled: false },
      http: mockHttp(multiVideoTweet),
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'twitter', url: 'https://x.com/mv/status/2', id: '2' }])
    const videos = sentElements(session._sent).filter(e => e?.type === 'video')
    expect(videos).toHaveLength(2)
    const srcs = videos.map((v: any) => v.attrs?.src).sort()
    expect(srcs).toEqual(['https://video.twimg.com/v1.mp4', 'https://video.twimg.com/v2.mp4'])
    // 每个视频的封面都进概述区（主封面 p1 + 额外封面 p2）
    const all = JSON.stringify(session._sent)
    expect(all).toContain('p1.jpg')
    expect(all).toContain('p2.jpg')
  })

  it('图集：图片以独立消息发送', async () => {
    const rt = makeRuntime({
      http: mockHttp({ code: 200, data: { title: '图文标题', images: ['https://x/1.jpg', 'https://x/2.jpg'] } }),
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'xiaohongshu', url: 'https://xhslink.com/X', id: 'X' }])
    const all = JSON.stringify(session._sent)
    expect(all).toContain('图文标题')
    expect(all).toContain('1.jpg')
    expect(all).toContain('2.jpg')
  })

  it('直播：发送"直播进行中"提示', async () => {
    const rt = makeRuntime({
      http: mockHttp({ code: 200, data: { type: 'live', live: true, url: 'https://x/live.mp4' } }),
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'huya', url: 'https://huya.com/video/x', id: 'x' }])
    expect(JSON.stringify(session._sent)).toContain('直播进行中')
  })

  it('合并转发模式：构建 forward 消息含气泡', async () => {
    const rt = makeRuntime({
      config: { enableForward: true, showImageText: true, globalFieldMapping: '{}' },
      http: mockHttp({ code: 200, data: { title: '转发视频', url: 'https://x/v.mp4' } }),
    })
    const session = mockSession({ platform: 'onebot' })
    await flush(rt, session as any, [{ type: 'douyin', url: 'https://v.douyin.com/F/', id: 'F' }])
    const fwd = session._sent.find(c => c?.type === 'message' && c.attrs?.forward === true)
    expect(fwd).toBeTruthy()
    // 内层是 <message> 气泡，含 <author>
    const childTypes = (fwd.children || []).map((n: any) => n?.type)
    expect(childTypes).toContain('message')
    const firstBubble = fwd.children.find((n: any) => n?.type === 'message')
    expect(firstBubble.children.map((n: any) => n.type)).toContain('author')
  })

  it('URL 去重：第二次相同链接发送去重提示', async () => {
    const rt = makeRuntime({
      config: { enableDeduplication: true, deduplicationInterval: 180, globalFieldMapping: '{}' },
      http: mockHttp({ code: 200, data: { title: '去重视频', url: 'https://x/v.mp4' } }),
    })
    const url = 'https://v.douyin.com/D/'
    const s1 = mockSession()
    await flush(rt, s1 as any, [{ type: 'douyin', url, id: 'D' }])
    expect(s1._sent.length).toBeGreaterThan(0) // 首次正常发送
    const s2 = mockSession()
    await flush(rt, s2 as any, [{ type: 'douyin', url, id: 'D' }])
    expect(sentTexts(s2._sent).some(t => t.includes('已解析过'))).toBe(true) // 第二次命中去重
  })

  it('去重按会话隔离：另一会话首次发送同一链接不受影响', async () => {
    const rt = makeRuntime({
      config: { enableDeduplication: true, deduplicationInterval: 180, globalFieldMapping: '{}' },
      http: mockHttp({ code: 200, data: { title: '跨会话视频', url: 'https://x/v.mp4' } }),
    })
    const url = 'https://v.douyin.com/D2/'
    const s1 = mockSession({ channelId: 'ch-A' })
    await flush(rt, s1 as any, [{ type: 'douyin', url, id: 'D2' }])
    const s2 = mockSession({ channelId: 'ch-B' })
    await flush(rt, s2 as any, [{ type: 'douyin', url, id: 'D2' }])
    expect(sentTexts(s2._sent).some(t => t.includes('已解析过'))).toBe(false) // 不同会话不去重
    expect(sentTexts(s2._sent).some(t => t.includes('标题：'))).toBe(true)    // 正常解析发送
  })

  it('skipDedup：手动命令显式触发时跳过去重', async () => {
    const rt = makeRuntime({
      config: { enableDeduplication: true, deduplicationInterval: 180, globalFieldMapping: '{}' },
      http: mockHttp({ code: 200, data: { title: '手动视频', url: 'https://x/v.mp4' } }),
    })
    const url = 'https://v.douyin.com/D3/'
    const s1 = mockSession({ channelId: 'ch-C' })
    await flush(rt, s1 as any, [{ type: 'douyin', url, id: 'D3' }])
    await flush(rt, s1 as any, [{ type: 'douyin', url, id: 'D3' }], { skipDedup: true })
    const texts = sentTexts(s1._sent)
    expect(texts.filter(t => t.includes('已解析过')).length).toBe(0)                          // 无去重提示
    expect(texts.filter(t => t.includes('标题：')).length).toBe(2)                            // 两次都完整发送
  })

  it('平台被禁用：不发送任何内容', async () => {
    const rt = makeRuntime({
      config: { platformEnabled: { douyin: false }, globalFieldMapping: '{}' },
      http: mockHttp({ code: 200, data: { url: 'https://x/v.mp4' } }),
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'douyin', url: 'https://v.douyin.com/E/', id: 'E' }])
    expect(session._sent).toHaveLength(0)
  })

  it('网关选择：未配置 apiKey 走旧网关且无认证头', async () => {
    const seen: any[] = []
    const rt = makeRuntime({
      config: { globalFieldMapping: '{}' },
      http: {
        get: async (url: string, cfg: any) => {
          seen.push({ url, headers: cfg?.headers })
          return { data: { code: 200, data: { title: '旧网关', url: 'https://x/v.mp4' } } }
        },
      },
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'douyin', url: 'https://v.douyin.com/G1/', id: 'G1' }])
    expect(seen[0].url).toBe('https://api.bugpk.com/api/short_videos')
    expect(seen[0].headers['X-API-Key']).toBeUndefined()
  })

  it('网关选择：配置 apiKey 走新网关并携带 X-API-Key', async () => {
    const seen: any[] = []
    const rt = makeRuntime({
      config: { apiKey: 'k123', globalFieldMapping: '{}' },
      http: {
        get: async (url: string, cfg: any) => {
          seen.push({ url, headers: cfg?.headers })
          return { data: { code: 200, data: { title: '新网关', url: 'https://x/v.mp4' } } }
        },
      },
    })
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'douyin', url: 'https://v.douyin.com/G2/', id: 'G2' }])
    expect(seen[0].url).toBe('https://api-new.ifphp.com/api/svparse')
    expect(seen[0].headers['X-API-Key']).toBe('k123')
  })
})
