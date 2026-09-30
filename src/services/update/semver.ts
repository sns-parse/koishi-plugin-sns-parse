/**
 * 语义化版本工具（更新子系统自用；剥离 build metadata 语义与 npm registry 一致）。
 */
export function stripBuildMeta(v: string): string {
  return String(v || '').split('+')[0]
}

/** 语义化版本比较（支持 prerelease 段，忽略 build metadata）：a>b → 1，a<b → -1，相等 → 0 */
export function compareVersions(a: string, b: string): number {
  const pa = stripBuildMeta(a).split('-')
  const pb = stripBuildMeta(b).split('-')
  const na = pa[0].split('.').map(Number)
  const nb = pb[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) > (nb[i] || 0) ? 1 : -1
  }
  const ra = pa[1] || ''
  const rb = pb[1] || ''
  if (!ra && !rb) return 0
  if (!ra) return 1
  if (!rb) return -1
  const sa = ra.split('.')
  const sb = rb.split('.')
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i]
    const y = sb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1
    } else if (xn) return -1
    else if (yn) return 1
    else if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

function parseVer(v: string): { nums: number[]; pre: string } {
  const s = stripBuildMeta(v)
  const i = s.indexOf('-')
  const main = i < 0 ? s : s.slice(0, i)
  return { nums: main.split('.').map(n => Number(n) || 0), pre: i < 0 ? '' : s.slice(i + 1) }
}

/** 语义化范围内判定（支持 ^ / ~ / 精确；0.x caret 钉死 minor——0.x minor 锁纪律） */
export function inRange(version: string, range: string): boolean {
  const r = stripBuildMeta(String(range || '').trim())
  const v = stripBuildMeta(version)
  if (!r) return true
  const base = r.replace(/^[\^~]/, '')
  const pv = parseVer(v)
  const pb = parseVer(base)
  if (!r.startsWith('^') && !r.startsWith('~')) {
    return compareVersions(v, base) === 0
  }
  if (compareVersions(v, base) < 0) return false
  if (r.startsWith('~')) {
    return pv.nums[0] === pb.nums[0] && pv.nums[1] === pb.nums[1]
  }
  if (pb.nums[0] === 0) {
    // 0.x：^ 钉 major.minor
    if (pv.nums[0] !== 0 || pv.nums[1] !== pb.nums[1]) return false
  } else if (pv.nums[0] !== pb.nums[0]) {
    return false
  }
  // prerelease 只在 base 同 [major,minor,patch] 且带 prerelease 时放行
  if (pv.pre && (!pb.pre || pv.nums.join('.') !== pb.nums.join('.'))) return false
  return true
}
