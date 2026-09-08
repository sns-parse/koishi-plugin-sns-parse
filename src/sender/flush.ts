/**
 * 解析编排：三层去重 → 并发解析 → gate（NSFW 策略）预处理 → 发送分派。
 *
 * 去重三层（默认全开）：
 * ① 同消息 URL 去重（含并发竞态）
 * ② 内容指纹去重（不同链接相同内容只发首个）
 * ③ title===desc 抑制（engine/parser 与 twitter mapper 内实现）
 *
 * 发送分派（优先级）：
 * enableForward(onebot/satori) → 合并转发
 * sendStrategy='single'（默认）→ 单条整合；不可行/失败 → 转发 → split
 * sendStrategy='split' → 逐条
 */
import type { ParserRuntime } from '../runtime'
import type { LinkMatch } from '../types'
import { ConcurrencyLimiter } from '../utils/concurrency'
import { debugLog, logger } from '../utils/logger'
import { contentFingerprint, getText } from '../utils/common'
import { mp4ToGif } from '../utils/gif'
import { getPlatformConfig } from '../platforms/custom'
import { processSingleUrl } from '../engine/fetcher'
import { processImage, processVideo } from '../services/nsfw/gate'
import type { ImageOutcome, VideoOutcome } from '../services/nsfw/gate'
import { sendWithTimeout } from './sender'
import { sendSplit, sendSingle, type ProcessedItem } from './compose'
import { sendForward } from './forward'

export interface FlushOptions {
  /** 手动命令（parse <url>）显式触发：跳过去重检查（用户明确要求重新解析） */
  skipDedup?: boolean
}

/** 去重键按会话隔离：防的是同一会话内刷屏，不阻断内容跨会话传播 */
function dedupScopeKey(session: any, url: string): string {
  const scope = session?.channelId || session?.guildId || session?.userId || 'global'
  return `${scope}::${url}`
}

/** gate 预处理：把 ParsedData 转成发送层消费的 ProcessedItem */
async function processItem(rt: ParserRuntime, session: any, platform: string, text: string, parsed: any): Promise<ProcessedItem> {
  const requesterId = String(session?.userId || 'unknown')
  const images: ImageOutcome[] = []
  for (const url of (parsed.images || []) as string[]) {
    images.push(await processImage(rt, platform, url, 'image'))
  }
  const avatar = parsed.avatar ? await processImage(rt, platform, parsed.avatar, 'avatar') : { kind: 'drop' as const }
  const cover = (parsed.cover && parsed.type !== 'image' && parsed.type !== 'live_photo' && parsed.type !== 'live')
    ? await processImage(rt, platform, parsed.cover, 'cover')
    : null

  const video: VideoOutcome = parsed.video
    ? await processVideo(rt, platform, parsed.video, parsed.cover || '', { title: parsed.title, author: parsed.author, requesterId })
    : { kind: 'raw' as const, url: '' }

  // 推文动图：按配置转 GIF（仅合规视频；转换失败回退原视频）
  let gif: Buffer | null = null
  if (parsed.isGif && video.kind === 'raw' && video.url && rt.config.gifConvertEnabled !== false) {
    gif = await mp4ToGif(rt, video.url, parsed.duration, {
      maxWidth: rt.config.gifMaxWidth || 480,
      fps: rt.config.gifFps || 15,
      maxDurationSec: rt.config.gifMaxDurationSec || 15,
    })
  }

  // 多视频推文：其余视频逐条过 gate 与 GIF 转换；封面单独审核、随行展示，视频判定用各自封面
  const extraVideos: VideoOutcome[] = []
  const extraGifs: (Buffer | null)[] = []
  const extraCovers: (ImageOutcome | null)[] = []
  for (const ev of parsed.extraVideos || []) {
    const evCover = ev.cover || parsed.cover || ''
    extraCovers.push(evCover
      ? await processImage(rt, platform, evCover, 'cover')
      : null)
    const outcome = await processVideo(rt, platform, ev.url, evCover, { title: parsed.title, author: parsed.author, requesterId })
    extraVideos.push(outcome)
    if (ev.isGif && outcome.kind === 'raw' && outcome.url && rt.config.gifConvertEnabled !== false) {
      extraGifs.push(await mp4ToGif(rt, outcome.url, ev.duration || 0, {
        maxWidth: rt.config.gifMaxWidth || 480,
        fps: rt.config.gifFps || 15,
        maxDurationSec: rt.config.gifMaxDurationSec || 15,
      }))
    } else {
      extraGifs.push(null)
    }
  }

  return { text, parsed, images, avatar, cover, video, gif, extraVideos, extraGifs, extraCovers }
}

