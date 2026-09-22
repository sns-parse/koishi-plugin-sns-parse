import axios, { AxiosRequestConfig } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { ParserRuntime } from '../runtime'
import type { ParsedData, ApiItem } from '../types'
import { debugLog, logger } from '../utils/logger'
import { delay, getErrorMessage } from '../utils/common'
import { generateFormattedText } from '../utils/format'
import { parseApiResponse } from './parser'
import { getPlatformConfig, buildAuthHeaders } from '../platforms/custom'
import { parseTwitter, fetchGrokTranslation } from '../platforms/twitter'
import { shouldSkipTranslate, translateText } from '../utils/translate'
import { tlsGet } from '../utils/tls-client'
import { NEW_GATEWAY_PRIMARY, LEGACY_GATEWAY_PRIMARY, LEGACY_GATEWAY_BACKUP, defaultDedicatedApisLegacy } from '../platforms/dedicated-apis'

export async function fetchApi(rt: ParserRuntime, url: string, type: string, fieldMapping?: Record<string, string>, platformConf?: any): Promise<ParsedData> {
  const { config, http, urlCacheLocal, proxyConfig, cacheTTL } = rt
  const cacheKey = url
  const cached = urlCacheLocal.get(cacheKey)
  if (cached && cached.expire > Date.now()) {
    debugLog('缓存命中，直接返回:', url)
    return cached.data
  }

  const { apiUrl: dedicatedUrl, dedicatedFirst, apiKey, authHeaderType, customHeaderName, customProxy } = platformConf || getPlatformConfig(rt, type)

  // X / Twitter：统一网关均走原生 syndication 解析（除非用户自定义了 API）
  if (type === 'twitter' && !dedicatedUrl) {
    debugLog('twitter 走原生 syndication 解析:', url)
    const twCreds = (config.twitterAuthToken && config.twitterCt0)
      ? { authToken: String(config.twitterAuthToken), ct0: String(config.twitterCt0) }
      : undefined
    // 代理串通：axios 走 runtime 实例；tlsget-rs（GraphQL/Grok 翻译）显式透传代理地址
    const tlsProxy = (proxyConfig.enabled && proxyConfig.host)
      ? `${proxyConfig.protocol || 'http'}://${proxyConfig.auth?.username ? `${encodeURIComponent(proxyConfig.auth.username)}:${encodeURIComponent(proxyConfig.auth.password || '')}@` : ''}${proxyConfig.host}:${proxyConfig.port || 7890}`
      : undefined
    const tlsGetWithProxy = (u: string, o: any) => tlsGet(u, { ...o, proxy: tlsProxy })
    const parsed = await parseTwitter(url, http, twCreds, tlsGetWithProxy)
    // 推文翻译：目标语种与推文语种相同时跳过；Grok（需登录态）优先，通用翻译兜底
    if (config.tweetTranslateEnabled && parsed.desc) {
      const target = config.tweetTranslateLang || 'zh'
      if (!shouldSkipTranslate(parsed.lang, target)) {
        let translated: string | null = null
        let provider = ''
        if (twCreds) {
          const grok = await fetchGrokTranslation(url, target, twCreds, tlsGetWithProxy).catch(() => null)
          if (grok) {
            translated = grok.text
            provider = 'Grok'
            if (!parsed.lang && grok.sourceLang) parsed.lang = grok.sourceLang
          }
        }
        if (!translated) {
          const generic = await translateText(rt, parsed.desc, target, parsed.lang)
          if (generic) { translated = generic.text; provider = generic.provider }
        }
        if (translated) {
          parsed.translation = translated
          parsed.translationProvider = provider
        }
      }
    }
    urlCacheLocal.set(cacheKey, { data: parsed, expire: Date.now() + cacheTTL })
    return parsed
  }

  // 网关选择（上游 issue #12）：配置 apiKey → 新网关（无备用 API）；否则 → 旧网关（主+备用）。
  // 注意：primaryApiUrl 是旧网关覆盖字段，新网关不受其影响（避免旧配置劫持切换）
  const useNewGateway = !!config.apiKey
  const primaryApi = useNewGateway
    ? NEW_GATEWAY_PRIMARY
    : (config.primaryApiUrl || LEGACY_GATEWAY_PRIMARY)
  const backupApi = config.backupApiUrl || LEGACY_GATEWAY_BACKUP
  const backupAllowed = !useNewGateway && new Set(['douyin', 'xiaohongshu', 'instagram', 'jimeng']).has(type)
  const gwConf = useNewGateway
    ? { apiKey: config.apiKey, authHeaderType: 'X-API-Key' as const, customHeaderName: 'X-API-Key' }
    : { apiKey: '', authHeaderType: undefined, customHeaderName: undefined }

  const apiList: ApiItem[] = []
  if (dedicatedFirst && dedicatedUrl) {
    apiList.push({ url: dedicatedUrl, label: `专属API(${type})`, apiKey, authHeaderType, customHeaderName, fieldMapping })
    apiList.push({ url: primaryApi, label: '默认主API', ...gwConf, fieldMapping })
    if (backupAllowed) apiList.push({ url: backupApi, label: '备用主API', ...gwConf, fieldMapping })
  } else {
    apiList.push({ url: primaryApi, label: '默认主API', ...gwConf, fieldMapping })
    if (backupAllowed) apiList.push({ url: backupApi, label: '备用主API', ...gwConf, fieldMapping })
    if (dedicatedUrl) apiList.push({ url: dedicatedUrl, label: `专属API(${type})`, apiKey, authHeaderType, customHeaderName, fieldMapping })
  }

  if (type.startsWith('custom_') && apiList.length === 0 && dedicatedUrl) {
    apiList.push({ url: dedicatedUrl, label: `自定义API(${type})`, apiKey, authHeaderType, customHeaderName, fieldMapping })
  }

  // 新网关模式下追加旧网关末位兜底：新网关无专属端点的平台（微博/小红书等）或主 API 故障
  // （5xx/网关侧异常）时仍有机会解析；旧网关对语义问题会返回更明确的错误信息
  if (useNewGateway && !type.startsWith('custom_')) {
    const legacyDedicated = defaultDedicatedApisLegacy[type]
    const legacyMain = config.primaryApiUrl && config.primaryApiUrl !== LEGACY_GATEWAY_PRIMARY ? config.primaryApiUrl : LEGACY_GATEWAY_PRIMARY
    if (legacyDedicated && !apiList.some((a) => a.url === legacyDedicated)) {
      apiList.push({ url: legacyDedicated, label: `旧网关专属API(${type})`, apiKey: '', authHeaderType: undefined, customHeaderName: undefined, fieldMapping })
    }
    if (!apiList.some((a) => a.url === legacyMain)) {
      apiList.push({ url: legacyMain, label: '旧网关主API', apiKey: '', authHeaderType: undefined, customHeaderName: undefined, fieldMapping })
    }
    if (!apiList.some((a) => a.url === backupApi)) {
      apiList.push({ url: backupApi, label: '旧网关备用API', apiKey: '', authHeaderType: undefined, customHeaderName: undefined, fieldMapping })
    }
  }

  const customHeaders = config.customHeaders || []
  const errors: Error[] = []
  for (const [apiIndex, api] of apiList.entries()) {
    for (let attempt = 0; attempt <= config.retryTimes; attempt++) {
      try {
        const headers: any = {
          'User-Agent': config.userAgent,
          'Referer': 'https://www.baidu.com/',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
        for (const h of customHeaders) {
          if (h.name && h.value) headers[h.name] = h.value
        }
        if (api.apiKey) {
          const authHeaders = buildAuthHeaders(api.apiKey, api.authHeaderType || 'Bearer', api.customHeaderName || 'X-API-Key')
          Object.assign(headers, authHeaders)
        }
        const proxyToUse = customProxy && customProxy.enabled ? customProxy : (proxyConfig.enabled ? proxyConfig : undefined)
        const axiosConfigLocal: AxiosRequestConfig = {
          params: { url },
          timeout: config.timeout,
          headers,
        }
        // 代理：runtime 实例已按全局代理配置好 https-proxy-agent；
        // 仅当平台级 customProxy 覆盖时才按请求另建 agent（不用 axios 内置 proxy 选项——对 https 目标不做 CONNECT 隧道）
        if (customProxy && customProxy.enabled && customProxy.host) {
          const pUrl = `${customProxy.protocol || 'http'}://${customProxy.auth?.username ? `${encodeURIComponent(customProxy.auth.username)}:${encodeURIComponent(customProxy.auth.password || '')}@` : ''}${customProxy.host}:${customProxy.port || 7890}`
          const agent = new HttpsProxyAgent(pUrl)
          axiosConfigLocal.httpAgent = agent
          axiosConfigLocal.httpsAgent = agent
          axiosConfigLocal.proxy = false
        }
        const res = await http.get(api.url, axiosConfigLocal)
        // 兼容第三方 API：响应不含 code/status 状态字段时视为成功，直接交由解析器处理
        const code = res.data?.code
        const ok = res.data && (code === 200 || code === 0 || (code === undefined && res.data.status === undefined))
        if (ok) {
          // 回退链路重要事件：非首个 API 成功说明上游发生了故障切换
          if (apiIndex > 0) logger.info(`${api.label} 回退解析成功（此前 API 失败）: ${url}`)
          else debugLog(`${api.label} 解析成功: ${url}`)
          const parsed = parseApiResponse(res.data, config.maxDescLength, api.fieldMapping)
          urlCacheLocal.set(cacheKey, { data: parsed, expire: Date.now() + cacheTTL })
          return parsed
        }
        throw new Error(res.data?.msg || res.data?.message || `API返回错误码: ${code ?? res.data?.status}`)
      } catch (error) {
        const lastErr = error instanceof Error ? error : new Error(String(error))
        errors.push(lastErr)
        debugLog(`${api.label} attempt ${attempt+1} failed: ${lastErr.message}`)
        if (axios.isAxiosError(error)) {
          if (!error.response) {
            if (attempt < config.retryTimes) { await delay(config.retryInterval); continue }
          }
          const status = error.response?.status
          if (status && (status >= 500 || status === 429)) {
            if (attempt < config.retryTimes) { await delay(config.retryInterval); continue }
          }
        }
        break
      }
    }
    logger.warn(`${api.label} 全部重试失败`)
  }
  // 优先返回语义级错误（服务端明确说明原因），避免被后续兜底 API 的 5xx/网络/风控泛错覆盖；
  // 「Request failed with status code NNN」这类 axios 泛错无信息量，同样降级
  const semantic = errors.find((e) => !/status code \d{3}|socket|ECONNRESET|ETIMEDOUT|timeout|Bad Gateway|Service Unavailable/i.test(e.message))
  throw semantic || errors[errors.length - 1] || new Error('所有API请求全部失败')
}

export async function parseUrl(rt: ParserRuntime, url: string, type: string, fieldMapping?: Record<string, string>, platformConf?: any): Promise<{ success: true; data: ParsedData } | { success: false; msg: string }> {
  try {
    const info = await fetchApi(rt, url, type, fieldMapping, platformConf)
    const hasMedia = !!(info.video || info.images.length > 0 || info.live_photo.length > 0)
    if (hasMedia) return { success: true, data: info }
    // 纯文字内容（如 X 纯文字推文）：有正文即视为成功，下游发送文字卡片
    if (info.type === 'text' && (info.title || info.desc)) {
      debugLog(`纯文字内容: ${url}`)
      return { success: true, data: info }
    }
    debugLog(`解析成功但无内容: ${url}`)
    return { success: false, msg: '解析接口返回空内容' }
  } catch (error) {
    logger.error(`解析失败: ${url}`, getErrorMessage(error))
    let msg = getErrorMessage(error)
    // 小红书风控：裸 /discovery/item 链接缺 xsec_token，服务端获取 gate 票据失败；提示用户改发完整分享链接
    if (type === 'xiaohongshu' && /xsec_token|gate|票据/i.test(msg)) {
      msg += '（小红书升级了风控：请发送完整分享链接，如 xhslink.com 短链、App 分享文案里的原链接，或带 xsec_token 参数的网页链接）'
    }
    // 微博：API 仅支持视频微博，图文微博/新版 base62 短链会报「无法从URL中提取视频ID」
    if (type === 'weibo' && /无法从URL中提取视频ID|提取.*视频ID/.test(msg)) {
      msg += '（微博解析仅支持视频微博链接，如 weibo.com/tv/show/… 或 video.weibo.com/show?fid=…；图文微博与新版短链 /用户ID/短ID 形式暂不支持）'
    }
    return { success: false, msg }
  }
}

export async function processSingleUrl(rt: ParserRuntime, url: string, type: string, fieldMapping?: Record<string, string>, platformConf?: any): Promise<{ success: true; data: { text: string; parsed: ParsedData } } | { success: false; msg: string; url: string }> {
  const { config } = rt
  const result = await parseUrl(rt, url, type, fieldMapping, platformConf)
  if (!result.success) return { success: false, msg: result.msg, url }
  const text = generateFormattedText(result.data, config.unifiedMessageFormat)
  return { success: true, data: { text, parsed: result.data } }
}
