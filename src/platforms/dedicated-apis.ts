/**
 * 双网关常量与平台专属端点聚合（re-export + 本地定义派生）。
 * 常量与聚合函数来自 @sns-parse/core；映射由本仓库 BUILTIN_PLATFORMS 计算。
 */
import { dedicatedApisFrom, NEW_GATEWAY_PRIMARY, LEGACY_GATEWAY_PRIMARY, LEGACY_GATEWAY_BACKUP } from '@sns-parse/core'
import { BUILTIN_PLATFORMS } from './definitions'

export { NEW_GATEWAY_PRIMARY, LEGACY_GATEWAY_PRIMARY, LEGACY_GATEWAY_BACKUP }

const maps = dedicatedApisFrom(BUILTIN_PLATFORMS)

/** 旧网关平台专属端点（无需 Key） */
export const defaultDedicatedApisLegacy: Record<string, string> = maps.legacy

/** 新网关平台专属端点（与上游 v1.6.7 对齐；需 Key；未覆盖的平台走主 API 兜底） */
export const defaultDedicatedApisNew: Record<string, string> = maps.next
