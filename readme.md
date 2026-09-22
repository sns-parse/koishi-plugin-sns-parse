# @char46/koishi-plugin-video-parser-all

> 本项目 fork 自 [Minecraft-1314/koishi-plugin-video-parser-all](https://github.com/Minecraft-1314/koishi-plugin-video-parser-all)（MIT），感谢原作者。
> Forked from Minecraft-1314's MIT-licensed project. Credits to the original author.

## 项目介绍 (Project Introduction)

### 中文
这是一个为 Koishi 机器人框架开发的**全平台视频/图集解析插件**，使用统一API接口，支持自动识别并解析抖音、快手、B站、小红书、微博、西瓜视频、YouTube、TikTok、AcFun（A站）、知乎、微视、虎牙、好看视频、美拍、Twitter/X、Instagram、豆包（视频/图集）、**即梦（AI视频/图片）**、绿洲、视频号、梨视频、全民直播、皮皮搞笑、皮皮虾、最右等**20+主流平台**的短视频/图集/实况链接。

### English
This is a **multi-platform video/image parsing plugin** developed for the Koishi bot framework, using a unified API interface to automatically recognize and parse short video/image/live photo links from **20+ mainstream platforms** such as Douyin, Kuaishou, Bilibili, Xiaohongshu, Weibo, Xigua, YouTube, TikTok, AcFun, Zhihu, Weishi, Huya, Haokan, Meipai, Twitter/X, Instagram, Doubao (video/images), **Jimeng (AI video/image)**, Oasis, WeChat Channels, Lishi, Quanmin, Pipigx, Pipixia, Zuiyou and more.

## 版本方案 (Versioning)

本包是 [Minecraft-1314/koishi-plugin-video-parser-all](https://github.com/Minecraft-1314/koishi-plugin-video-parser-all) 的 fork，采用**独立 semver + build metadata 标注上游基线**：

- **核心版本**（`MAJOR.MINOR.PATCH`）：本 fork 自己的语义化版本，描述 fork 自身的变更（重构、新功能、修复）。升级链永远单调递增，不受上游版本号影响
- **build 段**（`+upstream.X.Y.Z`）：所跟随的上游基线版本，仅作标识、**不参与 semver 比较**。同步上游新版本时更新此段
- 同步上游时的规则：合并上游 `X.Y.Z` 后，fork 核心版本 = `max(自身当前, 上游)` 基础上 minor+1，并更新 build 段；永不回退、永不重号

| fork 版本 | 上游基线 | 说明 |
|---|---|---|
| 1.5.8 → 1.9.0 | 1.5.8 | 引入版本方案前的演化线 |
| ~~1.6.2-1~~ | 1.6.2 | 已弃用（semver 预发布格式导致降级问题） |
| 1.10.0+upstream.1.6.2 | 1.6.2 | 双网关条件切换（apiKey → api-new.ifphp.com） |

This package is a fork with **independent semver + upstream baseline in build metadata**: the core version tracks fork-only changes (always monotonically increasing), while the `+upstream.X.Y.Z` build segment marks the upstream base it follows (not part of semver comparison).

### 版本声明与致歉 (Versioning Statement & Apology)

本项目在开发过程中 **LLM（大语言模型）参与程度较高**，因此在版本管理上**未能充分利用语义化版本（semver）**：不少功能尚未经过充分稳定验证就以 minor 版本号发布了，导致版本号难以准确反映功能的成熟度，也可能给依赖方带来不必要的升级成本。为此我们向所有使用者**致歉**。

> 本项目为上游 [Minecraft-1314/koishi-plugin-video-parser-all](https://github.com/Minecraft-1314/koishi-plugin-video-parser-all) 的 fork，**变更同步上游**。

## 项目仓库 (Repository)
- GitHub: `https://github.com/char-46/koishi-plugin-video-parser-all`
- Issues: `https://github.com/char-46/koishi-plugin-video-parser-all/issues`

## 核心指令 (Core Commands)

| 指令 (Command) | 说明 (Description) | 示例 (Example) |
|----------------|--------------------|----------------|
| `parse <url>` | 手动解析指定的视频/图集链接 | `parse https://v.douyin.com/xxxx/` |
| `parse/getvideo <token>`（别名 `取视频`） | 领取受限暂存视频（仅私聊，token 绑定请求者） | `取视频 ab12cd34…` |
| `parse/diag` | 诊断 X/Twitter 登录态解析环境（cycletls），默认关闭 | `parse/diag` |

## 内容安全与图片混淆 (NSFW Moderation & Image Scramble)

**可选依赖**：安装 [koishi-plugin-ferret-transform-image](https://www.npmjs.com/package/koishi-plugin-ferret-transform-image)（**≥ 0.0.4**）后自动启用；未安装时本组功能全部停用，不影响其他功能。建议同时开启该插件的 `enableGroupDescramble` 配置，群友可在群内引用图片还原。

**策略模型**：

| 层 | 配置 | 说明 |
|---|---|---|
| **全局一刀切** | `nsfwGlobalMode` | `off`（默认）/\ `full` /\ `smart`，对所有未显式配置的平台生效 |
| 平台覆盖 | `nsfwPlatformMode` | 每平台 `inherit`（默认，跟随全局）/ `off` / `full` / `smart` |
| 全局动作 | `nsfwPolicy.imageAction / videoAction` | 图片：`scramble`（默认，混淆+还原 token）/ `link` / `drop`；视频：`redeem`（默认，暂存+私聊凭 token 取回）/ `link` / `drop` |
| 高级覆盖 | `nsfwAdvancedPolicy` + `nsfwPlatformPolicyAdvanced` | 平台级覆盖模式与动作；**高级模式显式 `full` 视为专家意图，配了审核也保留一刀切** |

**关键规则**：
- 配置了审核凭证（`nsfwModeration`）→ 非高级显式的 `full` 自动等效 `smart`（按审核判定）；需要某平台无条件全量处理时，用高级模式显式设 `full`
- 审核 API **故障即拦截**（fail-closed）：网络/凭证/响应异常一律按命中处理，宁可不发也不放行
- **视频仅封面送审**；命中后群内只发**文字卡片 + 取件 token**（引用请求者，无封面无视频），原视频暂存内存（默认 ≤200MB/条、20 条、30 分钟，LRU 驱逐），请求者**私聊** `取视频 <token>` 领取（token 绑定请求者，他人无效；卡片提示含**暂存截止时间** `${until}`；超限或下载失败改发原链接文字）
- 图片混淆 token 每次随机，兼容 ferret 的 `解混淆 <token>` 命令；同消息所有混淆图共用一个 token。**解码须在私聊**：将混淆图转发到与机器人的私聊并附「解混淆 <token>」（群内直接发 token 无效；如需群内还原，在 ferret 插件开启 `enableGroupDescramble` 后引用图片发送）
- 作者头像/音乐封面默认跳过混淆（`nsfwPolicy.scrambleAvatar` 可放开头像）

**支持的审核平台**：百度智能云、网易易盾、阿里云、腾讯云、**Azure Content Safety**、自定义 REST 模板（`nsfwModeration.provider`）。审核结果按图片内容缓存 30 分钟，同图不重复计费。

**发送策略**（`sendStrategy`）：默认 `single` —— 单条解析结果整合为一条消息发送；图片数超过 `singleSendMaxImages`（默认 10）或含视频时自动回退合并转发（需 onebot/satori 且开启 `enableForward`）或逐条模式。`split` 为旧版逐条行为。

**去重三层**（默认全开）：同消息相同链接只解析一次；同消息不同链接解析出相同内容只发首个；标题与简介相同时抑制重复字段。

## X/Twitter 登录态解析 (X/Twitter Authenticated Parsing)

公开推文走 syndication API，无需任何配置。**需登录的推文**（被墙/受限制内容）需要：

1. **配置凭证**：在插件配置中填入你浏览器登录 X 后的 `auth_token` 与 `ct0` 两个 Cookie 值
2. **安装可选依赖 cycletls**（在 Koishi 应用目录执行）：
   ```bash
   npm i cycletls
   ```
   X 的 GraphQL 端点受 Cloudflare TLS 指纹校验保护，Node 原生 TLS 握手会被直接 403；cycletls（Go 二进制）可模拟 Chrome 指纹
3. **环境要求**：允许派生子进程（部分容器/PaaS 禁止）。Alpine/musl 环境（官方 glibc 二进制无法运行）会自动改用静态构建的 `@char46/cycletls-linux-musl-x64`（本插件的可选依赖，自动安装、自动调度）。配置了凭证时，插件加载后自动把 cycletls 环境自检结果输出到运行日志；也可在配置中开启 `enableDiagCommand` 后用 `parse/diag` 在聊天内查看

Public tweets use the syndication API with zero config. **Login-required tweets** need credentials (`auth_token` + `ct0` cookies) and the optional dependency `cycletls` (Chrome TLS fingerprint impersonation to bypass Cloudflare). Run `parse/diag` in chat to troubleshoot without shell access.

## 配置项说明 (Configuration)

### 基本设置 (Basic Settings)
| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `enable` | boolean | true | 启用插件 (Enable plugin) |
| `botName` | string | 视频解析机器人 | 合并转发中的昵称 (Nickname in forward messages) |
| `showWaitingTip` | boolean | true | 显示等待提示 (Show waiting tip) |
| `debug` | boolean | false | Debug 日志 (Debug logging) |
| `enableDiagCommand` | boolean | false | 启用 `parse/diag` 诊断命令（默认关闭；无论开关，配置了 X 凭证时插件加载后都会自动自检并输出到日志）(Enable the `parse/diag` command; auto-diagnosis logs on load when X credentials are set) |
| `platformEnabled` | object | 全开 (All enabled) | 各平台开关 (Platform switches) |

### 消息格式 (Message Format)
| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `unifiedMessageFormat` | string | 见预设 (See preset) | 文字格式，支持变量：${标题} ${作者} ${简介} ${视频时长} ${点赞数} ${收藏数} ${转发数} ${播放数} ${评论数} ${发布时间} ${图片数量} ${作者ID} ${音乐标题} ${音乐作者}，空行自动隐藏 (Text format, supports variables: ${标题} ${作者} ${简介} ${视频时长} ${点赞数} ${收藏数} ${转发数} ${播放数} ${评论数} ${发布时间} ${图片数量} ${作者ID} ${音乐标题} ${音乐作者}, auto-hide empty lines) |

### 媒体发送 (Media Sending)
| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `showImageText` | boolean | true | 发送文字内容 (Send text content) |
| `showCoverImage` | boolean | true | 发送封面图片 (Send cover image) |
| `showCoverFile` | boolean | true | 封面是否以图片形式发送（关闭则只发送链接）(Send cover as image, otherwise link only) |
| `showCoverText` | boolean | true | 发送封面前显示文字提示 (Show text hint before cover image) |
| `coverText` | string | 封面： | 封面前显示的文字 (Text displayed before cover) |
| `showImageFileNew` | boolean | true | 图片是否以图片形式发送（关闭则只发送链接）(Send images as image, otherwise link only) |
| `showAuthorAvatar` | boolean | true | 发送作者头像图片 (Send author avatar image) |
| `showAuthorAvatarFile` | boolean | true | 作者头像图片是否以图片形式发送（关闭则只发送链接）(Send author avatar as image, otherwise link only) |
| `showAuthorAvatarText` | boolean | true | 作者头像前显示文字提示（将追加到文字消息末尾）(Show text hint before author avatar, appended to the text message) |
| `authorAvatarText` | string | 作者头像： | 作者头像前显示的文字 (Text displayed before author avatar) |
| `showMusicCover` | boolean | true | 发送音乐封面图片 (Send music cover image) |
| `showVideoFile` | boolean | true | 视频是否以视频形式发送（关闭则只发送链接）(Send video as file, otherwise link only) |
| `sendLiveMessage` | boolean | true | 直播作品发送文字消息（不发送视频）(Send text message for live streams, no video) |
| `mergeSameOriginImages` | boolean | true | 同源图片内容识别合并（不依赖链接/文件名）：宫格数（4/9/16）按**色调风格一致性**（64bin RGB 直方图逐对交 ≥0.35，标定：同组壁纸 min 0.41 / 无关图 max 0.21）判定同源后拼 √n 宫格；非宫格数按**接缝亮度+纹理连续性**验证长图切分条带后堆叠/拼接；判定不过回退逐张；需 ffmpeg (Content-based same-origin merge: 4/9/16 → style-coherent grid collage; other counts → seam-verified strip merge; per-image fallback) |

### 音乐语音 (Music Voice)
| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `showMusicVoice` | boolean | false | 音乐链接以语音发送 (Send music as voice) |
| `showMusicVoiceFile` | boolean | true | 音乐链接是否以语音形式发送（关闭则只发送链接）(Send as voice file, otherwise link only) |

### 性能与限制 (Performance & Limits)
| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `maxDescLength` | number | 200 | 简介长度上限 (Max description length) |
| `maxConcurrent` | number | 3 | 解析最大并发数 (Max concurrent parsing) |

### 网络与请求 (Network & Request)
| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `timeout` | number | 180000 | API 超时 (ms) (API timeout) |
| `videoSendTimeout` | number | 180000 | 发送超时 (ms) (Send timeout) |
| `userAgent` | string | 见预设 | User-Agent |
| `proxy` | object | ... | HTTP/HTTPS 代理 (Proxy) |
| `customHeaders` | array | [] | 自定义请求头 (Custom headers) |

### 发送与重试 (Send & Retry)
| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `ignoreSendError` | boolean | true | 忽略发送失败 (Ignore send errors) |
| `retryTimes` | number | 3 | 重试次数 (Retry times) |
| `retryInterval` | number | 1000 | 重试间隔 (ms) (Retry interval) |
| `enableForward` | boolean | false | 合并转发（OneBot/Satori）(Enable forward message) |

### 缓存与去重 (Cache & Deduplication)
| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `enableDeduplication` | boolean | true | 启用重复解析检测与提示 (Enable duplicate detection) |
| `deduplicationInterval` | number | 180 | 去重间隔 (s) (Deduplication interval) |
| `cacheTTL` | number | 600 | 缓存时间 (s) (Cache TTL) |

### API 与平台 (API & Platforms)
| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `platformDedicatedFirst` | object | 全关 (All off) | 优先专属 API (Prioritize dedicated APIs) |
| `customApis` | array | [] | 覆盖内置平台 API (Override built-in APIs) |
| `customPlatforms` | array | [] | 自定义新平台 (Custom platforms) |
| `globalFieldMapping` | string | 预设 (Preset) | 全局字段映射 JSON (Global field mapping JSON) |

### 界面文本 (UI Text)
| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `waitingTipText` | string | 正在解析... | 等待提示 (Waiting tip) |
| `unsupportedPlatformText` | string | 不支持该平台 | 不支持提示 (Unsupported platform tip) |
| `invalidLinkText` | string | 无效链接 | 无效链接提示 (Invalid link tip) |
| `parseErrorPrefix` | string | ❌ 解析失败： | 错误前缀 (Error prefix) |
| `parseErrorItemFormat` | string | ... | 错误格式 (Error format) |
| `deduplicationTipText` | string | 链接 ${url} 在最近 ${interval} 秒内已解析过，已跳过。 | 重复解析提示 (Duplication tip) |

### 解析网关 (Parse Gateway)

依据上游[迁移公告（issue #12）](https://github.com/Minecraft-1314/koishi-plugin-video-parser-all/issues/12)，本插件采用**条件化双网关**：

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `apiKey` | string | ''（空） | api-new.ifphp.com 网关 API Key。[注册获取](https://api-new.ifphp.com/auth/login) |

- **配置了 `apiKey`** → 自动切换到新网关 `api-new.ifphp.com`（主 API `/api/svparse` + B站/抖音/快手/视频号/豆包/皮皮搞笑专属端点），所有请求携带 `X-API-Key` 头
- **未配置** → 继续使用旧网关 `api.bugpk.com`（无需 Key，行为与 v1.5.8 相同）。注意：旧网关将逐步停止解析能力，建议尽早配置 `apiKey`
- X/Twitter 解析不受网关影响（始终走原生 syndication/GraphQL）

## 支持的变量 (Supported Variables)

> 在 `unifiedMessageFormat` 中可使用以下变量，空行自动隐藏。  
> The following variables can be used in `unifiedMessageFormat`, empty lines are auto-hidden.

| 变量 (Variable) | 说明 (Description) |
|----------------|--------------------|
| `${标题}` | 视频/图集标题 (Title) |
| `${作者}` | 作者名称 (Author name) |
| `${简介}` | 内容简介 (Description) |
| `${视频时长}` | 视频时长（时:分:秒）(Duration, hh:mm:ss) |
| `${点赞数}` | 点赞数量 (Like count) |
| `${收藏数}` | 收藏数量 (Favorite count) |
| `${转发数}` | 转发/分享数量 (Share count) |
| `${播放数}` | 播放量 (Play count) |
| `${评论数}` | 评论数量 (Comment count) |
| `${发布时间}` | 发布时间（格式化）(Publish time, formatted) |
| `${图片数量}` | 图集/实况图片数量 (Image count) |
| `${作者ID}` | 作者唯一标识ID (Author ID) |
| `${音乐标题}` | 音乐标题 (Music title) |
| `${音乐作者}` | 音乐作者 (Music author) |

## 支持的平台 (Supported Platforms)

> 以下为插件内置链接匹配规则，可根据用户发送的链接自动识别。所有匹配规则同时支持 HTTP 和 HTTPS 协议，并兼容多级路径（如短链后带 `/` 子路径）。  
> The following are the built-in link matching rules, which can automatically identify links sent by users. All rules support both HTTP and HTTPS, and are compatible with multi-level paths (e.g., short links followed by `/` subpaths).

| 平台名称 (Platform) | 关键词识别（匹配的域名/路径模式）(Keyword/Domain Patterns) | 解析能力 (Supported Content) |
|---------------------|--------------------------------------------------------------|------------------------------|
| 哔哩哔哩 (B站) Bilibili | `bilibili.com/video/`, `b23.tv`, `bili*.cn`, `b23.wtf`, `bili2233.cn` | 视频 (Video) |
| 抖音 Douyin | `douyin.com/video/`, `v.douyin.com` | 短视频、图集、实况 (Short video, Image, Live photo) |
| 快手 Kuaishou | `kuaishou.com/short-video/`, `v.kuaishou.com`, `kuaishou.com/f/` | 短视频、图集 (Short video, Image) |
| 小红书 Xiaohongshu | `xiaohongshu.com/discovery/item/`, `xhslink.com`, `xiaohongshu.com/explore/`, `xiaohongshu.com/board/` | 图文、视频 (Image, Video) |
| 微博 Weibo | `weibo.com/数字/`, `video.weibo.com/show`, `t.cn`, `m.weibo.cn` | 视频、图集 (Video, Image) |
| 西瓜视频 Xigua | `ixigua.com` | 短视频 (Short video) |
| YouTube | `youtube.com/watch`, `youtu.be`, `youtube.com/shorts/` | 视频 (Video) |
| TikTok | `tiktok.com/@/video/`, `vm.tiktok.com`, `vt.tiktok.com` | 短视频 (Short video) |
| AcFun（A站） | `acfun.cn/v/ac` | 视频 (Video) |
| 知乎 Zhihu | `zhihu.com/video/`, `zhihu.com/question/xxx/answer/xxx`, `zhuanlan.zhihu.com/p/`, `zhihu.com/zvideo/` | 视频、回答中的视频 (Video, answer video) |
| 微视 Weishi | `weishi.qq.com/weishi/feed/` | 短视频 (Short video) |
| 虎牙 Huya | `huya.com/video/` | 直播回放、视频 (Live replay, Video) |
| 好看视频 Haokan | `haokan.baidu.com/v?vid=` | 短视频 (Short video) |
| 美拍 Meipai | `meipai.com/media/` | 短视频 (Short video) |
| Twitter / X | `twitter.com/用户名/status/`, `x.com/用户名/status/` | 视频、图文 (Video, Image) |
| Instagram | `instagram.com/p/`, `instagram.com/reel/`, `instagram.com/share/` | 图文、Reels (Image, Reels) |
| 豆包（视频）Doubao Video | `doubao.com/video/`, `doubao.com/video-sharing` | 视频 (Video) |
| 豆包（图集）Doubao Image | `doubao.com/thread/` | 图文 (Image) |
| **即梦 (Jimeng)** | `jimeng.jianying.com`, `jimeng.cn`, `dreamina.jianying.com`, `dreamina.capcut.com` | AI视频、AI图片 (AI video, AI image) |
| 绿洲 Oasis | `oasis.weibo.com/v/` | 视频、图文 (Video, Image) |
| 视频号 WeChat Channels | `channels.weixin.qq.com`, `weixin.qq.com/sph/` | 短视频 (Short video) |
| 梨视频 Lishi | `pearvideo.com/video_`, `video.li` | 短视频 (Short video) |
| 全民直播 Quanmin | `quanmin.tv`, `quanmintv.cn` | 直播 (Live) |
| 皮皮搞笑 Pipigx | `h5.pipigx.com/pp/post/`, `ippzone.com` | 短视频 (Short video) |
| 皮皮虾 Pipixia | `pipix.com`, `pipixia.com` | 短视频 (Short video) |
| 最右 Zuiyou | `share.xiaochuankeji.cn/hybrid/share/post`, `izuiyou.com` | 短视频 (Short video) |
| 🔧 自定义平台 Custom | 通过 `customPlatforms` 配置添加 (Add via `customPlatforms`) | 取决于提供的 API (Depends on API) |

## 项目贡献者 (Contributors)

| 贡献者 (Contributor) | 贡献内容 (Contribution) |
|----------------------|-------------------------|
| Minecraft-1314 | 插件完整开发 (Complete plugin development) |
| char46 | 模块化重构、X/Twitter 登录态解析（cycletls + GraphQL 回退）、CLI、测试框架、`parse/diag` 诊断 (Modular refactor, X/Twitter authenticated parsing via cycletls + GraphQL fallback, CLI, test framework, `parse/diag` diagnostics) |
| ShiraiKuroko003 | 修复消息格式设置问题并且PR-1.2.5版本已修复 (Fixed message format issue, PR-1.2.5) |
| cyavb | 提交功能建议-给自定义API添加KEY认证-已采纳 (Suggested custom API key auth - adopted) |
| Keep785 | 提交Bug-无法正常关闭发送封面-已修复<br>提交Bug-解析问题-已修复 (Reported bug - cannot disable cover sending - fixed<br>Reported bug - parsing issue - fixed) |
| dzt2008 + Apricityx | 提交Bug-会对非支持视频平台URL进行误解析-已修复 (Reported incorrect parsing of unsupported URLs - fixed) |
| linyves | 提交Bug-小红书图集重复发送封面-已修复<br>提交Bug-话题显示异常 #**[话题]#-已修复<br>提交建议-Live Photo 全部按普通图片处理-已采纳<br>提交Bug-解析后会把作者头像一起发送-已修复 (Reported bug - duplicate cover for Xiaohongshu image posts - fixed<br>Reported bug - abnormal topic display #**[topic]# - fixed<br>Suggestion - treat Live Photos as normal images - adopted<br>Reported bug - author avatar sent together after parsing - fixed) |
| JH-Ahua | BugPk-Api 支持 (BugPk-Api support) |
| shangxue | 灵感来源 (Inspiration) |

（欢迎通过 Issues 或 PR 加入贡献者列表）  
(Welcome to join the contributor list via Issues or PR)

## 许可协议 (License)

本项目（插件本体）采用 **MIT** 许可证，基于 [Minecraft-1314/koishi-plugin-video-parser-all](https://github.com/Minecraft-1314/koishi-plugin-video-parser-all) 的 MIT 项目 fork 而来，详情参见 [LICENSE](LICENSE) 文件。  
This project (the plugin itself) is licensed under the **MIT** License, forked from the MIT-licensed project by Minecraft-1314. See the [LICENSE](LICENSE) file for details.

**第三方组件分层说明 (Third-party components)**：
- `cycletls`（可选依赖，仅 X/Twitter 登录态解析使用）：[GPL-3.0](https://github.com/Danny-Dasilva/CycleTLS/blob/master/LICENSE)。它作为独立子进程运行（进程边界 + WebSocket 通信），不包含在本包的发布产物中，其 GPL 义务不及于本插件。
- `@char46/cycletls-linux-musl-x64`（可选依赖，musl/Alpine 环境的静态二进制）：独立 npm 包，以 GPL-3.0 单独分发并附带源码指向，同样不包含在本包发布产物中。

## 支持我们 (Support Us)

如果这个项目对您有帮助，欢迎点亮右上角的 Star ⭐ 支持我们！  
If this project is helpful to you, please feel free to star it in the upper right corner ⭐ to support us!