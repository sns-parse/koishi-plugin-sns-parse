/**
 * 插件本体自更新（市场安装型部署）：检查 dist-tags.latest → 精确版本安装 →
 * 守护进程下 loader.fullReload() 生效（退出码 51 自动重启 worker）。
 */
import { createRequire } from 'module'
import type { Context } from 'koishi'
import { stripBuildMeta, compareVersions } from './semver'
import { resolveRegistry, fetchPackument } from './registry'
import { installSpecs } from './pm'

export function packageNameFor(pluginName: string): string {
  return pluginName === 'video-parser-all'
    ? '@char46/koishi-plugin-video-parser-all'
    : '@sns-parse/koishi-plugin-sns-parse'
}

export function currentVersion(): string {
  try {
    const req = createRequire(__filename)
    return String(req('../../package.json').version || '0.0.0')
  } catch {
    return '0.0.0'
  }
}

async function fetchLatestVersion(pkg: string, registry: string): Promise<string> {
  const { latest } = await fetchPackument(pkg, registry)
  if (!latest) throw new Error('registry 响应缺少 dist-tags.latest')
  return latest
}

export interface UpdateResult {
  updated: boolean
  message: string
  current?: string
  latest?: string
  /** 守护进程模式（可自动重启生效） */
  daemon?: boolean
}

let busy = false

/** 完整更新流程（互斥执行）。notify 用于命令模式回报进度。 */
export async function performSelfUpdate(pluginName: string, opts: {
  registry?: string
  timeoutMs?: number
  baseDir?: string
  notify?: (text: string) => Promise<void> | void
} = {}): Promise<UpdateResult> {
  if (busy) return { updated: false, message: '已有更新任务在执行中，请稍候' }
  busy = true
  try {
    const pkg = packageNameFor(pluginName)
    const cur = stripBuildMeta(currentVersion())
    const baseDir = opts.baseDir || process.cwd()
    const registry = resolveRegistry(opts.registry, baseDir, process.env.USERPROFILE || process.env.HOME || '')
    let latest: string
    try {
      latest = stripBuildMeta(await fetchLatestVersion(pkg, registry))
    } catch (e: any) {
      return { updated: false, message: `检查最新版本失败：${e?.message || e}` }
    }
    if (compareVersions(latest, cur) <= 0) {
      return { updated: false, message: `已是最新版本 ${cur}`, current: cur, latest }
    }
    if (latest.split('.')[0] !== cur.split('.')[0]) {
      return { updated: false, message: `最新版本 ${latest} 与当前 ${cur} 主版本不同，请手动确认后更新`, current: cur, latest }
    }
    await opts.notify?.(`检测到新版本 ${latest}（当前 ${cur}），开始安装…`)
    const inst = await installSpecs([`${pkg}@${latest}`], baseDir, registry, opts.timeoutMs)
    if (!inst.ok) return { updated: false, message: `安装失败：${inst.message}`, current: cur, latest }
    const daemon = typeof (process as any).send === 'function'
    return {
      updated: true,
      message: `已更新到 ${latest}。${daemon ? '即将自动重启生效。' : '请重启 Koishi 后生效。'}`,
      current: cur,
      latest,
      daemon,
    }
  } finally {
    busy = false
  }
}

/** 生效（仅守护进程模式）：延迟触发全量重载，退出码 51 由主进程重启 worker */
export function applyReload(ctx: Context, delayMs = 1500): void {
  const loader = (ctx as any).loader
  const timer = setTimeout(() => {
    if (typeof (process as any).send === 'function' && loader?.fullReload) {
      try {
        loader.fullReload()
      } catch (e) {
        (ctx as any).logger?.warn?.(`触发重启失败：${e}`)
      }
    }
  }, delayMs)
  ;(timer as any).unref?.()
}
