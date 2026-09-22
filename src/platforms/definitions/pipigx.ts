import type { PlatformDefinition } from '../../core/platform'

export const pipigx: PlatformDefinition = {
  type: "pipigx",
  rules: [
    new RegExp("https?:\\/\\/h5\\.pipigx\\.com\\/pp\\/post\\/\\d+", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.)?ippzone\\.com\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/pipigx",
    next: "https://api-new.ifphp.com/api/pipigx",
  },
}
