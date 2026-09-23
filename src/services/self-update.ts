/**
 * 插件自更新（市场安装型部署）：
 * - 检查：registry dist-tags.latest vs 当前版本（剥离 build metadata 后比较）
 * - 安装：按锁文件探测包管理器，spawn 安装指定版本（registry 经环境变量注入，
 *   兼容 npm/pnpm 与 yarn classic/berry）
 * - 生效：守护进程模式（存在 IPC）下 loader.fullReload()（退出码 51，主进程
 *   自动重启 worker）；无守护进程则提示手动重启
 *
 * 触发方式：设置（updateOnStartup）/ 定时（autoUpdateHours）/ 命令（parse/update）。
 */
import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import axios from 'axios'
import type { Context } from 'koishi'

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

export function stripBuildMeta(v: string): string {
  return String(v || '').split('+')[0]
}

/** 语义化版本比较（支持 prerelease 段，忽略 build metadata）：a>b → 1，a<b → -1，相等 → 0 */
export function compareVersions(a: string, b: string): number {
  const pa = stripBuildMeta(a).split('-')
  const pb = stripBuildMeta(b).split('-')
  const na = pa[0].split('.').map(Number)
  const nb = pb[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) > (nb[i] || 0) ? 1 : -1
  }
  const ra = pa[1] || ''
  const rb = pb[1] || ''
  if (!ra && !rb) return 0
  if (!ra) return 1
  if (!rb) return -1
  const sa = ra.split('.')
  const sb = rb.split('.')
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i]
    const y = sb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1
    } else if (xn) return -1
    else if (yn) return 1
    else if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** 按锁文件探测包管理器（yarn 需兼容 classic 与 berry，二者均为 `yarn add`） */
export function detectPackageManager(baseDir: string): { cmd: string; args: string[]; label: string } {
  if (existsSync(join(baseDir, 'pnpm-lock.yaml'))) return { cmd: 'pnpm', args: ['add'], label: 'pnpm' }
  if (existsSync(join(baseDir, 'yarn.lock')) || existsSync(join(baseDir, '.yarnrc.yml'))) {
    return { cmd: 'yarn', args: ['add'], label: 'yarn' }
  }
  return { cmd: 'npm', args: ['install', '--no-audit', '--no-fund'], label: 'npm' }
}

function readNpmrcRegistry(file: string): string {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*registry\s*=\s*(\S+)/)
      if (m) return m[1]
    }
  } catch {}
  return ''
}

/** registry 解析优先级：显式配置 > 项目 .npmrc > 用户 .npmrc > npmmirror */
export function resolveRegistry(configured: string | undefined, baseDir: string | undefined, home: string): string {
  if (configured && configured.trim()) return configured.trim()
  return readNpmrcRegistry(join(baseDir || process.cwd(), '.npmrc'))
    || readNpmrcRegistry(join(home, '.npmrc'))
    || 'https://registry.npmmirror.com'
}

export async function fetchLatestVersion(pkg: string, registry: string): Promise<string> {
  const res = await axios.get(`${registry.replace(/\/+$/, '')}/${pkg}`, {
    timeout: 15000,
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  const latest = res.data?.['dist-tags']?.latest
  if (typeof latest !== 'string' || !latest) throw new Error('registry 响应缺少 dist-tags.latest')
  return latest
}

/** 安装指定版本（有界等待，超时整树击杀；输出留尾部用于报错） */
export function installVersion(pkg: string, version: string, baseDir: string, registry: string, timeoutMs = 600000): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const pm = detectPackageManager(baseDir)
    const args = [...pm.args, `${pkg}@${version}`]
    let out = ''
    let settled = false
    const child = spawn(pm.cmd, args, {
      cwd: baseDir,
      shell: true,
      windowsHide: true,
      env: { ...process.env, npm_config_registry: registry, YARN_NPM_REGISTRY_SERVER: registry },
    })
    const finish = (ok: boolean, message: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, message })
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid) {
          if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
          else child.kill('SIGKILL')
        }
      } catch {}
      finish(false, `${pm.label} 安装超时（超过 ${Math.round(timeoutMs / 1000)}s，已终止）`)
    }, timeoutMs)
    child.stdout?.on('data', (d) => { out = (out + String(d)).slice(-4000) })
    child.stderr?.on('data', (d) => { out = (out + String(d)).slice(-4000) })
    child.on('error', (e) => finish(false, `无法启动 ${pm.label}：${e.message}`))
    child.on('close', (code) => {
      if (code === 0) finish(true, `${pm.label} 安装 ${pkg}@${version} 完成`)
      else finish(false, `${pm.label} 退出码 ${code}：\n${out.split(/\r?\n/).filter(Boolean).slice(-6).join('\n')}`)
    })
  })
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
    const inst = await installVersion(pkg, latest, baseDir, registry, opts.timeoutMs)
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
