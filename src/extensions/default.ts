/**
 * 默认扩展装配（薄组合）：
 * - 引擎自带实现（merge/GIF/translate）来自 @sns-parse/core 的 createCoreExtensions
 * - NSFW（审核/混淆/暂存）来自 @sns-parse/ext-nsfw
 *
 * 宿主可用自己的 VideoParserExtensions 覆盖其中任意一项。
 */
import { createCoreExtensions } from '@sns-parse/core'
import type { VideoParserExtensions } from '../core/extensions'
import { nsfwExtension } from '@sns-parse/ext-nsfw'

export function createDefaultExtensions(): VideoParserExtensions {
  return {
    ...createCoreExtensions(),
    ...nsfwExtension(),
  }
}
