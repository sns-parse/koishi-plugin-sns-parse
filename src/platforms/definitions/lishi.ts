import type { PlatformDefinition } from '../../core/platform'

export const lishi: PlatformDefinition = {
  type: "lishi",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?pearvideo\\.com\\/video_\\d+", "gi"),
    new RegExp("https?:\\/\\/video\\.li\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
}
