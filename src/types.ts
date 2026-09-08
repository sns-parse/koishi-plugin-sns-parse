export interface VideoQuality {
  quality: string
  url: string
  bit_rate?: number
}

export interface ParsedData {
  type: string
  title: string
  desc: string
  author: string
  uid: string
  avatar: string
  cover: string
  video: string
  videos: VideoQuality[]
  images: string[]
  live_photo: Array<{ image: string; video: string }>
  music: { title?: string; author?: string; cover?: string; url?: string }
  like: number
  comment: number
  collect: number
  share: number
  play: number
  duration: number
  publishTime: number
  author_followers: number
  author_signature: string
  admire: number
  /** 推文动图（animated_gif）：True 时可按配置转 GIF 发送 */
  isGif?: boolean
  /** 多视频推文的其余视频（第一个在 video 字段；每项带自身 isGif/时长/封面） */
  extraVideos?: { url: string; isGif?: boolean; duration?: number; cover?: string }[]
  /** 推文语种（BCP-47 短码，如 fr/zh/und），供翻译跳过判定 */
  lang?: string
  /** 外语推文译文（tweetTranslate 开启时填充，经 ${翻译} 展示） */
  translation?: string
}

export interface LinkMatch {
  type: string
  url: string
  id: string
}

export interface ApiItem {
  url: string
  label: string
  apiKey?: string
  authHeaderType?: string
  customHeaderName?: string
  fieldMapping?: Record<string, string>
}

export interface CustomPlatformConfig {
  name: string
  apiUrl: string
  apiKey: string
  authHeaderType: string
  customHeaderName: string
  fieldMapping?: Record<string, string>
  proxy?: any
}
