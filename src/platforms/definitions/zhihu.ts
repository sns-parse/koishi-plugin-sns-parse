import type { PlatformDefinition } from '../../core/platform'

export const zhihu: PlatformDefinition = {
  type: "zhihu",
  rules: [
    new RegExp("https?:\\/\\/(?:www\\.)?zhihu\\.com\\/video\\/\\d{10,}", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.|m\\.)?zhihu\\.com\\/question\\/\\d+\\/answer\\/\\d+", "gi"),
    new RegExp("https?:\\/\\/zhuanlan\\.zhihu\\.com\\/p\\/\\d+", "gi"),
    new RegExp("https?:\\/\\/(?:www\\.|m\\.)?zhihu\\.com\\/zvideo\\/\\d+", "gi"),
  ],
}
