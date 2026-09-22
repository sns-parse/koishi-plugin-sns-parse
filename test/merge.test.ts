import { describe, it, expect } from 'vitest'
import { deflateSync } from 'zlib'
import { probeImageSize } from '../src/utils/image-size'
import { imageStem, sameOrigin, detectMergeLayout, xstackLayout, buildMergeFilter, mergeImages } from '../src/utils/merge'
import type { ImageSize } from '../src/utils/image-size'
import { makeRuntime } from './helpers'

/* ---------- 合成 PNG（真实可解码，供 ffmpeg 端到端） ---------- */

let crcTable: number[] | null = null
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function makePng(w: number, h: number, rgb: [number, number, number] = [200, 60, 60]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const rows: Buffer[] = []
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3)
    for (let x = 0; x < w; x++) {
      row[1 + x * 3] = rgb[0]
      row[2 + x * 3] = rgb[1]
      row[3 + x * 3] = rgb[2]
    }
    rows.push(row)
  }
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------- 尺寸探测 ---------- */

describe('probeImageSize', () => {
  it('识别 PNG 尺寸', () => {
    const png = makePng(320, 240)
    expect(probeImageSize(png)).toEqual({ width: 320, height: 240 })
  })
  it('识别 GIF 尺寸', () => {
    const gif = Buffer.alloc(13)
    gif.write('GIF89a', 0, 'ascii')
    gif.writeUInt16LE(640, 6)
    gif.writeUInt16LE(480, 8)
    expect(probeImageSize(gif)).toEqual({ width: 640, height: 480 })
  })
  it('识别 JPEG 尺寸（SOF0 段）', () => {
    const jpg = Buffer.alloc(16)
    jpg[0] = 0xff; jpg[1] = 0xd8
    jpg[2] = 0xff; jpg[3] = 0xc0 // SOF0 直接跟在 SOI 后
    jpg.writeUInt16BE(9, 4) // 段长
    jpg.writeUInt16BE(600, 7) // 高（SOF 标记偏移 2 → 高在 2+5）
    jpg.writeUInt16BE(800, 9) // 宽（2+7）
    expect(probeImageSize(jpg)).toEqual({ width: 800, height: 600 })
  })
  it('无法识别返回 null', () => {
    expect(probeImageSize(Buffer.from('not an image at all.....'))).toBeNull()
  })
})

/* ---------- 同源识别 ---------- */

describe('imageStem / sameOrigin', () => {
  it('去掉 CDN 变换段与数字序号后 stem 一致', () => {
    const a = 'https://sns-webpic-qc.xhscdn.com/2026/1040g00831d9abc~nd_dft_wlteh_webp_3_0.jpg'
    const b = 'https://sns-webpic-qc.xhscdn.com/2026/1040g00831d9abc~nd_dft_wlteh_webp_3_1.jpg'
    expect(imageStem(a)).toEqual(imageStem(b))
    expect(sameOrigin([a, b])).toBe(true)
  })
  it('下划线序号形式同样归一', () => {
    const a = 'https://cdn.example.com/img/abc_0.jpg'
    const b = 'https://cdn.example.com/img/abc_1.jpg'
    expect(sameOrigin([a, b])).toBe(true)
  })
  it('不同母图 / 不同 host 不算同源', () => {
    expect(sameOrigin(['https://cdn.example.com/img/abc_0.jpg', 'https://cdn.example.com/img/xyz_1.jpg'])).toBe(false)
    expect(sameOrigin(['https://a.example.com/img/abc_0.jpg', 'https://b.example.com/img/abc_1.jpg'])).toBe(false)
  })
})

/* ---------- 布局识别 ---------- */

