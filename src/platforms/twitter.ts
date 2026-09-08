import type { AxiosInstance } from 'axios'
import type { ParsedData, VideoQuality } from '../types'
import { tlsGet } from '../utils/tls-client'

/** GraphQL GET 器：可注入（生产用 tlsGet，测试用 mock） */
export type GraphqlGetter = (url: string, opts: { headers?: Record<string, string>; cookies?: Record<string, string>; timeout?: number }) => Promise<{ status: number; data: any }>

/**
 * X / Twitter 原生解析器。
 *
 * - 公开推文：走 syndication API（cdn.syndication.twimg.com），无需登录，Node 友好。
 * - 需登录推文（syndication 返回 tombstone）：若提供 {authToken, ct0}，回退到
 *   GraphQL TweetResultByRestId（仅用 auth_token + ct0 两个 cookie，最小化）。
 *
 * ⚠️ 重要限制：X 的 GraphQL 端点受 Cloudflare TLS 指纹校验保护。纯 Node/axios 的
 * TLS 握手(JA3/JA4)与 Chrome 不同，会被 CF 直接 403（cookie 到不了应用层）。
 * 因此登录态回退由 tlsget-rs（wreq/BoringSSL，Chrome 指纹）完成；未安装该
 * 可选依赖时会返回明确错误。
 */

const SYNDICATION_URL = 'https://cdn.syndication.twimg.com/tweet-result'

// X 网页端公开 bearer（抓包固定值，非密钥）
const WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
// TweetResultByRestId 的 queryId（随 web 版本变动，可被覆盖）
const TWEET_RESULT_QUERY_ID = 'GZsN2Pc4knAoit6pXa4HSA'
const GRAPHQL_FEATURES = {
  creator_subscriptions_tweet_preview_api_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
}

export interface TwitterCreds {
  authToken: string
  ct0: string
}

/** Grok 翻译特性集（与网页端抓包一致；关键是 grok_show_grok_translated_post 开关） */
const GROK_FEATURES: Record<string, boolean> = {
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  rweb_cashtags_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
}

const GROK_FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: false,
  withArticleSummaryText: true,
  withArticleVoiceOver: true,
}

/** 目标语言 → x-twitter-client-language（译文语言由该头驱动） */
function clientLanguage(target: string): string {
  const t = target.toLowerCase()
  if (t === 'zh') return 'zh-cn'
  if (t === 'zh-tw') return 'zh-tw'
  return t
}

export interface GrokTranslation {
  text: string
  sourceLang?: string
}

/**
 * X 原生 Grok 翻译（与网页"翻译推文"同源）。
 * 需登录态；网页抓包实证：grok 特性开关 + client-language 头即可，无需
 * x-client-transaction-id / cf_clearance。任何失败返回 null 由调用方回落通用翻译。
 */
export async function fetchGrokTranslation(url: string, targetLang: string, creds: TwitterCreds, get: GraphqlGetter = tlsGet): Promise<GrokTranslation | null> {
  const id = extractTweetId(url)
  if (!id) return null
  const variables = { tweetId: id, includePromotedContent: true, withBirdwatchNotes: true, withVoice: true, withCommunity: true }
  const gqlUrl = `https://x.com/i/api/graphql/${TWEET_RESULT_QUERY_ID}/TweetResultByRestId` +
    `?variables=${encodeURIComponent(JSON.stringify(variables))}` +
    `&features=${encodeURIComponent(JSON.stringify(GROK_FEATURES))}` +
    `&fieldToggles=${encodeURIComponent(JSON.stringify(GROK_FIELD_TOGGLES))}`
  let res
  try {
    res = await get(gqlUrl, {
      headers: {
        authorization: `Bearer ${WEB_BEARER}`,
        'x-csrf-token': creds.ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': clientLanguage(targetLang),
      },
      cookies: { auth_token: creds.authToken, ct0: creds.ct0 },
      timeout: 30000,
    })
  } catch {
    return null
  }
  if (res.status !== 200) return null
  const node = res.data?.data?.tweetResult?.result?.grok_translated_post_with_availability
  if (!node || node.is_available !== true) return null
  const text = node.data?.translation
  if (typeof text !== 'string' || !text.trim()) return null
  return { text: text.trim(), sourceLang: node.data?.source_language ? String(node.data.source_language) : undefined }
}

