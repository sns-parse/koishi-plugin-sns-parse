import { describe, it, expect } from 'vitest'
import { deflateSync } from 'zlib'
import { probeImageSize } from '../src/utils/image-size'
import { candidateLayouts, verifyLayout, detectMergeLayout, xstackLayout, buildMergeFilter, mergeImages } from '../src/utils/merge'
import type { ImageSize } from '../src/utils/image-size'
import type { MergeLayout } from '../src/utils/merge'
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
  return makePngPattern(w, h, () => rgb)
}

/** 按全局坐标取色的母图模式生成 PNG（切片 = 限定子矩形，天然保证接缝连续） */
export function makePngPattern(w: number, h: number, p: (x: number, y: number) => [number, number, number], ox = 0, oy = 0): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const rows: Buffer[] = []
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = p(ox + x, oy + y)
      row[1 + x * 3] = r & 0xff
      row[2 + x * 3] = g & 0xff
      row[3 + x * 3] = b & 0xff
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

/** 平滑母图模式 + 跨缝延续的高频纹理（内容验证需要纹理能量，纯渐变视为不可验证）；
 *  趋势用有界 sin（永不回绕），纹理用全局坐标哈希 */
const MOTHER = (x: number, y: number): [number, number, number] => {
  const h = (x * 7 + y * 13) % 17
  return [
    20 + Math.round(70 * (1 + Math.sin(x / 9 + y / 7)) / 2) + h * 2,
    20 + Math.round(70 * (1 + Math.sin(x / 5 - y / 9)) / 2) + h * 3,
    20 + Math.round(70 * (1 + Math.sin(y / 4 + x / 11)) / 2) + h,
  ]
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

/* ---------- 布局候选（纯尺寸） ---------- */

const S = (w: number, h: number): ImageSize => ({ width: w, height: h })

describe('candidateLayouts', () => {
  it('4 图同尺寸 → 宫格与堆叠双候选（由内容验证裁决）', () => {
    expect(candidateLayouts(4, [S(100, 100), S(100, 100), S(100, 100), S(100, 100)])).toEqual([
      { kind: 'grid', cols: 2, rows: 2 }, { kind: 'v' }, { kind: 'h' },
    ])
  })
  it('同宽不同高 → 仅垂直堆叠候选', () => {
    expect(candidateLayouts(3, [S(300, 100), S(300, 140), S(300, 120)])).toEqual([{ kind: 'v' }])
  })
  it('同高不同宽 → 仅水平拼接候选', () => {
    expect(candidateLayouts(3, [S(100, 300), S(140, 300), S(120, 300)])).toEqual([{ kind: 'h' }])
  })
  it('尺寸杂乱 / 数量超限 → 无候选', () => {
    expect(candidateLayouts(3, [S(100, 100), S(200, 100), S(150, 300)])).toEqual([])
    expect(candidateLayouts(13, Array.from({ length: 13 }, () => S(100, 100)))).toEqual([])
  })
})

/* ---------- 内容验证（合成灰度图） ---------- */

function grayBuf(rows: number, fn: (x: number, y: number) => number): Buffer {
  const b = Buffer.alloc(256 * rows)
  for (let y = 0; y < rows; y++) for (let x = 0; x < 256; x++) b[y * 256 + x] = fn(x, y) & 0xff
  return b
}

describe('verifyLayout / detectMergeLayout（内容识别）', () => {
  /** 全局坐标的 sin 趋势 + 哈希纹理（有界无回绕）；base 控制亮度基线 */
  const pat = (off: number, phase: number, hx: number, hy: number, base = 60) => (x: number, y: number) =>
    base + Math.round(50 * (1 + Math.sin((x + 3 * (off + y)) / 11 + phase)) / 2) + ((x * hx + (off + y) * hy) % 23)
  it('纹理跨缝延续的切片通过，无关图片被拒', () => {
    // 母图 y 全程连续：piece i 覆盖 y ∈ [i*40, i*40+40)，趋势与纹理均为全局坐标函数
    const cont = [0, 1, 2].map((i) => grayBuf(40, pat(i * 40, 0, 5, 7)))
    const v: MergeLayout = { kind: 'v' }
    expect(verifyLayout(v, cont).pass).toBe(true)
    // 无关图片：亮度分布/趋势相位/纹理函数均不同（真实无关照片的典型差异）→ 接缝不连续
    const alien = [0, 1, 2].map((i) => grayBuf(40, pat(i * 40, (i + 1) * Math.PI / 3, 3 + i * 2, 5 + i * 4, 20 + i * 55)))
    expect(verifyLayout(v, alien).pass).toBe(false)
  })
  it('纯渐变（无纹理）接缝不可验证 → 拒绝', () => {
    const ramp = [0, 1, 2].map((i) => grayBuf(40, (x, y) => 40 + Math.round(x * 0.5 + (i * 40 + y) * 0.3)))
    expect(verifyLayout({ kind: 'v' }, ramp).pass).toBe(false)
  })
  it('detectMergeLayout 在多候选中选出接缝最优布局', () => {
    // 构造只可能纵向连续的 4 图（同宽、高各不同 → 只有 v 候选）
    const sizes = [S(300, 100), S(300, 140), S(300, 120), S(300, 90)]
    const rowsPer = [40, 48, 56, 64]
    const offsets = [0, 40, 88, 144] // 累计偏移与各片行数严格对齐，接缝天然连续
    const grays = rowsPer.map((rows, i) => grayBuf(rows, pat(offsets[i], 0, 5, 7)))
    expect(detectMergeLayout(sizes, grays)).toEqual({ kind: 'v' })
  })
})

/* ---------- ffmpeg 滤镜串 ---------- */

describe('xstackLayout / buildMergeFilter', () => {
  it('2x2 布局串行优先', () => {
    expect(xstackLayout(2, 2, 100, 50)).toBe('0_0|100_0|0_50|100_50')
  })
  it('宫格滤镜含 concat+tile 等比补边且以 [out] 结尾', () => {
    const f = buildMergeFilter(4, { kind: 'grid', cols: 2, rows: 2 }, [S(100, 50), S(100, 50), S(100, 50), S(100, 50)])
    expect(f).toContain('pad=')
    expect(f).toContain('tile=2x2')
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

describe('mergeImages 端到端（内容识别）', () => {
  // 母图切片用 ≥256px 原生宽度的分片：灰度归一化不再放大插值、纹理能量保留（真实场景图片远大于 256px）
  it('四宫格：同一母图 2x2 切片合一（URL 完全不同也能识别）', async () => {
    const urls = ['https://a.example.com/x.jpg', 'https://b.example.com/y.jpg', 'https://c.example.com/z.jpg', 'https://d.example.com/w.jpg']
    const byUrl: Record<string, Buffer> = {
      [urls[0]]: makePngPattern(256, 128, MOTHER, 0, 0),
      [urls[1]]: makePngPattern(256, 128, MOTHER, 256, 0),
      [urls[2]]: makePngPattern(256, 128, MOTHER, 0, 128),
      [urls[3]]: makePngPattern(256, 128, MOTHER, 256, 128),
    }
    const res = await mergeImages(rtWithImages(byUrl), urls)
    if (res === null) return // 无 ffmpeg 环境跳过
    expect(res.layout).toEqual({ kind: 'grid', cols: 2, rows: 2 })
    const size = probeImageSize(res.buffer)
    expect(size?.width).toBe(512)
    expect(size?.height).toBe(256)
  }, 60000)
  it('垂直堆叠：母图按高度切 3 片合一', async () => {
    const urls = [0, 1, 2].map((i) => `https://cdn.example.com/p${i}.jpg`)
    const byUrl: Record<string, Buffer> = {
      [urls[0]]: makePngPattern(256, 96, MOTHER, 0, 0),
      [urls[1]]: makePngPattern(256, 128, MOTHER, 0, 96),
      [urls[2]]: makePngPattern(256, 144, MOTHER, 0, 224),
    }
    const res = await mergeImages(rtWithImages(byUrl), urls)
    if (res === null) return
    expect(res.layout).toEqual({ kind: 'v' })
    const size = probeImageSize(res.buffer)
    expect(size?.width).toBe(256)
    expect(size?.height).toBe(368)
  }, 60000)
  it('水平拼接：母图按宽度切 3 片合一', async () => {
    const urls = [0, 1, 2].map((i) => `https://cdn.example.com/p${i}.jpg`)
    const byUrl: Record<string, Buffer> = {
      [urls[0]]: makePngPattern(256, 128, MOTHER, 0, 0),
      [urls[1]]: makePngPattern(384, 128, MOTHER, 256, 0),
      [urls[2]]: makePngPattern(160, 128, MOTHER, 640, 0),
    }
    const res = await mergeImages(rtWithImages(byUrl), urls)
    if (res === null) return
    expect(res.layout).toEqual({ kind: 'h' })
    const size = probeImageSize(res.buffer)
    expect(size?.width).toBeGreaterThanOrEqual(780)
    expect(size?.width).toBeLessThanOrEqual(820)
    expect(size?.height).toBe(128)
  }, 60000)
  it('无关图集（4 张独立纯色图）→ 内容验证不过 → 不合并', async () => {
    const urls = [0, 1, 2, 3].map((i) => `https://cdn.example.com/p${i}.jpg`)
    const byUrl: Record<string, Buffer> = {}
    // 纯色独立图片：平坦边缘不可验证 → 拒绝；不无条件拼宫格
    urls.forEach((u, i) => { byUrl[u] = makePng(20, 10, [40 + i * 60, 100, 200]) })
    expect(await mergeImages(rtWithImages(byUrl), urls)).toBeNull()
  }, 30000)
  it('3 张无关图 → 接缝与风格均不过 → 不合并', async () => {
    const urls = [0, 1, 2].map((i) => `https://cdn.example.com/p${i}.jpg`)
    const byUrl: Record<string, Buffer> = {}
    urls.forEach((u, i) => { byUrl[u] = makePng(20 + i * 10, 10, [40 + i * 60, 100, 200]) })
    expect(await mergeImages(rtWithImages(byUrl), urls)).toBeNull()
  }, 30000)
  it('同调色板非切片三图（接缝不连续）→ 不合并', async () => {
    const urls = [0, 1, 2].map((i) => `https://cdn.example.com/p${i}.jpg`)
    // 同一 MOTHER 调色板但取自相距很远的区域：色调风格一致但接缝内容不连续 → 纯内容判定拒绝
    const byUrl: Record<string, Buffer> = {
      [urls[0]]: makePngPattern(256, 128, MOTHER, 1000, 1000),
      [urls[1]]: makePngPattern(256, 128, MOTHER, 5000, 3000),
      [urls[2]]: makePngPattern(256, 128, MOTHER, 9000, 7000),
    }
    expect(await mergeImages(rtWithImages(byUrl), urls)).toBeNull()
  }, 30000)
})
