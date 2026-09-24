/**
 * 扩展片段装配：动态发现已安装的 @sns-parse/ext-*（WorkflowExtension[]，含 setup 钩子）。
 * 未安装的自动缺席（能力/配置贡献同时缺席）；实现全部在扩展包，core 只调度。
 */
import { loadWorkflowExtensions, type WorkflowExtension } from '@sns-parse/core'

export function createDefaultExtensions(): WorkflowExtension[] {
  return loadWorkflowExtensions()
}

export type { WorkflowExtension }
