/**
 * 内置平台定义——**真相源**（紧凑聚合写法，便于集中审阅/批量增删）。
 *
 * 运行期实际使用 `./definitions/*`（每平台一个文件，由本文件生成）：
 *   修改本文件后请运行 `npx tsx scripts/gen-defs.ts` 重新生成。
 * definitions 的生成产物是后续「每平台一个包」的迁移单位。
 */
import type { PlatformDefinition } from '../core/platform'

export const BUILTIN_PLATFORMS: PlatformDefinition[] = [
  {
    type: 'bilibili',
    rules: [
      /https?:\/\/(?:www\.)?bilibili\.com\/video\/([ab]v[0-9a-zA-Z_-]+)(?:\?[^\s'"“”‘’]*)?/gi,
      /https?:\/\/b23\.tv\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/bili\d+\.cn\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/b23\.wtf\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/bili2233\.cn\/[0-9a-zA-Z_\/-]+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/bilibili', next: 'https://api-new.ifphp.com/api/bilibili' },
  },
  {
    type: 'douyin',
    rules: [
      /https?:\/\/(?:www\.)?douyin\.com\/video\/\d{10,}/gi,
      /https?:\/\/v\.douyin\.com\/[0-9a-zA-Z_\/-]+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/douyin', next: 'https://api-new.ifphp.com/api/dyjx' },
  },
  {
    type: 'kuaishou',
    rules: [
      /https?:\/\/(?:www\.)?kuaishou\.com\/short-video\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/v\.kuaishou\.com\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/(?:www\.)?kuaishou\.com\/f\/[0-9a-zA-Z_\/-]+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/kuaishou', next: 'https://api-new.ifphp.com/api/ksjx' },
  },
  {
    type: 'xiaohongshu',
    rules: [
      /https?:\/\/(?:www\.)?xiaohongshu\.com\/discovery\/item\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/xhslink\.com\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/(?:www\.)?xiaohongshu\.com\/explore\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/(?:www\.)?xiaohongshu\.com\/board\/[0-9a-zA-Z_\/-]+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/xhs' },
  },
  {
    type: 'weibo',
    rules: [
      /https?:\/\/weibo\.com\/\d+\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/video\.weibo\.com\/show\?fid=[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/t\.cn\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/m\.weibo\.cn\/[0-9a-zA-Z_\/-]+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/weibo' },
  },
  {
    type: 'xigua',
    rules: [
      /https?:\/\/(?:www\.)?ixigua\.com\/\d{10,}/gi,
    ],
  },
  {
    type: 'youtube',
    rules: [
      /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}/gi,
      /https?:\/\/youtu\.be\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/(?:www\.)?youtube\.com\/shorts\/[0-9a-zA-Z_\/-]+/gi,
    ],
  },
  {
    type: 'tiktok',
    rules: [
      /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.]+\/video\/\d{10,}/gi,
      /https?:\/\/vm\.tiktok\.com\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/vt\.tiktok\.com\/[0-9a-zA-Z_\/-]+/gi,
    ],
  },
  {
    type: 'acfun',
    rules: [
      /https?:\/\/(?:www\.)?acfun\.cn\/v\/ac\d{10,}/gi,
    ],
  },
  {
    type: 'zhihu',
    rules: [
      /https?:\/\/(?:www\.)?zhihu\.com\/video\/\d{10,}/gi,
      /https?:\/\/(?:www\.|m\.)?zhihu\.com\/question\/\d+\/answer\/\d+/gi,
      /https?:\/\/zhuanlan\.zhihu\.com\/p\/\d+/gi,
      /https?:\/\/(?:www\.|m\.)?zhihu\.com\/zvideo\/\d+/gi,
    ],
  },
  {
    type: 'weishi',
    rules: [
      /https?:\/\/weishi\.qq\.com\/weishi\/feed\/[0-9a-zA-Z_\/-]+/gi,
    ],
  },
  {
    type: 'huya',
    rules: [
      /https?:\/\/(?:www\.)?huya\.com\/video\/[0-9a-zA-Z_\/-]+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/huya' },
  },
  {
    type: 'haokan',
    rules: [
      /https?:\/\/haokan\.baidu\.com\/v\?vid=[0-9a-zA-Z_\/-]+/gi,
    ],
  },
  {
    type: 'meipai',
    rules: [
      /https?:\/\/(?:www\.)?meipai\.com\/media\/\d{10,}/gi,
    ],
  },
  {
    type: 'twitter',
    rules: [
      /https?:\/\/twitter\.com\/\w+\/status\/\d{10,}/gi,
      /https?:\/\/x\.com\/\w+\/status\/\d{10,}/gi,
    ],
  },
  {
    type: 'instagram',
    rules: [
      /https?:\/\/(?:www\.)?instagram\.com\/p\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/(?:www\.)?instagram\.com\/reel\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/(?:www\.)?instagram\.com\/share\/(?:reel|p)\/[0-9a-zA-Z_\/-]+/gi,
    ],
  },
  {
    type: 'doubao',
    rules: [
      /https?:\/\/(?:www\.)?doubao\.com\/video\/\d{10,}/gi,
      /https?:\/\/(?:www\.)?doubao\.com\/video-sharing\?[^\s'"“”‘’]*/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/dbvideos', next: 'https://api-new.ifphp.com/api/doubao' },
  },
  {
    type: 'doubao_image',
    rules: [
      /https?:\/\/(?:www\.)?doubao\.com\/thread\/[^\s'"“”‘’]+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/dbduihua' },
  },
  {
    type: 'jimeng',
    rules: [
      /https?:\/\/(?:www\.)?jimeng\.jianying\.com\/[^\s'"“”‘’]*/gi,
      /https?:\/\/(?:www\.)?jimeng\.cn\/[^\s'"“”‘’]*/gi,
      /https?:\/\/(?:www\.)?dreamina\.jianying\.com\/[^\s'"“”‘’]*/gi,
      /https?:\/\/(?:www\.)?dreamina\.capcut\.com\/[^\s'"“”‘’]*/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/jimengai', next: 'https://api-new.ifphp.com/api/jimeng' },
  },
  {
    type: 'oasis',
    rules: [
      /https?:\/\/(?:www\.)?oasis\.weibo\.com\/v\/[0-9a-zA-Z_\/-]+/gi,
    ],
  },
  {
    type: 'wechat_channel',
    rules: [
      /https?:\/\/channels\.weixin\.qq\.com\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/weixin\.qq\.com\/sph\/[0-9a-zA-Z_\/-]+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/wxsph', next: 'https://api-new.ifphp.com/api/wxsph' },
  },
  {
    type: 'lishi',
    rules: [
      /https?:\/\/(?:www\.)?pearvideo\.com\/video_\d+/gi,
      /https?:\/\/video\.li\/[0-9a-zA-Z_\/-]+/gi,
    ],
  },
  {
    type: 'quanmin',
    rules: [
      /https?:\/\/(?:www\.)?quanmin\.tv\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/(?:www\.)?quanmintv\.cn\/[0-9a-zA-Z_\/-]+/gi,
    ],
  },
  {
    type: 'pipigx',
    rules: [
      /https?:\/\/h5\.pipigx\.com\/pp\/post\/\d+/gi,
      /https?:\/\/(?:www\.)?ippzone\.com\/[0-9a-zA-Z_\/-]+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/pipigx', next: 'https://api-new.ifphp.com/api/pipigx' },
  },
  {
    type: 'pipixia',
    rules: [
      /https?:\/\/(?:h5|www)\.pipix\.com\/[0-9a-zA-Z_\/-]+/gi,
      /https?:\/\/(?:www\.)?pipixia\.com\/[0-9a-zA-Z_\/-]+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/pipixia' },
  },
  {
    type: 'zuiyou',
    rules: [
      /https?:\/\/share\.xiaochuankeji\.cn\/hybrid\/share\/post\?pid=\d+/gi,
      /https?:\/\/(?:h5|www)\.izuiyou\.com\/[0-9a-zA-Z_\/-]+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/zuiyou' },
  },
  {
    type: 'toutiao',
    rules: [
      /https?:\/\/(?:www\.|m\.)?toutiao\.com\/video\/\d+/gi,
    ],
    dedicated: { legacy: 'https://api.bugpk.com/api/toutiao' },
  },
]

/** 扁平规则表（链接识别用；保持既有导出名） */
export const BUILTIN_LINK_RULES: { pattern: RegExp; type: string }[] =
  BUILTIN_PLATFORMS.flatMap(p => p.rules.map(pattern => ({ pattern, type: p.type })))
