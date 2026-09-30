/**
 * 碎片包（platform-* / ext-* / core / 聚合）更新机制 —— 完全重做版。
 *
 * 设计（相对旧版的关键变化）：
 * 1. **动态发现**：已装碎片来自 core `installedFragments()`（registry 扫描），
 *    不再维护硬编码清单——新增平台/扩展包无需改本文件（静态清单仅作兜底）。
 * 2. **并行规划**：packument 并发读取（4 路、单包超时 + 1 次重试），
 *    34 个包从串行数十秒降到数秒；单包失败不影响其余（分类 unknown）。
 * 3. **镜像滞后识别**：registry 展示的 latest 比本地已装还旧（npmmirror
 *    packudent 缓存滞后 / npm 异步发布未落地）时标 stale，不误报"已是最新"。
 * 4. **精确钉版安装**：目标版本在规划阶段确定，单次包管理器调用批量
 *    `name@exact`（无范围解析意外、幂等）；失败逐包隔离重试。
 * 5. **装后核验**：安装退出码 ≠ 落盘；重新 require 读实际版本比对目标，
 *    不匹配即 failed（防"假成功"）。
 * 6. 0.x minor 锁纪律保留：只升到各包声明范围内最新；范围外仅提示升本体。
 */
import { createRequire } from 'module'
import { installedFragments } from '@sns-parse/core'
import { stripBuildMeta, compareVersions, inRange } from './semver'
import { resolveRegistry, fetchPackument, type PackumentInfo } from './registry'
import { installSpecs } from './pm'

/** 静态兜底清单（core installedFragments 不可用时）；与动态发现取并集 */
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

const anchorRequire = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/')

/** 已装版本（require 探测；未装返回 null） */
export function installedVersion(name: string): string | null {
  try {
    const pkg = anchorRequire(`${name}/package.json`)
    return String(pkg?.version || '').split('+')[0] || null
  } catch {
    return null
  }
}

/** 读本插件 package.json 里声明的依赖范围 */
function declaredRange(name: string): string {
  try {
    const self = anchorRequire('../../package.json')
    return String(self?.dependencies?.[name] || '')
  } catch {
    return ''
  }
}

/** 动态发现 + 静态兜底：本部署中实际存在的碎片包名（有序去重） */
function discoverInstalled(): string[] {
  const found = new Set<string>()
  try {
    for (const f of installedFragments(anchorRequire) || []) {
      if (f?.name && f.version) found.add(f.name)
    }
  } catch { /* core 版本过旧无 installedFragments → 静态兜底 */ }
  for (const n of FRAGMENT_PACKAGES) {
    if (!found.has(n) && installedVersion(n)) found.add(n)
  }
  // 保持稳定顺序（静态清单顺序优先，动态发现的新包追加在后）
  const extra = Array.from(found).filter((n: string) => !FRAGMENT_PACKAGES.includes(n))
  return [...FRAGMENT_PACKAGES.filter(n => found.has(n)), ...extra]
}

export interface FragmentStatus {
  name: string
  current: string
  latest: string | null
  /** none=已最新；in-range=范围内可更；out-of-range=范围外（需升本体抬范围）；unknown=registry 元数据不可用；stale=registry 展示旧于本地（镜像滞后） */
  updateKind: 'none' | 'in-range' | 'out-of-range' | 'unknown' | 'stale'
  /** 范围内可更的目标版本（updateKind==='in-range' 时有值） */
  target?: string
}

/** 有界并发执行（保序完成） */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

type FetchImpl = (pkg: string, registry: string) => Promise<PackumentInfo>

/** 单包分类（fetch 失败重试一次后仍失败 → unknown） */
async function classify(name: string, registry: string, fetchImpl: FetchImpl): Promise<FragmentStatus> {
  const current = installedVersion(name) || '0.0.0'
  const range = declaredRange(name)
  let doc: PackumentInfo | null = null
  try {
    doc = await fetchImpl(name, registry)
  } catch {
    try {
      await new Promise((r) => setTimeout(r, 1500))
      doc = await fetchImpl(name, registry)
    } catch {
      return { name, current, latest: null, updateKind: 'unknown' }
    }
  }
  const latest = doc.latest ? stripBuildMeta(doc.latest) : null
  const candidates = doc.versions
    .map(stripBuildMeta)
    .filter(v => inRange(v, range || `^${current}`))
    .filter(v => compareVersions(v, current) > 0)
    .sort(compareVersions)
  const target = candidates[candidates.length - 1]
  if (target) return { name, current, latest, updateKind: 'in-range', target }
  if (latest && compareVersions(latest, current) < 0) return { name, current, latest, updateKind: 'stale' }
  if (latest && compareVersions(latest, current) > 0) return { name, current, latest, updateKind: 'out-of-range' }
  return { name, current, latest, updateKind: 'none' }
}

