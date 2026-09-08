import { describe, it, expect } from 'vitest'
import { parseTwitter } from '../src/platforms/twitter'
import { fetchApi, parseUrl } from '../src/engine/fetcher'
import { makeRuntime, mockHttp } from './helpers'

const photoTweet = {
  __typename: 'Tweet',
  text: 'Four more years. http://t.co/bAJE6Vom',
  created_at: '2012-11-07T04:16:00Z',
  favorite_count: 458034,
  conversation_count: 46905,
  user: { screen_name: 'BarackObama', name: 'Barack Obama', profile_image_url_https: 'https://pbs.twimg.com/a.jpg' },
  photos: [{ url: 'https://pbs.twimg.com/media/A7EiDWcCYAAZT1D.jpg' }],
}

const videoTweet = {
  __typename: 'Tweet',
  text: 'watch this',
  favorite_count: 10,
  user: { screen_name: 'vid', name: 'Vid' },
  videoDetails: {
    durationMs: 12300,
    viewCount: 999,
    posterUrl: 'https://pbs.twimg.com/poster.jpg',
    variants: [
      { bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/832.mp4' },
      { bitrate: 432000, content_type: 'video/mp4', url: 'https://video.twimg.com/432.mp4' },
    ],
  },
}

describe('parseTwitter — X 原生 syndication 解析', () => {
  it('从链接提取推文 ID', async () => {
    const t = await parseTwitter('https://x.com/BarackObama/status/266031293945503744', mockHttp(photoTweet))
    expect(t.uid).toBe('BarackObama')
  })

  it('图集推文：type=image，取 photos', async () => {
    const t = await parseTwitter('https://x.com/u/status/266031293945503744', mockHttp(photoTweet))
    expect(t.type).toBe('image')
    expect(t.images).toEqual(['https://pbs.twimg.com/media/A7EiDWcCYAAZT1D.jpg'])
    expect(t.cover).toBe('https://pbs.twimg.com/media/A7EiDWcCYAAZT1D.jpg')
    expect(t.like).toBe(458034)
    expect(t.comment).toBe(46905)
    expect(t.publishTime).toBe(Date.parse('2012-11-07T04:16:00Z'))
    expect(t.author).toBe('Barack Obama')
  })

  it('视频推文：按码率降序取最高', async () => {
    const t = await parseTwitter('https://x.com/u/status/266031293945503744', mockHttp(videoTweet))
    expect(t.type).toBe('video')
    expect(t.videos[0].url).toBe('https://video.twimg.com/832.mp4')
    expect(t.video).toBe('https://video.twimg.com/832.mp4')
    expect(t.cover).toBe('https://pbs.twimg.com/poster.jpg')
    expect(t.duration).toBe(12)
    expect(t.play).toBe(999)
  })

  it('动图推文：isGif=true（供发送层转 GIF）', async () => {
    const gifTweet = {
      __typename: 'Tweet',
      text: 'loop!',
      favorite_count: 1,
      user: { screen_name: 'g', name: 'G' },
      mediaDetails: [{
        type: 'animated_gif',
        media_url_https: 'https://pbs.twimg.com/poster.jpg',
        video_info: {
          duration_millis: 4000,
          variants: [{ bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/gif.mp4' }],
        },
      }],
    }
    const t = await parseTwitter('https://x.com/u/status/1', mockHttp(gifTweet))
    expect(t.isGif).toBe(true)
    expect(t.type).toBe('video')
    expect(t.duration).toBe(4)
    const plainVideoTweet = JSON.parse(JSON.stringify(gifTweet))
    plainVideoTweet.mediaDetails[0].type = 'video'
    const v = await parseTwitter('https://x.com/u/status/1', mockHttp(plainVideoTweet))
    expect(v.isGif).toBeUndefined()
  })

  it('多视频推文：第一个进 video，其余进 extraVideos（带各自时长）', async () => {
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
          type: 'animated_gif',
          media_url_https: 'https://pbs.twimg.com/p2.jpg',
          video_info: { duration_millis: 3200, variants: [{ bitrate: 632000, content_type: 'video/mp4', url: 'https://video.twimg.com/v2.mp4' }] },
        },
      ],
    }
    const t = await parseTwitter('https://x.com/u/status/2', mockHttp(multiVideoTweet))
    expect(t.video).toBe('https://video.twimg.com/v1.mp4')
    expect(t.duration).toBe(5)
    expect(t.isGif).toBeUndefined()
    expect(t.extraVideos).toHaveLength(1)
    expect(t.extraVideos![0].url).toBe('https://video.twimg.com/v2.mp4')
    expect(t.extraVideos![0].isGif).toBe(true)
    expect(t.extraVideos![0].duration).toBe(3)
  })

  it('tombstone（需登录/已删除）：抛出明确错误', async () => {
    const tomb = { __typename: 'TweetWithVisibilityResults', tombstone: { text: '__FIXME__LYNCHED__FIXME__' } }
    await expect(parseTwitter('https://x.com/u/status/2059244332285313260', mockHttp(tomb as any)))
      .rejects.toThrow(/不可访问|登录/)
  })

  it('纯文字推文：type=text，保留正文与作者，不再返回空内容', async () => {
    // 真实案例：syndication 200 但无任何媒体字段（无 photos/mediaDetails/video）
    const textTweet = {
      __typename: 'Tweet',
      text: '在亲戚眼里，我属于那种懂电脑的孩子……',
      created_at: '2026-08-22T04:30:29.000Z',
      favorite_count: 277,
      conversation_count: 13,
      user: { screen_name: 'AkasakaRentsuki', name: '大土贝', profile_image_url_https: 'https://pbs.twimg.com/a.jpg' },
    }
    const t = await parseTwitter('https://x.com/u/status/2091020159150628935', mockHttp(textTweet))
    expect(t.type).toBe('text')
    expect(t.desc).toContain('懂电脑')
    expect(t.author).toBe('大土贝')
    expect(t.video).toBe('')
    expect(t.images).toHaveLength(0)
  })

  it('cleanDesc：清理 desc 中的 t.co 短链', async () => {
    // 真实案例：推文末尾附带 t.co 缩短链接污染简介
    const tcoTweet = {
      __typename: 'Tweet',
      text: '骚狗只配脱光衣服在地上爬行 https://t.co/5am26H14JA',
      created_at: '2026-08-22T04:30:29.000Z',
      favorite_count: 100,
      user: { screen_name: 'test', name: 'T' },
    }
    const t = await parseTwitter('https://x.com/u/status/1234567890', mockHttp(tcoTweet))
    expect(t.desc).toBe('骚狗只配脱光衣服在地上爬行')
    expect(t.desc).not.toContain('t.co')
    // 标题同源去重：标题基于清理后文本，与简介相同则置空（不再重复展示）
    expect(t.title).toBe('')
  })

  it('非 X 链接抛出"无法提取 ID"', async () => {
    await expect(parseTwitter('https://example.com/no-id', mockHttp(photoTweet))).rejects.toThrow(/推文 ID/)
  })
})

