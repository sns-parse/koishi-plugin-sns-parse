/**
 * 生成器：把平台定义从聚合数组拆成「每平台一个文件」。
 * 运行：npx tsx scripts/gen-defs.ts
 *
 * 当新增/修改平台时，先改 src/platforms/rules.ts 的 BUILTIN_PLATFORMS，
 * 再运行本脚本重新生成 src/platforms/definitions/*。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_PLATFORMS } from '../src/platforms/rules'

const outDir = join(process.cwd(), 'src', 'platforms', 'definitions')
mkdirSync(outDir, { recursive: true })

for (const p of BUILTIN_PLATFORMS) {
  // 带函数钩子（parse/translate）的定义序列化会丢函数 → 生成物直接 re-export 平台包
  if (typeof (p as any).parse === 'function' || typeof (p as any).translate === 'function') {
    writeFileSync(join(outDir, `${p.type}.ts`), [
      `import type { PlatformDefinition } from '../../core/platform'`,
      '',
      `// 带函数钩子（parse/translate）的定义来自平台包（gen-defs 序列化会丢函数），此处 re-export`,
      `export { ${p.type} } from '@sns-parse/platform-${p.type}'`,
      `export type { PlatformDefinition }`,
      '',
    ].join('\n'), 'utf8')
    continue
  }
  const lines: string[] = []
  lines.push(`import type { PlatformDefinition } from '../../core/platform'`)
  lines.push('')
  lines.push(`export const ${p.type}: PlatformDefinition = {`)
  lines.push(`  type: ${JSON.stringify(p.type)},`)
  lines.push(`  rules: [`)
  for (const r of p.rules) lines.push(`    new RegExp(${JSON.stringify(r.source)}, ${JSON.stringify(r.flags)}),`)
  lines.push(`  ],`)
  if (p.dedicated) {
    lines.push(`  dedicated: {`)
    if (p.dedicated.legacy) lines.push(`    legacy: ${JSON.stringify(p.dedicated.legacy)},`)
    if (p.dedicated.next) lines.push(`    next: ${JSON.stringify(p.dedicated.next)},`)
    lines.push(`  },`)
  }
  if (p.dedicatedFirst !== undefined) lines.push(`  dedicatedFirst: ${p.dedicatedFirst},`)
  if (p.hints) lines.push(`  hints: ${JSON.stringify(p.hints)},`)
  lines.push('}')
  lines.push('')
  writeFileSync(join(outDir, `${p.type}.ts`), lines.join('\n'), 'utf8')
}

const idx: string[] = []
idx.push('/*')
idx.push(' * 内置平台定义聚合（每平台一个文件，便于后续一平台一包）。')
idx.push(' * 由 scripts/gen-defs.ts 生成，勿手工编辑；请改 src/platforms/rules.ts 后重新生成。')
idx.push(' */')
idx.push(`import type { PlatformDefinition } from '../../core/platform'`)
for (const p of BUILTIN_PLATFORMS) idx.push(`import { ${p.type} } from './${p.type}'`)
idx.push('')
idx.push(`export const BUILTIN_PLATFORMS: PlatformDefinition[] = [`)
for (const p of BUILTIN_PLATFORMS) idx.push(`  ${p.type},`)
idx.push(`]`)
idx.push('')
idx.push(`/** 扁平规则表（链接识别用） */`)
idx.push(`export const BUILTIN_LINK_RULES: { pattern: RegExp; type: string }[] =`)
idx.push(`  BUILTIN_PLATFORMS.flatMap(p => p.rules.map(pattern => ({ pattern, type: p.type })))`)
idx.push('')
writeFileSync(join(outDir, 'index.ts'), idx.join('\n'), 'utf8')

console.log(`generated ${BUILTIN_PLATFORMS.length} platform definitions -> src/platforms/definitions`)
