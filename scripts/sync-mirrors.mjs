/**
 * npmmirror 同步触发脚本（发包后必跑；不降级、不跳过）。
 *
 * 两种缺失形态与对策：
 * 1. 包不存在（404）：GET 包路径即触发 cnpmcore 按需同步
 * 2. 包存在但版本滞后：显式 `PUT /-/package/<name>/syncs` 创建同步任务
 *
 * 轮询节奏：每秒检查，单个包就绪即移出队列，全部就绪立即退出（不空等）。
 * 用法：node scripts/sync-mirrors.mjs [总时限秒，默认 240] [重复触发间隔秒，默认 30]
 * 退出码：全部就绪 0；超时仍有缺失 1。
 */
const PLATFORM_TYPES = [
  'bilibili', 'douyin', 'kuaishou', 'xiaohongshu', 'weibo', 'xigua', 'youtube',
  'tiktok', 'acfun', 'zhihu', 'weishi', 'huya', 'haokan', 'meipai', 'twitter',
  'instagram', 'doubao', 'doubao_image', 'jimeng', 'oasis', 'wechat_channel',
  'lishi', 'quanmin', 'pipigx', 'pipixia', 'zuiyou', 'toutiao',
]

const PACKAGES = [
  '@sns-parse/core',
  '@sns-parse/ext-nsfw',
  '@sns-parse/ext-merge',
  '@sns-parse/ext-translate',
  '@sns-parse/ext-gif',
  '@sns-parse/extensions',
  '@sns-parse/platforms',
  '@sns-parse/koishi-plugin-sns-parse',
  '@sns-parse/cli',
  '@char46/koishi-plugin-video-parser-all',
  ...PLATFORM_TYPES.map(t => `@sns-parse/platform-${t}`),
]

const DEADLINE_MS = Number(process.argv[2] || 240) * 1000
const RETRIGGER_MS = Number(process.argv[3] || 30) * 1000

const MIRROR = 'https://registry.npmmirror.com'
const UPSTREAM = 'https://registry.npmjs.org'

const esc = n => encodeURIComponent(n)

async function fetchJson(url, timeoutMs = 15000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) return { status: res.status }
    return { status: res.status, body: await res.json() }
  } catch {
    return { status: 0 }
  } finally {
    clearTimeout(timer)
  }
}

/** 期望版本 = 上游 dist-tags.latest（npm 发布时会剥掉 build metadata） */
async function expectedLatest(name) {
  const r = await fetchJson(`${UPSTREAM}/${esc(name)}`)
  return r.body?.['dist-tags']?.latest || null
}

/** 镜像侧是否已含期望版本 */
async function mirrorHas(name, expectVer) {
  const r = await fetchJson(`${MIRROR}/${esc(name)}`)
  return r.status === 200 && (!expectVer || !!r.body?.versions?.[expectVer])
}

/** 显式创建同步任务（对「存在但滞后」的包必需；对 404 包亦有加速作用） */
async function triggerSync(name) {
  try {
    const res = await fetch(`${MIRROR}/-/package/${esc(name)}/syncs`, { method: 'PUT' })
    return res.status
  } catch {
    return 0
  }
}

async function main() {
  const t0 = Date.now()
  console.log(`npmmirror 同步：${PACKAGES.length} 个包（每秒轮询，就绪即退；时限 ${DEADLINE_MS / 1000}s）`)

  const pending = new Map()
  for (const n of PACKAGES) pending.set(n, await expectedLatest(n))

  let lastTrigger = 0
  while (pending.size > 0 && Date.now() - t0 < DEADLINE_MS) {
    const elapsed = Math.round((Date.now() - t0) / 1000)
    const shouldTrigger = Date.now() - lastTrigger >= RETRIGGER_MS
    if (shouldTrigger) lastTrigger = Date.now()

    for (const [name, ver] of [...pending]) {
      if (await mirrorHas(name, ver)) {
        pending.delete(name)
        console.log(`  ✓ ${name}@${ver}（${elapsed}s）`)
        continue
      }
      if (shouldTrigger) {
        const code = await triggerSync(name)
        console.log(`  … ${name} 缺 ${ver}，触发同步（PUT ${code}，${elapsed}s）`)
      }
    }
    if (pending.size > 0) await new Promise(r => setTimeout(r, 1000))
  }

  if (pending.size > 0) {
    console.error(`✗ 超时仍缺失 ${pending.size} 个：${[...pending.keys()].join(', ')}`)
    process.exit(1)
  }
  console.log(`✓ 全部 ${PACKAGES.length} 个包已在 npmmirror 就绪（总耗时 ${Math.round((Date.now() - t0) / 1000)}s）`)
}

main()