function extractTweetId(url: string): string | null {
  const m = /\/status(?:es)?\/(\d+)/.exec(url)
  return m ? m[1] : null
}

function pick(...vals: any[]): any {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v
  return ''
}

/** 清理描述中的 t.co 短链（Twitter 自动附加的截断 URL，无实际内容价值） */
function cleanDesc(text: string): string {
  if (!text) return text
  // 移除末尾的 t.co URL（含可能的空格前导）
  let cleaned = text.replace(/\s*https?:\/\/t\.co\/[A-Za-z0-9]+(?:\?[^\s]*)?\s*$/g, '').trim()
  // 移除中间出现的 t.co URL（较少见，但推文内嵌的缩短链）
  cleaned = cleaned.replace(/\s*https?:\/\/t\.co\/[A-Za-z0-9]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return cleaned || text
}

function baseParsed(): ParsedData {
  return {
    type: 'video', title: '', desc: '', author: '', uid: '', avatar: '', cover: '',
    video: '', videos: [], images: [], live_photo: [], music: {},
    like: 0, comment: 0, collect: 0, share: 0, play: 0, duration: 0, publishTime: 0,
    author_followers: 0, author_signature: '', admire: 0,
  }
}

/** 归一化变体列表（三种来源的字段名不同：url/src、content_type/type） */
function normalizeVariants(variants: any[]): VideoQuality[] {
  return variants
    .filter((v: any) => v && (v.url || v.src))
    .map((v: any) => ({
      quality: v.bitrate ? `${v.bitrate}bps` : (v.content_type || v.type || 'unknown'),
      url: v.url || v.src,
      bit_rate: Number(v.bitrate || 0),
    }))
    .sort((a: VideoQuality, b: VideoQuality) => (b.bit_rate || 0) - (a.bit_rate || 0))
}

/**
 * 统一媒体提取（新结构优先，旧结构兜底）：
 * - 新：mediaDetails[]（photo/video_info.variants）+ 顶层 video（poster/src variants）
 * - 旧：videoDetails（posterUrl/url variants）+ photos[]
 */
function extractSyndicationMedia(tw: any, p: ParsedData): void {
  // 1) mediaDetails[]：新版标准位置
  if (Array.isArray(tw.mediaDetails)) {
    for (const m of tw.mediaDetails) {
      if (!m) continue
      if (m.type === 'photo') {
        if (m.media_url_https && !p.images.includes(m.media_url_https)) p.images.push(m.media_url_https)
      } else if ((m.type === 'video' || m.type === 'animated_gif') && Array.isArray(m.video_info?.variants)) {
        const vs = normalizeVariants(m.video_info.variants)
        if (vs.length) {
          p.videos.push(...vs)
          const dur = m.video_info.duration_millis ? Math.floor(Number(m.video_info.duration_millis) / 1000) : 0
          if (!p.video) {
            p.video = vs[0].url
            p.cover = String(pick(m.media_url_https, p.cover))
            if (dur) p.duration = dur
            if (m.type === 'animated_gif') p.isGif = true
          } else {
            // 多视频推文：其余视频逐条携带（发送层每条独立发送，封面随行用于展示与单独审核）
            ;(p.extraVideos ||= []).push({ url: vs[0].url, isGif: m.type === 'animated_gif', duration: dur, cover: String(pick(m.media_url_https, '')) })
          }
        }
      }
    }
  }
  // 2) 顶层 video（amplify 等）：poster + variants
  if (!p.video && Array.isArray(tw.video?.variants)) {
    const vs = normalizeVariants(tw.video.variants)
    if (vs.length) {
      p.videos.push(...vs)
      p.video = vs[0].url
      p.cover = String(pick(tw.video.poster, p.cover))
      if (tw.video.durationMs) p.duration = Math.floor(Number(tw.video.durationMs) / 1000)
    }
  }
  // 3) 旧结构兜底：videoDetails + photos
  if (!p.video && Array.isArray(tw.videoDetails?.variants)) {
    const vs = normalizeVariants(tw.videoDetails.variants)
    if (vs.length) {
      p.videos.push(...vs)
      p.video = vs[0].url
      p.cover = String(pick(tw.videoDetails.posterUrl, p.cover))
      if (tw.videoDetails.durationMs) p.duration = Math.floor(Number(tw.videoDetails.durationMs) / 1000)
    }
  }
  if (!p.images.length && Array.isArray(tw.photos)) {
    p.images = tw.photos.map((x: any) => (typeof x === 'string' ? x : x?.url)).filter((u: any) => !!u)
  }
}

/** 把 syndication 响应映射为 ParsedData */
function mapSyndication(tw: any): ParsedData {
  const user = tw.user || {}
  const text = String(pick(tw.note_tweet?.text, tw.text, ''))
  const p = baseParsed()

  extractSyndicationMedia(tw, p)
  if (!p.cover) p.cover = String(pick(p.images[0], ''))
  // 纯文字推文：type=text（无任何媒体但有正文，属合法内容）
  p.type = p.video ? 'video' : (p.images.length ? 'image' : 'text')

  // 标题/简介同源；标题也须基于清理后的文本，否则 t.co 短链会让去重判断失效
  const cleaned = cleanDesc(text)
  p.title = cleaned.slice(0, 100)
  p.desc = cleaned
  p.lang = tw.lang ? String(tw.lang) : undefined
  p.author = String(pick(user.name, user.screen_name, ''))
  p.uid = String(pick(user.screen_name, user.id_str, ''))
  p.avatar = String(pick(user.profile_image_url_https, user.profile_image_url, ''))
  p.like = Number(pick(tw.favorite_count, 0)) || 0
  p.comment = Number(pick(tw.conversation_count, tw.reply_count, 0)) || 0
  p.share = Number(pick(tw.retweet_count, 0)) || 0
  p.play = Number(pick(tw.video?.viewCount, tw.videoDetails?.viewCount, tw.views, 0)) || 0
  p.collect = Number(pick(tw.bookmark_count, 0)) || 0
  if (tw.created_at) { const t = Date.parse(tw.created_at); if (!isNaN(t)) p.publishTime = t }
  p.author_followers = Number(pick(user.followers_count, 0)) || 0
  p.author_signature = String(pick(user.description, ''))
  if (p.title && p.desc && p.desc.startsWith(p.title)) p.title = ''
  return p
}

/** 把 GraphQL TweetResultByRestId 响应映射为 ParsedData */
function mapGraphql(rawResult: any): ParsedData {
  // NSFW/受限推文会被 TweetWithVisibilityResults 包裹，真实推文在其 .tweet 下
  let result = rawResult
  if (result && result.__typename === 'TweetWithVisibilityResults' && result.tweet) {
    result = result.tweet
  }
  const legacy = result.legacy || {}
  const user = result.core?.user_results?.result
  const ulegacy = user?.legacy || {}
  const text = String(pick(legacy.full_text, result.note_tweet?.note_results?.note?.text, ''))
  const p = baseParsed()

  const media = Array.isArray(legacy.entities?.media) ? legacy.entities.media : []
  const photos: string[] = []
  for (const m of media) {
    if (!m) continue
    if (m.type === 'photo') {
      if (m.media_url_https) photos.push(m.media_url_https)
    } else if ((m.type === 'video' || m.type === 'animated_gif') && m.video_info?.variants?.length) {
      const vs = m.video_info.variants
        .filter((v: any) => v && v.url && (v.content_type || '').includes('mp4'))
        .map((v: any) => ({ quality: v.bitrate ? `${v.bitrate}bps` : 'unknown', url: v.url, bit_rate: Number(v.bitrate || 0) }))
        .sort((a: VideoQuality, b: VideoQuality) => (b.bit_rate || 0) - (a.bit_rate || 0))
      if (vs.length) {
        p.videos.push(...vs)
        const dur = m.video_info.duration_millis ? Math.floor(Number(m.video_info.duration_millis) / 1000) : 0
        if (!p.video) {
          p.video = vs[0].url
          p.cover = String(pick(m.media_url_https, p.cover))
          if (dur) p.duration = dur
          if (m.type === 'animated_gif') p.isGif = true
        } else {
          ;(p.extraVideos ||= []).push({ url: vs[0].url, isGif: m.type === 'animated_gif', duration: dur, cover: String(pick(m.media_url_https, '')) })
        }
      }
    }
  }
  p.images = photos
  if (!p.cover) p.cover = String(pick(photos[0], ''))
  // 纯文字推文：type=text
  p.type = p.video ? 'video' : (p.images.length ? 'image' : 'text')

  // 标题/简介同源；标题也须基于清理后的文本，否则 t.co 短链会让去重判断失效
  const cleaned = cleanDesc(text)
  p.title = cleaned.slice(0, 100)
  p.desc = cleaned
  p.lang = legacy.lang ? String(legacy.lang) : undefined
  p.author = String(pick(ulegacy.name, ulegacy.screen_name, ''))
  p.uid = String(pick(ulegacy.screen_name, user?.rest_id, ''))
  p.avatar = String(pick(ulegacy.profile_image_url_https, ''))
  p.like = Number(pick(legacy.favorite_count, 0)) || 0
  p.comment = Number(pick(legacy.reply_count, 0)) || 0
  p.share = Number(pick(legacy.retweet_count, 0)) || 0
  p.play = Number(pick(result.views?.count, 0)) || 0
  p.collect = Number(pick(legacy.bookmark_count, 0)) || 0
  if (legacy.created_at) { const t = Date.parse(legacy.created_at); if (!isNaN(t)) p.publishTime = t }
  p.author_followers = Number(pick(ulegacy.followers_count, 0)) || 0
  p.author_signature = String(pick(ulegacy.description, ''))
  if (p.title && p.desc && p.desc.startsWith(p.title)) p.title = ''
  return p
}

/** 鉴权 GraphQL：仅用 auth_token + ct0，回退取登录受限推文 */
async function fetchGraphqlTweet(id: string, creds: TwitterCreds, get: GraphqlGetter): Promise<ParsedData> {
  const variables = { tweetId: id, includePromotedContent: true, withBirdwatchNotes: true, withVoice: true, withCommunity: true }
  const url = `https://x.com/i/api/graphql/${TWEET_RESULT_QUERY_ID}/TweetResultByRestId` +
    `?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(GRAPHQL_FEATURES))}`
  let res
  try {
    res = await get(url, {
      headers: {
        authorization: 'Bearer ' + WEB_BEARER,
        'x-csrf-token': creds.ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'en',
      },
      cookies: { auth_token: creds.authToken, ct0: creds.ct0 },
      timeout: 30000,
    })
  } catch (e: any) {
    throw new Error(`X GraphQL 请求失败：${e?.message || e}（需登录的推文）`)
  }

  if (res.status === 403 || res.status === 429) {
    throw new Error(
      `X GraphQL 被 Cloudflare 拦截 (HTTP ${res.status})：TLS 指纹校验未通过。` +
      `请确认已安装可选依赖 @char46/tlsget-rs（npm i @char46/tlsget-rs），它提供浏览器级 TLS 指纹。`
    )
  }
  if (res.status !== 200) {
    throw new Error(`X GraphQL 返回 HTTP ${res.status}：${typeof res.data === 'string' ? res.data.slice(0, 120) : JSON.stringify(res.data || {}).slice(0, 120)}`)
  }

  const result = res.data?.data?.tweetResult?.result
  if (!result) throw new Error('X GraphQL 返回无数据')
  if (result.__typename === 'TweetTombstone' || result.__typename === 'TweetUnavailable') {
    const tb = result?.tombstone?.text?.text || result?.tombstone?.text
    throw new Error(`推文不可访问（可能需要登录、已被删除或为非公开内容）${tb ? '：' + tb : ''}`)
  }
  return mapGraphql(result)
}

export async function parseTwitter(url: string, http: AxiosInstance, creds?: TwitterCreds, getGraphql?: GraphqlGetter): Promise<ParsedData> {
  const id = extractTweetId(url)
  if (!id) throw new Error('无法从 X 链接提取推文 ID')

  // 1) 公开 syndication 路径
  const res = await http.get(SYNDICATION_URL, {
    params: { id, token: 'a' },
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  })
  const tw = res.data
  if (tw && tw.__typename === 'Tweet' && tw.user) {
    return mapSyndication(tw)
  }

  // 2) tombstone（需登录）：回退到鉴权 GraphQL（TLS 指纹模拟）
  if (creds && creds.authToken && creds.ct0) {
    return fetchGraphqlTweet(id, creds, getGraphql || tlsGet)
  }
  const reasonRaw = pick(tw?.tombstone?.text, tw?.tombstone?.name)
  throw new Error(`推文不可访问（可能需要登录、已被删除或为非公开内容）${reasonRaw ? '：' + reasonRaw : ''}`)
}
