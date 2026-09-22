/**
 * 运行时构建（薄包装）：实现来自 @sns-parse/core 的 createRuntime，
 * 注入本仓库的内置平台定义与完整默认扩展（含 NSFW 等 Koishi 侧能力）。
 */
import { createRuntime as coreCreateRuntime, type ParserRuntime } from '@sns-parse/core'
import { createDefaultExtensions } from './extensions/default'
import { BUILTIN_PLATFORMS } from './platforms/definitions'

export type { ParserRuntime }

export function createRuntime(source: any, config: any): ParserRuntime {
  return coreCreateRuntime(source, config, {
    defs: BUILTIN_PLATFORMS,
    defaultExtensions: createDefaultExtensions(),
  })
}
