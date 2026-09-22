/**
 * 同源切图识别与合并（纯内容识别，不依赖 URL/文件名等外部信息）：
 * - 候选布局：n∈{4,9,16} 且各片等尺寸 → n×n 宫格；各片同宽 → 垂直堆叠；各片同高 → 水平拼接
 * - 内容验证：ffmpeg 解码为 256 宽灰度图，比较接缝两侧边界行/列的平均绝对差（MAD），
 *   与图片内部相邻行/列的自然差异比较——母图切片在接缝处连续（比值≈1），无关图片差异显著（比值≫1）
 * - 合并：宫格 xstack / 垂直 vstack / 水平 hstack
 *
 * 识别/解码/ffmpeg 任一环节失败均返回 null，调用方回退逐张发送。
 */
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ParserRuntime } from '../runtime'
import { probeImageSize, type ImageSize } from './image-size'
import { resolveFfmpeg } from './gif'
import { debugLog, logger } from './logger'

export type MergeLayout =
  | { kind: 'grid'; cols: number; rows: number }
  | { kind: 'v' }
  | { kind: 'h' }

const MAX_PIECES = 12
/** 同一母图切出的分片尺寸精确相等，仅留极小容差防探测/编解码舍入 */
const DIM_TOLERANCE = 2
const MAX_OUTPUT_SIDE = 4096
const MAX_TOTAL_BYTES = 150 * 1048576
/** 灰度归一化宽度（边界行/列向量长度基准） */
const GRAY_W = 256
/** 列向量统一重采样长度 */
const COL_LEN = 64
/** 接缝差异 / 内部自然差异 的判定阈值（母图切片 ≈1，无关图片 ≫1；下限 3 防平坦图除零） */
const BOUNDARY_THRESH = 3.0
const MAD_FLOOR = 3.0
/** 边界带纹理能量下限：低于此值视为「不可验证接缝」（相似背景/平边照片会骗过亮度对比） */
const TEXTURE_MIN = 4.0
/** 色调风格一致性阈值：64bin RGB 直方图逐对交的下限（标定：同组壁纸 min 0.41，无关图交叉 max 0.21） */
const STYLE_THRESH = 0.35

/* ---------- 尺寸候选 ---------- */

function dimsEqual(a: ImageSize, b: ImageSize, tol: number): boolean {
  return Math.abs(a.width - b.width) <= tol && Math.abs(a.height - b.height) <= tol
}

/** 仅凭数量与尺寸给出全部可行布局（内容验证前） */
export function candidateLayouts(n: number, sizes: ImageSize[]): MergeLayout[] {
  if (n < 2 || n > MAX_PIECES) return []
  if (sizes.some((s) => !s || s.width < 8 || s.height < 8)) return []
  const out: MergeLayout[] = []
  const sqrt = Math.sqrt(n)
  if (Number.isInteger(sqrt) && sizes.every((s) => dimsEqual(s, sizes[0], DIM_TOLERANCE))) {
    out.push({ kind: 'grid', cols: sqrt, rows: sqrt })
  }
  if (sizes.every((s) => Math.abs(s.width - sizes[0].width) <= DIM_TOLERANCE)) out.push({ kind: 'v' })
  if (sizes.every((s) => Math.abs(s.height - sizes[0].height) <= DIM_TOLERANCE)) out.push({ kind: 'h' })
  return out
}

/* ---------- 灰度边界向量 ---------- */

