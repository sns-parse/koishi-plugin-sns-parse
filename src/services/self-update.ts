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


/* ================= 碎片包（平台/扩展）范围内更新 ================= */

export interface FragmentStatus {
  name: string
  current: string
  latest: string | null
  /** none=已最新或范围内无新；in-range=范围内可更；out-of-range=范围外（需升本体抬范围） */
  updateKind: 'none' | 'in-range' | 'out-of-range'
  /** 范围内可更的目标版本（updateKind==='in-range' 时有值） */
  target?: string
}

/** 本插件声明的全部 @sns-parse/* 碎片包（core/平台×27/扩展×4/聚合×2） */
export const FRAGMENT_PACKAGES: string[] = [
  '@sns-parse/core',
  '@sns-parse/platform-acfun', '@sns-parse/platform-bilibili', '@sns-parse/platform-doubao',
  '@sns-parse/platform-doubao_image', '@sns-parse/platform-douyin', '@sns-parse/platform-haokan',
  '@sns-parse/platform-huya', '@sns-parse/platform-instagram', '@sns-parse/platform-jimeng',
  '@sns-parse/platform-kuaishou', '@sns-parse/platform-lishi', '@sns-parse/platform-meipai',
  '@sns-parse/platform-oasis', '@sns-parse/platform-pipigx', '@sns-parse/platform-pipixia',
  '@sns-parse/platform-quanmin', '@sns-parse/platform-tiktok', '@sns-parse/platform-toutiao',
  '@sns-parse/platform-twitter', '@sns-parse/platform-wechat_channel', '@sns-parse/platform-weibo',
  '@sns-parse/platform-weishi', '@sns-parse/platform-xiaohongshu', '@sns-parse/platform-xigua',
  '@sns-parse/platform-youtube', '@sns-parse/platform-zhihu', '@sns-parse/platform-zuiyou',
  '@sns-parse/ext-nsfw', '@sns-parse/ext-merge', '@sns-parse/ext-translate', '@sns-parse/ext-gif',
  '@sns-parse/platforms', '@sns-parse/extensions',
]

export interface FragmentInstall {
  name: string
  version: string
}

function parseVer(v: string): { nums: number[]; pre: string } {
  const s = stripBuildMeta(v)
  const i = s.indexOf('-')
  const main = i < 0 ? s : s.slice(0, i)
  return { nums: main.split('.').map(n => Number(n) || 0), pre: i < 0 ? '' : s.slice(i + 1) }
}

/** 语义化范围内判定（支持 ^ / ~ / 精确；0.x caret 钉死 minor——0.x minor 锁纪律） */
export function inRange(version: string, range: string): boolean {
  const r = stripBuildMeta(String(range || '').trim())
  const v = stripBuildMeta(version)
  if (!r) return true
  const base = r.replace(/^[\^~]/, '')
  const pv = parseVer(v)
  const pb = parseVer(base)
  if (!r.startsWith('^') && !r.startsWith('~')) {
    return compareVersions(v, base) === 0
  }
  if (compareVersions(v, base) < 0) return false
  if (r.startsWith('~')) {
    return pv.nums[0] === pb.nums[0] && pv.nums[1] === pb.nums[1]
  }
  if (pb.nums[0] === 0) {
    // 0.x：^ 钉 major.minor
    if (pv.nums[0] !== 0 || pv.nums[1] !== pb.nums[1]) return false
  } else if (pv.nums[0] !== pb.nums[0]) {
    return false
  }
  // prerelease 只在 base 同 [major,minor,patch] 且带 prerelease 时放行
  if (pv.pre && (!pb.pre || pv.nums.join('.') !== pb.nums.join('.'))) return false
  return true
}

/** 已装版本（require 探测；未装返回 null） */
export function installedVersion(name: string): string | null {
  try {
    const req = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/')
    const pkg = req(`${name}/package.json`)
    return String(pkg?.version || '').split('+')[0] || null
  } catch {
    return null
  }
}

/** 读本插件 package.json 里声明的依赖范围 */
export function declaredRange(name: string): string {
  try {
    const req = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/')
    const self = req('../../package.json')
    return String(self?.dependencies?.[name] || '')
  } catch {
    return ''
  }
}

export interface PackumentInfo {
  latest: string | null
  versions: string[]
}

