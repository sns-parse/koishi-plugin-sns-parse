/**
 * core 发送层契约的 Koishi 实现：
 * 把 OutboundElement 翻译为 koishi `h` 元素，并复用 sendWithTimeout 的重试/超时逻辑。
 */
import { h } from 'koishi'
import type { ParserRuntime } from '../runtime'
import type { ForwardBubble, OutboundElement, OutboundSender, SessionLike } from '../core/sender'
import { sendWithTimeout } from './sender'

/** OutboundElement → koishi h 元素 */
export function toH(element: OutboundElement): any {
  switch (element.type) {
    case 'text': return h.text(element.text)
    case 'image': return element.buffer
      ? h.image(element.buffer, element.mime ?? 'image/jpeg')
      : h.image(element.url!)
    case 'video': return h.video(element.url)
    case 'audio': return h.audio(element.url)
    case 'quote': return h.quote(element.id)
  }
}

/** 由 runtime 构造 Koishi 发送器（发送配置取自 rt.config） */
export function createKoishiSender(rt: ParserRuntime): OutboundSender {
  return {
    send(session: SessionLike, elements: OutboundElement[], retries?: number) {
      return sendWithTimeout(rt, session, elements.map(toH), retries)
    },
    sendForward(session: SessionLike, bubbles: ForwardBubble[], retries?: number) {
      const nodes = bubbles.map(b => h(
        'message',
        h('author', { id: b.id ?? session.selfId, name: String(b.name ?? '').substring(0, 15) }),
        b.content.map(toH),
      ))
      return sendWithTimeout(rt, session, h('message', { forward: true }, nodes), retries)
    },
  }
}
