import { describe, it, expect } from 'vitest'
import { createRuntime as coreCreateRuntime, flush, type OutboundSender, type OutboundElement } from '@sns-parse/core'
import { inRange, listFragments, FRAGMENT_PACKAGES } from '../src/services/self-update'
import { makeConfig, mockSession } from './helpers'

describe('无扩展基线全链路（WorkflowExtension=[] 也能跑通）', () => {
  it('flush：逐张图 / 视频直发 / 不合并 / 不崩', async () => {
    const sent: OutboundElement[][] = []
    const sender: OutboundSender = {
      send: async (_s, elements) => { sent.push(elements); return true },
      sendForward: async (_s, bubbles) => { sent.push(bubbles.flatMap(b => b.content)); return true },
    }
    const rt = coreCreateRuntime({ sender }, makeConfig({ mergeSameOriginImages: true }), { defs: [], extensions: [] })
    ;(rt as any).http = {
      get: async () => ({
        data: {
          code: 200,
          data: {
            type: 'video',
            title: 'T',
            desc: 'D',
            author: { name: 'A' },
            url: 'https://cdn/v.mp4',
            images: ['https://cdn/1.jpg', 'https://cdn/2.jpg'],
            statistics: {},
            duration: 30,
          },
        },
      }),
    }
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'douyin', url: 'https://v.douyin.com/xyz/' }], { skipDedup: true, sender })
    expect(sent.length).toBeGreaterThan(0)
    const flat = sent.flat()
    expect(flat.filter(e => e.type === 'image').length).toBe(2)
    expect(flat.filter(e => e.type === 'video').length).toBe(1)
    expect(flat.some(e => e.type === 'text')).toBe(true)
  })

  it('flush：动图无 transcode 时直发视频（不崩）', async () => {
    const sent: OutboundElement[][] = []
    const sender: OutboundSender = {
      send: async (_s, elements) => { sent.push(elements); return true },
      sendForward: async (_s, bubbles) => { sent.push(bubbles.flatMap(b => b.content)); return true },
    }
    const rt = coreCreateRuntime({ sender }, makeConfig({ gifConvertEnabled: true }), { defs: [], extensions: [] })
    ;(rt as any).http = {
      get: async () => ({
        data: {
          code: 200,
          data: {
            type: 'video', title: 'G', desc: '', author: { name: 'A' },
            url: 'https://cdn/g.mp4', images: [], statistics: {}, duration: 8,
            is_gif: true,
          },
        },
      }),
    }
    const session = mockSession()
    await flush(rt, session as any, [{ type: 'douyin', url: 'https://v.douyin.com/gif1/' }], { skipDedup: true, sender })
    const flat = sent.flat()
    expect(flat.filter(e => e.type === 'video').length).toBe(1)
  })
})

describe('updateFragments 范围内更新判定', () => {
  it('inRange：0.x caret 钉死 minor（0.x minor 锁）', () => {
    expect(inRange('0.6.0-alpha.2', '^0.6.0-alpha.1')).toBe(true)
    expect(inRange('0.6.1', '^0.6.0-alpha.1')).toBe(true)
    expect(inRange('0.7.0-alpha.1', '^0.6.0-alpha.1')).toBe(false)
    expect(inRange('0.5.9', '^0.6.0-alpha.1')).toBe(false)
    expect(inRange('1.2.3', '^1.0.0')).toBe(true)
    expect(inRange('2.0.0', '^1.0.0')).toBe(false)
    expect(inRange('1.2.3', '')).toBe(true)
    expect(inRange('1.2.3', '1.2.3')).toBe(true)
    expect(inRange('1.2.4', '1.2.3')).toBe(false)
    expect(inRange('1.2.9', '~1.2.3')).toBe(true)
    expect(inRange('1.3.0', '~1.2.3')).toBe(false)
  })
  it('inRange：prerelease 仅同 [major,minor,patch] 且 range 带 prerelease 才放行', () => {
    expect(inRange('0.6.0-alpha.2', '^0.6.0-alpha.1')).toBe(true)
    expect(inRange('0.6.1-alpha.1', '^0.6.0-alpha.1')).toBe(false)
    expect(inRange('0.6.0', '^0.6.0-alpha.1')).toBe(true)
  })
  it('listFragments 分类：in-range / out-of-range / none', async () => {
    const fetchPackumentImpl = async (pkg: string) => {
      if (pkg === '@sns-parse/core') return { latest: '0.6.0-alpha.2', versions: ['0.5.0-alpha.1', '0.6.0-alpha.1', '0.6.0-alpha.2'] }
      return { latest: '9.9.9', versions: ['0.3.0-alpha.1', '9.9.9'] }
    }
    const rows = await listFragments({ registry: 'https://example.invalid', names: ['@sns-parse/core', '@sns-parse/ext-gif'], fetchPackumentImpl })
    const core = rows.find(r => r.name === '@sns-parse/core')!
    const gif = rows.find(r => r.name === '@sns-parse/ext-gif')!
    expect(core.updateKind).toBe('in-range')
    expect(core.target).toBe('0.6.0-alpha.2')
    expect(gif.updateKind).toBe('out-of-range')
  })
  it('FRAGMENT_PACKAGES 覆盖 core/平台/扩展/聚合', () => {
    expect(FRAGMENT_PACKAGES).toContain('@sns-parse/core')
    expect(FRAGMENT_PACKAGES).toContain('@sns-parse/platform-twitter')
    expect(FRAGMENT_PACKAGES).toContain('@sns-parse/ext-nsfw')
    expect(FRAGMENT_PACKAGES).toContain('@sns-parse/platforms')
    expect(FRAGMENT_PACKAGES.length).toBe(34)
  })
})
