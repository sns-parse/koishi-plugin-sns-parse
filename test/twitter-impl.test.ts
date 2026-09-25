import { describe, it, expect } from 'vitest'
import {
  parseTwitter, fetchTweetTree, assembleReplies,
  categorizeTweetResult, parseTimeline, parseConnections,
  type TweetTree,
} from '../src/platforms/twitter'

/* ---------- X 长推全文 / 深度提取 / 换行保留（回归自 core 0.5 迁移） ---------- */

const SYN_URL = 'https://x.com/__soragoto__/status/2102260920382541939'
const synHttp = {
  get: async () => ({
    data: {
      __typename: 'Tweet',
      user: { screen_name: '__soragoto__', name: 'そら' },
      text: '一个人被大伙跨越了结界魔法般的世界。world, heaven,',
      lang: 'zh',
      note_tweet: { id: 'Tm90ZVR3ZWV0UmVzdWx0czoyMTAyMjYwOTIwMjg2MDgxMDI0' },
      display_text_range: [0, 162],
    },
  }),
} as any

const gqlResult = (id: string, opts: { replyTo?: string; quote?: any } = {}): any => ({
  __typename: 'Tweet',
  rest_id: id,
  legacy: {
    id_str: id, full_text: `tweet-${id}`, lang: 'zh', favorite_count: 1,
    ...(opts.replyTo ? { in_reply_to_status_id_str: opts.replyTo } : {}),
  },
  core: { user_results: { result: { legacy: { name: 'n', screen_name: 's', followers_count: 1 } } } },
  ...(opts.quote ? { quoted_status_result: { result: opts.quote } } : {}),
})

const graphqlFull = (async () => ({
  status: 200,
  data: { data: { tweetResult: { result: {
    __typename: 'Tweet',
    legacy: { full_text: '一个人被大伙跨越了结界魔法般的世界。world, heaven,', lang: 'zh', favorite_count: 1 },
    note_tweet: { note_results: { note: { text: 'FULL-NOTE-TEXT-全文' } } },
    core: { user_results: { result: { legacy: { name: 'そら', screen_name: '__soragoto__' } } } },
  } } } },
})) as any

describe('twitter 长推全文回退（回归）', () => {
  it('无登录态降级为截断文本', async () => {
    const p = await parseTwitter(SYN_URL, synHttp)
    expect(p.desc).toContain('world, heaven,')
    expect(p.desc).not.toContain('FULL-NOTE')
  })
  it('有登录态经 GraphQL 取回全文', async () => {
    const p = await parseTwitter(SYN_URL, synHttp, { authToken: 't', ct0: 'c' }, graphqlFull)
    expect(p.desc).toBe('FULL-NOTE-TEXT-全文')
  })
  it('GraphQL 失败回退截断结果', async () => {
    const p = await parseTwitter(SYN_URL, synHttp, { authToken: 't', ct0: 'c' }, (async () => { throw new Error('403') }) as any)
    expect(p.desc).toContain('world, heaven,')
  })
  it('新版用户/笔记结构深度提取（作者/头像/全文/统计）', async () => {
    const graphqlNewShape = (async () => ({
      status: 200,
      data: { data: { tweetResult: { result: {
        __typename: 'Tweet',
        legacy: { full_text: '一个人被大伙跨越了结界魔法般的世界。world, heaven,', lang: 'zh', favorite_count: 988, retweet_count: 79, bookmark_count: 236 },
        note_tweet: { note_results: { result: { text: 'FULL-NEW-SHAPE-全文' } } },
        views: { count: '76284' },
        core: { user_results: { result: {
          __typename: 'User',
          core: { name: '空言', screen_name: '__soragoto__' },
          avatar: { image_url: 'https://pbs.twimg.com/profile_images/1/y_400x400.jpg' },
          profile_bio: { description: 'bio' },
          legacy: { followers_count: 1234 },
        } } },
      } } } },
    })) as any
    const p = await parseTwitter(SYN_URL, synHttp, { authToken: 't', ct0: 'c' }, graphqlNewShape)
    expect(p.desc).toBe('FULL-NEW-SHAPE-全文')
    expect(p.author).toBe('空言')
    expect(p.uid).toBe('__soragoto__')
    expect(p.avatar).toContain('profile_images')
    expect(p.author_followers).toBe(1234)
    expect(p.like).toBe(988)
    expect(p.collect).toBe(236)
    expect(p.play).toBe(76284)
  })
  it('段落换行保留 + t.co 短链剥离', async () => {
    const synHttp2 = {
      get: async () => ({
        data: {
          __typename: 'Tweet',
          user: { screen_name: 'a' },
          text: '第一段\n\n第二段 https://t.co/AbCdEf1234\n\n第三段',
          lang: 'zh',
        },
      }),
    } as any
    const p = await parseTwitter('https://x.com/a/status/2102260920382541000', synHttp2)
    expect(p.desc).toBe('第一段\n\n第二段\n\n第三段')
  })
})

