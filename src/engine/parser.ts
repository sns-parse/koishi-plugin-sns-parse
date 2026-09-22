import type { ParsedData, VideoQuality } from '../types'
import { debugLog } from '../utils/logger'
import { getNestedValue } from '../utils/field-mapping'
import { pickBestQuality, parseCount } from '../utils/common'

export function parseApiResponse(rawInput: any, maxDescLen: number, fieldMapping?: Record<string, string>): ParsedData {
  // 兼容：响应本身为数组时取首个元素（部分第三方 API 行为）
  const raw = Array.isArray(rawInput) ? rawInput[0] : rawInput
  debugLog('API raw response', raw)
  let data: any = raw?.data || {}
  if (Array.isArray(data)) data = data[0] || {}
  const extra = data.extra || {}

  const mapField = (name: string, fallback: () => any) => {
    if (fieldMapping && fieldMapping[name]) {
      const value = getNestedValue(raw, fieldMapping[name])
      if (value !== undefined) return value
    }
    return fallback()
  }

  let type = mapField('type', () => {
    let t = data.type || data.videoType || ''
    if (!t) {
      if (data.images?.length > 0 && !data.url) t = 'image'
      else if (data.live_photo?.length > 0) t = 'live_photo'
      else if (raw.msg === 'live' || data.live) t = 'live'
      else t = 'video'
    }
    return t
  })

  let authorObj = mapField('author', () => data.author || data.user)
  let author = '', uid = '', avatar = ''
  if (authorObj && typeof authorObj === 'object') {
    author = authorObj.name || authorObj.author || ''
    uid = String(authorObj.id || authorObj.userID || data.uid || data.userID || data.author_id || '')
    avatar = authorObj.avatar || data.avatar || ''
  } else {
    author = mapField('author', () => data.author || data.auther || '')
    uid = String(mapField('uid', () => data.uid || data.userID || data.author_id || ''))
    avatar = mapField('avatar', () => data.avatar || '')
  }

  let title = mapField('title', () => data.title || '')
  let desc = (mapField('desc', () => data.desc || data.description || '') as string).slice(0, maxDescLen).trim()
  const coverRaw = mapField('cover', () => data.cover || '')
  const cover = coverRaw ? (String(coverRaw).startsWith('http') ? String(coverRaw) : 'https:' + String(coverRaw)) : ''

  let video = ''
  let videos: VideoQuality[] = []
  const videoBackup = mapField('video_backup', () => data.video_backup)
  if (Array.isArray(videoBackup) && videoBackup.length) {
    const bestQ = pickBestQuality(videoBackup)
    videos = bestQ
    video = bestQ[0]?.url || ''
  }
  if (!video) {
    const rawVideos = mapField('videos', () => data.videos)
    if (Array.isArray(rawVideos) && rawVideos.length) {
      const validVideos = rawVideos.filter((v: any) => v && v.url)
      if (validVideos.length) {
        video = validVideos[0].url
        videos = validVideos.map((v: any) => ({ quality: v.accept?.[0] || 'unknown', url: v.url }))
      }
    }
  }
  if (!video && data.quality_urls && typeof data.quality_urls === 'object') {
    const entries = Object.entries(data.quality_urls)
    videos = entries.map(([label, url]) => ({ quality: label, url: String(url) }))
    if (videos.length) video = videos[0].url
  }
  if (!video) video = mapField('video', () => data.url || '')
  if (video && !video.startsWith('http')) video = 'https:' + video

  let images: string[] = []
  // 统一图片地址规范化：兼容大写协议、// 协议相对地址、{url} 对象与数组形式（上游 v1.6.7）
  const normalizeImageUrl = (img: any): string | null => {
    if (typeof img === 'string') {
      if (!img) return null
      return /^https?:\/\//i.test(img) ? img : (/^\/\//.test(img) ? 'https:' + img : 'https:' + img)
    }
    if (Array.isArray(img) && img.length) return normalizeImageUrl(img[0])
    if (img && typeof img === 'object' && img.url) return normalizeImageUrl(String(img.url))
    return null
  }
  const directImages = mapField('images', () => data.images)
  if (Array.isArray(directImages)) {
    images = directImages.map(normalizeImageUrl).filter((u: string | null): u is string => !!u)
  } else if (Array.isArray(data.imgurl)) {
    images = data.imgurl.map(normalizeImageUrl).filter((u: string | null): u is string => !!u)
  } else if (directImages && typeof directImages === 'object') {
    const single = normalizeImageUrl(directImages)
    if (single) images = [single]
  }

  const live_photo = Array.isArray(data.live_photo) ? data.live_photo.filter((lp: any) => lp && lp.image).map((lp: any) => ({
    image: lp.image.startsWith('http') ? lp.image : 'https:' + lp.image,
    video: lp.video ? (lp.video.startsWith('http') ? lp.video : 'https:' + lp.video) : ''
  })) : []

  if (type === 'live' && live_photo.length > 0 && !data.live) {
    type = 'live_photo'
  }

  const musicCoverRaw = mapField('music_cover', () => data.music?.cover || data.music?.albumCover?.url || '')
  const musicUrlRaw = mapField('music_url', () => data.music?.url || data.music?.playURL || '')
  const musicUrlNorm = musicUrlRaw ? (String(musicUrlRaw).startsWith('http') ? String(musicUrlRaw) : 'https:' + String(musicUrlRaw)) : ''
  const music = {
    title: mapField('music_title', () => data.music?.title || data.music?.name || '') as string,
    author: mapField('music_author', () => data.music?.author || data.music?.artist || '') as string,
    cover: musicCoverRaw ? (String(musicCoverRaw).startsWith('http') ? String(musicCoverRaw) : 'https:' + String(musicCoverRaw)) : '',
    // 过滤占位垃圾值（如即梦接口返回的 map[]），含空白/括号的地址不视为有效链接（上游 v1.6.7）
    url: /[\s\[\]]/.test(musicUrlNorm) ? '' : musicUrlNorm,
  }

  const like = parseCount(mapField('like', () => data.like ?? data.statistics?.digg_count ?? data.statistics?.like_count ?? data.statistics?.likes ?? extra.statistics?.digg_count ?? extra.statistics?.like_count ?? extra.statistics?.likes ?? data.attitudes_count ?? 0))
  const comment = parseCount(mapField('comment', () => data.comment ?? data.statistics?.comment_count ?? data.statistics?.comments ?? extra.statistics?.comment_count ?? extra.statistics?.comments ?? data.comments_count ?? 0))
  const collect = parseCount(mapField('collect', () => data.collect ?? data.statistics?.collect_count ?? data.statistics?.favorite_count ?? data.statistics?.favorites ?? extra.statistics?.collect_count ?? extra.statistics?.favorite_count ?? extra.statistics?.favorites ?? data.favorites_count ?? 0))
  const share = parseCount(mapField('share', () => data.share ?? data.statistics?.share_count ?? data.statistics?.forward_count ?? data.statistics?.shares ?? extra.statistics?.share_count ?? extra.statistics?.forward_count ?? extra.statistics?.shares ?? data.reposts_count ?? 0))
  const play = parseCount(mapField('play', () => data.play ?? data.statistics?.play_count ?? data.statistics?.view_count ?? data.statistics?.plays ?? extra.statistics?.play_count ?? extra.statistics?.view_count ?? extra.statistics?.plays ?? data.play_count ?? data.view_count ?? 0))

  let duration = 0
  if (extra.duration_ms) {
    duration = Math.floor(Number(extra.duration_ms) / 1000)
  } else {
    const durRaw = mapField('duration', () => data.duration)
    if (durRaw) {
      duration = typeof durRaw === 'string' ? parseInt(durRaw, 10) : Math.floor(Number(durRaw))
    }
  }

  let publishTime = 0
  const timeRaw = mapField('publishTime', () => data.time)
  if (timeRaw) {
    publishTime = typeof timeRaw === 'number' ? timeRaw : parseInt(timeRaw, 10)
    if (publishTime < 1000000000000) publishTime *= 1000
  } else if (extra.create_time) {
    publishTime = Number(extra.create_time) * 1000
  }

  const author_followers = parseCount(mapField('author_followers', () => extra.author_extra?.follower_count ?? data.author_extra?.follower_count ?? 0))
  const author_signature = String(mapField('author_signature', () => extra.author_extra?.signature ?? data.author_extra?.signature ?? ''))
  const admire = parseCount(mapField('admire', () => extra.statistics?.admire_count ?? data.statistics?.admire_count ?? 0))

  title = title.replace(/\[话题\]/g, '')
  desc = desc.replace(/\[话题\]/g, '')

  if (title && desc && title.trim() === desc.trim()) {
    desc = ''
  }

  if (title.trim().startsWith('#')) title = ''
  if (desc.trim().startsWith('#')) desc = ''

  return { type, title, desc, author, uid, avatar, cover, video, videos, images, live_photo, music, like, comment, collect, share, play, duration, publishTime, author_followers, author_signature, admire }
}
