/*
 * 内置平台定义聚合（每平台一个文件，便于后续一平台一包）。
 * 由 scripts/gen-defs.ts 生成，勿手工编辑；请改 src/platforms/rules.ts 后重新生成。
 */
import type { PlatformDefinition } from '../../core/platform'
import { bilibili } from './bilibili'
import { douyin } from './douyin'
import { kuaishou } from './kuaishou'
import { xiaohongshu } from './xiaohongshu'
import { weibo } from './weibo'
import { xigua } from './xigua'
import { youtube } from './youtube'
import { tiktok } from './tiktok'
import { acfun } from './acfun'
import { zhihu } from './zhihu'
import { weishi } from './weishi'
import { huya } from './huya'
import { haokan } from './haokan'
import { meipai } from './meipai'
import { twitter } from './twitter'
import { instagram } from './instagram'
import { doubao } from './doubao'
import { doubao_image } from './doubao_image'
import { jimeng } from './jimeng'
import { oasis } from './oasis'
import { wechat_channel } from './wechat_channel'
import { lishi } from './lishi'
import { quanmin } from './quanmin'
import { pipigx } from './pipigx'
import { pipixia } from './pipixia'
import { zuiyou } from './zuiyou'
import { toutiao } from './toutiao'

export const BUILTIN_PLATFORMS: PlatformDefinition[] = [
  bilibili,
  douyin,
  kuaishou,
  xiaohongshu,
  weibo,
  xigua,
  youtube,
  tiktok,
  acfun,
  zhihu,
  weishi,
  huya,
  haokan,
  meipai,
  twitter,
  instagram,
  doubao,
  doubao_image,
  jimeng,
  oasis,
  wechat_channel,
  lishi,
  quanmin,
  pipigx,
  pipixia,
  zuiyou,
  toutiao,
]

/** 扁平规则表（链接识别用） */
export const BUILTIN_LINK_RULES: { pattern: RegExp; type: string }[] =
  BUILTIN_PLATFORMS.flatMap(p => p.rules.map(pattern => ({ pattern, type: p.type })))
