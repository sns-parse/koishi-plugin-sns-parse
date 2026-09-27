import { describe, it, expect } from 'vitest'
import { parseWeibo, extractWeiboId } from '@sns-parse/platform-weibo'
import { collectPlatformDefinitions } from '@sns-parse/core'
import { linkTypeParser } from '../src/utils/url'

const SUB = 'SUB=_2AkMdTest; SUBP=test; SRT=1; SRF=1'

function mkHttp(handler: (u: string) => any) {
  return {
    get: async (u: string) => handler(u),
    post: async (u: string) => handler(u),
  } as any
}

/** 标准访客流 mock：genvisitor → incarnate(set-cookie) → show/extend 按 handler（注意 axios params 不进 URL，判据用路径） */
function weiboHttp(handler: (u: string) => any) {
  return mkHttp(u => {
    if (u.includes('genvisitor')) return { data: 'window.gen_callback && gen_callback({"retcode":20000000,"data":{"tid":"TID123"}})' }
    if (u.includes('visitor/visitor')) return { headers: { 'set-cookie': ['SUB=_2AkMdTest; Path=/; Domain=.weibo.cn', 'SUBP=test; Path=/; Domain=.weibo.cn'] } }
    return handler(u)
  })
}

describe('weibo URL 归一', () => {
  it('extractWeiboId 五种形态', () => {
    expect(extractWeiboId('https://weibo.com/2656274875/Rk1uCBIoe?from=page')).toBe('Rk1uCBIoe')
    expect(extractWeiboId('https://m.weibo.cn/status/Rk1uCBIoe')).toBe('Rk1uCBIoe')
    expect(extractWeiboId('https://m.weibo.cn/detail/5347714632974458')).toBe('5347714632974458')
    expect(extractWeiboId('https://m.weibo.cn/profile/Rk1nmFaKe')).toBe('Rk1nmFaKe')
    expect(extractWeiboId('https://video.weibo.com/show?fid=1034:5347714632974458')).toBe('5347714632974458')
    expect(extractWeiboId('https://weibo.com/u/customname')).toBeNull()
    expect(extractWeiboId('https://weibo.com/2656274875/profile')).toBeNull()
  })
  it('rules 识别全部形态且不误伤 profile 页', () => {
    const all = collectPlatformDefinitions().flatMap(d => d.rules.map(pattern => ({ pattern, type: d.type })))
    const m = linkTypeParser('看 https://weibo.com/2656274875/Rk1uCBIoe 和 https://m.weibo.cn/status/AbCd12345 再 https://video.weibo.com/show?fid=1034:5347714632974458 还有 https://t.cn/AXW434WW', all)
    const types = m.map(x => x.type)
    expect(types.filter(t => t === 'weibo').length).toBe(4)
    const miss = linkTypeParser('主页是 https://weibo.com/2656274875/profile 关注一下', all)
    expect(miss.find(x => x.type === 'weibo')).toBeUndefined()
  })
})

