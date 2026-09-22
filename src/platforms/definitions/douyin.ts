import type { PlatformDefinition } from '../../core/platform'

export const douyin: PlatformDefinition = {
  type: "douyin",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?douyin\\.com\\/video\\/\\d{10,}", "gi"),
    new RegExp("https?:\\/\\/v\\.douyin\\.com\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/douyin",
    next: "https://api-new.ifphp.com/api/dyjx",
  },
}
