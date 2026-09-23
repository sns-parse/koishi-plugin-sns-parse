/**
 * 动态配置：core 中立 DSL → koishi Schema。
 *
 * 配置项来自「已安装的扩展包与平台包」的声明（ConfigContribution），
 * 而非本插件硬编码；未安装的扩展/平台自动缺席。
 */
import { Schema } from 'koishi'
import { mergeConfigContributions, platformConfigContributions } from '@sns-parse/core'
import type { ConfigContribution, ConfigField } from '@sns-parse/core'
import { loadExtensionContributions } from './loaded-extensions'
import { collectPlatformDefinitions } from './platform-registry'

/** 单个中立字段 → koishi Schema */
function fieldToSchema(f: ConfigField): any {
  let s: any
  switch (f.type) {
    case 'string':
      s = Schema.string()
      if (f.role) s = s.role(f.role)
      break
    case 'number':
      s = Schema.number()
      if (f.min !== undefined) s = s.min(f.min)
      if (f.max !== undefined) s = s.max(f.max)
      if (f.step !== undefined) s = s.step(f.step)
      break
    case 'boolean':
      s = Schema.boolean()
      break
    case 'union':
      s = Schema.union((f.values || []).map(v => {
        let c = Schema.const(v.value)
        if (v.description) c = c.description(v.description)
        return c
      }))
      break
    case 'array':
      if (f.itemFields) {
        s = Schema.array(Schema.object(Object.fromEntries(f.itemFields.map(c => [c.key, fieldToSchema(c)]))))
      } else if (f.itemType === 'string') {
        s = Schema.array(Schema.string())
      } else if (f.itemType === 'number') {
        s = Schema.array(Schema.number())
      } else if (f.itemType === 'boolean') {
        s = Schema.array(Schema.boolean())
      } else if (f.itemType === 'union') {
        s = Schema.array(Schema.union((f.values || []).map(v => {
          let c = Schema.const(v.value)
          if (v.description) c = c.description(v.description)
          return c
        })))
      } else {
        s = Schema.array(Schema.any())
      }
      break
    case 'object':
      s = Schema.object(Object.fromEntries((f.fields || []).map(c => [c.key, fieldToSchema(c)])))
      break
    default:
      s = Schema.any()
  }
  if (f.description) s = s.description(f.description)
  if (f.hidden) s = s.hidden()
  if (f.required) s = s.required()
  if (f.default !== undefined) s = s.default(f.default)
  return s
}

/** 一组中立配置 → koishi Schema.object */
export function contributionToSchema(c: ConfigContribution): any {
  const obj = Schema.object(Object.fromEntries(c.fields.map(f => [f.key, fieldToSchema(f)])))
  return (c.description || c.group) ? obj.description(c.description || c.group) : obj
}

/** 多组配置 → koishi Schema.intersect */
export function contributionsToSchema(list: ConfigContribution[]): any {
  if (!list.length) return Schema.object({})
  return Schema.intersect(list.map(contributionToSchema))
}

/** 汇总所有已加载扩展与平台声明的配置 */
export function collectConfigContributions(): ConfigContribution[] {
  const platformDefs = collectPlatformDefinitions()
  const lists: ConfigContribution[][] = [loadExtensionContributions()]
  if (platformDefs.length) lists.push(platformConfigContributions(platformDefs))
  return mergeConfigContributions(lists)
}
