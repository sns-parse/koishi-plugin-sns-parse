/**
 * 合并转发模式：把每个语义单元（MessageUnit）构建为一个转发气泡。
 *
 * 发送层无关：构建 ForwardBubble[]，由 OutboundSender.sendForward 翻译为
 * 宿主实现（Koishi 为 <message forward> 嵌套 <message><author>）。
 * 仅一个气泡时不打包卡片，直接发送。
 */
import type { ParserRuntime } from '../runtime'
import { delay } from '../utils/common'
import type { ForwardBubble, OutboundSender, SessionLike } from './sender'
import { buildUnits, type ProcessedItem } from './compose'
import { logger } from '../utils/logger'

// 保持兼容：旧签名 buildForwardNode(session, content, botName) 曾用于构建气泡；
// 发送层无关后由 OutboundSender.sendForward 负责，占位导出避免外部引用断裂。
export function buildForwardNode(_session: any, content: any, botName: string) {
  return { content, name: botName }
}

export async function sendForward(
  rt: ParserRuntime,
  sender: OutboundSender,
  session: SessionLike,
  items: ProcessedItem[],
): Promise<void> {
  const { config } = rt
  const botName = config.botName || '视频解析机器人'
  const bubbles: ForwardBubble[] = []
  const total = items.length

  for (let i = 0; i < total; i++) {
    const item = items[i]
    const units = buildUnits(rt, item)
    // 多 item 时给概述文字加序号前缀
    if (total > 1) {
      for (const u of units) {
        const txt = u.content.find((e) => e.type === 'text')
        if (txt && txt.type === 'text') { txt.text = `【${i + 1}/${total}】\n${txt.text}`; break }
      }
    }
    // mergeable 单元（概述+图片+提示）合并为第一个气泡；非 mergeable（视频文件/取件码/混淆图）各占一个气泡
    const mergeable = units.filter(u => u.mergeable)
    const standalone = units.filter(u => !u.mergeable)
    if (mergeable.length) bubbles.push({ content: mergeable.flatMap(u => u.content), name: botName })
    for (const u of standalone) bubbles.push({ content: u.content, name: botName })
  }

  // 仅一条消息：不打包转发卡片，直接发送
  if (bubbles.length === 1) {
    await sender.send(session, bubbles[0].content, config.retryTimes)
    return
  }

  const MAX_BUBBLES = 50
  for (let i = 0; i < bubbles.length; i += MAX_BUBBLES) {
    const batch = bubbles.slice(i, i + MAX_BUBBLES)
    try {
      await sender.sendForward(session, batch, config.retryTimes)
    } catch (err) {
      logger.error('合并转发失败，降级逐条发送:', err)
      for (const item of items) {
        for (const u of buildUnits(rt, item)) {
          await sender.send(session, u.content).catch(() => {})
          await delay(300)
        }
      }
      return
    }
  }
}
