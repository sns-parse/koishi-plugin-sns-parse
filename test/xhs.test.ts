import { describe, it, expect } from 'vitest'
import { parseXiaohongshu } from '@sns-parse/platform-xiaohongshu'
import { xiaohongshu as xhsDef } from '@sns-parse/platforms'
import { collectPlatformDefinitions } from '@sns-parse/core'
import { linkTypeParser } from '../src/utils/url'

const TOKEN = 'xsec_token=CBWHSxXQVnpBGWo7vnvbrzIFdutG3D4Z0R8fGjWhw9Yuc%3D'
const FULL = `https://www.xiaohongshu.com/discovery/item/69f0ffb5000000001e00efa3?app_platform=ios&${TOKEN}&xsec_source=app_share`

function isHtml(html: string, finalUrl: string) {
  return {
    status: 200,
    data: html,
    request: { res: { responseUrl: finalUrl } },
  }
}

function noteHtml(note: any) {
  const state = { note: { noteDetailMap: { currentNoteId: 'n1', n1: { note } } } }
  return `<html><script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script></html>`
}

const mkHttp = (handler: (u: string) => any) => ({ get: async (u: string) => handler(u) }) as any

describe('xiaohongshu 原生解析', () => {
  it('短链展开 + __INITIAL_STATE__ 图文笔记映射（含计数格式化）', async () => {
    const note = {
      id: 'n1', title: '夏日美甲', desc: '清新配色分享', type: 'normal',
      imageList: [
        { urlDefault: '//sns-webpic-qc.xhscdn.com/1.jpg' },
        { urlDefault: '//sns-webpic-qc.xhscdn.com/2.jpg' },
      ],
      user: { nickname: '小红薯', userId: 'u1', avatar: '//cdn.avatar/x.png' },
      interactInfo: { liked: '1.2万', commentCount: 3, collected: '888', shared: '12' },
      time: 1784105542000, ipLocation: '上海',
    }
    const http = mkHttp(u => {
      if (u.includes('xhslink.com')) return isHtml(noteHtml(note), FULL)
      throw new Error('unexpected: ' + u)
    })
    const p = await parseXiaohongshu('http://xhslink.com/o/ABCDEF123', http)
    expect(p.type).toBe('image')
    expect(p.images).toEqual(['https://sns-webpic-qc.xhscdn.com/1.jpg', 'https://sns-webpic-qc.xhscdn.com/2.jpg'])
    expect(p.cover).toContain('1.jpg')
    expect(p.title).toBe('夏日美甲')
    expect(p.desc).toBe('清新配色分享')
    expect(p.author).toBe('小红薯')
    expect(p.uid).toBe('u1')
    expect(p.like).toBe(12000)
    expect(p.comment).toBe(3)
    expect(p.collect).toBe(888)
    expect(p.share).toBe(12)
    expect(p.publishTime).toBe(1784105542000)
  })

  it('视频笔记：h264 master + backup 变体与时长', async () => {
    const note = {
      id: 'n2', title: '', desc: 'Vlog', type: 'video',
      imageList: [{ urlDefault: '//sns-webpic-qc.xhscdn.com/cover.jpg' }],
      video: {
        media: { stream: { h264: [{ masterUrl: 'https://v.xhscdn.com/h264.m3u8', backupUrls: ['https://v.xhscdn.com/b1.m3u8'], durationMs: 63000, avgBitrate: 2000 }] } },
        capa: { duration: 63 },
      },
      user: { nickname: 'U', userId: 'u2' },
      interactInfo: { liked: 5 },
    }
    const http = mkHttp(u => isHtml(noteHtml(note), FULL))
    const p = await parseXiaohongshu(FULL, http)
    expect(p.type).toBe('video')
    expect(p.video).toBe('https://v.xhscdn.com/h264.m3u8')
    expect(p.videos.length).toBe(2)
    expect(p.duration).toBe(63)
    expect(p.cover).toContain('cover.jpg')
    expect(p.title).toBe('')
  })

  it('死链从 redirectPath 恢复重试', async () => {
    const calls: string[] = []
    const note = { id: 'n1', title: 'R', desc: 'recovered', type: 'normal', imageList: [{ urlDefault: '//x/1.jpg' }], user: { nickname: 'U' }, interactInfo: {} }
    const dead = `https://www.xiaohongshu.com/404/sec_abc?redirectPath=${encodeURIComponent(FULL)}&error_code=300031&error_msg=%E5%BD%93%E5%89%8D%E7%AC%94%E8%AE%B0%E6%9A%82%E6%97%B6%E6%97%A0%E6%B3%95%E6%B5%8F%E8%A7%88`
    const http = mkHttp(u => {
      calls.push(u)
      if (u.includes('xhslink.com')) return isHtml('<html>404</html>', dead)
      return isHtml(noteHtml(note), FULL)
    })
    const p = await parseXiaohongshu('http://xhslink.com/o/DEAD123', http)
    expect(calls.length).toBe(2)
    expect(calls[1]).toContain('xsec_token=')
    expect(p.desc).toBe('recovered')
  })

  it('真死链：恢复仍 404 → 抛"无法浏览"', async () => {
    const dead1 = `https://www.xiaohongshu.com/404/sec_a?redirectPath=${encodeURIComponent(FULL)}&error_code=300031&error_msg=takedown`
    const dead2 = `https://www.xiaohongshu.com/404/sec_b?error_code=300031`
    const http = mkHttp(u => {
      if (u.includes('xhslink.com')) return isHtml('<html></html>', dead1)
      return isHtml('<html></html>', dead2)
    })
    await expect(parseXiaohongshu('http://xhslink.com/o/TT', http)).rejects.toThrow(/无法浏览|takedown/)
  })

  it('IS 缺失时 og 元信息兜底（过滤站点框架图）', async () => {
    const ogHtml = `<html><head>
      <meta property="og:title" content="OG 标题" />
      <meta property="og:description" content="OG 描述" />
      <meta property="og:image" content="//sns-webpic-qc.xhscdn.com/og.jpg" />
    </head><body>no state</body></html>`
    const http = mkHttp(u => isHtml(ogHtml, FULL))
    const p = await parseXiaohongshu(FULL, http)
    expect(p.title).toBe('OG 标题')
    expect(p.desc).toBe('OG 描述')
    expect(p.images).toEqual(['https://sns-webpic-qc.xhscdn.com/og.jpg'])
  })

  it('页面无内容 → 旧网关兜底（svparse 通用格式）', async () => {
    const calls: string[] = []
    const http = mkHttp(u => {
      calls.push(u)
      if (u.includes('api.bugpk.com')) {
        return { status: 200, data: { code: 200, msg: 'ok', data: { type: 'image', title: 'GW', desc: 'from gateway', author: { name: 'G' }, images: ['https://img/1.jpg'], url: '' } } }
      }
      return isHtml('<html>empty</html>', FULL)
    })
    const p = await parseXiaohongshu(FULL, http)
    expect(p.title).toBe('GW')
    expect(p.desc).toBe('from gateway')
    expect(p.images).toEqual(['https://img/1.jpg'])
    expect(calls.some(c => c.includes('api.bugpk.com'))).toBe(true)
  })

  it('网关报缺 token → 明确提示发分享链接', async () => {
    const http = mkHttp(u => {
      if (u.includes('api.bugpk.com')) {
        return { status: 200, data: { code: 400, msg: 'Missing xsec_token. Please pass the original XHS share/browser URL with xsec_token.' } }
      }
      return isHtml('<html></html>', 'https://www.xiaohongshu.com/explore/69f0ffb5000000001e00efa3')
    })
    await expect(parseXiaohongshu('https://www.xiaohongshu.com/explore/69f0ffb5000000001e00efa3', http)).rejects.toThrow(/xsec_token/)
  })
})

describe('xiaohongshu 链接识别（query 保留）', () => {
  it('explore/discovery 完整链接的 xsec_token 不再被剥离', () => {
    const all = collectPlatformDefinitions().flatMap(d => d.rules.map(pattern => ({ pattern, type: d.type })))
    const m = linkTypeParser(`看这个 https://www.xiaohongshu.com/explore/69f0ffb5000000001e00efa3?${TOKEN}&xsec_source=pc_share 好看`, all)
    expect(m.length).toBe(1)
    expect(m[0].type).toBe('xiaohongshu')
    expect(m[0].url).toContain('xsec_token=')
    expect(m[0].url).toContain('xsec_source=pc_share')
  })
  it('def 带 parse 钩子（fetcher 原生路径可用）', () => {
    expect(typeof xhsDef.parse).toBe('function')
    expect(typeof xhsDef.translate).toBe('undefined')
  })
})
