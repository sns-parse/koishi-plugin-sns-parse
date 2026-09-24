import type { PlatformDefinition } from '../../core/platform'

// 带函数钩子（parse/translate）的定义来自平台包（gen-defs 序列化会丢函数），此处 re-export
export { twitter } from '@sns-parse/platform-twitter'
export type { PlatformDefinition }
