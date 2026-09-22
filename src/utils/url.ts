import type { LinkMatch } from '../types'

export function cleanUrl(url: string): string {
  url = url.replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\\\//g, '/')
  url = url.replace(/^[\s"'<（(“”‘’]+/, '')
  url = url.replace(/[\s"'<>\{\}\[\]`,;，。！？：；“”‘’…—～.()）]+$/, '')
  // 剔除链接后残留的 XML/HTML 标签片段（如卡片消息里的 <op>…（上游 v1.6.7）
  const tagStart = url.indexOf('<')
  if (tagStart > 0) url = url.slice(0, tagStart)
  if (!/^https?:\/\//i.test(url)) {
    if (/^\/\//.test(url)) url = 'https:' + url
    else return url
  }
  return url
}

export function linkTypeParser(content: string, rules: { pattern: RegExp; type: string }[]): LinkMatch[] {
  content = content.replace(/\\\//g, '/')
  const matches: (LinkMatch & { pos: number })[] = []
  const seen = new Set<string>()
  for (const rule of rules) {
    let match: RegExpExecArray | null
    rule.pattern.lastIndex = 0
    while ((match = rule.pattern.exec(content)) !== null) {
      let url = match[0]
      url = cleanUrl(url)
      if (!url) continue
      if (seen.has(url)) continue
      seen.add(url)
      // 记录出现位置，多链接按正文出现顺序排列（上游 v1.6.7）
      matches.push({ type: rule.type, url, id: match[1] || url, pos: match.index })
    }
  }
  return matches.sort((a, b) => a.pos - b.pos).map(({ pos, ...m }) => m)
}

export function extractAllUrlsFromMessage(session: any, rules: { pattern: RegExp; type: string }[]): LinkMatch[] {
  const content = session.content?.trim() || ''
  const matchedLinks = linkTypeParser(content, rules)
  const cardsContent: string[] = []
  if (session.elements) {
    for (const elem of session.elements) {
      if (elem.type === 'xml' && elem.data) cardsContent.push(elem.data)
      else if (elem.type === 'json' && elem.data) {
        try {
          const json = JSON.parse(elem.data)
          const extract = (obj: any) => {
            if (!obj || typeof obj !== 'object') return
            for (const val of Object.values(obj)) {
              if (typeof val === 'string') cardsContent.push(val)
              else if (typeof val === 'object') extract(val)
            }
          }
          extract(json)
        } catch {}
      }
    }
  }
  for (const cardContent of cardsContent) {
    matchedLinks.push(...linkTypeParser(cardContent, rules))
  }
  const cleanResult: LinkMatch[] = []
  const seenUrls = new Set<string>()
  for (const link of matchedLinks) {
    const cleaned = cleanUrl(link.url)
    if (!cleaned || !/^https?:\/\//i.test(cleaned)) continue
    if (!seenUrls.has(cleaned)) {
      seenUrls.add(cleaned)
      cleanResult.push({ ...link, url: cleaned })
    }
  }
  return cleanResult
}
