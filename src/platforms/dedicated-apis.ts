/**
 * 双网关配置（上游 issue #12）：
 * - 旧网关 api.bugpk.com：无需 API Key，v1.5.8 及之前的行为
 * - 新网关 api-new.ifphp.com：需 API Key（X-API-Key 头），上游唯一维护入口
 * 选择规则：配置了 apiKey → 新网关；否则 → 旧网关
 *
 * 平台专属端点已内联到各 PlatformDefinition（见 ./rules），此处聚合为映射。
 */
import { BUILTIN_PLATFORMS } from './rules'

export const NEW_GATEWAY_PRIMARY = 'https://api-new.ifphp.com/api/svparse'
export const LEGACY_GATEWAY_PRIMARY = 'https://api.bugpk.com/api/short_videos'
export const LEGACY_GATEWAY_BACKUP = 'https://api.bugpk.com/api/svparse'

function collect(kind: 'legacy' | 'next'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of BUILTIN_PLATFORMS) {
    const url = p.dedicated?.[kind]
    if (url) out[p.type] = url
  }
  return out
}

/** 旧网关平台专属端点（无需 Key） */
export const defaultDedicatedApisLegacy: Record<string, string> = collect('legacy')

/** 新网关平台专属端点（与上游 v1.6.7 对齐；需 Key；未覆盖的平台走主 API 兜底） */
export const defaultDedicatedApisNew: Record<string, string> = collect('next')