/** 解码为固定宽度灰度原始流（buf = rows × GRAY_W 字节） */
function toGray(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `scale=${GRAY_W}:-2:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1',
    ])
    const chunks: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.stderr.on('data', (d: Buffer) => reject(new Error(d.toString().slice(0, 120))))
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      const buf = Buffer.concat(chunks)
      if (code === 0 && buf.length >= GRAY_W * 2) resolve(buf)
      else reject(new Error(`gray decode exit ${code}`))
    })
  })
}

function grayRows(g: Buffer): number {
  return Math.floor(g.length / GRAY_W)
}

/** 取一行（256 长） */
function rowOf(g: Buffer, r: number): Float32Array {
  const rows = grayRows(g)
  const rr = Math.min(Math.max(r, 0), rows - 1)
  const out = new Float32Array(GRAY_W)
  for (let x = 0; x < GRAY_W; x++) out[x] = g[rr * GRAY_W + x]
  return out
}

/** 取一列（重采样到 COL_LEN，适配各片灰度高度不一） */
function colOf(g: Buffer, c: number): Float32Array {
  const rows = grayRows(g)
  const cc = Math.min(Math.max(c, 0), GRAY_W - 1)
  const out = new Float32Array(COL_LEN)
  for (let i = 0; i < COL_LEN; i++) {
    const y = Math.min(rows - 1, Math.round((i / (COL_LEN - 1)) * (rows - 1)))
    out[i] = g[y * GRAY_W + cc]
  }
  return out
}

function mad(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/** 滑动平均（提取平滑趋势） */
function smooth(v: Float32Array): Float32Array {
  const win = Math.max(3, Math.floor(v.length / 16) | 1)
  const out = new Float32Array(v.length)
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    sum += v[i]
    if (i >= win) sum -= v[i - win]
    out[i] = sum / Math.min(i + 1, win)
  }
  return out
}

/** 去趋势残差（高频纹理成分） */
function residual(v: Float32Array): Float32Array {
  const s = smooth(v)
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] - s[i]
  return out
}

function std(v: Float32Array): number {
  let mean = 0
  for (let i = 0; i < v.length; i++) mean += v[i]
  mean /= v.length
  let acc = 0
  for (let i = 0; i < v.length; i++) acc += (v[i] - mean) ** 2
  return Math.sqrt(acc / v.length)
}

export interface SeamVerdict {
  /** false = 接缝不可验证（边界带平坦，无纹理可判）或不连续 */
  ok: boolean
  score: number
}

/**
 * 单条接缝裁决：趋势延续（亮度）+ 纹理延续（去趋势残差）双重要求。
 * 基线 = 各自片内相邻行/列对的平均差异（不可跨片比较，否则无关片间差异会稀释接缝信号）。
 * 任一侧边界带纹理能量不足（TEXTURE_MIN）→ 不可验证 → 拒绝：
 * 相似背景/暗角的无关照片能骗过亮度对比，但平坦边缘本就无法证明连续。
 */
function judgeSeam(edgeA: Float32Array, edgeB: Float32Array, innerPairs: () => [Float32Array, Float32Array][]): SeamVerdict {
  const resA = residual(edgeA)
  const resB = residual(edgeB)
  const texture = Math.max(std(resA), std(resB))
  if (texture < TEXTURE_MIN) return { ok: false, score: Infinity }
  const pairs = innerPairs()
  // 纹理延续：接缝两侧残差应接近（母图切片的纹理跨缝延续）
  const innerRes = pairs.map(([p, q]) => mad(residual(p), residual(q)))
  const resRef = Math.max(innerRes.reduce((t, s) => t + s, 0) / innerRes.length, MAD_FLOOR)
  const resScore = mad(resA, resB) / resRef
  if (resScore >= BOUNDARY_THRESH) return { ok: false, score: resScore }
  // 趋势延续：边界亮度差与片内自然差异同量级
  const innerTrend = pairs.map(([p, q]) => mad(p, q))
  const trendRef = Math.max(innerTrend.reduce((t, s) => t + s, 0) / innerTrend.length, MAD_FLOOR)
  const score = mad(edgeA, edgeB) / trendRef
  return { ok: score < BOUNDARY_THRESH, score: Math.max(score, resScore) }
}

/** 垂直接缝：A 末行 vs B 首行（基线取各自片内相邻行对） */
function seamVerdictV(a: Buffer, b: Buffer): SeamVerdict {
  const r = grayRows(a)
  return judgeSeam(
    rowOf(a, r - 1),
    rowOf(b, 0),
    () => [
      [rowOf(a, r - 2), rowOf(a, r - 1)],
      [rowOf(a, r - 3), rowOf(a, r - 2)],
      [rowOf(b, 1), rowOf(b, 0)],
      [rowOf(b, 2), rowOf(b, 1)],
    ],
  )
}

/** 水平接缝：A 末列 vs B 首列（基线取各自片内相邻列对） */
function seamVerdictH(a: Buffer, b: Buffer): SeamVerdict {
  return judgeSeam(
    colOf(a, GRAY_W - 1),
    colOf(b, 0),
    () => [
      [colOf(a, GRAY_W - 2), colOf(a, GRAY_W - 1)],
      [colOf(a, GRAY_W - 3), colOf(a, GRAY_W - 2)],
      [colOf(b, 1), colOf(b, 0)],
      [colOf(b, 2), colOf(b, 1)],
    ],
  )
}

/** 内容验证：所有接缝（趋势+纹理）均通过才成立；返回最大接缝比值（越小越像母图切片） */
export function verifyLayout(layout: MergeLayout, grays: Buffer[]): { pass: boolean; score: number } {
  const verdicts: SeamVerdict[] = []
  const n = grays.length
  if (layout.kind === 'v') {
    for (let i = 0; i + 1 < n; i++) verdicts.push(seamVerdictV(grays[i], grays[i + 1]))
  } else if (layout.kind === 'h') {
    for (let i = 0; i + 1 < n; i++) verdicts.push(seamVerdictH(grays[i], grays[i + 1]))
  } else {
    const { cols } = layout
    for (let i = 0; i < n; i++) {
      if (i % cols < cols - 1 && i + 1 < n) verdicts.push(seamVerdictH(grays[i], grays[i + 1]))
      if (i + cols < n) verdicts.push(seamVerdictV(grays[i], grays[i + cols]))
    }
  }
  if (!verdicts.length) return { pass: false, score: Infinity }
  const worst = Math.max(...verdicts.map((v) => v.score))
  return { pass: verdicts.every((v) => v.ok), score: worst }
}

/** 内容识别：候选布局逐一经接缝连续性验证，取通过者中比值最小的一个 */
export function detectMergeLayout(sizes: ImageSize[], grays: Buffer[]): MergeLayout | null {
  const candidates = candidateLayouts(sizes.length, sizes)
  let best: MergeLayout | null = null
  let bestScore = Infinity
  for (const c of candidates) {
    const { pass, score } = verifyLayout(c, grays)
    if (pass && score < bestScore) { best = c; bestScore = score }
  }
  return best
}

/* ---------- 色调风格特征（宫格数同源判定） ---------- */

export interface ColorFeatures {
  hist: Float32Array
  lumMean: number
  lumStd: number
}

/** 解码为 64 宽 RGB 缩略图（buf = rows × 64 × 3 字节） */
function toColorThumb(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', 'scale=64:-2:flags=area,format=rgb24', '-f', 'rawvideo', 'pipe:1',
    ])
    const chunks: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      const buf = Buffer.concat(chunks)
      if (code === 0 && buf.length >= 64 * 3 * 4) resolve(buf)
      else reject(new Error(`color thumb decode exit ${code}`))
    })
  })
}

/** 4x4x4 RGB 直方图（归一化）+ 亮度统计 */
export function colorFeatures(thumb: Buffer): ColorFeatures {
  const hist = new Float32Array(64)
  let lumSum = 0
  let lumSum2 = 0
  let count = 0
  for (let i = 0; i + 2 < thumb.length; i += 3) {
    const r = thumb[i]
    const g = thumb[i + 1]
    const b = thumb[i + 2]
    hist[(r >> 6) * 16 + (g >> 6) * 4 + (b >> 6)]++
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    lumSum += lum
    lumSum2 += lum * lum
    count++
  }
  if (!count) return { hist, lumMean: 0, lumStd: 0 }
  for (let i = 0; i < 64; i++) hist[i] /= count
  const mean = lumSum / count
  return { hist, lumMean: mean, lumStd: Math.sqrt(Math.max(0, lumSum2 / count - mean * mean)) }
}

/** 直方图交（∈[0,1]，越大越相似） */
export function histIntersection(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i])
  return s
}

/** 色调风格一致性：逐对直方图交全部不低于阈值（同一组图共享色调分布；无关场景差异显著） */
export function styleCoherent(feats: ColorFeatures[]): boolean {
  if (feats.length < 2) return false
  for (let i = 0; i < feats.length; i++) {
    for (let j = i + 1; j < feats.length; j++) {
      if (histIntersection(feats[i].hist, feats[j].hist) < STYLE_THRESH) return false
    }
  }
  return true
}

/* ---------- ffmpeg 合并 ---------- */

/** xstack 均匀网格布局串（各片已统一缩放为 w×h，行优先） */
export function xstackLayout(cols: number, rows: number, w: number, h: number): string {
  const parts: string[] = []
  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) * w
    const y = Math.floor(i / cols) * h
    parts.push(`${x}_${y}`)
  }
  return parts.join('|')
}

/** 生成 ffmpeg filter_complex（输出标签恒为 [out]，导出供测试） */
export function buildMergeFilter(n: number, layout: MergeLayout, sizes: ImageSize[]): string {
  const chains: string[] = []
  const stacks: string[] = []
  const chainOf = (stack: string, outW: number, outH: number): string => {
    if (outW > MAX_OUTPUT_SIDE || outH > MAX_OUTPUT_SIDE) {
      const scale = Math.min(1, MAX_OUTPUT_SIDE / Math.max(outW, outH))
      return `${stack}[tmp];[tmp]scale=${Math.round(outW * scale) / 2 * 2}:${Math.round(outH * scale) / 2 * 2}:flags=lanczos[out]`
    }
    return `${stack}[out]`
  }
  if (layout.kind === 'grid') {
    // 宫格拼图：各片等比缩放进统一格子（不足处黑边补齐——切片场景无补边，杂图集保持各自比例），
    // 逐片 concat 成帧序列后 tile 出宫格（支持非满宫格，如 7 图 3x3）
    const cellW = Math.min(Math.max(...sizes.map((s) => s.width)), 1920)
    const cellH = Math.min(Math.max(...sizes.map((s) => s.height)), 1920)
    const cw = Math.ceil(cellW / 2) * 2
    const ch = Math.ceil(cellH / 2) * 2
    for (let i = 0; i < n; i++) {
      chains.push(`[${i}:v]scale=${cw}:${ch}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${cw}:${ch}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[c${i}]`)
      stacks.push(`[c${i}]`)
    }
    chains.push(`${stacks.join('')}concat=n=${n}:v=1:a=0[frames]`)
    chains.push(chainOf(`[frames]tile=${layout.cols}x${layout.rows}`, layout.cols * cw, layout.rows * ch))
  } else if (layout.kind === 'v') {
    const w = Math.max(...sizes.map((s) => s.width))
    for (let i = 0; i < n; i++) chains.push(`[${i}:v]scale=${w}:-2:flags=lanczos[s${i}]`)
    for (let i = 0; i < n; i++) stacks.push(`[s${i}]`)
    chains.push(chainOf(`${stacks.join('')}vstack=inputs=${n}`, w, sizes.reduce((t, s) => t + s.height, 0)))
  } else {
    const h = Math.max(...sizes.map((s) => s.height))
    for (let i = 0; i < n; i++) chains.push(`[${i}:v]scale=-2:${h}:flags=lanczos[s${i}]`)
    for (let i = 0; i < n; i++) stacks.push(`[s${i}]`)
    chains.push(chainOf(`${stacks.join('')}hstack=inputs=${n}`, sizes.reduce((t, s) => t + s.width, 0), h))
  }
  return chains.join(';')
}

/** 按魔数给临时文件配扩展名（ffmpeg 也可自行探测，显式更稳） */
function extOf(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  if (buf.toString('ascii', 0, 4) === 'RIFF') return 'webp'
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif'
  return 'bin'
}

const MERGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function downloadImage(rt: ParserRuntime, url: string): Promise<Buffer> {
  const headers: Record<string, string> = { 'User-Agent': MERGE_UA }
  headers['Referer'] = /twimg\.com/.test(url) ? 'https://twitter.com/' : 'https://www.baidu.com/'
  return rt.http.get(url, { responseType: 'arraybuffer', timeout: 30000, headers })
    .then((res: any) => Buffer.from(res.data))
}

/**
 * 下载 → 灰度解码 → 内容识别接缝 → 合并。
 * 不构成母图切片（接缝不连续）或任一环节失败 → null。
 */
export async function mergeImages(rt: ParserRuntime, urls: string[]): Promise<{ buffer: Buffer; layout: MergeLayout } | null> {
  if (urls.length < 2 || urls.length > MAX_PIECES) return null
  let buffers: Buffer[]
  try {
    buffers = await Promise.all(urls.map((u) => downloadImage(rt, u)))
  } catch (e: any) {
    debugLog(`切图合并跳过（分片下载失败）：${e?.message || e}`)
    return null
  }
  const total = buffers.reduce((t, b) => t + b.length, 0)
  if (total > MAX_TOTAL_BYTES || buffers.some((b) => !b.length)) return null

  const sizes = buffers.map((b) => probeImageSize(b))
  if (sizes.some((s) => !s)) return null

  const dir = await mkdtemp(join(tmpdir(), `vpa-merge-${randomBytes(4).toString('hex')}-`))
  try {
    const files: string[] = []
    for (let i = 0; i < buffers.length; i++) {
      const f = join(dir, `${i}.${extOf(buffers[i])}`)
      await writeFile(f, buffers[i])
      files.push(f)
    }
    // 布局选择（全部由内容决定，不依赖链接/文件名）：
    // ① 宫格数（4/9/16）→ 色调风格一致性判定同源（同组图共享色调分布），过阈值拼 √n 宫格
    // ② 非宫格数 → 接缝连续性验证（趋势+纹理双通道），命中按长图条带堆叠/拼接
    // 任一判定不过 → 不合并，逐张发送
    const n = files.length
    let layout: MergeLayout | null = null
    if (Number.isInteger(Math.sqrt(n))) {
      try {
        const thumbs = await Promise.all(files.map(toColorThumb))
        if (styleCoherent(thumbs.map(colorFeatures))) {
          layout = { kind: 'grid', cols: Math.sqrt(n), rows: Math.sqrt(n) }
        } else {
          debugLog(`宫格合并跳过（色调风格不一致：非同源图组）`)
        }
      } catch (e: any) {
        debugLog(`宫格合并跳过（缩略图解码失败）：${e?.message || e}`)
      }
    } else {
      let grays: Buffer[]
      try {
        grays = await Promise.all(files.map(toGray))
      } catch (e: any) {
        debugLog(`切图合并跳过（灰度解码失败）：${e?.message || e}`)
        return null
      }
      layout = detectMergeLayout(sizes as ImageSize[], grays)
      if (!layout) debugLog(`切图合并跳过（内容验证未通过：接缝不连续，非同源切片）`)
    }
    if (!layout) return null

    const filter = buildMergeFilter(files.length, layout, sizes as ImageSize[])
    const args = ['-hide_banner', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]),
      '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-q:v', '2',
      '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']
    const out = await new Promise<Buffer | null>((resolve) => {
      const child = spawn(resolveFfmpeg(), args)
      const chunks: Buffer[] = []
      child.stdout.on('data', (d: Buffer) => chunks.push(d))
      child.stderr.on('data', () => {})
      child.on('error', () => resolve(null))
      child.on('close', (code) => resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null))
    })
    if (!out) {
      debugLog(`切图合并失败（ffmpeg 退出非 0），回退逐张发送`)
      return null
    }
    const desc = layout.kind === 'grid' ? `${layout.cols}x${layout.rows} 宫格` : layout.kind === 'v' ? '垂直堆叠' : '水平拼接'
    logger.info(`同源切图已合并为一张（内容识别：${urls.length} 张 → ${desc}，${Math.round(out.length / 1024)}KB）`)
    return { buffer: out, layout }
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
