/**
 * 内置扩展实现装配：把 NSFW(ext-nsfw)、同源合并(ext-merge)、
 * 翻译(ext-translate)、GIF(ext-gif) 组装为 core 契约的默认实现。
 *
 * 宿主可用自己的 VideoParserExtensions 覆盖其中任意一项。
 * 后续拆分仓库时，本文件即 @sns-parse/extensions 的入口。
 */
import type { VideoParserExtensions } from '../core/extensions'
import { processImage, processVideo, processMergedImage, nsfwCapability } from '../services/nsfw/gate'
import { mergeImages } from '../utils/merge'
import { mp4ToGif } from '../utils/gif'
import { translateText } from '../utils/translate'

export function createDefaultExtensions(): VideoParserExtensions {
  return {
    mergeImages,
    processImage,
    processVideo,
    processMergedImage,
    mp4ToGif,
    translate: translateText,
    capability: nsfwCapability,
  }
}
