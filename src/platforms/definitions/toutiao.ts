import type { PlatformDefinition } from '../../core/platform'

export const toutiao: PlatformDefinition = {
  type: "toutiao",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.|m\\.)?toutiao\\.com\\/video\\/\\d+", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/toutiao",
  },
}
