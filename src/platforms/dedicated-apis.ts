/**
 * 双网关配置（上游 issue #12）：
 * - 旧网关 api.bugpk.com：无需 API Key，v1.5.8 及之前的行为
 * - 新网关 api-new.ifphp.com：需 API Key（X-API-Key 头），上游唯一维护入口
 * 选择规则：配置了 apiKey → 新网关；否则 → 旧网关
 */
export const NEW_GATEWAY_PRIMARY = 'https://api-new.ifphp.com/api/svparse'
export const LEGACY_GATEWAY_PRIMARY = 'https://api.bugpk.com/api/short_videos'
export const LEGACY_GATEWAY_BACKUP = 'https://api.bugpk.com/api/svparse'

/** 旧网关平台专属端点（无需 Key） */
export const defaultDedicatedApisLegacy: Record<string, string> = {
  bilibili: 'https://api.bugpk.com/api/bilibili',
  douyin: 'https://api.bugpk.com/api/douyin',
  doubao: 'https://api.bugpk.com/api/dbvideos',
  doubao_image: 'https://api.bugpk.com/api/dbduihua',
  kuaishou: 'https://api.bugpk.com/api/kuaishou',
  xiaohongshu: 'https://api.bugpk.com/api/xhs',
  jimeng: 'https://api.bugpk.com/api/jimengai',
  toutiao: 'https://api.bugpk.com/api/toutiao',
  weibo: 'https://api.bugpk.com/api/weibo',
  huya: 'https://api.bugpk.com/api/huya',
  pipigx: 'https://api.bugpk.com/api/pipigx',
  pipixia: 'https://api.bugpk.com/api/pipixia',
  zuiyou: 'https://api.bugpk.com/api/zuiyou',
  wechat_channel: 'https://api.bugpk.com/api/wxsph',
}

/** 新网关平台专属端点（与上游 v1.6.7 对齐；需 Key；未覆盖的平台走主 API 兜底） */
export const defaultDedicatedApisNew: Record<string, string> = {
  bilibili: 'https://api-new.ifphp.com/api/bilibili',
  douyin: 'https://api-new.ifphp.com/api/dyjx',
  kuaishou: 'https://api-new.ifphp.com/api/ksjx',
  wechat_channel: 'https://api-new.ifphp.com/api/wxsph',
  doubao: 'https://api-new.ifphp.com/api/doubao',
  pipigx: 'https://api-new.ifphp.com/api/pipigx',
  jimeng: 'https://api-new.ifphp.com/api/jimeng',
}
