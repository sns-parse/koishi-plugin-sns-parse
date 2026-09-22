import type { PlatformDefinition } from '../../core/platform'

export const meipai: PlatformDefinition = {
  type: "meipai",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?meipai\\.com\\/media\\/\\d{10,}", "gi"),
  ],
}
