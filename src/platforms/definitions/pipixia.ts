import type { PlatformDefinition } from '../../core/platform'

export const pipixia: PlatformDefinition = {
  type: "pipixia",
  rules: [
    new RegExp("https?:\\/\\/(?:h5|www)\\.pipix\\.com\\/[0-9a-zA-Z_\\/-]+", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?pipixia\\.com\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/pipixia",
  },
}
