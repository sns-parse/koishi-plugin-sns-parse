#!/usr/bin/env node
import axios from 'axios'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, stat, writeFile } from 'fs/promises'
import { join, resolve, extname } from 'path'
import { linkTypeParser } from './utils/url'
import { BUILTIN_LINK_RULES } from './platforms/rules'
import { createRuntime } from './runtime'
import { getPlatformConfig } from './platforms/custom'
import { parseUrl } from './engine/fetcher'
import { generateFormattedText, formatDuration, formatPublishTime } from './utils/format'
import { setVerboseLogging, debugLog } from './utils/logger'
import { langName } from './utils/translate'
import { mergeImages, type MergeLayout } from './utils/merge'
import { shutdownTlsClient } from './utils/tls-client'
import type { Context } from 'koishi'
import type { ParsedData } from './types'

// 与 config.ts 中 globalFieldMapping 默认值一致
const DEFAULT_GLOBAL_FIELD_MAPPING = JSON.stringify({
  title: 'data.title', desc: 'data.description', author: 'data.author.name', uid: 'data.author.id',
  avatar: 'data.author.avatar', cover: 'data.cover_url', video: 'data.video_url',
  video_backup: 'data.video_qualities', videos: 'data.videos', type: 'data.type',
  like: 'data.statistics.likes', comment: 'data.statistics.comments', collect: 'data.statistics.favorites',
  share: 'data.statistics.shares', play: 'data.statistics.plays', duration: 'data.duration',
  publishTime: 'data.create_time', music_title: 'data.music.title', music_author: 'data.music.author',
  music_cover: 'data.music.cover', music_url: 'data.music.url',
})

const DEFAULT_UNIFIED_FORMAT = '标题：${标题}\n作者：${作者}\n简介：${简介}\n翻译：${翻译}\n点赞：${点赞数}\n收藏：${收藏数}\n转发：${转发数}\n播放：${播放数}\n评论：${评论数}'

interface CliArgs {
  url: string
  download: boolean
  output: string
  json: boolean
  info: boolean
  debug: boolean
  api: string | undefined
  apiKey: string | undefined
  proxy: string | undefined
  dedicatedFirst: boolean
  mergeImages: boolean
  twitterAuthToken: string | undefined
  twitterCt0: string | undefined
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    url: '', download: false, output: '.', json: false, info: false, debug: false,
    api: undefined, apiKey: undefined, proxy: undefined, dedicatedFirst: false,
    mergeImages: false, twitterAuthToken: undefined, twitterCt0: undefined,
  }
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '-d': case '--download': args.download = true; break
      case '-i': case '--info': args.info = true; break
      case '--json': args.json = true; break
      case '--debug': args.debug = true; break
      case '-o': case '--output': args.output = argv[++i]; break
      case '--api': args.api = argv[++i]; break
      case '--api-key': args.apiKey = argv[++i]; break
      case '--proxy': args.proxy = argv[++i]; break
      case '--dedicated-first': args.dedicatedFirst = true; break
      case '--merge-images': args.mergeImages = true; break
      case '--twitter-auth-token': args.twitterAuthToken = argv[++i]; break
      case '--twitter-ct0': args.twitterCt0 = argv[++i]; break
      case '-v': case '--version': printVersion(); process.exit(0)
      case '-h': case '--help': printHelp(); process.exit(0)
      default:
        if (a.startsWith('-')) { console.error(`未知选项: ${a}`); process.exit(1) }
        positional.push(a)
    }
  }
  args.url = positional[0] || ''
  return args
}

function printVersion(): void {
  const pkg = require('../package.json')
  console.log(`video-parser ${pkg.version}`)
}