/** 全量碎片状态（并行；names 缺省=动态发现全部已装碎片） */
export async function listFragments(opts: {
  registry?: string
  baseDir?: string
  names?: string[]
  fetchPackumentImpl?: FetchImpl
  concurrency?: number
} = {}): Promise<FragmentStatus[]> {
  const baseDir = opts.baseDir || process.cwd()
  const registry = resolveRegistry(opts.registry, baseDir, process.env.USERPROFILE || process.env.HOME || '')
  const fetchImpl = opts.fetchPackumentImpl || ((pkg, reg) => fetchPackument(pkg, reg))
  let names = opts.names || discoverInstalled()
  if (!opts.names) names = names.filter(n => installedVersion(n))
  return pooled(names, opts.concurrency ?? 4, (name) => classify(name, registry, fetchImpl))
}

/** 已装碎片包版本清单（插件加载日志用） */
export function describeFragments(): string {
  return discoverInstalled()
    .map(n => {
      const v = installedVersion(n)
      return v ? `${n.replace('@sns-parse/', '')}@${v}` : null
    })
    .filter(Boolean)
    .join('、')
}

export interface FragmentInstall {
  name: string
  version: string
}

export interface FragmentUpdateResult {
  updated: FragmentInstall[]
  failed: FragmentInstall[]
  message: string
  outOfRange: string[]
}

let fragmentsBusy = false

/** 装后核验：重新读取实际落盘版本，与目标一致才算成功 */
function verify(name: string, target: string): boolean {
  const got = installedVersion(name)
  return !!got && compareVersions(got, target) === 0
}

/**
 * 碎片包范围内更新：规划（并行 packument）→ 批量精确钉版安装（单次调用）→
 * 装后核验 → 失败逐包隔离重试。安装成功后由调用方 applyReload 生效。
 */
export async function updateFragments(opts: {
  registry?: string
  baseDir?: string
  timeoutMs?: number
  names?: string[]
  notify?: (text: string) => Promise<void> | void
  fetchPackumentImpl?: FetchImpl
} = {}): Promise<FragmentUpdateResult> {
  if (fragmentsBusy) return { updated: [], failed: [], message: '碎片包更新已在执行中，请稍候', outOfRange: [] }
  fragmentsBusy = true
  try {
    const baseDir = opts.baseDir || process.cwd()
    const registry = resolveRegistry(opts.registry, baseDir, process.env.USERPROFILE || process.env.HOME || '')
    const statuses = await listFragments(opts)
    const toInstall = statuses.filter(s => s.updateKind === 'in-range' && s.target)
    const outOfRange = statuses.filter(s => s.updateKind === 'out-of-range').map(s => s.name)
    const unknown = statuses.filter(s => s.updateKind === 'unknown').map(s => s.name)
    const stale = statuses.filter(s => s.updateKind === 'stale').map(s => s.name)
    const updated: FragmentInstall[] = []
    const failed: FragmentInstall[] = []

    if (toInstall.length) {
      await opts.notify?.(`规划完成：范围内可更 ${toInstall.length} 个（${toInstall.map(s => `${s.name}@${s.target}`).join('、')}），开始批量安装…`)
      const batch = await installSpecs(
        toInstall.map(s => `${s.name}@${s.target}`),
        baseDir, registry, opts.timeoutMs,
      )
      if (batch.ok) {
        for (const s of toInstall) {
          if (verify(s.name, s.target!)) updated.push({ name: s.name, version: s.target! })
          else failed.push({ name: s.name, version: s.target! })
        }
      } else {
        await opts.notify?.(`批量安装失败（${batch.message.split('\n')[0]}），逐包隔离重试…`)
        for (const s of toInstall) {
          if (updated.some(u => u.name === s.name)) continue
          const inst = await installSpecs([`${s.name}@${s.target}`], baseDir, registry, opts.timeoutMs)
          if (inst.ok && verify(s.name, s.target!)) updated.push({ name: s.name, version: s.target! })
          else { failed.push({ name: s.name, version: s.target! }); await opts.notify?.(`安装 ${s.name} 失败：${inst.message}`) }
        }
      }
    }

    const parts: string[] = []
    if (updated.length) {
      parts.push(`已更新 ${updated.length} 个碎片包（${updated.map(u => `${u.name}@${u.version}`).join('、')}）`)
      parts.push(typeof (process as any).send === 'function' ? '守护进程将自动重载生效' : '需重启 Koishi 后生效')
    } else if (toInstall.length) {
      parts.push('碎片包更新失败（详见日志）')
    } else {
      parts.push('碎片包均已是范围内最新')
    }
    if (failed.length) parts.push(`失败：${failed.map(f => `${f.name}@${f.version}`).join('、')}`)
    if (outOfRange.length) parts.push(`范围外有新版本（需升级本体插件）：${outOfRange.join('、')}`)
    if (stale.length) parts.push(`registry 元数据滞后（展示版本旧于本地，可稍后再查）：${stale.join('、')}`)
    if (unknown.length) parts.push(`元数据不可用（网络/镜像问题，已跳过）：${unknown.join('、')}`)
    return { updated, failed, message: parts.join('；'), outOfRange }
  } finally {
    fragmentsBusy = false
  }
}
