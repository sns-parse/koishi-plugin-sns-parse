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

  Schema.object({
    updateFragmentsTrigger: Schema.boolean().default(false).description('一键更新平台/扩展碎片包：开启并保存即执行一次范围内更新，完成后自动复位'),
    updateOnStartup: Schema.boolean().default(false).description('启动/重载时自动检查更新（发现新版自动安装；守护进程部署下自动重启生效）'),
    autoUpdateHours: Schema.number().min(0).step(1).default(0).description('定时检查更新的间隔（小时，0=关闭；结果写入日志，更新成功自动重启生效）'),
    updateRegistry: Schema.string().default('').description('更新用 npm registry（留空自动：项目 .npmrc → 用户 .npmrc → npmmirror）'),
  }).description('自动更新'),

  ...ENGINE_GROUPS.slice(0, 6).map(contributionToSchema),

  // 扩展与平台声明的配置（NSFW/合并/翻译/GIF 与各平台开关等，动态生成）
  contributionsToSchema(collectConfigContributions()),

  ...ENGINE_GROUPS.slice(6).map(contributionToSchema),
])
