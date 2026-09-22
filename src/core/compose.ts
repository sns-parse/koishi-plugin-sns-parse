/**
 * 发送编排：把一条解析结果拆成「语义单元」（MessageUnit），按发送策略消费。
 *
 * 本模块发送层无关：只构建 OutboundElement，具体发送交给 OutboundSender。
 *
 * 每个单元带 mergeable 标记：
 * - mergeable=true：概述文字/头像/封面/图片/音乐/提示文案（含受限视频与混淆图提示），
 *   全部并入首条消息——提示说清楚「怎么取」
 * - mergeable=false：后面跟着的干脆的可领取形式，不含其他内容：
 *   视频文件 / 「取视频 <token>」/ 「解混淆 <token>[混淆图]」
 *
 * 消费方式见 core/flush.ts：
 * - sendSingle：合并所有 mergeable 单元为一条，mergeable=false 单元逐条
 * - sendSplit：每个单元一条
 * - sendForward：每个单元一个转发气泡（仅一条时不打包直接发送）
 */
import type { ParserRuntime } from '../runtime'
import type { ParsedData } from '../types'
import { delay } from '../utils/common'
import { el, videoFallback, type OutboundElement, type OutboundSender, type SessionLike } from './sender'
import type { ImageOutcome, VideoOutcome } from './extensions'

export interface ProcessedItem {
  text: string
  parsed: ParsedData
  images: ImageOutcome[]
  avatar: ImageOutcome
  cover: ImageOutcome | null
  video: VideoOutcome
  /** 推文动图转 GIF 的成品（转换失败为 null，回退发视频） */
  gif?: Buffer | null
  /** 多视频推文的其余视频及其 GIF 成品/封面（与 extraVideos 一一对应） */
  extraVideos?: VideoOutcome[]
  extraGifs?: (Buffer | null)[]
  extraCovers?: (ImageOutcome | null)[]
}

/** 一个待发送的语义单元 */
export interface MessageUnit {
  content: OutboundElement[]
  /** true=可合并进单条消息；false=必须独立发送（视频文件/混淆图/取件码） */
  mergeable: boolean
}

/** 首条消息的混淆图数量提示（不含取件码，取件码只出现在独立领取消息里） */
export function buildImageHint(rt: ParserRuntime, count: number): string {
  const nsfw = rt.config.nsfwPolicy || {}
  return String(nsfw.tokenHintText || '').replace(/\$\{count\}/g, String(count))
}

/** 首条消息的受限视频提示（不含取件码；token 只在独立的「取视频 <token>」消息里） */
export function buildVideoHint(rt: ParserRuntime, item: ProcessedItem): string {
  const nsfw = rt.config.nsfwPolicy || {}
  if (item.video.kind === 'card' && item.video.token) {
    const ttl = rt.config.nsfwVault?.ttlMinutes || 30
    const until = new Date(Date.now() + ttl * 60000)
    const untilStr = `${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`
    return String(nsfw.videoCardHint || '')
      .replace(/\$\{until\}/g, untilStr)
      .replace(/\$\{ttl\}/g, String(ttl))
  }
  if (item.video.kind === 'link' && item.video.url) return `受限视频未在群内发送。视频链接：${item.video.url}`
  if (item.video.kind === 'drop' && item.parsed.video) return '受限视频未在群内发送。'
  return ''
}

