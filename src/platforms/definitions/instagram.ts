import type { PlatformDefinition } from '../../core/platform'

export const instagram: PlatformDefinition = {
  type: "instagram",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?instagram\\.com\\/p\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?instagram\\.com\\/reel\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?instagram\\.com\\/share\\/(?:reel|p)\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
}