describe('fetchApi — twitter 路由到原生解析', () => {
  it('type=twitter 且无自定义 API 时走 syndication', async () => {
    const rt = makeRuntime({ http: mockHttp(photoTweet) })
    const parsed = await fetchApi(rt, 'https://x.com/u/status/266031293945503744', 'twitter')
    expect(parsed.type).toBe('image')
    expect(parsed.images).toHaveLength(1)
  })

  it('结果写入缓存（第二次不再次请求）', async () => {
    let calls = 0
    const rt = makeRuntime({
      http: { get: async () => { calls++; return { data: photoTweet } } } as any,
    })
    await fetchApi(rt, 'https://x.com/u/status/266031293945503744', 'twitter')
    await fetchApi(rt, 'https://x.com/u/status/266031293945503744', 'twitter')
    expect(calls).toBe(1)
  })

  it('纯文字推文：parseUrl 判定成功（修复"解析接口返回空内容"）', async () => {
    const textTweet = {
      __typename: 'Tweet',
      text: '纯文字推文正文',
      favorite_count: 1,
      user: { screen_name: 'u', name: 'U' },
    }
    const rt = makeRuntime({ http: mockHttp(textTweet) })
    const result = await parseUrl(rt, 'https://x.com/u/status/2091020159150628935', 'twitter')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('text')
      expect(result.data.desc).toBe('纯文字推文正文')
    }
  })

  it('统一 API 空响应（type=video 且无视频）：仍判失败', async () => {
    const rt = makeRuntime({ http: mockHttp({ code: 200, data: {} }) })
    const result = await parseUrl(rt, 'https://v.douyin.com/x/', 'douyin')
    expect(result.success).toBe(false)
  })
})

