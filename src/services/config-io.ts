/**
 * 配置导出 / 导入 / 迁移。
 *
 * 目的：新旧包使用不同命名空间（旧 video-parser-all / 新 sns-parse），
 * koishi 配置键随之不同，因此提供可跨命名空间移植的配置信封。
 *
 * - 导出：默认脱敏（密钥打码 MASK），--include-secrets 才输出明文
 * - 导入：深度合并进当前配置；MASK 值跳过（保留现有密钥）
 * - 持久化：自管覆盖文件 <baseDir>/data/<name>/config.override.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export const CONFIG_ENVELOPE_KIND = 'sns-parse-config'
export const CONFIG_ENVELOPE_VERSION = 1
/** 脱敏占位；导入时遇此值跳过（保留现有密钥） */
export const MASK = '***'

export interface ConfigEnvelope {
  kind: typeof CONFIG_ENVELOPE_KIND
  version: number
  exportedAt: string
  pluginName: string
  redacted: boolean
  config: Record<string, any>
}

/** 需要脱敏的键名（大小写不敏感） */
const SECRET_KEYS = new Set([
  'apikey', 'secretkey', 'secretid', 'accesskeyid', 'accesskeysecret',
  'authtoken', 'ct0', 'twitterauthtoken', 'twitterct0', 'password',
])

function isPlainObject(v: any): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** 判断键名是否为敏感字段（另含 customHeaders[].value 等，由调用方逐层递归统一处理） */
export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase())
}

/** 深度克隆并按敏感键名打码；数组原样保留（元素递归） */
export function redactConfig(config: any): any {
  if (Array.isArray(config)) return config.map(redactConfig)
  if (!isPlainObject(config)) return config
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(config)) {
    if (isSecretKey(k) && typeof v === 'string' && v) out[k] = MASK
    else out[k] = redactConfig(v)
  }
  return out
}

/** 构造导出信封 */
export function createConfigEnvelope(
  config: any,
  opts: { pluginName?: string; includeSecrets?: boolean } = {},
): ConfigEnvelope {
  const cfg = opts.includeSecrets ? JSON.parse(JSON.stringify(config ?? {})) : redactConfig(config)
  return {
    kind: CONFIG_ENVELOPE_KIND,
    version: CONFIG_ENVELOPE_VERSION,
    exportedAt: new Date().toISOString(),
    pluginName: opts.pluginName || '',
    redacted: !opts.includeSecrets,
    config: cfg,
  }
}

/** 序列化信封（pretty JSON） */
export function serializeConfigEnvelope(env: ConfigEnvelope): string {
  return JSON.stringify(env, null, 2)
}

export function isConfigEnvelope(x: any): x is ConfigEnvelope {
  return !!x && typeof x === 'object' && x.kind === CONFIG_ENVELOPE_KIND
}

/**
 * 解析导入输入：接受
 * - 信封 JSON
 * - 裸配置对象 JSON
 * - 旧版导出（无 kind，直接是配置）
 */
export function parseConfigInput(input: string): { config: Record<string, any>; envelope: boolean; pluginName?: string } {
  let data: any
  const text = (input || '').trim()
  if (!text) throw new Error('导入内容为空')
  try {
    data = JSON.parse(text)
  } catch (e: any) {
    throw new Error(`导入内容不是合法 JSON：${e?.message || e}`)
  }
  if (isConfigEnvelope(data)) {
    return { config: data.config || {}, envelope: true, pluginName: data.pluginName }
  }
  if (isPlainObject(data)) return { config: data, envelope: false }
  throw new Error('导入内容既不是配置信封也不是配置对象')
}

/** 深度合并：对象递归合并，数组/标量直接替换；MASK 值跳过（保留现有） */
export function mergeConfig(base: any, patch: any): any {
  if (!isPlainObject(patch)) return patch
  const out: Record<string, any> = isPlainObject(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === MASK) continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeConfig(out[k], v) : v
  }
  return out
}

/** 统计将被覆盖的顶层键，供 import/migrate 输出摘要 */
export function diffKeys(base: any, patch: any): string[] {
  if (!isPlainObject(patch)) return []
  const out: string[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (v === MASK) continue
    if (isPlainObject(v) && isPlainObject(base?.[k])) out.push(...diffKeys(base[k], v).map(sub => `${k}.${sub}`))
    else out.push(k)
  }
  return out
}

/* ---------- 覆盖文件持久化 ---------- */

export function overrideFilePath(baseDir: string | undefined, name: string): string {
  const root = baseDir || process.cwd()
  return join(root, 'data', name, 'config.override.json')
}

export function readOverride(baseDir: string | undefined, name: string): Record<string, any> | null {
  try {
    const raw = readFileSync(overrideFilePath(baseDir, name), 'utf8')
    const data = JSON.parse(raw)
    return isConfigEnvelope(data) ? data.config : (isPlainObject(data) ? data : null)
  } catch {
    return null
  }
}

export function writeOverride(baseDir: string | undefined, name: string, config: Record<string, any>, pluginName?: string): string {
  const file = overrideFilePath(baseDir, name)
  mkdirSync(dirname(file), { recursive: true })
  const env = createConfigEnvelope(config, { pluginName: pluginName || name, includeSecrets: true })
  writeFileSync(file, serializeConfigEnvelope(env), 'utf8')
  return file
}

/** 读覆盖文件并合并到 schema 配置之上（启动时调用） */
export function applyOverrideToConfig(config: any, baseDir: string | undefined, name: string): any {
  const override = readOverride(baseDir, name)
  return override ? mergeConfig(config, override) : config
}
