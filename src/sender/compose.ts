/**
 * 发送编排：把一条解析结果拆成「语义单元」（MessageUnit），按发送策略消费。
 *
 * 每个单元带 mergeable 标记：
 * - mergeable=true：概述文字/头像/封面/图片/音乐/提示文案（含受限视频与混淆图提示），
 *   全部并入首条消息——提示说清楚「怎么取」
 * - mergeable=false：后面跟着的干脆的可领取形式，不含其他内容：
 *   视频文件 / 「取视频 <token>」/ 「解混淆 <token>[混淆图]」
 *
 * 消费方式见 flush.ts：
 * - sendSingle：合并所有 mergeable 单元为一条，mergeable=false 单元逐条
 * - sendSplit：每个单元一条
 * - sendForward：每个单元一个转发气泡（仅一条时不打包直接发送）
 */
import { h } from 'koishi'
import type { ParserRuntime } from '../runtime'
import type { ParsedData } from '../types'
import { delay } from '../utils/common'
import { sendWithTimeout } from './sender'
import type { ImageOutcome, VideoOutcome } from '../services/nsfw/gate'

export interface ProcessedItem {
  text: string
  parsed: ParsedData
  images: ImageOutcome[]
  avatar: ImageOutcome
  cover: ImageOutcome | null
  video: VideoOutcome
  /** 推文动图转 GIF 的成品（转换失败为 null，回退发视频） */
  gif?: Buffer | null
  /** 多视频推文的其余视频及其 GIF 成品（与 extraVideos 一一对应） */
  extraVideos?: VideoOutcome[]
  extraGifs?: (Buffer | null)[]
}

/** 一个待发送的语义单元 */
export interface MessageUnit {
  content: h[]
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
  const push = (content: h[], mergeable: boolean) => { if (content.length) units.push({ content, mergeable }) }

  // ① 概述文字
  if (item.text && config.showImageText) push([h.text(item.text)], true)

  // ② 头像（非混淆）
  if (config.showAuthorAvatar && p.avatar && item.avatar.kind !== 'drop' && item.avatar.kind !== 'scrambled' && item.avatar.url) {
    push([h.image(item.avatar.url)], true)
  }
  // ③ 封面（非混淆）
  if (item.cover && item.cover.kind === 'raw' && item.cover.url
      && p.cover && config.showCoverImage && p.type !== 'live_photo' && p.type !== 'image' && p.type !== 'live') {
    const c: h[] = []
    if (config.showCoverText) c.push(h.text(config.coverText || '封面：'))
    c.push(h.image(item.cover.url))
    push(c, true)
  }
  // ④ 音乐封面
  if (config.showMusicCover && p.music.cover) push([h.image(p.music.cover)], true)

  // ⑤ 非混淆图片
  for (const img of item.images) {
    if (img.kind === 'raw' && img.url) push([h.image(img.url)], true)
    else if (img.kind === 'link' && img.url) push([h.text(`图片链接：${img.url}`)], true)
  }

  // ⑥ 合规视频（必须独立，含视频自动分条）；动图已转 GIF 时以图片形式独立发送
  if (item.gif) {
    push([h.image(item.gif, 'image/gif')], false)
  } else if (p.video && p.type !== 'live' && p.type !== 'live_photo' && item.video.kind === 'raw' && item.video.url) {
    push([config.showVideoFile !== false ? h.video(item.video.url) : h.text(`视频链接：${item.video.url}`)], false)
  }

  // ⑥b 多视频推文：其余视频逐条独立发送（动图转 GIF 优先，受限降级链接）
  for (let i = 0; i < (item.extraVideos?.length || 0); i++) {
    const ev = item.extraVideos![i]
    const eg = item.extraGifs?.[i]
    if (eg) {
      push([h.image(eg, 'image/gif')], false)
    } else if (ev.kind === 'raw' && ev.url) {
      push([config.showVideoFile !== false ? h.video(ev.url) : h.text(`视频链接：${ev.url}`)], false)
    } else if (ev.kind === 'link' && ev.url) {
      push([h.text(`视频链接：${ev.url}`)], true)
    }
  }

  // ⑦ 音乐语音
  if (config.showMusicVoice && p.music.url) push([h.audio(p.music.url)], true)
  // ⑧ 直播提示
  if (p.type === 'live' && config.sendLiveMessage) push([h.text('直播进行中，无法发送视频流。')], true)

  // ⑨ 受限视频：提示并入首条消息；取件码独立为干脆的「取视频 <token>」
  const videoHint = buildVideoHint(rt, item)
  if (videoHint) push([h.text(videoHint)], true)
  if (item.video.kind === 'card' && item.video.token) push([h.text(`取视频 ${item.video.token}`)], false)

  // ⑩ 混淆图：首条只报数量；每张独立为干脆的「解混淆 <token>[混淆图]」
  const scrambledImgs = [item.avatar, item.cover, ...item.images]
    .filter(img => img?.kind === 'scrambled' && img.buffer) as { kind: 'scrambled'; buffer: Buffer; token?: string }[]
  if (scrambledImgs.length) {
    const summary = buildImageHint(rt, scrambledImgs.length)
    if (summary) push([h.text(summary)], true)
  }
  for (const img of scrambledImgs) {
    const c: h[] = []
    if (img.token) c.push(h.text(`解混淆 ${img.token}`))
    c.push(h.image(img.buffer, 'image/png'))
    push(c, false)
  }

  return units
}

/** 发送单个单元；视频发送失败降级为链接文字 */
async function sendContent(rt: ParserRuntime, session: any, content: h[], quoteId?: string): Promise<void> {
  const toSend = quoteId ? [h.quote(quoteId), ...content] : content
  await sendWithTimeout(rt, session, toSend).catch(async () => {
    const links = content.map((e: any) => e.type === 'video' && e.attrs?.src ? h.text(`视频链接：${e.attrs.src}`) : e)
    await sendWithTimeout(rt, session, quoteId ? [h.quote(quoteId), ...links] : links).catch(() => {})
  })
}

/**
 * 单条整合：合并所有 mergeable 单元为一条消息（图片超限则退化为逐条），
 * mergeable=false 单元独立逐条。
 */
export async function sendSingle(
  rt: ParserRuntime,
  session: any,
  item: ProcessedItem,
  opts: { quoteId?: string } = {},
): Promise<void> {
  const units = buildUnits(rt, item)
  const mergeable = units.filter(u => u.mergeable)
  const standalone = units.filter(u => !u.mergeable)
  const maxImages = rt.config.singleSendMaxImages || 10

  let quote = opts.quoteId
  if (mergeable.length) {
    const imgCount = mergeable.reduce((n, u) => n + u.content.filter((e: any) => e.type === 'img').length, 0)
    if (imgCount <= maxImages) {
      const merged = mergeable.flatMap(u => u.content)
      await sendContent(rt, session, merged, quote)
      await delay(300)
      quote = undefined // 仅首条引用原消息
    } else {
      for (const u of mergeable) {
        await sendContent(rt, session, u.content, quote)
        await delay(300)
        quote = undefined
      }
    }
  }

  for (const u of standalone) {
    await sendContent(rt, session, u.content, quote)
    await delay(300)
    quote = undefined
  }
}

/** 逐条发送：每个语义单元一条消息 */
export async function sendSplit(
  rt: ParserRuntime,
  session: any,
  item: ProcessedItem,
  opts: { quoteId?: string } = {},
): Promise<void> {
  const units = buildUnits(rt, item)
  let quote = opts.quoteId
  for (const u of units) {
    await sendContent(rt, session, u.content, quote)
    await delay(300)
    quote = undefined
  }
}