/** 把 ProcessedItem 拆成有序语义单元 */
export function buildUnits(rt: ParserRuntime, item: ProcessedItem): MessageUnit[] {
  const { config } = rt
  const p = item.parsed
  const units: MessageUnit[] = []
  const push = (content: OutboundElement[], mergeable: boolean) => { if (content.length) units.push({ content, mergeable }) }

  // ① 概述文字
  if (item.text && config.showImageText) push([el.text(item.text)], true)

  // ② 头像（非混淆）
  if (config.showAuthorAvatar && p.avatar && item.avatar.kind !== 'drop' && item.avatar.kind !== 'scrambled' && item.avatar.url) {
    push([el.image(item.avatar.url)], true)
  }
  // ③ 封面（非混淆）；多视频推文的每个视频封面都进概述区
  if (item.cover && item.cover.kind === 'raw' && item.cover.url
      && p.cover && config.showCoverImage && p.type !== 'live_photo' && p.type !== 'image' && p.type !== 'live') {
    const c: OutboundElement[] = []
    if (config.showCoverText) c.push(el.text(config.coverText || '封面：'))
    c.push(el.image(item.cover.url))
    push(c, true)
  }
  if (config.showCoverImage && p.type !== 'live_photo' && p.type !== 'image' && p.type !== 'live') {
    for (const ec of item.extraCovers || []) {
      if (ec?.kind === 'raw' && ec.url && ec.url !== item.cover?.url) push([el.image(ec.url)], true)
      else if (ec?.kind === 'link' && ec.url && ec.url !== item.cover?.url) push([el.text(`封面链接：${ec.url}`)], true)
    }
  }
  // ④ 音乐封面
  if (config.showMusicCover && p.music.cover) push([el.image(p.music.cover)], true)

  // ⑤ 非混淆图片（raw 可带 buffer：同源切图合并成品优先按 buffer 发送）
  for (const img of item.images) {
    if (img.kind === 'raw' && img.buffer) push([el.imageBuffer(img.buffer, 'image/jpeg')], true)
    else if (img.kind === 'raw' && img.url) push([el.image(img.url)], true)
    else if (img.kind === 'link' && img.url) push([el.text(`图片链接：${img.url}`)], true)
  }

  // ⑥ 合规视频（必须独立，含视频自动分条）；动图已转 GIF 时以图片形式独立发送
  if (item.gif) {
    push([el.imageBuffer(item.gif, 'image/gif')], false)
  } else if (p.video && p.type !== 'live' && p.type !== 'live_photo' && item.video.kind === 'raw' && item.video.url) {
    push([config.showVideoFile !== false ? el.video(item.video.url) : el.text(`视频链接：${item.video.url}`)], false)
  }

  // ⑥b 多视频推文：其余视频逐条独立发送（动图转 GIF 优先，受限降级链接）
  for (let i = 0; i < (item.extraVideos?.length || 0); i++) {
    const ev = item.extraVideos![i]
    const eg = item.extraGifs?.[i]
    if (eg) {
      push([el.imageBuffer(eg, 'image/gif')], false)
    } else if (ev.kind === 'raw' && ev.url) {
      push([config.showVideoFile !== false ? el.video(ev.url) : el.text(`视频链接：${ev.url}`)], false)
    } else if (ev.kind === 'link' && ev.url) {
      push([el.text(`视频链接：${ev.url}`)], true)
    }
  }

  // ⑦ 音乐语音
  if (config.showMusicVoice && p.music.url) push([el.audio(p.music.url)], true)
  // ⑧ 直播提示
  if (p.type === 'live' && config.sendLiveMessage) push([el.text('直播进行中，无法发送视频流。')], true)

  // ⑨ 受限视频：提示并入首条消息（存在任一受限视频即提示一次）；每个取件码独立成条
  const cardOutcomes = ([item.video, ...(item.extraVideos || [])] as any[])
    .filter(v => v?.kind === 'card' && v.token) as { kind: 'card'; token: string }[]
  let videoHint = buildVideoHint(rt, item)
  if (!videoHint && cardOutcomes.length) {
    // 主视频未受限但存在受限的额外视频（按各自封面单独判定）：仍给出领取提示
    videoHint = buildVideoHint(rt, { ...item, video: cardOutcomes[0] } as any)
  }
  if (videoHint) push([el.text(videoHint)], true)
  for (const c of cardOutcomes) push([el.text(`取视频 ${c.token}`)], false)

  // ⑩ 混淆图：首条只报数量；每张独立为干脆的「解混淆 <token>[混淆图]」（多视频封面同策略）
  const scrambledImgs = [item.avatar, item.cover, ...(item.extraCovers || []), ...item.images]
    .filter(img => img?.kind === 'scrambled' && img.buffer) as { kind: 'scrambled'; buffer: Buffer; token?: string }[]
  if (scrambledImgs.length) {
    const summary = buildImageHint(rt, scrambledImgs.length)
    if (summary) push([el.text(summary)], true)
  }
  for (const img of scrambledImgs) {
    const c: OutboundElement[] = []
    if (img.token) c.push(el.text(`解混淆 ${img.token}`))
    c.push(el.imageBuffer(img.buffer, 'image/png'))
    push(c, false)
  }

  return units
}

/** 发送一组元素；失败时视频元素降级为链接文字 */
async function sendElements(
  sender: OutboundSender,
  session: SessionLike,
  elements: OutboundElement[],
  quoteId?: string,
): Promise<void> {
  const withQuote = quoteId ? [el.quote(quoteId), ...elements] : elements
  try {
    await sender.send(session, withQuote)
  } catch {
    const links = elements.map(videoFallback)
    await sender.send(session, quoteId ? [el.quote(quoteId), ...links] : links).catch(() => {})
  }
}

/**
 * 单条整合：合并所有 mergeable 单元为一条消息（图片超限则退化为逐条），
 * mergeable=false 单元独立逐条。
 */
export async function sendSingle(
  rt: ParserRuntime,
  sender: OutboundSender,
  session: SessionLike,
  item: ProcessedItem,
  opts: { quoteId?: string } = {},
): Promise<void> {
  const units = buildUnits(rt, item)
  const mergeable = units.filter(u => u.mergeable)
  const standalone = units.filter(u => !u.mergeable)
  const maxImages = rt.config.singleSendMaxImages || 10

  let quote = opts.quoteId
  if (mergeable.length) {
    const imgCount = mergeable.reduce((n, u) => n + u.content.filter(e => e.type === 'image').length, 0)
    if (imgCount <= maxImages) {
      const merged = mergeable.flatMap(u => u.content)
      await sendElements(sender, session, merged, quote)
      await delay(300)
      quote = undefined // 仅首条引用原消息
    } else {
      for (const u of mergeable) {
        await sendElements(sender, session, u.content, quote)
        await delay(300)
        quote = undefined
      }
    }
  }

  for (const u of standalone) {
    await sendElements(sender, session, u.content, quote)
    await delay(300)
    quote = undefined
  }
}

/** 逐条发送：每个语义单元一条消息 */
export async function sendSplit(
  rt: ParserRuntime,
  sender: OutboundSender,
  session: SessionLike,
  item: ProcessedItem,
  opts: { quoteId?: string } = {},
): Promise<void> {
  const units = buildUnits(rt, item)
  let quote = opts.quoteId
  for (const u of units) {
    await sendElements(sender, session, u.content, quote)
    await delay(300)
    quote = undefined
  }
}