describe('parseTwitter — 登录态 GraphQL 回退', () => {
  const creds = { authToken: 'tok', ct0: 'ct0val' }
  // syndication 恒返回 tombstone（公开路径不可用）
  const syndicationHttp = { get: async () => ({ data: { __typename: 'TweetTombstone', tombstone: {} } }) }
  // GraphQL GET 器（第 4 参注入，替代真实 tlsget）
  const gqlGet = (payload: any, status = 200) => async () => ({ status, data: payload })

  const gqlTweet = {
    data: { tweetResult: { result: {
      __typename: 'Tweet', rest_id: '2059244332285313260',
      views: { count: '999' },
      core: { user_results: { result: { rest_id: '9', legacy: { screen_name: 'lk1', name: 'L K', profile_image_url_https: 'https://pbs/a.jpg', followers_count: 88, description: 'bio' } } } },
      legacy: {
        full_text: 'login required tweet', created_at: 'Fri Jan 01 00:00:00 +0000 2021',
        favorite_count: 5, retweet_count: 4, reply_count: 3, bookmark_count: 2,
        entities: { media: [
          { type: 'photo', media_url_https: 'https://pbs/p.jpg' },
          { type: 'video', media_url_https: 'https://pbs/poster.jpg', video_info: { duration_millis: 5000, variants: [
            { bitrate: 832000, content_type: 'video/mp4', url: 'https://video/832.mp4' },
            { bitrate: 432000, content_type: 'video/mp4', url: 'https://video/432.mp4' },
          ] } },
        ] },
      },
    } } },
  }

  it('无 creds 且 tombstone → 抛需登录错误', async () => {
    await expect(parseTwitter('https://x.com/u/status/2059244332285313260', syndicationHttp)).rejects.toThrow(/不可访问|登录/)
  })

  it('有 creds + GraphQL 200 → 解析需登录推文', async () => {
    const t = await parseTwitter('https://x.com/u/status/2059244332285313260', syndicationHttp, creds, gqlGet(gqlTweet))
    expect(t.type).toBe('video')
    expect(t.video).toBe('https://video/832.mp4')       // 取最高码率
    expect(t.videos[0].url).toBe('https://video/832.mp4')
    expect(t.images).toEqual(['https://pbs/p.jpg'])
    expect(t.cover).toBe('https://pbs/poster.jpg')
    expect(t.duration).toBe(5)
    expect(t.author).toBe('L K')
    expect(t.uid).toBe('lk1')
    expect(t.like).toBe(5)
    expect(t.share).toBe(4)
    expect(t.play).toBe(999)
    expect(t.publishTime).toBe(Date.parse('Fri Jan 01 00:00:00 +0000 2021'))
  })

  it('TweetWithVisibilityResults 包裹 → 解包 .tweet 解析', async () => {
    const wrapped = { data: { tweetResult: { result: {
      __typename: 'TweetWithVisibilityResults',
      tweet: gqlTweet.data.tweetResult.result,
    } } } }
    const t = await parseTwitter('https://x.com/u/status/2059244332285313260', syndicationHttp, creds, gqlGet(wrapped))
    expect(t.type).toBe('video')
    expect(t.video).toBe('https://video/832.mp4')
  })

  it('有 creds + GraphQL 403 → 抛 Cloudflare 指纹错误', async () => {
    await expect(parseTwitter('https://x.com/u/status/2059244332285313260', syndicationHttp, creds, gqlGet({}, 403)))
      .rejects.toThrow(/Cloudflare|TLS 指纹/)
  })
})
