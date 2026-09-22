/**
 * TLS 指纹模拟 HTTP 客户端（一次性 CLI 模式）。
 *
 * X/Twitter 的 GraphQL 受 Cloudflare TLS 指纹校验保护：普通 Node/axios 的
 * TLS 握手(JA3/JA4)与 Chrome 不同，会被 CF 直接 403。此模块经
 * @char46/tlsget-rs（wreq/BoringSSL 内核，Chrome147 指纹）发起请求。
 *
 * 每次请求 spawn 一个静态二进制：stdin 进 JSON、stdout 出 JSON。
 * 无常驻服务、无端口管理、无生命周期问题；musl 环境自动使用静态 musl 构建。
 * tlsget-rs 为 optionalDependency，未安装时抛出明确错误，调用方据此降级。
 */

export interface TlsGetOptions {
  headers?: Record<string, string>
  cookies?: Record<string, string>
  timeout?: number
  /** HTTP(S) 代理地址（如 http://127.0.0.1:7890），透传给 tlsget-rs 二进制 */
  proxy?: string
}

export interface TlsResponse {
  status: number
  data: any
}

let modPromise: Promise<any> | null = null

/** 惰性加载 npm 包装（未安装时不缓存失败，装好后无需重启即可生效） */
async function getMod(): Promise<any> {
  if (!modPromise) {
    modPromise = import('@char46/tlsget-rs')
      .then((m: any) => m.default || m)
      .catch(() => {
        modPromise = null
        throw new Error('TLS 指纹模拟工具 @char46/tlsget-rs 未安装（可选依赖）。解析需登录的 X 推文需要它：npm i @char46/tlsget-rs')
      })
  }
  return modPromise
}

export async function tlsGet(url: string, opts: TlsGetOptions = {}): Promise<TlsResponse> {
  const mod = await getMod()
  const r = await mod.tlsGet({
    url,
    headers: opts.headers,
    cookies: opts.cookies,
    timeoutMs: Math.max(1000, opts.timeout || 30000),
    proxy: opts.proxy,
  })
  return { status: r.status, data: r.body }
}

/** 一次性二进制无需常驻进程；保留接口兼容旧调用方与测试 */
export async function shutdownTlsClient(): Promise<void> {
  modPromise = null
}

/**
 * 环境诊断：二进制定位 → 自检 → TLS 指纹回显 → X 边缘探测。
 * 失败环节即根因，全部结果同时输出到日志。
 */
export async function diagnoseTls(): Promise<string[]> {
  const lines: string[] = []
  try {
    const mod = await getMod()

    const bin = mod.binaryPath?.()
    if (bin) lines.push(`[1] ✓ 二进制：${bin}`)
    else lines.push(`[1] ✗ 当前平台 ${process.platform}/${process.arch} 无二进制子包（npm i @char46/tlsget-rs --force 重装）`)

    try {
      const st = await mod.selftest()
      lines.push(`[2] ✓ 自检：v${st.version}，指纹 ${st.emulation}`)
    } catch (e: any) {
      lines.push(`[2] ✗ 二进制无法执行：${e?.message || e}（可能被杀软/安全策略拦截）`)
    }

    try {
      const r = await mod.tlsGet({ url: 'https://tls.peet.ws/api/all', timeoutMs: 20000 })
      const ja4: string = r.body?.tls?.ja4 || '?'
      const chromeLike = ja4.startsWith('t13d')
      lines.push(`[3] ${chromeLike ? '✓' : '✗'} TLS 回显：JA4=${ja4}${chromeLike ? '（Chrome 形态）' : '（异常：非浏览器形态）'}`)
    } catch (e: any) {
      lines.push(`[3] ✗ 回显请求失败：${e?.message || e}`)
    }

    try {
      const x = await mod.tlsGet({ url: 'https://x.com/robots.txt', timeoutMs: 20000 })
      lines.push(`[4] ${x.status === 200 ? '✓' : '✗'} X 边缘探测：HTTP ${x.status}`)
    } catch (e: any) {
      lines.push(`[4] ✗ X 边缘探测失败：${e?.message || e}`)
    }

    if (!lines.some(l => l.includes('✗'))) lines.push('结论：环境正常。')
  } catch (e: any) {
    lines.push(`✗ 诊断失败：${e?.message || e}`)
  }
  return lines
}
