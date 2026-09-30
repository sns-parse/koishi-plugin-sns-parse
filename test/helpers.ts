import { createRuntime, ParserRuntime } from '../src/runtime'
import { createPlainHost } from '../src/host'

/** 构造一份足够驱动 flush/fetchApi/getPlatformConfig 的默认配置 */
export function makeConfig(overrides: Record<string, any> = {}): any {
  return {
    enable: true,
    debug: false,
    deduplicationInterval: 180,
    cacheTTL: 600,
    maxConcurrent: 3,
    platformEnabled: {},
    enableDeduplication: true,
    platformDedicatedFirst: {},
    globalFieldMapping: '{}',
    customApis: [],
    customPlatforms: [],
    primaryApiUrl: 'https://api.bugpk.com/api/short_videos',
    backupApiUrl: 'https://api.bugpk.com/api/svparse',
    retryTimes: 1,
    retryInterval: 1,
    timeout: 5000,
    userAgent: 'test-ua',
    customHeaders: [],
    maxDescLength: 200,
    unifiedMessageFormat: '标题：${标题}\n作者：${作者}\n点赞：${点赞数}',
    showImageText: true,
    enableForward: false,
    showAuthorAvatar: false,
    showCoverImage: true,
    showCoverText: false,
    showMusicCover: false,
    showMusicVoice: false,
    sendLiveMessage: true,
    showCoverFile: true,
    showImageFileNew: true,
    showAuthorAvatarFile: true,
    showMusicVoiceFile: true,
    showAuthorAvatarText: false,
    ignoreSendError: true,
    videoSendTimeout: 0,
    proxy: { enabled: false },
    ...overrides,
  }
}

/** 模拟 Koishi session：记录所有 send 调用，便于断言 */
export function mockSession(opts: { content?: string; elements?: any[]; platform?: string; subtype?: string; channelId?: string } = {}) {
  const sent: any[] = []
  return {
    platform: opts.platform ?? 'onebot',
    selfId: 'bot1',
    userId: 'user1',
    channelId: opts.channelId,
    messageId: 'msg1',
    subtype: opts.subtype ?? 'private',
    content: opts.content ?? '',
    elements: opts.elements,
    async send(content: any) {
      sent.push(content)
      return []
    },
    _sent: sent,
  }
}

/** 构造一个 http.get 返回固定 payload 的 mock axios 实例 */
export function mockHttp(payloadByMatcher: ((url: string) => any) | any) {
  return {
    get: async (url: string) => {
      const payload = typeof payloadByMatcher === 'function' ? payloadByMatcher(url) : payloadByMatcher
      return { data: payload }
    },
  }
}

/** 构造 ParserRuntime，并用 mock http 替换真实 axios 实例 */
export function makeRuntime(opts: { config?: any; http?: any } = {}): ParserRuntime {
  const config = makeConfig(opts.config)
  const rt = createRuntime(createPlainHost(), config)
  if (opts.http) (rt as any).http = opts.http
  return rt
}

/** 从收集到的发送内容中提取文本（h 元素或纯文本；自动展开数组） */
export function sentTexts(sent: any[]): string[] {
  const out: string[] = []
  const walk = (c: any) => {
    if (c == null) return
    if (Array.isArray(c)) { c.forEach(walk); return }
    if (typeof c === 'string') { out.push(c); return }
    if (c.type === 'text') { out.push(c.attrs?.content ?? ''); return }
    out.push(c.type ? `<${c.type}>` : JSON.stringify(c))
  }
  sent.forEach(walk)
  return out
}

/** 递归展开发送内容（元素数组/合并转发节点），提取全部 h 元素 */
export function sentElements(sent: any[]): any[] {
  const out: any[] = []
  const walk = (c: any) => {
    if (c == null) return
    if (Array.isArray(c)) { c.forEach(walk); return }
    if (typeof c === 'object') {
      out.push(c)
      if (Array.isArray(c.children)) c.children.forEach(walk)
    }
  }
  sent.forEach(walk)
  return out
}
