/**
 * 平台定义契约：每个平台的自描述单元，是后续「每平台一个包」的基础。
 *
 * 一个 PlatformDefinition 应自包含该平台的全部静态信息（链接规则、专属 API、
 * 提示等）；动态解析逻辑（normalize/parseNative）在后续阶段以可选钩子加入。
 */
export interface PlatformDefinition {
  /** 平台类型标识（与 config.platformEnabled 的键一致） */
  type: string
  /** 链接识别规则（全局标志由聚合层统一处理） */
  rules: RegExp[]
  /** 平台专属 API（双网关；缺省走主 API） */
  dedicated?: {
    /** 旧网关 api.bugpk.com（无需 Key） */
    legacy?: string
    /** 新网关 api-new.ifphp.com（需 Key） */
    next?: string
  }
  /** 是否默认优先专属 API（可被 config.platformDedicatedFirst 覆盖） */
  dedicatedFirst?: boolean
  /** 解析失败时的平台特定引导提示 */
  hints?: string[]
}
