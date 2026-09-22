import type { PlatformDefinition } from '../../core/platform'

export const tiktok: PlatformDefinition = {
  type: "tiktok",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?tiktok\\.com\\/@[\\w.]+\\/video\\/\\d{10,}", "gi"),
    new RegExp("https?:\\/\\/vm\\.tiktok\\.com\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/vt\\.tiktok\\.com\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
}
