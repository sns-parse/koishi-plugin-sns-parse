/**
 * 默认扩展装配（纯组合）：动态发现已安装的 @sns-parse/ext-* 碎片包
 * （NSFW/合并/翻译/GIF 实现均在扩展包内；core 只调度，不持有实现）。
 *
 * 宿主可用自己的 VideoParserExtensions 覆盖其中任意一项。
 */
import { loadExtensionImplementations } from '@sns-parse/core'
import type { VideoParserExtensions } from '../core/extensions'

export function createDefaultExtensions(): VideoParserExtensions {
  return { ...loadExtensionImplementations() }
}