describe('weibo 原生解析', () => {
  it('视频微博：高清/标清变体 + 封面 + 时长 + 播放量/互动数（万格式）', async () => {
    const data = {
      bid: 'Rk1uCBIoe',
      text: '#三星堆# 新发现！<a href="/search">三星堆文物保护</a>取得进展<br />详见视频<span class="url-icon"><img alt="[doge]" src="x.png"></span>',
      user: { screen_name: '央视新闻', id: '2656274875', avatar_hd: '//wx4.sinaimg.cn/a.jpg', followers_count: '1.41万' },
      created_at: 'Sun Sep 27 11:33:09 +0800 2026',
      reposts_count: 17, comments_count: 35, attitudes_count: 67,
      page_info: {
        type: 'video', play_count: '1.2万', page_pic: { url: 'https://wx3.sinaimg.cn/cover.jpg' },
        media_info: { stream_url: 'https://f.video.weibocdn.com/sd.mp4?label=mp4', stream_url_hd: 'https://f.video.weibocdn.com/hd.mp4?label=mp4_hd', duration: 103.7 },
      },
    }
    const http = weiboHttp(u => {
      if (u.includes('statuses/show')) return { data: { ok: 1, data } }
      throw new Error('unexpected: ' + u)
    })
    const p = await parseWeibo('https://weibo.com/2656274875/Rk1uCBIoe', http)
    expect(p.type).toBe('video')
    expect(p.video).toContain('hd.mp4')
    expect(p.videos.map(v => v.quality)).toEqual(['高清', '标清'])
    expect(p.cover).toContain('cover.jpg')
    expect(p.duration).toBe(104)
    expect(p.play).toBe(12000)
    expect(p.author).toBe('央视新闻')
    expect(p.uid).toBe('2656274875')
    expect(p.avatar).toBe('https://wx4.sinaimg.cn/a.jpg')
    expect(p.author_followers).toBe(14100)
    expect(p.like).toBe(67)
    expect(p.comment).toBe(35)
    expect(p.share).toBe(17)
    expect(p.publishTime).toBe(Date.parse('Sun Sep 27 11:33:09 +0800 2026'))
    expect(p.desc).toContain('三星堆文物保护')
    expect(p.desc).toContain('[doge]')
    expect(p.desc).toContain('\n详见视频')
    expect(p.title).toBe('')
  })
  it('图集微博：pic_ids 拼 large 原图', async () => {
    const data = {
      bid: 'Rk1i5zJtA',
      text: '清晨的校园',
      user: { screen_name: '摄影君', id: 'u1', profile_image_url: '//wx2.sinaimg.cn/av.jpg' },
      created_at: 'Sun Sep 27 11:02:16 +0800 2026',
      reposts_count: 5, comments_count: 2, attitudes_count: 99,
      pic_ids: ['002TLsr9ly1ihi1pmopcpj61kw0votq802', 'abc.gif'],
    }
    const http = weiboHttp(u => {
      if (u.includes('statuses/show')) return { data: { ok: 1, data } }
      throw new Error('unexpected: ' + u)
    })
    const p = await parseWeibo('https://m.weibo.cn/status/Rk1i5zJtA', http)
    expect(p.type).toBe('image')
    expect(p.images).toEqual([
      'https://wx2.sinaimg.cn/large/002TLsr9ly1ihi1pmopcpj61kw0votq802.jpg',
      'https://wx2.sinaimg.cn/large/abc.gif',
    ])
    expect(p.cover).toBe(p.images[0])
  })
  it('t.cn 短链：302 → video.weibo.com fid → mid 解析', async () => {
    const data = {
      bid: 'Rk0XSoUoX',
      text: 't.cn 目标视频',
      user: { screen_name: '视频号', id: 'u2' },
      page_info: { type: 'video', page_pic: { url: 'https://wx1.sinaimg.cn/c.jpg' }, media_info: { stream_url: 'https://f.video.weibocdn.com/v.mp4', duration: 10 } },
    }
    const http = weiboHttp(u => {
      if (u.includes('t.cn/AXW434WW')) return { status: 302, headers: { location: 'https://video.weibo.com/show?fid=1034:5347714632974458' } }
      if (u.includes('statuses/show')) return { data: { ok: 1, data } }
      throw new Error('unexpected: ' + u)
    })
    const p = await parseWeibo('https://t.cn/AXW434WW', http)
    expect(p.type).toBe('video')
    expect(p.video).toContain('v.mp4')
  })
  it('t.cn 指向站外：明确报错不误吞', async () => {
    const http = weiboHttp(u => {
      if (u.includes('t.cn/')) return { status: 302, headers: { location: 'https://item.taobao.com/item.htm?id=1' } }
      throw new Error('unexpected: ' + u)
    })
    await expect(parseWeibo('https://t.cn/Axxxxx', http)).rejects.toThrow(/不是微博内容/)
  })
  it('转发微博：本条无媒体时借转发对象图集，desc 带 //@', async () => {
    const data = {
      bid: 'Rt9999999',
      text: '转发理由：太美了',
      user: { screen_name: '转发者', id: 'u3' },
      reposts_count: 1, comments_count: 1, attitudes_count: 2,
      retweeted_status: {
        bid: 'OrigBID01',
        text: '原图文',
        user: { screen_name: '原作者', id: 'u4' },
        pic_ids: ['pid1', 'pid2'],
      },
    }
    const http = weiboHttp(u => {
      if (u.includes('statuses/show')) return { data: { ok: 1, data } }
      throw new Error('unexpected: ' + u)
    })
    const p = await parseWeibo('https://m.weibo.cn/status/Rt9999999', http)
    expect(p.images.length).toBe(2)
    expect(p.desc).toContain('//@原作者: 原图文')
    expect(p.author).toBe('转发者')
  })
  it('长文微博：isLongText → extend 取 longTextContent', async () => {
    const data = {
      bid: 'LongBID01',
      text: '长文开头…',
      isLongText: true,
      user: { screen_name: '长文作者', id: 'u5' },
    }
    const http = weiboHttp(u => {
      if (u.includes('statuses/extend')) return { data: { ok: 1, data: { longTextContent: '这是<b>完整长文</b>内容' } } }
      if (u.includes('statuses/show')) return { data: { ok: 1, data } }
      throw new Error('unexpected: ' + u)
    })
    const p = await parseWeibo('https://m.weibo.cn/status/LongBID01', http)
    expect(p.desc).toContain('这是完整长文内容')
  })
  it('直播微博：无回放降级文本 + 直播间链接', async () => {
    const data = {
      bid: 'LiveBID01',
      text: '直播中',
      user: { screen_name: '主播', id: 'u6' },
      page_info: { type: 'live', page_url: 'https://weibo.com/l/wblive/p/show/1022:2321', page_pic: { url: 'https://wx1.sinaimg.cn/live.jpg' }, media_info: { stream_url: 'https://weibo.com/l/wblive/p/show/1022:2321' } },
    }
    const http = weiboHttp(u => {
      if (u.includes('statuses/show')) return { data: { ok: 1, data } }
      throw new Error('unexpected: ' + u)
    })
    const p = await parseWeibo('https://m.weibo.cn/status/LiveBID01', http)
    expect(p.type).toBe('text')
    expect(p.desc).toContain('【正在直播】')
    expect(p.cover).toContain('live.jpg')
  })
  it('不存在/已删除：show miss 两次 → 明确报错', async () => {
    const http = weiboHttp(u => {
      if (u.includes('statuses/show')) return { data: { ok: 0, msg: '抱歉，未找到相关内容' } }
      throw new Error('unexpected: ' + u)
    })
    await expect(parseWeibo('https://m.weibo.cn/status/DeadBID0', http)).rejects.toThrow(/不存在或已删除/)
  })
})
