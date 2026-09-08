# AGENTS.md

## 同步上游 (Sync with Upstream)

- 本仓库是 [Minecraft-1314/koishi-plugin-video-parser-all](https://github.com/Minecraft-1314/koishi-plugin-video-parser-all) 的 fork，架构已大幅分叉（`src/` 结构不兼容：本 fork 有 `src/utils/` 目录、`src/engine/`、`src/sender/`、`src/services/` 等；上游为扁平 `src/utils.ts`、`src/config.ts` 等）。
- 同步上游时：**优先吸收功能性修复与文档**；上游的 `src` 大重构类提交需评估，避免破坏 fork 自身工作。
- 同步完成后，**记得移除 GitHub 上「N commits behind Minecraft-1314/koishi-plugin-video-parser-all:main」的落后提示**：用 `git merge -s ours upstream/main`（生成合并提交、把上游提交并入历史以清除 behind 状态，同时保留 fork 自身的代码树），或用等效方式使上游提交成为本分支祖先。

## 版本发布 (Versioning)

- **充分利用语义化版本**：区分 patch / minor / major，让版本号如实反映变更性质与稳定程度。
- **恰当使用预发布版本**：功能尚未稳定时发 `alpha` / `beta` / `rc`（如 `1.14.0-beta.1`），不要未稳定就发正式 minor。
- **恰当使用其他 metadata**：如 `+upstream.X.Y.Z` build 段标注所跟随的上游基线版本。
