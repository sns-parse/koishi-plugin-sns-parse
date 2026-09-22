import type { PlatformDefinition } from '../../core/platform'

export const acfun: PlatformDefinition = {
  type: "acfun",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?acfun\\.cn\\/v\\/ac\\d{10,}", "gi"),
  ],
}
