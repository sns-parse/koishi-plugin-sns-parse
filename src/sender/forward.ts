/**
 * 兼容导出：合并转发已迁移至发送层无关的 src/core/forward.ts。
 * sendForward 新签名需要一个 OutboundSender 参数。
 */
export * from '../core/forward'
export { sendMedia } from './sender'
