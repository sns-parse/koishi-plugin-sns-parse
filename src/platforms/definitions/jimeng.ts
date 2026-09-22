import type { PlatformDefinition } from '../../core/platform'

export const jimeng: PlatformDefinition = {
  type: "jimeng",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?jimeng\\.jianying\\.com\\/[^\\s'\"“”‘’]*", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?jimeng\\.cn\\/[^\\s'\"“”‘’]*", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?dreamina\\.jianying\\.com\\/[^\\s'\"“”‘’]*", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?dreamina\\.capcut\\.com\\/[^\\s'\"“”‘’]*", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/jimengai",
    next: "https://api-new.ifphp.com/api/jimeng",
  },
}
