import type { PlatformDefinition } from '../../core/platform'

export const huya: PlatformDefinition = {
  type: "huya",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?huya\\.com\\/video\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/huya",
  },
}
