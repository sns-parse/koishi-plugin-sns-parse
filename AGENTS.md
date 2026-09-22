# AGENTS.md

## 同步上游 (Sync with Upstream)

- 本仓库是 [Minecraft-1314/koishi-plugin-video-parser-all](https://github.com/Minecraft-1314/koishi-plugin-video-parser-all) 的 fork，架构已大幅分叉（`src/` 结构不兼容：本 fork 有 `src/utils/` 目录、`src/engine/`、`src/sender/`、`src/services/` 等；上游为扁平 `src/utils.ts`、`src/config.ts` 等）。
- 同步上游时：**优先吸收功能性修复与文档**；上游的 `src` 大重构类提交需评估，避免破坏 fork 自身工作。
- 同步完成后，**记得移除 GitHub 上「N commits behind Minecraft-1314/koishi-plugin-video-parser-all:main」的落后提示**：用 `git merge -s ours upstream/main`（生成合并提交、把上游提交并入历史以清除 behind 状态，同时保留 fork 自身的代码树），或用等效方式使上游提交成为本分支祖先。

## 分层架构 (Layering)

- 目标：拆成「核心 core + 平台依赖 platforms + 扩展 extensions + Koishi 兼容层」四层，可独立成多仓库/多包。
- **已落地接缝**（本仓库内，行为不变）：
  - `src/core/host.ts`：`VideoParserHost`（logger/baseDir/getService/sender/extensions/context），core 不依赖 Koishi/CLI。
  - `src/core/sender.ts`：发送层无关 `OutboundElement` IR + `OutboundSender`；Koishi 适配器在 `src/sender/koishi-sender.ts`。
  - `src/core/flush.ts`、`src/core/compose.ts`、`src/core/forward.ts`：编排逻辑（发送层无关）。
  - `src/core/extensions.ts`：`VideoParserExtensions` 契约；默认实现在 `src/extensions/default.ts`。
  - `src/utils/logger.ts`：可注入 `LoggerLike`（默认静默；Koishi/CLI 分别注入）。
  - `src/runtime.ts`：以 `host` 构建，`extensions = 默认实现 + host.extensions`。
- 包矩阵（计划）：`@sns-parse/core`；`@sns-parse/platform-*`×27 + `@sns-parse/platforms` + `@sns-parse/cli`；`@sns-parse/ext-nsfw`/`-ext-merge`/`-ext-translate`/`-ext-gif`；`@sns-parse/koishi-plugin-sns-parse`。
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
- **恰当使用其他 metadata**：如 `+upstream.X.Y.Z` build 段标注所跟随的上游基线版本。
- 现阶段统一使用先行版本 + build metadata（如 `0.2.0-alpha.1+upstream.1.6.7`）；聚合包自动装全部碎片包。

## sns-parse 分层发布状态 (Published Packages)

- npm scope `@sns-parse` 与 GitHub org `sns-parse`（char-46 为 admin）：
  - `@sns-parse/core`：契约 + 配置 DSL + 平台配置聚合（`0.3.0-alpha.1+upstream.1.6.7`）
  - `@sns-parse/ext-nsfw|ext-merge|ext-translate|ext-gif` + `@sns-parse/extensions`（纯依赖聚合）
  - `@sns-parse/platform-<type>` ×27 + `@sns-parse/platforms`（纯依赖聚合）
  - `@sns-parse/koishi-plugin-sns-parse`：Koishi 兼容层，命名空间 `sns-parse`，动态配置
  - `@char46/koishi-plugin-video-parser-all`：旧命名空间兼容壳（转发新包，迁移非强制）
- 聚合包语义：`@sns-parse/extensions` / `@sns-parse/platforms` 仅 `dependencies` 自动装全部碎片包，**不 re-export**；碎片包可自选安装。
- 配置机制：core 定义中立 DSL（`ConfigField`/`ConfigContribution`）；**配置项来自已安装的 ext-*/platform-* 声明**，koishi 层动态翻译为 Schema；CLI 层同理。
- Koishi 仓库不 monorepo；通过 npm 依赖 + git submodule（`vendor/{core,extensions,platforms}`）管理。
- 发布限制：bypass 2FA 的 granular token **不能 `unpublish`**，只能用 `deprecate`/`dist-tag` 纠正；彻底删除需 npm 网页。

## 待办 (TODO)

- **CLI 兼容层 `@sns-parse/cli`**：需先把引擎（`engine/fetcher`、`engine/parser`、`utils/{format,url,cache,concurrency,field-mapping,common,tls-client}`）下沉到 `@sns-parse/core` 并发布，再建独立 CLI 仓库；同样从 core 取配置声明。
- **运行时实现切换**：koishi 运行时当前仍用本地实现（测试依赖本地 `nsfw/vault` 单例）；后续切换为 `ext-*` 包实现并同步测试。
- 旧包 `@sns-parse/extensions@0.1.0`（实现版）已 `deprecate`；如需移除请在 npm 网页操作。
