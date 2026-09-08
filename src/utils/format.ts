import type { ParsedData } from '../types'
import { langName } from './translate'

const formatVarRegex = /\$\{([^}]+)\}/g

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function formatPublishTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const y = d.getFullYear()
  const mo = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const H = d.getHours().toString().padStart(2, '0')
  const i = d.getMinutes().toString().padStart(2, '0')
  return `${y}年${mo}月${day}日 ${H}:${i}`
}

export function generateFormattedText(p: ParsedData, format: string, index?: number, total?: number): string {
  const imageCount = p.images.length || p.live_photo.length
  const vars: Record<string, string> = {
    '标题': p.title,
    '作者': p.author,
    '简介': p.desc,
    '视频时长': p.duration > 0 ? formatDuration(p.duration) : '',
    '点赞数': String(p.like),
    '收藏数': String(p.collect),
    '转发数': String(p.share),
    '播放数': String(p.play),
    '评论数': String(p.comment),
    '发布时间': p.publishTime ? formatPublishTime(p.publishTime) : '',
    '图片数量': String(imageCount),
    '作者ID': p.uid,
    '音乐标题': p.music.title || '',
    '音乐作者': p.music.author || '',
    '翻译': p.translation || '',
    // 原文语言与提供方仅在有译文时展示（同一行变量全空则整行隐藏）
    '原文语言': p.translation ? langName(p.lang) : '',
    '翻译提供方': p.translationProvider || '',
  }

  const lines = format.split('\n')
  const resultLines: string[] = []
  for (const line of lines) {
    const varMatches = line.match(formatVarRegex)
    if (varMatches && varMatches.length > 0) {
      let allEmptyOrZero = true
      for (const match of varMatches) {
        const varName = match.slice(2, -1)
        const val = vars[varName]
        if (val && val !== '0') {
          allEmptyOrZero = false
          break
        }
      }
      if (allEmptyOrZero) continue
    }
    let newLine = line
    for (const [key, val] of Object.entries(vars)) {
      newLine = newLine.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), val)
    }
    resultLines.push(newLine)
  }
  let text = resultLines.join('\n').trim()
  if (index !== undefined && total !== undefined && total > 1) {
    text = `【${index}/${total}】\n${text}`
  }
  return text
}
