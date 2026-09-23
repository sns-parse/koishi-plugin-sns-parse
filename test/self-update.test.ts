import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import {
  packageNameFor, stripBuildMeta, compareVersions, detectPackageManager, resolveRegistry,
} from '../src/services/self-update'

const TMP = join(process.env.TEMP || process.env.TMP || '.', 'opencode', 'self-update-test')

describe('self-update — 纯函数', () => {
  beforeAll(() => {
    mkdirSync(TMP, { recursive: true })
  })
  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  it('packageNameFor 按命名空间映射包名', () => {
    expect(packageNameFor('sns-parse')).toBe('@sns-parse/koishi-plugin-sns-parse')
    expect(packageNameFor('video-parser-all')).toBe('@char46/koishi-plugin-video-parser-all')
  })

  it('stripBuildMeta 剥离 build 段', () => {
    expect(stripBuildMeta('1.20.0-alpha.6+upstream.1.6.7')).toBe('1.20.0-alpha.6')
    expect(stripBuildMeta('0.4.0')).toBe('0.4.0')
  })

  it('compareVersions：主/次/修订', () => {
    expect(compareVersions('1.20.1', '1.20.0')).toBe(1)
    expect(compareVersions('1.20.0', '1.20.0')).toBe(0)
    expect(compareVersions('0.4.10', '0.4.9')).toBe(1)
  })
  it('compareVersions：prerelease 与正式版', () => {
    expect(compareVersions('1.20.0', '1.20.0-alpha.9')).toBe(1)
    expect(compareVersions('1.20.0-alpha.5', '1.20.0')).toBe(-1)
    expect(compareVersions('1.20.0-alpha.10', '1.20.0-alpha.9')).toBe(1)
    expect(compareVersions('1.20.0-beta.1', '1.20.0-alpha.9')).toBe(1)
    expect(compareVersions('1.20.0-alpha.1', '1.20.0-beta.1')).toBe(-1)
  })
  it('compareVersions：build metadata 不参与比较', () => {
    expect(compareVersions('1.20.0-alpha.6+upstream.1.6.7', '1.20.0-alpha.6')).toBe(0)
  })

  it('detectPackageManager 按锁文件探测', () => {
    const pn = join(TMP, 'pn'); mkdirSync(pn, { recursive: true }); writeFileSync(join(pn, 'pnpm-lock.yaml'), '')
    const ya = join(TMP, 'ya'); mkdirSync(ya, { recursive: true }); writeFileSync(join(ya, 'yarn.lock'), '')
    const yb = join(TMP, 'yb'); mkdirSync(yb, { recursive: true }); writeFileSync(join(yb, '.yarnrc.yml'), 'npmRegistryServer: x')
    const np = join(TMP, 'np'); mkdirSync(np, { recursive: true })
    expect(detectPackageManager(pn).label).toBe('pnpm')
    expect(detectPackageManager(ya).label).toBe('yarn')
    expect(detectPackageManager(yb).label).toBe('yarn')
    expect(detectPackageManager(np).label).toBe('npm')
  })

  it('resolveRegistry：显式配置 > 项目 .npmrc > 用户 .npmrc > 默认 npmmirror', () => {
    const proj = join(TMP, 'proj'); mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, '.npmrc'), 'registry=https://project.reg\n')
    const home = join(TMP, 'home'); mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '.npmrc'), 'registry=https://user.reg\n')
    const bare = join(TMP, 'bare'); mkdirSync(bare, { recursive: true })
    expect(resolveRegistry('https://explicit.reg', proj, home)).toBe('https://explicit.reg')
    expect(resolveRegistry('', proj, home)).toBe('https://project.reg')
    expect(resolveRegistry('', bare, home)).toBe('https://user.reg')
    expect(resolveRegistry('', bare, join(TMP, 'nohome'))).toBe('https://registry.npmmirror.com')
  })
})