/* ---------- 推文树（回归） ---------- */

describe('twitter 推文树（回归）', () => {
  it('游客态：引用启发式 + 回复上溯', async () => {
    const synTweets: Record<string, any> = {
      '1001': { __typename: 'Tweet', user: { screen_name: 'alice' }, text: '回复了楼上 https://t.co/Q1', lang: 'zh', in_reply_to_status_id_str: '1000', entities: { urls: [{ url: 'https://t.co/Q1', expanded_url: 'https://x.com/bob/status/900?type=link' }] } },
      '1000': { __typename: 'Tweet', user: { screen_name: 'bob' }, text: '根推，引用了别人的话 https://t.co/Q2', lang: 'zh', entities: { urls: [{ url: 'https://t.co/Q2', expanded_url: 'https://x.com/carol/status/999' }] } },
      '999': { __typename: 'Tweet', user: { screen_name: 'carol' }, text: '被引用的老推', lang: 'zh' },
    }
    const treeHttp = { get: async (_u: string, cfg: any) => ({ data: synTweets[cfg.params.id] }) } as any
    const t1 = await fetchTweetTree('https://x.com/alice/status/1001', treeHttp)
    expect(t1.id).toBe('1001')
    expect(t1.replyTo?.id).toBe('1000')
    expect(t1.replyTo?.quoted?.id).toBe('999')
    expect(t1.replyTo?.quoted?.replyTo).toBeUndefined()
  })
  it('GraphQL：嵌套引用链一次展开 + 父链拉取（visited 防环）', async () => {
    const nested = gqlResult('2002', { replyTo: '2001', quote: gqlResult('2999', { quote: gqlResult('2998') }) })
    const parent = gqlResult('2001', { quote: gqlResult('2998') })
    const gqlGet = (async (u: string) => {
      const m = /"tweetId":"(\d+)"/.exec(decodeURIComponent(u))
      const result = m && m[1] === '2002' ? nested : parent
      return { status: 200, data: { data: { tweetResult: { result } } } }
    }) as any
    const t2 = await fetchTweetTree('https://x.com/s/status/2002', { get: async () => { throw new Error('skip') } } as any, { authToken: 't', ct0: 'c' }, gqlGet)
    expect(t2.id).toBe('2002')
    expect(t2.quoted!.id).toBe('2999')
    expect(t2.quoted!.quoted!.id).toBe('2998')
    expect(t2.replyTo!.id).toBe('2001')
    expect(t2.replyTo!.quoted).toBeUndefined() // 同一引用已在子孙链出现，visited 去重省略
  })
  it('assembleReplies：直接回复/楼中楼递归/孤儿跳过/limit 截断', () => {
    const convResult = (id: string, replyTo?: string): any => gqlResult(id, { replyTo })
    const mkNode = (raw: any): TweetTree => {
      const cat = categorizeTweetResult(raw)
      return { id: cat.id, tweet: { desc: `conv-${cat.id}` } as any }
    }
    const convResults = [convResult('5000'), convResult('5001', '5000'), convResult('5002', '5000'), convResult('5003', '5001'), convResult('5004', '9999'), convResult('5000')]
    const replies = assembleReplies('5000', convResults, 100, mkNode)
    expect(replies.length).toBe(2)
    expect(replies.map((r) => r.id).sort()).toEqual(['5001', '5002'])
    expect(replies.find((r) => r.id === '5001')!.replies?.[0]?.id).toBe('5003')
    expect(assembleReplies('5000', convResults, 1, mkNode).length).toBe(1)
  })
  it('fetchTweetTree withReplies：TweetDetail 会话装配递归', async () => {
    const detailData = {
      data: { threaded_conversation_with_injections_v2: { timeline: { instructions: [
        { type: 'TimelineAddEntries', entries: [
          { entryId: 'tweet-focal', content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result: gqlResult('6000') } } } },
          { entryId: 'conv-1', content: { entryType: 'TimelineTimelineModule', items: [
            { itemContent: { tweet_results: { result: gqlResult('6001', { replyTo: '6000' }) } } },
            { itemContent: { tweet_results: { result: gqlResult('6002', { replyTo: '6001' }) } } },
          ] } },
        ] },
      ] } } },
    }
    const convGet = (async (u: string) => {
      const du = decodeURIComponent(u)
      if (du.includes('/TweetDetail')) return { status: 200, data: detailData }
      const m = /"tweetId":"(\d+)"/.exec(du)
      return { status: 200, data: { data: { tweetResult: { result: gqlResult(m?.[1] || '6000') } } } }
    }) as any
    const t3 = await fetchTweetTree('https://x.com/s/status/6000', { get: async () => { throw new Error('skip') } } as any, { authToken: 't', ct0: 'c' }, convGet, { withReplies: true })
    expect(t3.id).toBe('6000')
    expect(t3.replies?.length).toBe(1)
    expect(t3.replies![0].id).toBe('6001')
    expect(t3.replies![0].replies?.[0]?.id).toBe('6002')
  })
})

