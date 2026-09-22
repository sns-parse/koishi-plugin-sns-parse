import type { PlatformDefinition } from '../../core/platform'

export const kuaishou: PlatformDefinition = {
  type: "kuaishou",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?kuaishou\\.com\\/short-video\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/v\\.kuaishou\\.com\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?kuaishou\\.com\\/f\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/kuaishou",
    next: "https://api-new.ifphp.com/api/ksjx",
  },
}
