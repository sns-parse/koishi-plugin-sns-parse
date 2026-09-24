/**
 * 运行时装配：平台声明与扩展片段均动态发现（支持范围=已加载平台声明并集）。
 * 锚点用本包 __filename，pnpm strict 下也能发现宿主直依赖。
 */
import { createRequire } from 'module'
import { createRuntime as coreCreateRuntime, collectPlatformDefinitions, loadWorkflowExtensions, type ParserRuntime } from '@sns-parse/core'

export type { ParserRuntime }

export function createRuntime(source: any, config: any): ParserRuntime {
  const anchor = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/')
  return coreCreateRuntime(source, config, {
    defs: collectPlatformDefinitions(anchor),
    extensions: loadWorkflowExtensions(anchor),
  })
}
