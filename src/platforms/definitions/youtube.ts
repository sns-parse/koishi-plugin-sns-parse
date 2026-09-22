import type { PlatformDefinition } from '../../core/platform'

export const youtube: PlatformDefinition = {
  type: "youtube",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?youtube\\.com\\/watch\\?v=[a-zA-Z0-9_-]{11}", "gi"),
    new RegExp("https?:\\/\\/youtu\\.be\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?youtube\\.com\\/shorts\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
}
