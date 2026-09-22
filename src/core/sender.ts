/**
 * 发送层契约（core 与宿主解耦的关键接缝）。
 *
 * core 只构建与发送层无关的「出站元素」(OutboundElement)，由宿主提供的
 * OutboundSender 翻译为具体实现：
 * - Koishi 层：翻译为 koishi `h` 元素并调用 `session.send`
 * - CLI 层：翻译为纯文本 / 下载动作
 *
 * 这样 core 的 flush/compose/forward 不依赖任何宿主 SDK。
 */

/** 出站元素（发送层无关 IR） */
export type OutboundElement =
  | { type: 'text'; text: string }
  | { type: 'image'; url?: string; buffer?: Buffer; mime?: string }
  | { type: 'video'; url: string }
  | { type: 'audio'; url: string }
  | { type: 'quote'; id: string }

/** 合并转发的一个气泡 */
export interface ForwardBubble {
  content: OutboundElement[]
  /** 气泡作者 id（缺省由发送层用 session.selfId） */
  id?: string
  /** 气泡作者昵称 */
  name?: string
}

/** 会话最小面（Koishi session / CLI 上下文均可满足） */
export interface SessionLike {
  platform?: string
  selfId?: string
  userId?: string
  channelId?: string
  guildId?: string
  messageId?: string
  send?(content: any): Promise<any>
  [key: string]: any
}

export interface OutboundSender {
  /** 发送一组出站元素；retries 覆盖默认重试次数 */
  send(session: SessionLike, elements: OutboundElement[], retries?: number): Promise<any>
  /** 发送合并转发（每个 ForwardBubble 一个气泡） */
  sendForward(session: SessionLike, bubbles: ForwardBubble[], retries?: number): Promise<any>
}

/** 出站元素构造器（避免各模块散落字面量） */
export const el = {
  text: (text: string): OutboundElement => ({ type: 'text', text }),
  image: (url: string): OutboundElement => ({ type: 'image', url }),
  imageBuffer: (buffer: Buffer, mime: string): OutboundElement => ({ type: 'image', buffer, mime }),
  video: (url: string): OutboundElement => ({ type: 'video', url }),
  audio: (url: string): OutboundElement => ({ type: 'audio', url }),
  quote: (id: string): OutboundElement => ({ type: 'quote', id }),
}

/** 视频元素发送失败时的文本降级 */
export function videoFallback(element: OutboundElement): OutboundElement {
  return element.type === 'video' ? el.text(`视频链接：${element.url}`) : element
}
