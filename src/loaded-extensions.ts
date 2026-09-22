/**
 * 动态加载「已安装」的扩展包（@sns-parse/ext-*）。
 *
 * - 未安装的扩展自动跳过（可自选安装，或安装 @sns-parse/extensions 聚合装全部）
 * - 收集配置声明（ConfigContribution）与实现（VideoParserExtensions 片段）
 */
import { createRequire } from 'node:module'
import type { ConfigContribution, VideoParserExtensions } from '@sns-parse/core'

const nodeRequire = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/')

interface ExtensionSpec {
  name: string
  contributionKey?: string
  extensionKey?: string
}

const SPECS: ExtensionSpec[] = [
  { name: 'ext-nsfw', contributionKey: 'nsfwConfigContribution', extensionKey: 'nsfwExtension' },
  { name: 'ext-merge', extensionKey: 'mergeExtension' },
  { name: 'ext-translate', extensionKey: 'translateExtension' },
  { name: 'ext-gif', extensionKey: 'gifExtension' },
]

export interface LoadedExtension {
  name: string
  contribution?: ConfigContribution
  extension?: Partial<VideoParserExtensions>
}

/** 探测并加载全部已安装扩展 */
export function loadExtensions(): LoadedExtension[] {
  const out: LoadedExtension[] = []
  for (const spec of SPECS) {
    try {
      const mod = nodeRequire(`@sns-parse/${spec.name}`)
      out.push({
        name: spec.name,
        contribution: spec.contributionKey ? mod[spec.contributionKey] : undefined,
        extension: spec.extensionKey && typeof mod[spec.extensionKey] === 'function'
          ? mod[spec.extensionKey]()
          : undefined,
      })
    } catch {
      // 未安装该扩展 → 跳过（配置项与能力同时缺席）
    }
  }
  return out
}

export function loadExtensionContributions(): ConfigContribution[] {
  return loadExtensions()
    .map(e => e.contribution)
    .filter((c): c is ConfigContribution => !!c)
}

/** 合并所有已安装扩展的能力片段 */
export function loadExtensionImplementations(): Partial<VideoParserExtensions> {
  return Object.assign({}, ...loadExtensions().map(e => e.extension || {}))
}
