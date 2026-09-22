import type { PlatformDefinition } from '../../core/platform'

export const xiaohongshu: PlatformDefinition = {
  type: "xiaohongshu",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?xiaohongshu\\.com\\/discovery\\/item\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/xhslink\\.com\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?xiaohongshu\\.com\\/explore\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?xiaohongshu\\.com\\/board\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/xhs",
  },
}
