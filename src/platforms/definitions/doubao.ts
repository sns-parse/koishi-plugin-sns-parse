import type { PlatformDefinition } from '../../core/platform'

export const doubao: PlatformDefinition = {
  type: "doubao",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?doubao\\.com\\/video\\/\\d{10,}", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?doubao\\.com\\/video-sharing\\?[^\\s'\"“”‘’]*", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/dbvideos",
    next: "https://api-new.ifphp.com/api/doubao",
  },
}