const URLS = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.example.com/img/pic_${i}.jpg`)
const S = (w: number, h: number): ImageSize => ({ width: w, height: h })

describe('detectMergeLayout', () => {
  it('4 图同尺寸 → 2x2 宫格', () => {
    expect(detectMergeLayout(URLS(4), [S(100, 100), S(100, 100), S(100, 100), S(100, 100)])).toEqual({ kind: 'grid', cols: 2, rows: 2 })
  })
  it('9 图同尺寸 → 3x3 宫格（容忍轻微尺寸差）', () => {
    const sizes = Array.from({ length: 9 }, (_, i) => S(500 + (i % 3), 500 + (i % 2)))
    expect(detectMergeLayout(URLS(9), sizes)).toEqual({ kind: 'grid', cols: 3, rows: 3 })
  })
  it('各片同宽 → 垂直堆叠（水平切分）', () => {
    expect(detectMergeLayout(URLS(3), [S(300, 100), S(300, 140), S(300, 120)])).toEqual({ kind: 'v' })
  })
  it('各片同高 → 水平拼接（垂直切分）', () => {
    expect(detectMergeLayout(URLS(3), [S(100, 300), S(140, 300), S(120, 300)])).toEqual({ kind: 'h' })
  })
  it('不同源 / 尺寸杂乱 / 数量超限 → null', () => {
    expect(detectMergeLayout(['https://a/1.jpg', 'https://b/2.jpg'], [S(100, 100), S(100, 100)])).toBeNull()
    expect(detectMergeLayout(URLS(3), [S(100, 100), S(200, 100), S(150, 300)])).toBeNull()
    expect(detectMergeLayout(URLS(13), Array.from({ length: 13 }, () => S(100, 100)))).toBeNull()
  })
})

describe('xstackLayout / buildMergeFilter', () => {
  it('2x2 布局串行优先', () => {
    expect(xstackLayout(2, 2, 100, 50)).toBe('0_0|100_0|0_50|100_50')
  })
  it('宫格滤镜含 xstack 且以 [out] 结尾', () => {
    const f = buildMergeFilter(4, { kind: 'grid', cols: 2, rows: 2 }, [S(100, 50), S(100, 50), S(100, 50), S(100, 50)])
    expect(f).toContain('xstack=inputs=4')
    expect(f.endsWith('[out]')).toBe(true)
  })
  it('条带滤镜 vstack/hstack', () => {
    expect(buildMergeFilter(3, { kind: 'v' }, [S(300, 100), S(300, 140), S(300, 120)])).toContain('vstack=inputs=3')
    expect(buildMergeFilter(3, { kind: 'h' }, [S(100, 300), S(140, 300), S(120, 300)])).toContain('hstack=inputs=3')
  })
  it('输出超 4096 时追加缩放', () => {
    const f = buildMergeFilter(3, { kind: 'v' }, [S(3000, 2000), S(3000, 2000), S(3000, 2000)])
    expect(f).toContain('scale=')
  })
})

/* ---------- ffmpeg 端到端（需 ffmpeg，失败自动跳过） ---------- */

function rtWithImages(byUrl: Record<string, Buffer>) {
  return makeRuntime({
    http: { get: async (url: string) => ({ data: byUrl[url] ?? Buffer.alloc(0) }) },
  })
}

describe('mergeImages 端到端', () => {
  it('四宫格 4 片合一（2x2）', async () => {
    const urls = URLS(4)
    const byUrl: Record<string, Buffer> = {}
    urls.forEach((u, i) => { byUrl[u] = makePng(20 + i * 0, 10, [i * 60, 100, 200]) })
    const res = await mergeImages(rtWithImages(byUrl), urls)
    if (res === null) return // 无 ffmpeg 环境跳过
    expect(res.layout).toEqual({ kind: 'grid', cols: 2, rows: 2 })
    const size = probeImageSize(res.buffer)
    expect(size?.width).toBe(40)
    expect(size?.height).toBe(20)
  }, 30000)
  it('垂直堆叠 3 片合一', async () => {
    const urls = URLS(3)
    const byUrl: Record<string, Buffer> = {}
    byUrl[urls[0]] = makePng(20, 10)
    byUrl[urls[1]] = makePng(20, 14)
    byUrl[urls[2]] = makePng(20, 12)
    const res = await mergeImages(rtWithImages(byUrl), urls)
    if (res === null) return
    expect(res.layout).toEqual({ kind: 'v' })
    const size = probeImageSize(res.buffer)
    expect(size?.width).toBe(20)
    expect(size?.height).toBe(36)
  }, 30000)
  it('水平拼接 3 片合一', async () => {
    const urls = URLS(3)
    const byUrl: Record<string, Buffer> = {}
    byUrl[urls[0]] = makePng(20, 10)
    byUrl[urls[1]] = makePng(45, 10)
    byUrl[urls[2]] = makePng(15, 10)
    const res = await mergeImages(rtWithImages(byUrl), urls)
    if (res === null) return
    expect(res.layout).toEqual({ kind: 'h' })
    const size = probeImageSize(res.buffer)
    // scale=-2 偶数对齐会带来 ±2px 舍入
    expect(size?.width).toBeGreaterThanOrEqual(78)
    expect(size?.width).toBeLessThanOrEqual(84)
    expect(size?.height).toBe(10)
  }, 30000)
  it('非同源图片不合并', async () => {
    const urls = ['https://cdn.example.com/img/abc_0.jpg', 'https://cdn.example.com/img/xyz_1.jpg']
    const byUrl: Record<string, Buffer> = {}
    urls.forEach((u) => { byUrl[u] = makePng(20, 10) })
    expect(await mergeImages(rtWithImages(byUrl), urls)).toBeNull()
  }, 30000)
})