function printHelp(): void {
  console.log(`
koishi-plugin-video-parser-all CLI — 像 you-get 一样解析/下载视频

用法:
  video-parser <url> [选项]

选项:
  -d, --download         下载视频/图集/封面/音乐到本地（多视频推文全量下载）
  -i, --info             仅显示信息（默认行为，可不加）
  -o, --output <dir>     下载目录（默认当前目录）
  --json                 以 JSON 输出解析结果
  --api <url>            覆盖默认主解析 API
  --api-key <key>        api-new.ifphp.com 网关 API Key（配置后自动切换新网关）
  --proxy <url>          HTTP 代理，如 http://127.0.0.1:7890
  --dedicated-first      优先使用平台专属 API
  --merge-images         识别同源切图（四宫格/九宫格/横竖切分条带）并合并为一张：
                         信息模式显示检测结果，下载模式保存合并图替代逐张分片（需 ffmpeg）
  --twitter-auth-token <t>  X 登录态 auth_token（解析需登录推文；TLS 指纹由 tlsget-rs 处理，随包自动安装）
  --twitter-ct0 <t>         X 登录态 ct0（与 auth_token 配对，同时用作 csrf token）
  --debug                开启调试日志
  -v, --version          显示版本
  -h, --help             显示帮助

示例:
  video-parser https://www.bilibili.com/video/BV1xx411c7mD
  video-parser https://v.douyin.com/xxxx/ -d -o ./downloads
  video-parser https://x.com/.../status/123 --twitter-auth-token A --twitter-ct0 B
`.trim())
}

function buildConfig(overrides: Record<string, any>): any {
  return {
    debug: false,
    deduplicationInterval: 180,
    cacheTTL: 600,
    platformEnabled: {},
    enableDeduplication: false,
    platformDedicatedFirst: {},
    globalFieldMapping: DEFAULT_GLOBAL_FIELD_MAPPING,
    customApis: [],
    customPlatforms: [],
    primaryApiUrl: 'https://api.bugpk.com/api/short_videos',
    backupApiUrl: 'https://api.bugpk.com/api/svparse',
    retryTimes: 3,
    retryInterval: 1000,
    timeout: 60000,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    customHeaders: [],
    maxDescLength: 500,
    unifiedMessageFormat: DEFAULT_UNIFIED_FORMAT,
    proxy: { enabled: false },
    ...overrides,
  }
}

function parseProxy(proxyStr: string): any {
  const m = /^(https?):\/\/([^:\/]+)(?::(\d+))?/.exec(proxyStr)
  if (!m) { console.error('代理格式错误，应为 http://host:port'); process.exit(1) }
  return { enabled: true, protocol: m[1], host: m[2], port: Number(m[3] || 8080), auth: {} }
}

