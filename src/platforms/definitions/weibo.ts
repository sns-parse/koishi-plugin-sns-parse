import type { PlatformDefinition } from '../../core/platform'

export const weibo: PlatformDefinition = {
  type: "weibo",
  rules: [
    new RegExp("https?:\\/\\/weibo\\.com\\/\\d+\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/video\\.weibo\\.com\\/show\\?fid=[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/t\\.cn\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/m\\.weibo\\.cn\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/weibo",
  },
}
