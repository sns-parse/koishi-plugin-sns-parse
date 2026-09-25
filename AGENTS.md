# AGENTS.md

## 同步上游 (Sync with Upstream)

- 本仓库是 [Minecraft-1314/koishi-plugin-video-parser-all](https://github.com/Minecraft-1314/koishi-plugin-video-parser-all) 的 fork，架构已大幅分叉（`src/` 结构不兼容：本 fork 有 `src/utils/` 目录、`src/engine/`、`src/sender/`、`src/services/` 等；上游为扁平 `src/utils.ts`、`src/config.ts` 等）。
- 同步上游时：**优先吸收功能性修复与文档**；上游的 `src` 大重构类提交需评估，避免破坏 fork 自身工作。
- 同步完成后，**记得移除 GitHub 上「N commits behind Minecraft-1314/koishi-plugin-video-parser-all:main」的落后提示**：用 `git merge -s ours upstream/main`（生成合并提交、把上游提交并入历史以清除 behind 状态，同时保留 fork 自身的代码树），或用等效方式使上游提交成为本分支祖先。

## 分层架构 (Layering)

- **架构铁律（0.6 起）：core 内建完整工作流（9 阶段管道：parse/translate/media.*/merge/transcode/compose/send）+ 基线行为，不内建任何扩展实现、不依赖扩展包**；无扩展时全链路可跑（媒体直通、不合并逐张发、GIF 退化发视频、不翻译）。扩展（`@sns-parse/ext-*`）经 `WorkflowExtension.setup(hooks)` 注入/修改：`before`/`after` 可改输入输出、`replace` 整体替换（后注册者胜）——NSFW→`media.*`、合并→`merge`、GIF→`transcode`、翻译→`translate`。**平台支持范围 = 已加载平台插件声明并集**（`collectPlatformDefinitions()`：聚合包 `definitions[]` 先行 + 粒度包覆盖，未装即不识别）。宿主统一 `loadWorkflowExtensions()` 装配。`flush.ts:45` 式 `Required` 硬解构是反模式（缺扩展即崩），一律走 `runStage`。
- 目标：拆成「核心 core + 平台依赖 platforms + 扩展 extensions + Koishi 兼容层」四层，可独立成多仓库/多包。
- **已落地接缝**（本仓库内，行为不变）：
  - `src/core/host.ts`：`VideoParserHost`（logger/baseDir/getService/sender/extensions/context），core 不依赖 Koishi/CLI。
  - `src/core/sender.ts`：发送层无关 `OutboundElement` IR + `OutboundSender`；Koishi 适配器在 `src/sender/koishi-sender.ts`。
  - `src/core/flush.ts`、`src/core/compose.ts`、`src/core/forward.ts`：编排逻辑（发送层无关）。
  - `src/core/extensions.ts`：`VideoParserExtensions` 契约；默认实现在 `src/extensions/default.ts`（= `loadExtensionImplementations()` 动态发现已装 ext-*）。
  - `src/utils/logger.ts`：可注入 `LoggerLike`（默认静默；Koishi/CLI 分别注入）。
  - `src/runtime.ts`：以 `host` 构建，`extensions = 默认实现 + host.extensions`。
- 包矩阵：`@sns-parse/core`；`@sns-parse/platform-*`×27 + `@sns-parse/platforms` + `@sns-parse/cli`；`@sns-parse/ext-nsfw`/`-ext-merge`/`-ext-translate`/`-ext-gif`；`@sns-parse/koishi-plugin-sns-parse`。
- 平台声明真相源 = 各 `@sns-parse/platform-<type>` 包的 `PlatformDefinition`（rules/dedicated/parse/translate）；`src/platforms/rules.ts`/`definitions/*`/`gen-defs.ts` 已退役（0.6 起动态发现）。
- `tlsget-rs` **保留 `@char46` 命名与 `char-46/tlsget-rs` 仓库不变**（不重建 6 个平台二进制）。

## 命名空间与配置迁移 (Namespace & Config Migration)

- 新包 `@sns-parse/koishi-plugin-sns-parse` 使用命名空间 `sns-parse`；旧包 `@char46/koishi-plugin-video-parser-all` 保持 `video-parser-all`。二者共用 `createPlugin(pluginName)` 实现（`src/index.ts`）。
- **配置跨命名空间迁移**：`src/services/config-io.ts`
  - `parse/config export [--include-secrets]`（默认脱敏，密钥打码 `***`）
  - `parse/config import <JSON|路径>`、`parse/config migrate <JSON|路径>`（写入 `<baseDir>/data/<name>/config.override.json` 并热应用）
  - 启动时 `applyOverrideToConfig()` 合并覆盖文件到 schema 配置之上
  - CLI：`--export-config [--include-secrets]`、`--config <file>`
- 两包命令根统一 `parse`（同时安装会命令重名，文档提醒二选一）。

## 本地布局与建仓前置 (Local Layout / Repo Prerequisites)

- 本地布局：`A:\tlsget-rs`；`A:\sns-parse\{core,platforms,extensions,koishi-plugin-sns-parse}`；旧路径 `A:\koishi-plugin-video-parser-all` 以 Junction 指向 `A:\sns-parse\koishi-plugin-sns-parse`。
  - 迁移脚本：`A:\sns-parse\setup-koishi-repo.ps1`（幂等；**opencode 会话占用工作目录期间无法移动，需在会话外运行**）。
- **阻塞项**：GitHub 组织 `sns-parse` 尚未创建（`gh api orgs/sns-parse` 404，`char-46` 不在该组织），npm scope `@sns-parse` 尚未建立且本机未 `npm login`。完成 Phase 7 建仓/发布前需先在 GitHub 建组织（或改指定组织）、npm 建立 scope 并确认发布 token 权限。

## 版本发布 (Versioning)

- **充分利用语义化版本**：区分 patch / minor / major，让版本号如实反映变更性质与稳定程度。
- **恰当使用预发布版本**：功能尚未稳定时发 `alpha` / `beta` / `rc`（如 `1.14.0-beta.1`），不要未稳定就发正式 minor。
- **0.x/先行阶段的 minor 纪律**：alpha 阶段每个包固定一个目标 minor，迭代只刷 `alpha.N`；minor 只留给真正的 API 破坏性变更，且当次必须同步全链路依赖范围（0.x 的 `^` 钉死 minor，core 涨 minor 会让所有 ext-*/platform-* 范围失效 → 嵌套多份 core 实例、logger 单例分裂，2026-09 全链路重发 ext-* 就是这账单）。
- **恰当使用其他 metadata**：如 `+upstream.X.Y.Z` build 段标注所跟随的上游基线版本。
- 现阶段统一使用先行版本 + build metadata（如 `0.2.0-alpha.1+upstream.1.6.7`）；聚合包自动装全部碎片包。

## sns-parse 分层发布状态 (Published Packages)

- npm scope `@sns-parse` 与 GitHub org `sns-parse`（char-46 为 admin）：
  - `@sns-parse/core`：**完整工作流层**（`0.6.0-alpha.2+upstream.1.6.7`）：契约/配置 DSL/引擎配置声明/`createRuntime(source, config, {defs, extensions})`/9+1 阶段管道（`workflow/hooks.ts` + `workflow/default.ts` 基线；`parse.generic` 为**通用链接解析预留**——契约 `engine/generic.ts`（OG/HTML/LLM `LlmOptions`）+ 配置组「通用链接解析（预留）」，基线=null 未实现）/`flush`/`compose`/`forward`/`loadWorkflowExtensions()`（动态发现 ext-*）/`collectPlatformDefinitions()`（聚合+粒度并集）/`collectCapabilities`/`defaultsFromContributions`/`engineConfigContributions()`；语种工具 `langName`/`shouldSkipTranslate`
  - `@sns-parse/ext-nsfw`/`ext-merge`/`ext-translate`/`ext-gif`（均 `0.3.0-alpha.1`，钩子注入 `WorkflowExtension`）+ `@sns-parse/extensions`（0.3.0-alpha.1 聚合 + `allExtensions`）
  - `@sns-parse/platform-twitter`（0.3.0-alpha.2）：X syndication/GraphQL 原生解析 + 推文树/用户维度查询 + Grok 翻译（`parse`/`translate` 钩子）+ **外链卡片（t.co 预览）**：`buildLinkUrlMap`（外链原位展开/X 内部互链剥离）+ `fetchLinkCardPreview`（og:image/twitter:image 注入预览图，仅无原生媒体时，≤2 目标/10s/512KB 有界）
  - `@sns-parse/platform-xiaohongshu`（0.3.0-alpha.3）：**原生解析**——短链自展开（死链/登录墙从 redirectPath 恢复重试）→ 游客页 `__INITIAL_STATE__`（图文/视频流/互动数）→ og 兜底 → 旧网关（bugpk）兜底；rules 已带 query 捕获（**explore/discovery/board 链接的 xsec_token 不再被剥离**——旧正则会丢 query 导致网关必报 Missing xsec_token）
  - 其余 `platform-<type>` ×26 + `@sns-parse/platforms`（0.3.0-alpha.2 聚合 + `definitions[]` 导出）
  - `@sns-parse/koishi-plugin-sns-parse`：Koishi 兼容层（`1.20.0-alpha.11+upstream.1.6.7`；直依赖 platform-twitter + platform-xiaohongshu）
  - `@sns-parse/cli`：CLI 兼容层（`0.2.0-alpha.2+upstream.1.6.7`）
  - `@char46/koishi-plugin-video-parser-all`：旧命名空间兼容壳（lockstep `1.20.0-alpha.11`）
- 聚合包语义：`@sns-parse/extensions` / `@sns-parse/platforms` 通过 `dependencies` 自动装全部碎片包；platforms **导出 `definitions[]`**（聚合优先通道），extensions 导出 `allExtensions()`；碎片包可自选安装（粒度覆盖聚合）。
- 配置机制：core 定义中立 DSL（`ConfigField`/`ConfigContribution`）；**配置项来自已安装的 ext-*/platform-* 声明**，koishi 层动态翻译为 Schema；CLI 层同理。
- Koishi 仓库不 monorepo；通过 npm 依赖 + git submodule（`vendor/{core,extensions,platforms}`）管理。
- 发布限制：bypass 2FA 的 granular token **不能 `unpublish`**，只能用 `deprecate`/`dist-tag` 纠正；彻底删除需 npm 网页。

## 待办 (TODO)

- **0.6 工作流+钩子迁移已完成（2026-09）**：core 内建完整工作流（flush/compose/forward 已上收 core）+ 基线实现；ext-\* 全部改 `WorkflowExtension.setup(hooks)` 注入；平台声明动态发现（聚合+粒度并集，静态 definitions/rules/gen-defs 退役）；koishi 测试 185/185（含无扩展基线全链路、updateFragments 判定）。
- **运行时实现切换（2026-09，已被 0.6 取代）**：引擎与扩展实现来自外部包；`src/services/nsfw/*` 仅剩 ext-nsfw 的路径兼容 shim。
- **碎片包热更（1.20.0-alpha.10）**：`updateFragments()`（self-update.ts）——范围内更新全部 `@sns-parse/*` 碎片包（0.x minor 锁语义 `inRange()`；范围外仅提示升本体；**未声明范围的包按当前版本 caret 保守锁**）；触发：设置触发器 `updateFragmentsTrigger`（开启并保存即执行一次并自动复位写 override）/`parse/update --fragments`/`updateOnStartup`/`autoUpdateHours` 自动链路一并更碎片；装完 `applyReload`。真按钮卡片（`ctx.console.addEntry`）留待后续（需 `@koishijs/client` 构建链与用户 console 大版本对齐）。
- **自更新（1.20.0-alpha.7）**：`src/services/self-update.ts`——设置（updateOnStartup）/ 定时（autoUpdateHours）/ 命令（parse/update，authority 3）三路触发；registry 解析（显式 > 项目 .npmrc > 用户 .npmrc > npmmirror）；锁文件探测 PM（pnpm/yarn classic+berry/npm）；守护进程（IPC 存在）下 `loader.fullReload()`（退出码 51 自动重启），否则提示手动重启；主版本跨越不自动更。
- tag 触发的 CI 发布（含发布后自动 npmmirror 同步）尚未演练过：push 一个 `v*` tag 即可验证。
- 旧包 `@sns-parse/extensions@0.1.0`（实现版）已 `deprecate`；如需移除请在 npm 网页操作。

## pnpm 工具链 (Toolchain)

- **全部仓库已切 pnpm 12**（`packageManager: pnpm@12.3.4`）：`A:\sns-parse\{core,extensions,platforms,cli,legacy-plugin,koishi-plugin-sns-parse}`；CI 经 `pnpm/action-setup` + `pnpm install --frozen-lockfile`。
- **pnpm 12 不再读 package.json 的 `pnpm` 字段**：构建脚本许可（`allowBuilds: {esbuild: true, ffmpeg-static: false}`）与工作区（`packages: ['packages/*']`）统一放 `pnpm-workspace.yaml`；`pnpm approve-builds --all -y` 可代写。
- **供应链策略**：pnpm 12 默认 `minimumReleaseAge` 会拦截「当天发布」的依赖（含我们自己的 @sns-parse/* 新版本）→ 各仓 `pnpm-workspace.yaml` 统一 `minimumReleaseAge: 0`。
- **registry 动态探测**（core 的 `createRequire` 扫描已装 platform-*/ext-*）依赖提升：koishi 与 cli 仓 `.npmrc` 配 `public-hoist-pattern[]=*@sns-parse*`。
- **发布用 npm CLI**（`npm publish --access public --tag alpha`）：本机 pnpm publish 对 granular token 报 403（whoami 正常、npm 可发），原因未明；CI 内 pnpm publish 是否复现待首个 tag 验证。
- **core 仓库测试用 tsx + node:assert**（`pnpm test`）：vitest 在 core 目录起跑即挂（换版本/清缓存/孤进程排查均无效；koishi 仓 vitest 正常）——勿在 core 重引 vitest。
- **坑**：`linkTypeParser` 的规则 regex 必须带 `g` 标志，否则 `exec` 不推进 lastIndex → 死循环（测试里写裸 `/x/i` 会把 runner 挂死）。
- **依赖范围禁止含 build metadata**（`+upstream...`）：npmjs 宽容、**npmmirror 严格解析 → ETARGET**（`@sns-parse/platforms@0.2.0-alpha.1` 踩坑，0.2.0-alpha.2 起修复）；版本号本身可带 build 段（npm 发布时自动剥离）。
- **发包后自动同步 npmmirror**：`node scripts/sync-mirrors.mjs`（404 包 GET 触发按需同步 + 滞后包显式 `PUT /-/package/<name>/syncs` + 每秒轮询、全部就绪即退）；extensions/platforms/legacy/cli 的 CI 在 tag 发布后自动执行（从本仓库 main 拉取脚本）。镜像 CDN 边缘可能**缓存 404（负缓存）**：用户侧重试仍 404 时等待数分钟或临时切换 registry.npmjs.org。
- 本机命令惯例：先打印 `START <时间>`；长任务用 `Start-Process`+`WaitForExit(<上限>)`+超时 `taskkill /PID <id> /T /F`（整树击杀，勿留孤儿）。