function sanitize(name: string): string {
  return (name || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function inferExt(url: string, fallback: string): string {
  const ext = extname(new URL(url, 'http://x/').pathname).toLowerCase()
  if (['.mp4', '.m4v', '.flv', '.webm', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp3', '.m4a', '.aac'].includes(ext)) return ext
  return fallback
}

function bar(cur: number, total: number): string {
  if (!total) return ''
  const pct = Math.min(100, Math.round(cur / total * 100))
  return `${pct}% (${(cur / 1048576).toFixed(1)}MB/${(total / 1048576).toFixed(1)}MB)`
}

async function downloadOne(url: string, filepath: string, label: string): Promise<void> {
  if (!url) return
  process.stdout.write(`  ↓ ${label}: ${url}\n`)
  try {
    const res = await axios.get(url, {
      responseType: 'stream',
      timeout: 120000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      maxRedirects: 5,
    })
    const total = Number(res.headers['content-length'] || 0)
    let received = 0
    await new Promise<void>((resolveP, reject) => {
      const ws = createWriteStream(filepath)
      res.data.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (total) process.stdout.write(`\r  ${bar(received, total)}      `)
      })
      res.data.pipe(ws)
      ws.on('finish', () => { process.stdout.write('\n'); resolveP() })
      ws.on('error', reject)
      res.data.on('error', reject)
    })
    process.stdout.write(`  ✓ 已保存: ${filepath}\n`)
  } catch (e: any) {
    process.stdout.write(`  ✗ 下载失败: ${e.message || e}\n`)
  }
}

function printInfo(p: ParsedData, type: string): void {
  const line = (k: string, v: any) => v === '' || v === 0 || v == null ? null : `${k}: ${v}`
  const rows = [
    `平台类型: ${type} (${p.type})`,
    line('标题', p.title),
    line('作者', p.author ? `${p.author}${p.uid ? ` (ID: ${p.uid})` : ''}` : ''),
    line('简介', p.desc),
    p.translation ? `翻译（${p.translationProvider || '?'}，${langName(p.lang) || '?'}）：${p.translation}` : null,
    line('时长', p.duration > 0 ? formatDuration(p.duration) : ''),
    line('发布时间', p.publishTime ? formatPublishTime(p.publishTime) : ''),
    ['点赞', '评论', '收藏', '转发', '播放'].map((n, i) => {
      const val = [p.like, p.comment, p.collect, p.share, p.play][i]
      return val ? `${n}: ${val}` : null
    }).filter(Boolean).join('  ') || null,
    p.videos.length > 1
      ? `清晰度:\n${p.videos.map((v, i) => `  [${i}] ${v.quality}${v.bit_rate ? ` (${v.bit_rate}bps)` : ''}  ${v.url}`).join('\n')}`
      : null,
    p.video ? `视频地址: ${p.video}${p.isGif ? '（动图）' : ''}` : null,
    p.extraVideos?.length
      ? `更多视频 (${p.extraVideos.length}):\n${p.extraVideos.map((v, i) => `  [${i + 1}] ${v.url}${v.isGif ? '（动图）' : ''}`).join('\n')}`
      : null,
    p.images.length ? `图集 (${p.images.length}):\n${p.images.map((u, i) => `  [${i}] ${u}`).join('\n')}` : null,
    p.live_photo.length ? `实况 (${p.live_photo.length}): ${p.live_photo.map(lp => lp.image).join(', ')}` : null,
    p.cover ? `封面: ${p.cover}` : null,
    p.music.url || p.music.title ? `音乐: ${p.music.title || ''}${p.music.author ? ' - ' + p.music.author : ''}${p.music.url ? '\n  ' + p.music.url : ''}` : null,
  ]
  console.log(rows.filter(Boolean).join('\n'))
}

function layoutDesc(layout: MergeLayout): string {
  if (layout.kind === 'grid') return `${layout.cols}x${layout.rows} 宫格`
  return layout.kind === 'v' ? '垂直堆叠（水平切分）' : '水平拼接（垂直切分）'
}

async function downloadAll(p: ParsedData, type: string, outDir: string, merged: { buffer: Buffer; layout: MergeLayout } | null = null): Promise<void> {
  await mkdir(outDir, { recursive: true })
  const base = sanitize(p.title) || `${type}_${Date.now()}`
  console.log('\n开始下载:')
  // URL 级去重：封面=图集首图、实况图=封面等场景不重复下载
  const downloaded = new Set<string>()
  const dl = async (url: string, filepath: string, label: string) => {
    if (!url) return
    if (downloaded.has(url)) {
      console.log(`  ↷ 跳过重复（与此前已下载内容相同）: ${label}`)
      return
    }
    downloaded.add(url)
    await downloadOne(url, filepath, label)
  }
  if (p.video) {
    const useV = p.videos[0]?.url || p.video
    await dl(useV, join(outDir, `${base}${inferExt(useV, '.mp4')}`), '视频')
  }
  // 多视频推文：其余视频全量下载（主视频无后缀，其余 _2 _3…）
  for (let i = 0; i < (p.extraVideos?.length || 0); i++) {
    const u = p.extraVideos![i].url
    await dl(u, join(outDir, `${base}_${i + 2}${inferExt(u, '.mp4')}`), `视频 ${i + 2}/${p.extraVideos!.length + 1}`)
  }
  if (p.images.length) {
    // --merge-images：同源切图合并成功时保存合并图，替代逐张分片
    if (merged) {
      const f = join(outDir, `${base}_merged.jpg`)
      await writeFile(f, merged.buffer)
      console.log(`  ✓ 已保存合并图（${p.images.length} 片 → ${layoutDesc(merged.layout)}）: ${f}`)
      for (const u of p.images) downloaded.add(u)
    } else {
      for (let i = 0; i < p.images.length; i++) {
        await dl(p.images[i], join(outDir, `${base}_${i + 1}${inferExt(p.images[i], '.jpg')}`), `图片 ${i + 1}/${p.images.length}`)
      }
    }
  }
  if (p.live_photo.length) {
    for (let i = 0; i < p.live_photo.length; i++) {
      await dl(p.live_photo[i].image, join(outDir, `${base}_live_${i + 1}${inferExt(p.live_photo[i].image, '.jpg')}`), `实况图 ${i + 1}`)
      if (p.live_photo[i].video) await dl(p.live_photo[i].video!, join(outDir, `${base}_live_${i + 1}.mp4`), `实况视频 ${i + 1}`)
    }
  }
  if (p.cover) await dl(p.cover, join(outDir, `${base}_cover${inferExt(p.cover, '.jpg')}`), '封面')
  if (p.music.url) await dl(p.music.url, join(outDir, `${base}_music${inferExt(p.music.url, '.mp3')}`), '音乐')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.debug) setVerboseLogging(true)
  if (!args.url) { printHelp(); process.exit(1) }

  const matches = linkTypeParser(args.url, BUILTIN_LINK_RULES)
  if (!matches.length) {
    console.error('✗ 无法识别该链接对应的平台')
    process.exit(1)
  }
  const { type, url } = matches[0]
  process.stdout.write(`▶ 平台: ${type}\n▶ 链接: ${url}\n▶ 正在解析...\n\n`)

  const config = buildConfig({
    primaryApiUrl: args.api,
    apiKey: args.apiKey || '',
    platformDedicatedFirst: args.dedicatedFirst ? { [type]: true } : {},
    proxy: args.proxy ? parseProxy(args.proxy) : { enabled: false },
    debug: args.debug,
    twitterAuthToken: args.twitterAuthToken,
    twitterCt0: args.twitterCt0,
  })

  const ctx = {} as Context
  const rt = createRuntime(ctx, config)

  let exitCode = 0
  try {
    const conf = getPlatformConfig(rt, type)
    const result = await parseUrl(rt, url, type, conf.fieldMapping, conf)
    if (!result.success) {
      console.error('\n✗ 解析失败:', result.msg)
      exitCode = 1
    } else {
      const parsed = result.data
      debugLog('解析结果', parsed)

      // --merge-images：同源切图识别与合并（独立选项，默认关闭）
      let merged: { buffer: Buffer; layout: MergeLayout } | null = null
      if (args.mergeImages && parsed.images.length >= 2) {
        merged = await mergeImages(rt, parsed.images)
        if (!args.json) {
          if (merged) {
            console.log(`▶ 同源切图: ${parsed.images.length} 片 → 已合并（${layoutDesc(merged.layout)}，${Math.round(merged.buffer.length / 1024)}KB）`)
          } else {
            console.log('▶ 同源切图: 未检测到（图片非同源切分或 ffmpeg 不可用）')
          }
        }
      }

      if (args.json) {
        console.log(JSON.stringify(parsed, null, 2))
      } else {
        printInfo(parsed, type)
        if (parsed.video || parsed.images.length || parsed.live_photo.length) {
          process.stdout.write('\n--- 文字消息预览 (unifiedMessageFormat) ---\n')
          console.log(generateFormattedText(parsed, config.unifiedMessageFormat) || '(空)')
        }
      }

      if (args.download) {
        await downloadAll(parsed, type, resolve(args.output), merged)
      }
    }
  } catch (e: any) {
    console.error('\n✗ 解析失败:', e?.message || e)
    if (args.debug && e?.stack) console.error(e.stack)
    exitCode = 1
  }

  // 关闭 TLS 指纹模拟子进程，避免进程悬挂
  await shutdownTlsClient().catch(() => {})
  process.exit(exitCode)
}

main()
