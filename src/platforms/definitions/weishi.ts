import type { PlatformDefinition } from '../../core/platform'

export const weishi: PlatformDefinition = {
  type: "weishi",
  rules: [
    new RegExp("https?:\\/\\/weishi\\.qq\\.com\\/weishi\\/feed\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
}
