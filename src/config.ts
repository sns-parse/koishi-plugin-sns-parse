import { Schema } from 'koishi'
import { engineConfigContributions } from '@sns-parse/core'
import { contributionToSchema, contributionsToSchema, collectConfigContributions } from './config-dynamic'

export const name = 'sns-parse'

/**
 * 引擎配置来自 core 的 engineConfigContributions()（消息格式/媒体发送/…/界面文本），
 * NSFW/合并/翻译/GIF 与各平台开关来自已安装扩展/平台包的声明（动态生成）。
 * 「发送策略」组之后插入动态声明，保持既有 UI 分组顺序。
 */
const ENGINE_GROUPS = engineConfigContributions()

export const Config = Schema.intersect([
  Schema.object({
    enable: Schema.boolean().default(true).description('是否启用视频解析插件'),
    botName: Schema.string().default('视频解析机器人').description('合并转发中显示的昵称'),
    showWaitingTip: Schema.boolean().default(true).description('显示等待提示'),
    debug: Schema.boolean().default(false).description('调试模式：将 debug/verbose 级别日志提升为 info 输出'),
    enableDiagCommand: Schema.boolean().default(false).description('启用 parse/diag 环境诊断命令'),
  }).description('基本设置'),

  ...ENGINE_GROUPS.slice(0, 6).map(contributionToSchema),

  // 扩展与平台声明的配置（NSFW/合并/翻译/GIF 与各平台开关等，动态生成）
  contributionsToSchema(collectConfigContributions()),

  ...ENGINE_GROUPS.slice(6).map(contributionToSchema),
])
