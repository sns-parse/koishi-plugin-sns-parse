/**
 * 同源切图识别与合并：
 * - 四宫格（4 图）/九宫格（9 图）/n×n 宫格：同源 + 各片尺寸一致 → xstack 网格拼接
 * - 水平切分（每片同宽）→ 垂直堆叠 vstack
 * - 垂直切分（每片同高）→ 水平拼接 hstack
 *
 * 「同源」判定：所有图片 host 一致，且文件路径 stem（去掉扩展名、CDN 变换后缀 ~…!…、
 * 尾部 _数字 序号）完全一致——同一张母图切出来的分片共享同一 stem。
 * 识别/下载/ffmpeg 任一环节失败均返回 null，调用方回退逐张发送。
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
const GRID_TOLERANCE = 2
const STRIP_TOLERANCE = 2
const MAX_OUTPUT_SIDE = 4096
const MAX_TOTAL_BYTES = 150 * 1048576

/** 归一化图片 URL：host + stem（去扩展名/CDN 变换段/尾部数字序号） */
export function imageStem(url: string): { host: string; stem: string } | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  let p = u.pathname
  const slash = p.lastIndexOf('/')
  const last = slash >= 0 ? p.slice(slash + 1) : p
  // CDN 变换段：xx.jpg~nd_dft_wlteh_webp_3_0 / xx.webp!op_type=…（取 ~ 或 ! 之前）
  const cut = last.search(/[~!]/)
  if (cut > 0) p = p.slice(0, slash + 1) + last.slice(0, cut)
  // 扩展名
  p = p.replace(/\.[a-z0-9]{2,5}$/i, '')
  // 尾部数字序号组：_3_0 / -2 等
  p = p.replace(/([_-]\d+)+$/, '')
  return { host: u.host, stem: p }
}

/** 所有 URL 是否同源（host + stem 完全一致） */
export function sameOrigin(urls: string[]): boolean {
  if (urls.length < 2) return false
  const first = imageStem(urls[0])
  if (!first) return false
  return urls.every((u) => {
    const s = imageStem(u)
    return !!s && s.host === first.host && s.stem === first.stem
  })
}

/** 尺寸近似相等 */
function dimsEqual(a: ImageSize, b: ImageSize, tol: number): boolean {
  return Math.abs(a.width - b.width) <= tol && Math.abs(a.height - b.height) <= tol
}

/**
 * 布局识别：同源前提下，
 * n∈{4,9,16} 且各片尺寸一致 → 宫格；各片同宽 → 垂直堆叠；各片同高 → 水平拼接。
 */
export function detectMergeLayout(urls: string[], sizes: ImageSize[]): MergeLayout | null {
  const n = urls.length
  if (n < 2 || n > MAX_PIECES) return null
  if (sizes.some((s) => !s || s.width < 8 || s.height < 8)) return null
  if (!sameOrigin(urls)) return null

  const sqrt = Math.sqrt(n)
  if (Number.isInteger(sqrt)) {
    const allEqual = sizes.every((s) => dimsEqual(s, sizes[0], GRID_TOLERANCE))
    if (allEqual) return { kind: 'grid', cols: sqrt, rows: sqrt }
  }
  const widthEq = sizes.every((s) => Math.abs(s.width - sizes[0].width) <= STRIP_TOLERANCE)
  if (widthEq) return { kind: 'v' }
  const heightEq = sizes.every((s) => Math.abs(s.height - sizes[0].height) <= STRIP_TOLERANCE)
  if (heightEq) return { kind: 'h' }
  return null
}

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
      return `${stack}[tmp];[tmp]scale=${Math.round(outW * scale)}:${Math.round(outH * scale)}:flags=lanczos[out]`
    }
    return `${stack}[out]`
  }
  if (layout.kind === 'grid') {
    const w = Math.max(...sizes.map((s) => s.width))
    const h = Math.max(...sizes.map((s) => s.height))
    for (let i = 0; i < n; i++) chains.push(`[${i}:v]scale=${w}:${h}:flags=lanczos[s${i}]`)
    for (let i = 0; i < n; i++) stacks.push(`[s${i}]`)
    chains.push(chainOf(`${stacks.join('')}xstack=inputs=${n}:layout=${xstackLayout(layout.cols, layout.rows, w, h)}`, layout.cols * w, layout.rows * h))
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
 * 识别并合并同源切图：成功返回 { buffer(JPEG), layout }；不构成切图或任一环节失败返回 null。
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
  const layout = detectMergeLayout(urls, sizes as ImageSize[])
  if (!layout) return null

  const dir = await mkdtemp(join(tmpdir(), `vpa-merge-${randomBytes(4).toString('hex')}-`))
  try {
    const files: string[] = []
    for (let i = 0; i < buffers.length; i++) {
      const f = join(dir, `${i}.${extOf(buffers[i])}`)
      await writeFile(f, buffers[i])
      files.push(f)
    }
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
    logger.info(`同源切图已合并为一张（${urls.length} 张 → ${desc}，${Math.round(out.length / 1024)}KB）`)
    return { buffer: out, layout }
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