/* ---------- 用户时间线 / 关注列表（回归） ---------- */

describe('twitter 用户时间线纯函数（回归）', () => {
  it('categorizeTweetResult：转推解包/回复/媒体/文字', () => {
    const rt1 = {
      __typename: 'Tweet', rest_id: '3001',
      legacy: { id_str: '3001', full_text: 'RT @x: 转发内容', lang: 'zh', retweeted_status_result: { result: { __typename: 'Tweet', rest_id: '3000', legacy: { id_str: '3000', full_text: '原始内容', lang: 'zh', extended_entities: { media: [{ type: 'photo' }] } } } } },
    }
    const c1 = categorizeTweetResult(rt1)
    expect(c1.isRetweet).toBe(true)
    expect(c1.id).toBe('3000')
    expect(c1.hasImage).toBe(true)
    const c2 = categorizeTweetResult({ __typename: 'Tweet', rest_id: '3002', legacy: { id_str: '3002', full_text: '回复', in_reply_to_status_id_str: '3001', lang: 'zh' } })
    expect(c2.isReply).toBe(true)
    expect(c2.isText).toBe(true)
    const c3 = categorizeTweetResult({ __typename: 'Tweet', rest_id: '3003', legacy: { id_str: '3003', full_text: '视频', lang: 'zh', extended_entities: { media: [{ type: 'video' }] } } })
    expect(c3.hasVideo).toBe(true)
  })
  it('parseTimeline：Item/Module 条目 + Bottom 游标', () => {
    const instructions = [
      { type: 'TimelineAddEntries', entries: [
        { entryId: 'tweet-1', content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result: gqlResult('3001') } } } },
        { entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor', contentType: 'Bottom', value: 'CUR1' } },
      ] },
    ]
    const tl = parseTimeline(instructions)
    expect(tl.results.length).toBe(1)
    expect(tl.bottomCursor).toBe('CUR1')
  })
  it('parseConnections：legacy/core 双结构用户条目 + 游标', () => {
    const connInstructions = [
      { type: 'TimelineAddEntries', entries: [
        { entryId: 'user-1', content: { entryType: 'TimelineTimelineItem', itemContent: { user_results: { result: { __typename: 'User', legacy: { name: '张三', screen_name: 'zhang', followers_count: 10, followed_by: true }, profile_bio: { description: '简介' } } } } } },
        { entryId: 'user-2', content: { entryType: 'TimelineTimelineItem', itemContent: { user_results: { result: { __typename: 'User', is_blue_verified: true, core: { name: '李四', screen_name: 'li' } } } } } },
        { entryId: 'cursor-bottom', content: { entryType: 'TimelineTimelineCursor', contentType: 'Bottom', value: 'C1' } },
      ] },
    ]
    const conn = parseConnections(connInstructions)
    expect(conn.users.length).toBe(2)
    expect(conn.users[0].followedBy).toBe(true)
    expect(conn.users[1].verified).toBe(true)
    expect(conn.bottomCursor).toBe('C1')
  })
})

/* ---------- 外链卡片（t.co 预览）：展开保留 + og 预览图（0.3.0-alpha.2） ---------- */

