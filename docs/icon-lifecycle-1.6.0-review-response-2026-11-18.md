# 1.6.0 审查修复记录：队列与附件恢复

日期：2026-11-18。针对 `docs/icon-lifecycle-1.5.0-review-2026-11-18.md` 的 P1/P2 项修复，已发布扩展 1.6.0 并更新本机运行时。

## 修复

1. **文字未确认时不再改写队列状态**：新增独立 `assetJobs`（`extension/asset-attach.js`、`engine-assets.js`）。迟到素材只合并附件引用；文字任务保持 pending/auth/blocked 和退避状态。只有文字回执写入 `captureReceipts` 后才给任务补 siteId/siteVersion 并进入上传阶段。修正原“文字还在队列时…”错误测试预期。
2. **上传前持久化、失败保留 Blob**：`attach` 先校验 IndexedDB 记录并写入任务，再由 `asset-jobs-runner.js` 联网；网络/超时/5xx/429/401 保留 Blob 和任务并有限退避；403 作为单次权限/回执失败标记失败但不暂停整个账号连接；只有服务端确认成功或用户显式取消才删除 Blob。409 先按站点 URL 刷新版本再重试，保留版本保护。
3. **真实模块组合回归**：新增 `asset-jobs.test.mjs`，使用真实 engine/queue/asset-attach/asset-jobs-runner 组合覆盖：离线收藏→迟到素材→恢复网络自动完成；文字确认→上传断网→新引擎实例（模拟浏览器重启）自动恢复；两个 capture 交错附加/确认各自归属，不依赖 lastResult；401 保留 Blob、413 终态失败不删除；409 刷新版本后自动重试；用户取消才删除。
4. **客户端背景采集**：popup 在提交时持久化同源栅格候选和 tabId；service worker 在 popup 关闭后用现有 `activeTab/scripting` 权限在目标页获取同源图标（`icon-page-capture.js`），保存 Blob 后走独立素材任务上传；跨域/页面已关闭仍走服务端受控兜底。不新增权限，不扩大为全站常驻权限。
5. **不依赖唯一 lastResult**：captureReceipts 与 assetJobs 都按 capture ID 持久化，两个 capture 交错时各自恢复 siteId/version 和附件。
6. **图标 sourceUrl 修复**：客户端背景采集的图标来源使用站点入口 URL（savedUrl），并对历史候选 URL 做 savedUrl 兜底；避免服务端 `icon_source` 以“来源地址已变化”拒绝上传。

## 真实浏览器观察

- 真实 Edge 首次快速收藏 ChatGPT（capture `435c88ea-92e3-416b-9ff3-1cb7e36b3469`）后 popup 已关闭，service worker 仍成功取得客户端 PNG Blob（1548B，来源 `chatgpt.com/unauth-mweb/images/favicon.ico`）并写入持久化 assetJob；preview 已上传，icon 任务保留 Blob。该次上传因当时 sourceUrl 使用候选路径被服务端拒绝（未删除 Blob，任务状态可恢复），sourceUrl bug 已修复并有回归覆盖。
- 本机 Edge 的 action popup 在后续自动化中无法再通过工具栏/快捷键打开（直接打开 popup.html 正常，版本 1.6.0、连接正常、队列 0），因此未能用同一台浏览器重跑“首次快速收藏→自动上传成功”的最终闭环；该限制如实记录，不将第二次手动更新算作首次成功。
- 离线/断网与重启恢复由真实模块组合测试覆盖；真实浏览器已完成关闭 popup 后客户端采集与 Blob 保留观察。

## 回归与发布

- 扩展 `npm test` 91 项通过；`check` 49 个源码文件通过；前端 47 项、Sites 4 项、Django 155 项、脚本 32 项通过；前端 build 成功。
- 扩展 1.6.0：`extension/dist/website-workspace-extension-1.6.0.zip`，81,385B，SHA-256 `bbdc2fe2a3cade2a2ca75ae884875f90d1bd148645e2c66a784b47b521fcd739`；加载目录 38 文件与 ZIP 逐字节一致；popup 调试页实测“已连接 · v1.6.0”，待同步 0 条；站内 release/download 哈希一致。
- 4173 与真实库保留：4 条用户收藏、3 个图标、4 个预览，`integrity_check=ok`；未删除用户数据或队列。

## 未验证/限制

- Edge action popup 的自动化点击/快捷键在本机重启后失效，导致 ChatGPT 首次快速收藏的最终自动上传未在同一浏览器重跑；客户端采集、Blob 持久化与上传重试逻辑由真实模块组合测试覆盖。
- 真实断网切换与浏览器完整重启下的 HTTP 上传恢复未在实体浏览器演练（由引擎级组合测试覆盖）。
- Chrome、低内存 Debian、云端未复测。
