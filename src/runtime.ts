import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { ParsedData, CustomPlatformConfig } from './types'
import type { VideoParserHost } from './core/host'
import { createHost } from './core/host'
import type { VideoParserExtensions } from './core/extensions'
import { createDefaultExtensions } from './extensions/default'
import { SimpleLRUCache } from './utils/cache'
import { parseFieldMapping } from './utils/field-mapping'
import { BUILTIN_LINK_RULES } from './platforms/definitions'
import { buildCustomLinkRules } from './platforms/custom'

export interface ParserRuntime {
  /** 宿主抽象（core 统一入口） */
  host: VideoParserHost
  /** 过渡期兼容字段：底层上下文（等同于 host.context） */
  ctx: any
  config: any
  http: AxiosInstance
  proxyConfig: any
  cacheTTL: number
  dedupCache: SimpleLRUCache<number>
  urlCacheLocal: SimpleLRUCache<{ data: ParsedData; expire: number }>
  contentDedupCache: SimpleLRUCache<number>
  customPlatforms: CustomPlatformConfig[]
  allRules: { pattern: RegExp; type: string }[]
  /** 扩展能力（默认实现 + 宿主覆盖） */
  extensions: VideoParserExtensions
}

export function createRuntime(source: any, config: any): ParserRuntime {
  const host = createHost(source)
  const ctx = host.context
  const extensions: VideoParserExtensions = { ...createDefaultExtensions(), ...(host.extensions || {}) }
  const dedupCache = new SimpleLRUCache<number>(1000, config.deduplicationInterval * 1000)
  const cacheTTL = (config.cacheTTL || 600) * 1000
  const urlCacheLocal = new SimpleLRUCache<{ data: ParsedData; expire: number }>(500, cacheTTL)
  const contentDedupCache = new SimpleLRUCache<number>(1000, config.deduplicationInterval * 1000)

  const proxyConfig = config.proxy || {}
  const customPlatforms: CustomPlatformConfig[] = (config.customPlatforms || []).map((p: any) => ({
    name: p.name,
    apiUrl: p.apiUrl,
    apiKey: p.apiKey || '',
    authHeaderType: p.authHeaderType || 'Bearer',
    customHeaderName: p.customHeaderName || 'X-API-Key',
    fieldMapping: parseFieldMapping(p.fieldMapping),
    proxy: p.proxy || null
  }))

  const customRules = buildCustomLinkRules(config.customPlatforms || [])
  const allRules = [...BUILTIN_LINK_RULES, ...customRules]

  const axiosConfig: AxiosRequestConfig = {
    timeout: config.timeout,
    headers: {
      'User-Agent': config.userAgent,
      'Referer': 'https://www.baidu.com/',
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }
  if (proxyConfig.enabled && proxyConfig.host) {
    // axios 内置 proxy 选项对 https 目标存在不做 CONNECT 隧道的经典缺陷，
    // 改用 https-proxy-agent 显式代理（按请求生效，不污染全局 env）
    const proxyUrl = `${proxyConfig.protocol || 'http'}://${proxyConfig.auth?.username ? `${encodeURIComponent(proxyConfig.auth.username)}:${encodeURIComponent(proxyConfig.auth.password || '')}@` : ''}${proxyConfig.host}:${proxyConfig.port || 7890}`
    const agent = new HttpsProxyAgent(proxyUrl)
    axiosConfig.httpAgent = agent
    axiosConfig.httpsAgent = agent
    axiosConfig.proxy = false
  }
  const http: AxiosInstance = axios.create(axiosConfig)

  return {
    host,
    ctx,
    config,
    http,
    proxyConfig,
    cacheTTL,
    dedupCache,
    urlCacheLocal,
    contentDedupCache,
    customPlatforms,
    allRules,
    extensions,
  }
}