describe('twitter 外链卡片（A+B）', () => {
  const mkHttp = (tweet: any, targetHtml: string | null, calls: string[]) => ({
    get: async (u: string) => {
      calls.push(u)
      if (u.includes('syndication')) return { data: tweet }
      if (targetHtml === null) throw new Error('should not fetch target')
      return { data: targetHtml }
    },
  }) as any

  it('A：外链 t.co 原位展开为真实链接（X 内部互链仍剥离）', async () => {
    const calls: string[] = []
    const http = mkHttp({
      __typename: 'Tweet',
      user: { screen_name: 'TwinkFeetUK', name: 'TFUK' },
      text: 'Post of the day: Preparing @BGNFeet for lunch https://t.co/bWFa14ET1y',
      lang: 'en',
      entities: { urls: [
        { url: 'https://t.co/bWFa14ET1y', expanded_url: 'https://www.twinkfeet.uk/210522bgnfeetfootroast/' },
      ] },
    }, null, calls)
    const p = await parseTwitter('https://x.com/TwinkFeetUK/status/2101235351356404176', http)
    expect(p.desc).toBe('Post of the day: Preparing @BGNFeet for lunch https://www.twinkfeet.uk/210522bgnfeetfootroast/')
    // 纯文字推 + 外链：og 探测会发起（mock 抛错被静默吞掉，不影响出文字结果）
    expect(calls).toHaveLength(2)
    expect(p.type).toBe('text')
    expect(p.images).toEqual([])
  })

  it('X 内部互链（pic.twitter.com）剥离且不触发预览探测', async () => {
    const calls: string[] = []
    const http = mkHttp({
      __typename: 'Tweet',
      user: { screen_name: 'a' },
      text: '看图 https://t.co/AbCdEf1234',
      lang: 'zh',
      entities: { urls: [{ url: 'https://t.co/AbCdEf1234', expanded_url: 'https://pic.twitter.com/a/1/photo/1' }] },
    }, null, calls)
    const p = await parseTwitter('https://x.com/a/status/2101235351356404000', http)
    expect(p.desc).toBe('看图')
    expect(p.images).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('B：纯文字推 + 外链卡片 → og:image 注入为预览图（实体解码）', async () => {
    const calls: string[] = []
    const http = mkHttp({
      __typename: 'Tweet',
      user: { screen_name: 'TwinkFeetUK', name: 'TFUK' },
      text: 'Post of the day https://t.co/bWFa14ET1y',
      lang: 'en',
      entities: { urls: [
        { url: 'https://t.co/bWFa14ET1y', expanded_url: 'https://www.twinkfeet.uk/210522bgnfeetfootroast/' },
      ] },
    }, '<html><head><meta property="og:image" content="https://www.twinkfeet.uk/wp-content/uploads/2021/05/210522BGNFeetfootroast.jpg?x=1&amp;y=2" /><meta property="og:title" content="Preparing" /></head></html>', calls)
    const p = await parseTwitter('https://x.com/TwinkFeetUK/status/2101235351356404176', http)
    expect(p.images).toEqual(['https://www.twinkfeet.uk/wp-content/uploads/2021/05/210522BGNFeetfootroast.jpg?x=1&y=2'])
    expect(p.type).toBe('image')
    expect(p.cover).toContain('twinkfeet.uk')
    expect(calls.filter(u => !u.includes('syndication'))).toHaveLength(1)
  })

  it('有原生媒体时不做外链预览探测（避免重复）', async () => {
    const calls: string[] = []
    const http = mkHttp({
      __typename: 'Tweet',
      user: { screen_name: 'a' },
      text: 'native + card https://t.co/xXxXxX1234',
      lang: 'zh',
      entities: { urls: [{ url: 'https://t.co/xXxXxX1234', expanded_url: 'https://example.com/page' }] },
      mediaDetails: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/1.jpg' }],
    }, null, calls)
    const p = await parseTwitter('https://x.com/a/status/2101235351356404111', http)
    expect(p.images).toEqual(['https://pbs.twimg.com/media/1.jpg'])
    expect(p.type).toBe('image')
    expect(calls).toHaveLength(1)
  })

  it('og 探测失败静默（目标不可达仍出文字结果）', async () => {
    const calls: string[] = []
    const http = {
      get: async (u: string) => {
        calls.push(u)
        if (u.includes('syndication')) {
          return { data: {
            __typename: 'Tweet',
            user: { screen_name: 'a' },
            text: 'link https://t.co/deadbeef99',
            lang: 'zh',
            entities: { urls: [{ url: 'https://t.co/deadbeef99', expanded_url: 'https://unreachable.example/x' }] },
          } }
        }
        throw new Error('ECONNREFUSED')
      },
    } as any
    const p = await parseTwitter('https://x.com/a/status/2101235351356404222', http)
    expect(p.desc).toBe('link https://unreachable.example/x')
    expect(p.type).toBe('text')
    expect(p.images).toEqual([])
  })
})
