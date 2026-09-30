import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { handleUpdateTrigger, judgeMarker } from '../src/services/update/trigger'
import { updateFragments } from '../src/services/update/fragments'
import { applyReload } from '../src/services/update/self'
import { applyOverrideToConfig } from '@sns-parse/core'

vi.mock('../src/services/update/fragments', () => ({
  updateFragments: vi.fn(),
}))
vi.mock('../src/services/update/self', () => ({
  applyReload: vi.fn(),
}))

const TMP = join(process.env.TEMP || process.env.TMP || '.', 'opencode', 'trigger-test')
const PLUGIN = 'video-parser-all'

function makeCtx() {
  const scopeUpdates: any[] = []
  return {
    setTimeout: (fn: () => void) => { fn(); return 0 },
    scope: { update: (c: any) => { scopeUpdates.push(c) } },
    _scopeUpdates: scopeUpdates,
  } as any
}

function makeLogger() {
  const lines: string[] = []
  return {
    info: (m: string) => { lines.push(m) },
    warn: (m: string) => { lines.push(m) },
    error: (m: string) => { lines.push(m) },
    _lines: lines,
  }
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
  vi.mocked(updateFragments).mockReset()
  vi.mocked(applyReload).mockReset()
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('judgeMarker 消费判定', () => {
  const now = Date.now()
  it('无标记 → run', () => {
    expect(judgeMarker(null, now)).toBe('run')
  })
  it('finishedAt 新鲜 → skip-finished；过期 → run', () => {
    expect(judgeMarker({ startedAt: now - 60_000, finishedAt: now - 60_000 }, now)).toBe('skip-finished')
    expect(judgeMarker({ startedAt: now - 40 * 60_000, finishedAt: now - 40 * 60_000 }, now)).toBe('run')
  })
  it('startedAt 新鲜且未完成 → skip-running；过期僵尸 → run', () => {
    expect(judgeMarker({ startedAt: now - 60_000 }, now)).toBe('skip-running')
    expect(judgeMarker({ startedAt: now - 20 * 60_000 }, now)).toBe('run')
  })
})

describe('handleUpdateTrigger 集成', () => {
  it('无标记：恰好执行一次，marker 落盘，复位为 override 单键 + scope.update 热更', async () => {
    vi.mocked(updateFragments).mockResolvedValue({
      updated: [{ name: '@sns-parse/core', version: '0.6.0-alpha.99' }],
      failed: [],
      message: 'ok',
      outOfRange: [],
    })
    const ctx = makeCtx()
    const config = { updateFragmentsTrigger: true, otherSetting: 123, updateRegistry: '' }
    handleUpdateTrigger(ctx, config, TMP, PLUGIN, makeLogger())
    await new Promise((r) => setTimeout(r, 10))
    expect(updateFragments).toHaveBeenCalledTimes(1)
    expect(vi.mocked(updateFragments).mock.calls[0][0]).toMatchObject({ baseDir: TMP })
    // 更新成功 → applyReload 生效
    expect(applyReload).toHaveBeenCalled()
    // 复位热更：开关 false、其余配置保留
    expect(ctx._scopeUpdates.length).toBe(1)
    expect(ctx._scopeUpdates[0]).toMatchObject({ updateFragmentsTrigger: false, otherSetting: 123 })
    // override 落盘：仅触发器单键（不再全量快照）；writeOverride 为信封格式，取 config 字段
    const raw = JSON.parse(readFileSync(join(TMP, 'data', PLUGIN, 'config.override.json'), 'utf8'))
    expect(raw.config ?? raw).toEqual({ updateFragmentsTrigger: false })
    // 消费标记已写 finishedAt
    const marker = JSON.parse(readFileSync(join(TMP, 'data', PLUGIN, 'update-trigger.json'), 'utf8'))
    expect(marker.finishedAt).toBeGreaterThan(0)
    expect(marker.ok).toBe(true)
  })

  it('override 单键复位不固化用户配置（applyOverrideToConfig 合并语义）', async () => {
    vi.mocked(updateFragments).mockResolvedValue({ updated: [], failed: [], message: 'none', outOfRange: [] })
    const ctx = makeCtx()
    handleUpdateTrigger(ctx, { updateFragmentsTrigger: true }, TMP, PLUGIN, makeLogger())
    await new Promise((r) => setTimeout(r, 10))
    // 模拟用户之后在控制台改了 otherSetting=456 并重启：rawConfig 的新值不被 override 覆盖
    const merged = applyOverrideToConfig({ updateFragmentsTrigger: true, otherSetting: 456 }, TMP, PLUGIN)
    expect(merged.otherSetting).toBe(456)
    expect(merged.updateFragmentsTrigger).toBe(false)
  })

  it('新鲜 finished 标记：不重复执行，仍复位', async () => {
    const markerFile = join(TMP, 'data', PLUGIN, 'update-trigger.json')
    mkdirSync(join(TMP, 'data', PLUGIN), { recursive: true })
    const { writeFileSync } = await import('fs')
    writeFileSync(markerFile, JSON.stringify({ startedAt: Date.now() - 60_000, finishedAt: Date.now() - 30_000, ok: true }))
    const ctx = makeCtx()
    handleUpdateTrigger(ctx, { updateFragmentsTrigger: true }, TMP, PLUGIN, makeLogger())
    await new Promise((r) => setTimeout(r, 10))
    expect(updateFragments).not.toHaveBeenCalled()
    expect(ctx._scopeUpdates.length).toBe(1)
    expect(ctx._scopeUpdates[0].updateFragmentsTrigger).toBe(false)
  })

  it('进行中标记（startedAt 新鲜无 finished）：不重复执行，仍复位', async () => {
    const markerFile = join(TMP, 'data', PLUGIN, 'update-trigger.json')
    mkdirSync(join(TMP, 'data', PLUGIN), { recursive: true })
    const { writeFileSync } = await import('fs')
    writeFileSync(markerFile, JSON.stringify({ startedAt: Date.now() - 30_000 }))
    const ctx = makeCtx()
    handleUpdateTrigger(ctx, { updateFragmentsTrigger: true }, TMP, PLUGIN, makeLogger())
    await new Promise((r) => setTimeout(r, 10))
    expect(updateFragments).not.toHaveBeenCalled()
    expect(ctx._scopeUpdates[0].updateFragmentsTrigger).toBe(false)
  })

  it('updateFragments 抛异常：标记 ok=false、复位仍执行（finally 语义）', async () => {
    vi.mocked(updateFragments).mockRejectedValue(new Error('boom'))
    const ctx = makeCtx()
    const log = makeLogger()
    handleUpdateTrigger(ctx, { updateFragmentsTrigger: true }, TMP, PLUGIN, log)
    await new Promise((r) => setTimeout(r, 10))
    expect(updateFragments).toHaveBeenCalledTimes(1)
    const marker = JSON.parse(readFileSync(join(TMP, 'data', PLUGIN, 'update-trigger.json'), 'utf8'))
    expect(marker.ok).toBe(false)
    expect(ctx._scopeUpdates[0].updateFragmentsTrigger).toBe(false)
    expect(applyReload).not.toHaveBeenCalled()
  })

  it('开关关闭：零开销（不调度任何任务）', () => {
    vi.mocked(updateFragments).mockResolvedValue({ updated: [], failed: [], message: '', outOfRange: [] })
    const ctx = makeCtx()
    handleUpdateTrigger(ctx, { updateFragmentsTrigger: false }, TMP, PLUGIN, makeLogger())
    expect(updateFragments).not.toHaveBeenCalled()
    expect(ctx._scopeUpdates.length).toBe(0)
  })
})
