/**
 * 动态收集「已安装」的平台定义（@sns-parse/platform-<type>）。
 *
 * - 可自选安装单个平台包；安装 @sns-parse/platforms 聚合则全部到位。
 * - 未安装的平台自动缺席（链接识别与平台配置同时缺席）。
 */
import { createRequire } from 'node:module'
import type { PlatformDefinition } from '@sns-parse/core'

const nodeRequire = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/')

const PLATFORM_TYPES = [
  'bilibili', 'douyin', 'kuaishou', 'xiaohongshu', 'weibo', 'xigua', 'youtube',
  'tiktok', 'acfun', 'zhihu', 'weishi', 'huya', 'haokan', 'meipai', 'twitter',
  'instagram', 'doubao', 'doubao_image', 'jimeng', 'oasis', 'wechat_channel',
  'lishi', 'quanmin', 'pipigx', 'pipixia', 'zuiyou', 'toutiao',
]

/** 收集已安装平台的定义（含 label/rules/dedicated） */
export function collectPlatformDefinitions(): PlatformDefinition[] {
  const out: PlatformDefinition[] = []
  for (const type of PLATFORM_TYPES) {
    try {
      const mod = nodeRequire(`@sns-parse/platform-${type}`)
      const def: PlatformDefinition | undefined = mod.default || mod[type]
      if (def && def.type) out.push(def)
    } catch {
      // 未安装该平台包 → 跳过
    }
  }
  return out
}

/** 已安装平台的链接规则（扁平） */
export function collectPlatformLinkRules(): { pattern: RegExp; type: string }[] {
  return collectPlatformDefinitions().flatMap(d => d.rules.map(pattern => ({ pattern, type: d.type })))
}
