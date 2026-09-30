/**
 * 宿主（VideoParserHost）显式构造层 —— CLI 与 Koishi 双插件统一入口。
 *
 * 背景：core 的 createHost(source) 会对任意传入对象做属性探测
 * （getService/sender/extensions）。把 Koishi cordis Context 原样传入会在
 * 未知属性访问上触发 cordis "declare it as inject" 警告；CLI 传裸 {}
 * 则丢失日志能力。因此各宿主在这里**显式组好完整 Host**，core 收到后
 * 走「已是 Host」短路分支（typeof source.getService === 'function'），
 * 从不再摸未知属性。
 *
 * - createKoishiHost：Koishi 插件（新旧命名空间共用），Logger 绑定插件名，
 *   baseDir 取 ctx.baseDir，服务探测走 `in` 守卫（has-trap 不告警；已注册
 *   服务的 get 也不告警；未注册则直接跳过 get）
 * - createConsoleHost：CLI（video-parser 命令行），分级输出到 stderr，
 *   默认静默（与旧行为一致），verbose 时输出 info/debug
 * - createPlainHost：测试与任意宿主兜底（logger 静默）
 */
import type { VideoParserHost, LoggerLike } from '@sns-parse/core'
import { silentLogger } from '@sns-parse/core'

/** cordis 安全服务探测：`in`（has-trap）不触发 "declare it as inject" 警告 */
function probeService(ctx: any, name: string): any {
  try {
    if (ctx && name in ctx) {
      const value = ctx[name]
      return value ?? undefined
    }
  } catch { /* has/get 抛异常按未注册处理 */ }
  return undefined
}

/** Koishi 宿主：ctx.logger/baseDir 是 cordis 已知属性（安全访问） */
export function createKoishiHost(ctx: any, pluginName: string): VideoParserHost {
  const koishiLogger = ctx?.logger
  const logger: LoggerLike = {
    debug: (...a: any[]) => koishiLogger?.debug?.(...a),
    info: (...a: any[]) => koishiLogger?.info?.(prefix(pluginName, a)),
    warn: (...a: any[]) => koishiLogger?.warn?.(prefix(pluginName, a)),
    error: (...a: any[]) => koishiLogger?.error?.(prefix(pluginName, a)),
  }
  return {
    logger,
    baseDir: typeof ctx?.baseDir === 'string' ? ctx.baseDir : undefined,
    getService: (name: string) => probeService(ctx, name),
    context: ctx,
  }
}

function prefix(pluginName: string, args: any[]): any[] {
  return args.map((a) => (typeof a === 'string' ? `[${pluginName}] ${a}` : a))
}

/** CLI 宿主：分级输出到 stderr；默认静默（不污染 stdout 的 JSON/下载输出） */
export function createConsoleHost(opts: { baseDir?: string; verbose?: boolean } = {}): VideoParserHost {
  const verbose = !!opts.verbose
  const logger: LoggerLike = {
    debug: (...a: any[]) => { if (verbose) console.error('[debug]', ...a) },
    info: (...a: any[]) => { if (verbose) console.error('[info]', ...a) },
    warn: (...a: any[]) => console.error('[warn]', ...a),
    error: (...a: any[]) => console.error('[error]', ...a),
  }
  return {
    logger,
    baseDir: opts.baseDir,
  }
}

/** 测试/任意对象兜底：静默 logger，不探测任何属性 */
export function createPlainHost(source?: any): VideoParserHost {
  if (source && typeof source === 'object' && typeof source.getService === 'function') {
    return source as VideoParserHost
  }
  return {
    logger: silentLogger,
    baseDir: source && typeof source === 'object' && typeof source.baseDir === 'string' ? source.baseDir : undefined,
    context: source,
  }
}
