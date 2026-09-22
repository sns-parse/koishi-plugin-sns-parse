import type { PlatformDefinition } from '../../core/platform'

export const xigua: PlatformDefinition = {
  type: "xigua",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?ixigua\\.com\\/\\d{10,}", "gi"),
  ],
}
