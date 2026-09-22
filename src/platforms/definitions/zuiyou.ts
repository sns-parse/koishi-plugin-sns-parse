import type { PlatformDefinition } from '../../core/platform'

export const zuiyou: PlatformDefinition = {
  type: "zuiyou",
  rules: [
    new RegExp("https?:\\/\\/share\\.xiaochuankeji\\.cn\\/hybrid\\/share\\/post\\?pid=\\d+", "gi"),
    new RegExp("https?:\\/\\/(?:h5|www)\\.izuiyou\\.com\\/[0-9a-zA-Z_\\/-]+", "gi"),
  ],
  dedicated: {
    legacy: "https://api.bugpk.com/api/zuiyou",
  },
}
