/**
 * 配置触发器（updateFragmentsTrigger）—— 重做版。
 *
 * 旧版两大问题：
 * 1. **配置固化**：复位时把全量 config 快照写进 override
 *    （applyOverrideToConfig 为 override 键优先合并），用户之后在控制台
 *    改的任何配置在重启时被旧快照静默覆盖。
 * 2. **无防重消费**：安装成功触发 fullReload 后新进程再次读到开关 true
 *    会重复执行安装。
 *
 * 重做要点：
 * - 消费标记 data/<name>/update-trigger.json：{startedAt, finishedAt?, ok?}
 *   · finishedAt 新鲜（<30min）→ 已消费（无论成败），只复位不执行
 *   · startedAt 新鲜（<15min）且未完成 → 执行中/僵尸进程，只复位
 *   · 一次「保存开关」恰好执行一次；fullReload / 重启风暴不重复安装
 * - 复位双通道：① override **单键** {updateFragmentsTrigger:false} 落盘
 *   （跨重启持久复位，不再全量快照）；② cordis scope.update 热更
 *   （本次运行即时回落，控制台可见）。复位失败仅告警，不掩盖更新结果。
 * - ctx.setTimeout（cordis）调度：插件 dispose 时自动清理，不留孤儿任务。
 */
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { Context } from 'koishi'
import { writeOverride } from '@sns-parse/core'
import { updateFragments } from './fragments'
import { applyReload } from './self'

const FINISHED_FRESH_MS = 30 * 60 * 1000
const RUNNING_FRESH_MS = 15 * 60 * 1000

interface TriggerMarker {
  startedAt: number
  finishedAt?: number
  ok?: boolean
}

interface UpdateLogger {
  info: (msg: string) => void
  warn: (msg: string) => void
}

function markerFile(baseDir: string | undefined, pluginName: string): string {
  return join(baseDir || process.cwd(), 'data', pluginName, 'update-trigger.json')
}

function readMarker(baseDir: string | undefined, pluginName: string): TriggerMarker | null {
  try {
    const raw = JSON.parse(readFileSync(markerFile(baseDir, pluginName), 'utf8'))
    return raw && typeof raw.startedAt === 'number' ? raw : null
  } catch {
    return null
  }
}

function writeMarker(baseDir: string | undefined, pluginName: string, marker: TriggerMarker): void {
  const file = markerFile(baseDir, pluginName)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(marker), 'utf8')
}

/** 消费判定：run=应执行；skip-running=已有执行中；skip-finished=近期已消费 */
export function judgeMarker(marker: TriggerMarker | null, now = Date.now()): 'run' | 'skip-running' | 'skip-finished' {
  if (!marker) return 'run'
  if (marker.finishedAt && now - marker.finishedAt < FINISHED_FRESH_MS) return 'skip-finished'
  if (!marker.finishedAt && now - marker.startedAt < RUNNING_FRESH_MS) return 'skip-running'
  return 'run'
}

/** 复位双通道：override 单键落盘（跨重启）+ scope.update 热更（本次运行即时） */
function resetTrigger(ctx: Context, config: any, baseDir: string | undefined, pluginName: string, logger: UpdateLogger): void {
  let persisted = false
  try {
    writeOverride(baseDir, pluginName, { updateFragmentsTrigger: false }, pluginName)
    persisted = true
  } catch (e: any) {
    logger.warn(`触发器复位（override 落盘）失败：${e?.message || e}`)
  }
  const scope = (ctx as any).scope
  if (scope && typeof scope.update === 'function') {
    try {
      scope.update({ ...config, updateFragmentsTrigger: false })
      logger.info(`触发器已复位${persisted ? '（override 已落盘 + 配置热更即时回落）' : '（仅配置热更）'}`)
      return
    } catch (e: any) {
      logger.warn(`触发器复位（配置热更）失败：${e?.message || e}`)
    }
  }
  logger.info(persisted
    ? '触发器已复位（override 已落盘，重启/下次保存后控制台回落）'
    : '触发器复位完全失败：请手动关闭「一次性触发碎片更新」开关')
}

/**
 * 触发器主流程：apply 时调用。开关关闭时零开销；开关开启时按消费标记
 * 决定执行或跳过，最终必定尝试复位（finally 语义）。
 */
export function handleUpdateTrigger(ctx: Context, config: any, baseDir: string | undefined, pluginName: string, logger: UpdateLogger): void {
  if (!config?.updateFragmentsTrigger) return
  const run = async () => {
    const verdict = judgeMarker(readMarker(baseDir, pluginName))
    if (verdict !== 'run') {
      logger.info(verdict === 'skip-finished'
        ? '触发器：近期已消费（30 分钟内执行过），本次不重复执行，仅复位开关'
        : '触发器：检测到进行中的更新任务（15 分钟内启动），不重复执行，仅复位开关')
      resetTrigger(ctx, config, baseDir, pluginName, logger)
      return
    }
    // 先占位再执行：执行中守护进程 reload 也不会重复装
    const startedAt = Date.now()
    writeMarker(baseDir, pluginName, { startedAt })
    logger.info('触发器：开始碎片包范围内更新…')
    let ok = false
    let summary = ''
    try {
      const fr = await updateFragments({ baseDir, registry: config.updateRegistry })
      ok = fr.updated.length > 0 && fr.failed.length === 0
      summary = fr.message
      logger.info(`触发器更新完成：${summary}`)
    } catch (e: any) {
      summary = `执行异常：${e?.message || e}`
      logger.warn(`触发器更新异常：${summary}`)
    } finally {
      try {
        writeMarker(baseDir, pluginName, { startedAt, finishedAt: Date.now(), ok })
      } catch { /* 标记失败不影响复位 */ }
      resetTrigger(ctx, config, baseDir, pluginName, logger)
    }
    if (ok) {
      const daemon = typeof (process as any).send === 'function'
      logger.info(daemon ? '守护进程将自动重载生效' : '需重启 Koishi 后生效')
      applyReload(ctx)
    }
  }
  // cordis ctx.setTimeout：插件 dispose 自动清理；无则裸 timer + unref
  if (typeof (ctx as any).setTimeout === 'function') {
    ;(ctx as any).setTimeout(() => { void run() }, 5000)
  } else {
    const t = setTimeout(() => { void run() }, 5000)
    ;(t as any).unref?.()
  }
}
