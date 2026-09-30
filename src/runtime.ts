/**
 * 运行时装配：平台声明与扩展片段均动态发现（支持范围=已加载平台声明并集）。
 * 锚点用本包 __filename，pnpm strict 下也能发现宿主直依赖。
 */
import { createRequire } from 'module'
import { createRuntime as coreCreateRuntime, collectPlatformDefinitions, loadWorkflowExtensions, type ParserRuntime } from '@sns-parse/core'

export type { ParserRuntime }

export function createRuntime(source: any, config: any): ParserRuntime {
  const anchor = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/')
  // 显式包装 host：cordis Context 上不存在 getService/sender/extensions 三个属性，
  // 若把 ctx 原样交给 core createHost，其对未知属性的点访问会触发 cordis
  // "declare it as inject" 警告（每条 [W]）。这里先组好 Host（createHost 见 getService
  // 函数即原样短路），探测服务的动态属性访问仅发生在真实探测时（ferret-transform
  // 已由本插件 inject.optional 声明，cordis 不会对其告警）。
  const ctx = source && typeof source === 'object' ? source : {}
  const host = {
    logger: ctx.logger,
    baseDir: ctx.baseDir,
    getService: (name: string) => (name in ctx ? ctx[name] : undefined),
    context: ctx,
  }
  return coreCreateRuntime(host, config, {
    defs: collectPlatformDefinitions(anchor),
    extensions: loadWorkflowExtensions(anchor),
  })
}
