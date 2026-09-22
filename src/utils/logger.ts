/**
 * 宿主无关的可注入日志层。
 *
 * - core 默认使用静默 logger（测试/嵌入式场景不产生噪音）
 * - Koishi 层启动时 setLogger(ctx.logger)
 * - CLI 层启动时 setLogger(consoleLogger)
 *
 * 日志分级：
 * - info/warn/error 正常输出
 * - debug/verbose 级配合 setVerboseLogging(true) 提升为 info
 */

export interface LoggerLike {
  info(...args: any[]): void
  warn(...args: any[]): void
  error(...args: any[]): void
  debug(...args: any[]): void
  success?(...args: any[]): void
}

/** 静默实现：默认注入，保证无宿主时不产生副作用 */
export const silentLogger: LoggerLike = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  success() {},
}

/** 控制台实现：CLI / 独立使用 */
export const consoleLogger: LoggerLike = {
  info: (...a: any[]) => console.log(...a),
  warn: (...a: any[]) => console.warn(...a),
  error: (...a: any[]) => console.error(...a),
  debug: (...a: any[]) => { if (process.env.DEBUG) console.debug(...a) },
}

let current: LoggerLike = silentLogger
let verbose = false

/** 注入宿主日志实现（插件启动时调用一次） */
export function setLogger(l: LoggerLike): void { current = l ?? silentLogger }

export function getLogger(): LoggerLike { return current }

export function setVerboseLogging(v: boolean): void { verbose = v }

/** 始终代理到当前注入的 logger，支持运行期替换 */
export const logger: LoggerLike = {
  info: (...a: any[]) => current.info(...a),
  warn: (...a: any[]) => current.warn(...a),
  error: (...a: any[]) => current.error(...a),
  debug: (...a: any[]) => current.debug(...a),
  success: (...a: any[]) => (current.success ?? current.info)(...a),
}

function fmt(args: any[]): string {
  return args.map(a => {
    try {
      return typeof a === 'object' ? JSON.stringify(a) : String(a)
    } catch {
      return '[unserializable]'
    }
  }).join(' ')
}

/** debug/verbose 级日志：debug 配置开启后提升为 info，否则 debug 级 */
export function debugLog(...args: any[]): void {
  const line = fmt(args)
  if (verbose) logger.info(line)
  else logger.debug(line)
}
