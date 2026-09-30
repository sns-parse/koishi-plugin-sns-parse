/**
 * 运行时装配：平台声明与扩展片段均动态发现（支持范围=已加载平台声明并集）。
 * 锚点用本包 __filename，pnpm strict 下也能发现宿主直依赖。
 *
 * 入参为显式 VideoParserHost（见 src/host.ts）：Koishi/CLI/测试各自构造，
 * core 收到后走「已是 Host」短路，不再对宿主对象做属性探测。
 */
import { createRequire } from 'module'
import { createRuntime as coreCreateRuntime, collectPlatformDefinitions, loadWorkflowExtensions, type ParserRuntime, type VideoParserHost, type PlatformDefinition, type WorkflowExtension } from '@sns-parse/core'

export type { ParserRuntime }

export interface CreateRuntimeOptions {
  /** 平台定义列表（默认动态发现：聚合包 + 粒度包并集） */
  defs?: PlatformDefinition[]
  /** 扩展片段（默认动态发现已装 ext-*） */
  extensions?: WorkflowExtension[]
}

export function createRuntime(host: VideoParserHost, config: any, opts: CreateRuntimeOptions = {}): ParserRuntime {
  const anchor = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/')
  return coreCreateRuntime(host, config, {
    defs: opts.defs ?? collectPlatformDefinitions(anchor),
    extensions: opts.extensions ?? loadWorkflowExtensions(anchor),
  })
}
