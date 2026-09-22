/**
 * 宿主抽象：core 只依赖 VideoParserHost，不依赖 Koishi/CLI 任一 SDK。
 *
 * - logger：分级日志（Koishi 注入 Logger，CLI 注入 console 实现）
 * - baseDir：数据根目录（持久化缓存/Vault 落盘用）
 * - getService：可选服务探测（如 ferret-transform 图片混淆）
 * - sender：发送层实现（见 core/sender.ts）
 */
import { silentLogger, type LoggerLike } from '../utils/logger'
import type { OutboundSender } from './sender'
import type { VideoParserExtensions } from './extensions'

export interface VideoParserHost {
  logger: LoggerLike
  /** 数据根目录（如 koishi ctx.baseDir）；缺省时持久化走临时目录 */
  baseDir?: string
  /** 探测宿主提供的可选服务 */
  getService?<T = any>(name: string): T | undefined
  /** 发送层实现（缺省时由宿主适配层注入） */
  sender?: OutboundSender
  /** 扩展实现（部分覆盖；缺省能力由内置实现补齐） */
  extensions?: VideoParserExtensions
  /** 过渡期：底层上下文（koishi Context 等），core 新代码不应依赖 */
  context?: any
}

/**
 * 从宿主上下文（koishi Context / 任意对象）构建 Host。
 * 已是 Host（含 getService 方法）时原样返回。
 */
export function createHost(source: any): VideoParserHost {
  if (source && typeof source === 'object' && typeof source.getService === 'function') {
    return source as VideoParserHost
  }
  const ctx = source && typeof source === 'object' ? source : {}
  return {
    logger: ctx.logger ?? silentLogger,
    baseDir: ctx.baseDir,
    getService: (name: string) => ctx[name],
    sender: ctx.sender,
    extensions: ctx.extensions,
    context: ctx,
  }
}
