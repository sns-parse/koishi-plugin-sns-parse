/**
 * registry 解析与元数据读取（更新子系统自用）。
 *
 * - 解析优先级：显式配置 > 项目 .npmrc > 用户 .npmrc > npmmirror
 * - packument 读取带超时；调用方（fragments.ts）负责重试与并发调度
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import axios from 'axios'

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

export interface PackumentInfo {
  latest: string | null
  versions: string[]
}

/** 读取包元数据（corgi packument；失败抛异常由调用方分类处理） */
export async function fetchPackument(pkg: string, registry: string, timeoutMs = 12000): Promise<PackumentInfo> {
  const res = await axios.get(`${registry.replace(/\/+$/, '')}/${pkg}`, {
    timeout: timeoutMs,
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  const latest = typeof res.data?.['dist-tags']?.latest === 'string' ? res.data['dist-tags'].latest : null
  const versions = Object.keys(res.data?.versions || {})
  return { latest, versions }
}
