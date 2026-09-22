import type { PlatformDefinition } from '../../core/platform'

export const doubao_image: PlatformDefinition = {
  type: "doubao_image",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?doubao\\.com\\/thread\\/[^\\s'\"“”‘’]+", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/dbduihua",
  },
}