export async function flush(rt: ParserRuntime, session: any, matches: LinkMatch[], opts: FlushOptions = {}) {
  const { config, dedupCache, contentDedupCache } = rt
  debugLog(`开始解析 ${matches.length} 个链接`)
  const items: ProcessedItem[] = []
  const errors: string[] = []
  const limiter = new ConcurrencyLimiter(config.maxConcurrent || 3)

  // 去重层①：同消息 URL 去重（保序）
  const seenUrl = new Set<string>()
  const uniqueMatches = matches.filter((m) => {
    const key = m.url.replace(/\/+$/, '')
    if (seenUrl.has(key)) return false
    seenUrl.add(key)
    return true
  })

  const promises = uniqueMatches.map(async (match) => {
    await limiter.acquire()
    try {
      const platformEnabled = config.platformEnabled?.[match.type] ?? true
      if (!platformEnabled && !match.type.startsWith('custom_')) {
        debugLog(`平台 ${match.type} 已禁用，跳过链接: ${match.url}`)
        return
      }
      const dedupEnabled = !opts.skipDedup && config.enableDeduplication !== false && config.deduplicationInterval > 0
      const scopeKey = dedupScopeKey(session, match.url)
      if (dedupEnabled) {
        const lastTime = dedupCache.get(scopeKey)
        if (lastTime && (Date.now() - lastTime < config.deduplicationInterval * 1000)) {
          debugLog(`跳过重复链接: ${match.url}`)
          const shortUrl = match.url.length > 80 ? match.url.slice(0, 80) + '...' : match.url
          const tip = getText(config, 'deduplicationTipText').replace(/\$\{url\}/g, shortUrl).replace(/\$\{interval\}/g, String(config.deduplicationInterval))
          await sendWithTimeout(rt, session, tip).catch(() => {})
          return
        }
      }
      logger.info(`解析链接: ${match.url} (${match.type})`)
      const platformConf = getPlatformConfig(rt, match.type)
      const result = await processSingleUrl(rt, match.url, match.type, platformConf.fieldMapping, platformConf)
      if (result.success) {
        if (dedupEnabled) {
          // 去重层②：内容指纹按会话隔离；不同链接相同内容只发首个
          const fp = dedupScopeKey(session, contentFingerprint(result.data.parsed))
          const lastDedup = contentDedupCache.get(fp)
          if (lastDedup && (Date.now() - lastDedup < config.deduplicationInterval * 1000)) {
            debugLog(`跳过重复内容: ${match.url}`)
            return
          }
          contentDedupCache.set(fp, Date.now())
          dedupCache.set(scopeKey, Date.now())
        }
        items.push(await processItem(rt, session, match.type, result.data.text, result.data.parsed))
      } else {
        const displayUrl = match.url.length > 80 ? match.url.slice(0, 80) + '...' : match.url
        const item = getText(config, 'parseErrorItemFormat').replace(/\$\{url\}/g, displayUrl).replace(/\$\{msg\}/g, result.msg)
        errors.push(item)
      }
    } finally {
      limiter.release()
    }
  })
  await Promise.all(promises)

  if (errors.length) await sendWithTimeout(rt, session, `${getText(config, 'parseErrorPrefix')}\n${errors.join('\n')}`)
  if (!items.length) return

  const forwardAllowed = config.enableForward && (session.platform === 'onebot' || session.platform === 'satori')

  if (forwardAllowed) {
    await sendForward(rt, session, items)
    return
  }

  if (config.sendStrategy === 'split') {
    for (const item of items) await sendSplit(rt, session, item, { quoteId: session?.messageId })
    return
  }

  // single（默认）：单条整合；混淆图/视频取件码作为例外独立发送
  for (const item of items) {
    await sendSingle(rt, session, item, { quoteId: session?.messageId })
  }
}
