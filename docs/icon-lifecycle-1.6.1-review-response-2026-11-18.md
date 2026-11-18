# 1.6.1 审查修复记录：409 安全续传与运行时问题

日期：2026-11-18。针对 1.6.0 审查新增 P1 修复；1.6.0 不标记完成，1.6.1 仍需完成真实浏览器验收。

## 一、409 覆盖新图的根因与修复

### 根因
`asset-jobs-runner.js` 把**所有 409**都当成 `version_conflict`：调用 `refreshJobVersion` 只按 savedUrl lookup 最新版本，然后把旧 Blob 用新版本自动重传。独立复现中上传 `expectedVersion` 依次为 `[1,3]`，第二次上传覆盖了服务端较新的图片。服务端实际 409 至少有三类：`version_conflict`、`preview_source_changed`/`icon_source_changed`、`idempotency_conflict`，旧代码不区分错误码。

### 修复
- 按错误码分类：仅 `version_conflict` 进入安全校验；来源变化、幂等冲突和未知 409 直接进入 `conflict` 状态，不 lookup、不自动重传。
- 安全续传前验证：原 `siteId` 一致；savedUrl 仍能 lookup 到同一站点且未删除/归档；**对应素材 revision 与任务已知 revision 一致**；站点版本只允许推进 1（否则视为来源不明）。
- 只有同任务已确认的素材操作/对应 revision 未变时才刷新版本重试；用户换图、删图、来源变化、幂等冲突时保留 Blob，任务置 `conflict`，图标任务置 `unsupported`，提示到工作台明确处理，不覆盖新内容。
- 服务端 `capture_site_dto` 增加 `iconRevision`、`previewRevision`、`iconSourceUrl`、`previewSourceUrl`、`iconPresent`，扩展 lookup/capture 回执据此记录基线 revision。
- 回归（`asset-jobs-conflict.test.mjs`）：
  - 旧任务恢复时已有新图 → conflict，Blob 保留，不自动重试；
  - 用户已删图（已知 revision 非空、服务端为空）→ conflict；
  - 来源变化（`preview_source_changed`）→ 不 lookup、不重传；
  - 幂等冲突 → conflict；
  - 同任务 preview 推进版本后 icon 冲突，revision 匹配才安全续传；
  - 版本冲突但对应 revision 未变 → 校验后安全续传；
  - 原有 409 自动重试测试改为显式 `version_conflict` 错误码。

## 二、工具栏 popup 问题定位

- 确认过一个具体环境根因：**Edge 157 重启后“开发人员模式”变为关闭，未打包扩展被禁用，action popup 无法打开**；截图显示开发人员模式 Off、扩展卡片关闭。开启开发人员模式并启用扩展后，扩展状态恢复 On。
- 但本机自动化用合成鼠标点击工具栏/发送快捷键，仍无法稳定触发 action popup；`popup.html` 直接打开正常（显示已连接 v1.6.1、队列 0）。因此**未将独立 popup.html 作为验收替代**，真实工具栏/快捷键打开仍未完成验证。
- 这不是仅靠代码可证明修复的问题；需要在真实用户点击/快捷键下复测。当前记录为未关闭阻塞。

## 三、真实浏览器验收状态

- 未完成：ChatGPT 首次快速收藏→关闭 popup→后台采集→最终上传→刷新显示（因 action popup 无法稳定打开，未执行保存）。
- 未完成：实体浏览器断网后恢复（同样依赖 popup 触发收藏；未用直接 API 或 popup.html 冒充）。
- 已完成：运行时扩展 1.6.1 加载；直接 popup 调试页显示已连接 v1.6.1、待同步 0；真实库 4 站点/3 图标/4 预览，`integrity_check=ok`，账号/收藏/配对/队列保留。
- 未验证：真实浏览器中的 409 冲突场景（由真实 engine/queue/asset 组合测试覆盖）。

## 四、发布与回归

- 扩展 1.6.1：`extension/dist/website-workspace-extension-1.6.1.zip`，82,606B，SHA-256 `7d72472d91b6d671b328eb019597bc428339ecce7b7d65210f89f7f51dd0faf0`。
- 加载目录 38 文件与 ZIP 逐字节一致；manifest/package/popup/engine/options/README/server download 测试均更新到 1.6.1。
- 扩展 96 项、后端 155 项通过；扩展 check 50 文件通过；前端/脚本本轮未重跑（无前端改动；脚本构建通过）。
- 站内 release/download 哈希一致。

## 五、剩余限制

1. 工具栏/快捷键 action popup 在当前自动化环境仍未稳定打开；真实用户点击未验证，是验收阻塞。
2. 因此 ChatGPT 首次快速收藏与实体断网恢复未完成，不能标记 1.6.0/1.6.1 完成。
3. Chrome、低内存 Debian、云端未复测。