export async function fetchPackument(pkg: string, registry: string): Promise<PackumentInfo> {
  const res = await axios.get(`${registry.replace(/\/+$/, '')}/${pkg}`, {
    timeout: 15000,
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  const latest = typeof res.data?.['dist-tags']?.latest === 'string' ? res.data['dist-tags'].latest : null
  const versions = Object.keys(res.data?.versions || {})
  return { latest, versions }
}

/** 逐包状态：范围内可更 / 范围外 / 已最新 */
export async function listFragments(opts: {
  registry?: string
  baseDir?: string
  names?: string[]
  fetchPackumentImpl?: typeof fetchPackument
} = {}): Promise<FragmentStatus[]> {
  const baseDir = opts.baseDir || process.cwd()
  const registry = resolveRegistry(opts.registry, baseDir, process.env.USERPROFILE || process.env.HOME || '')
  const names = (opts.names || FRAGMENT_PACKAGES).filter(n => installedVersion(n))
  const fetchImpl = opts.fetchPackumentImpl || fetchPackument
  const out: FragmentStatus[] = []
  for (const name of names) {
    const current = installedVersion(name)!
    const range = declaredRange(name)
    try {
      const { latest, versions } = await fetchImpl(name, registry)
      const candidates = versions
        .map(stripBuildMeta)
        .filter(v => inRange(v, range || `^${current}`))
        .filter(v => compareVersions(v, current) > 0)
        .sort(compareVersions)
      const target = candidates[candidates.length - 1]
      const newer = latest ? compareVersions(stripBuildMeta(latest), current) > 0 : false
      out.push({
        name, current,
        latest: latest ? stripBuildMeta(latest) : null,
        updateKind: target ? 'in-range' : (newer ? 'out-of-range' : 'none'),
        target,
      })
    } catch {
      out.push({ name, current, latest: null, updateKind: 'none' })
    }
  }
  return out
}

/** 已装碎片包版本清单（插件加载日志用，如 core@0.6.0-alpha.2、platform-xiaohongshu@0.3.0-alpha.3） */
export function describeFragments(): string {
  return FRAGMENT_PACKAGES
    .map(n => {
      const v = installedVersion(n)
      return v ? `${n.replace('@sns-parse/', '')}@${v}` : null
    })
    .filter(Boolean)
    .join('、')
}

let fragmentsBusy = false

/**
 * 碎片包范围内更新（平台/扩展/core）：只升到各包声明范围内最新，
 * 不破 0.x minor 锁；范围外新版本仅提示升本体。安装后可 applyReload 生效。
 */
export async function updateFragments(opts: {
  registry?: string
  baseDir?: string
  timeoutMs?: number
  names?: string[]
  notify?: (text: string) => Promise<void> | void
  fetchPackumentImpl?: typeof fetchPackument
} = {}): Promise<{ updated: FragmentInstall[]; message: string; outOfRange: string[] }> {
  if (fragmentsBusy) return { updated: [], message: '碎片包更新已在执行中，请稍候', outOfRange: [] }
  fragmentsBusy = true
  try {
    const statuses = await listFragments(opts)
    const toInstall = statuses.filter(s => s.updateKind === 'in-range' && s.target)
    const outOfRange = statuses.filter(s => s.updateKind === 'out-of-range').map(s => s.name)
    const updated: FragmentInstall[] = []
    for (const s of toInstall) {
      await opts.notify?.(`更新 ${s.name}：${s.current} → ${s.target}（范围内）`)
      const baseDir = opts.baseDir || process.cwd()
      const registry = resolveRegistry(opts.registry, baseDir, process.env.USERPROFILE || process.env.HOME || '')
      const inst = await installVersion(s.name, s.target!, baseDir, registry, opts.timeoutMs)
      if (inst.ok) updated.push({ name: s.name, version: s.target! })
      else await opts.notify?.(`安装 ${s.name} 失败：${inst.message}`)
    }
    const parts: string[] = []
    parts.push(updated.length
      ? `已更新 ${updated.length} 个碎片包（${updated.map(u => `${u.name}@${u.version}`).join('、')}）`
      : '碎片包均已是范围内最新')
    if (outOfRange.length) parts.push(`以下包有范围外新版本（需升级本体插件）：${outOfRange.join('、')}`)
    if (updated.length) {
      parts.push(typeof (process as any).send === 'function' ? '守护进程将自动重载生效' : '需重启 Koishi 后生效')
    }
    return { updated, message: parts.join('；'), outOfRange }
  } finally {
    fragmentsBusy = false
  }
}
