import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  MASK, createConfigEnvelope, redactConfig, mergeConfig, diffKeys,
  parseConfigInput, isConfigEnvelope, serializeConfigEnvelope,
  writeOverride, readOverride, applyOverrideToConfig, overrideFilePath,
} from '../src/services/config-io'

describe('config-io 导出/导入', () => {
  it('redactConfig：密钥打码，非密钥保留', () => {
    const cfg = {
      apiKey: 'k123',
      twitterAuthToken: 'tok',
      twitterCt0: '',
      nsfwModeration: { baidu: { apiKey: 'bk', secretKey: 'bs' }, azure: { endpoint: 'https://e' } },
      customApis: [{ platform: 'douyin', apiUrl: 'u', apiKey: 'ck' }],
      proxy: { auth: { username: 'u', password: 'pw' } },
    }
    const red = redactConfig(cfg)
    expect(red.apiKey).toBe(MASK)
    expect(red.twitterAuthToken).toBe(MASK)
    expect(red.twitterCt0).toBe('')            // 空值不打扰
    expect(red.nsfwModeration.baidu.apiKey).toBe(MASK)
    expect(red.nsfwModeration.baidu.secretKey).toBe(MASK)
    expect(red.nsfwModeration.azure.endpoint).toBe('https://e')
    expect(red.customApis[0].apiKey).toBe(MASK)
    expect(red.customApis[0].apiUrl).toBe('u')
    expect(red.proxy.auth.password).toBe(MASK)
    expect(red.proxy.auth.username).toBe('u')
  })

  it('createConfigEnvelope：默认脱敏，includeSecrets 保留明文', () => {
    const cfg = { apiKey: 'secret' }
    const e1 = createConfigEnvelope(cfg, { pluginName: 'video-parser-all' })
    expect(e1.redacted).toBe(true)
    expect(e1.config.apiKey).toBe(MASK)
    expect(e1.pluginName).toBe('video-parser-all')
    const e2 = createConfigEnvelope(cfg, { includeSecrets: true })
    expect(e2.redacted).toBe(false)
    expect(e2.config.apiKey).toBe('secret')
  })

  it('mergeConfig：深度合并、数组替换、MASK 跳过', () => {
    const base = {
      enable: true,
      apiKey: 'real-key',
      nsfwModeration: { baidu: { apiKey: 'real', secretKey: 'real2' } },
      platformEnabled: { douyin: true, bilibili: true },
    }
    const patch = {
      enable: false,
      apiKey: MASK,
      nsfwModeration: { baidu: { apiKey: MASK, secretKey: 'imported' } },
      platformEnabled: { douyin: false },
    }
    const merged = mergeConfig(base, patch)
    expect(merged.enable).toBe(false)
    expect(merged.apiKey).toBe('real-key')                       // MASK 保留现有
    expect(merged.nsfwModeration.baidu.apiKey).toBe('real')      // MASK 保留
    expect(merged.nsfwModeration.baidu.secretKey).toBe('imported')
    expect(merged.platformEnabled).toEqual({ douyin: false, bilibili: true }) // 对象深度合并
  })

  it('parseConfigInput：信封 / 裸对象 / 非法输入', () => {
    const env = createConfigEnvelope({ a: 1 }, { pluginName: 'x', includeSecrets: true })
    const r1 = parseConfigInput(serializeConfigEnvelope(env))
    expect(r1.envelope).toBe(true)
    expect(r1.config).toEqual({ a: 1 })
    expect(r1.pluginName).toBe('x')
    const r2 = parseConfigInput('{"enable":true}')
    expect(r2.envelope).toBe(false)
    expect(r2.config).toEqual({ enable: true })
    expect(() => parseConfigInput('not json')).toThrow()
    expect(() => parseConfigInput('[1,2]')).toThrow()
    expect(isConfigEnvelope({ kind: 'other' })).toBe(false)
  })

  it('diffKeys：列出将被覆盖的键（跳过 MASK）', () => {
    expect(diffKeys({ a: 1, n: { x: 1 } }, { a: 2, b: 3, n: { x: 5, y: 6 }, c: MASK }).sort())
      .toEqual(['a', 'b', 'n.x', 'n.y'])
  })

  it('覆盖文件：写入 / 读取 / 合并回配置', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-config-'))
    try {
      const name = 'video-parser-all'
      expect(readOverride(dir, name)).toBeNull()
      const file = writeOverride(dir, name, { apiKey: 'nine', enable: false }, name)
      expect(file).toBe(overrideFilePath(dir, name))
      const back = readOverride(dir, name)
      expect(back).toEqual({ apiKey: 'nine', enable: false })
      const effective = applyOverrideToConfig({ apiKey: 'old', enable: true, other: 1 }, dir, name)
      expect(effective).toEqual({ apiKey: 'nine', enable: false, other: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
