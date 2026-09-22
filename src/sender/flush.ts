/**
 * Koishi 适配入口：core 的发送层无关 flush + 注入 Koishi 发送器。
 * 业务实现见 src/core/flush.ts。
 */
import type { ParserRuntime } from '../runtime'
import type { LinkMatch } from '../types'
import { flush as coreFlush, type FlushOptions } from '../core/flush'
import { createKoishiSender } from './koishi-sender'

export type { FlushOptions }

export async function flush(
  rt: ParserRuntime,
  session: any,
  matches: LinkMatch[],
  opts: FlushOptions = {},
): Promise<void> {
  const sender = opts.sender ?? rt.host.sender ?? createKoishiSender(rt)
  return coreFlush(rt, session, matches, { ...opts, sender })
}
