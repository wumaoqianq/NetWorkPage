
## 2026-11-18 1.10.0（交互修正候选）：恢复工具栏小弹窗 + 截图两入口，独立配置/测试库真机验收

用户 20:09 实测「点击扩展会打开新标签页、截图入口也找不到了」。按实际原因诊断：查看入口没丢（真实 Edge 点击「查看截图」能打开大图查看器）；真实根因是 (a) `default_popup` 缺失 → 每次开新标签页；(b) 2560×1440 内容丰富页面的原始 PNG 超过 700KB 上限被静默丢弃 + `submitDraft` 丢弃仍为 raw 的截图 → 新收藏缺图，卡片显示「暂无截图」（用户 19:11 真实收藏的 YouTube 站点 preview=0 为证）。修复：manifest 恢复 `default_popup`，弹窗只管交互；SW 短窗口采集 + 同一个 captureId 一次性事务落盘文字草稿+原始截图 Blob+图标 Blob；放宽原始快照到有界 8MB、弹窗 DOM/canvas 或后台 OffscreenCanvas 压成有界 WebP；`submitDraft` 不再丢 raw。新增 `popup.html/popup.js/popup.css`、`worker-compress.js`、`raw-preview.js` 与 `popup-entry.test.mjs` / `worker-compress.test.mjs`。三态「正在截图/截图已就绪/截图不可用」、截图失败仍可保存并明确「这次未附截图」。前端 `canViewScreenshot` 回归加固（不改 Logo 紧凑卡片布局）。回归：扩展 168 / 前端 57+Sites 4 / 脚本 35 / 后端 178 全绿，扩展 check 76 文件、前端 build、迁移无漂移、check 0 issues。独立环境：`127.0.0.1:4174` 独立库 + 独立 Edge profile + 独立测试账号/配对设备，日常 4173 数据（5 站点/4 图标/4 预览 + 3 个「我的浏览器」设备、notes/分类不变、integrity ok）。真实 Edge 验收：Alt+Shift+S 打开弹窗，标签数 7→7 无新标签页；截图预览「截图已就绪」；选「验收分类A」+备注 → 「已同步」；立即关弹窗 → 刷新工作台入库精确匹配、1 回执无重复；「查看截图」打开对应网页大图 + 适应窗口/原尺寸/缩放；停 4174 离线保存→关弹窗→仅重启 4174、无用户动作/无重新配对，靠 alarm 自动续传 3 站点/3 预览/3 回执。附带验证：改测试账号密码导致设备 auth_hash 失效 → 401 诚实暂停、队列保留；同账号重新配对恢复、不转投。发布 ZIP 114,814 B，SHA-256 `09551f05365a55f87f3194a539a6f3a6259a5d26f91450508d236a1155fee12d`；4173 release/download 同哈希、日常 Edge 重载后运行 1.10.0、加载目录 54 文件逐字节一致。四阶段仍候选，1.10.0 同为候选，不宣称全面验收完成。千问/ChatGPT 首次收藏、自动补图、非空队列升级随后继续验收（已于 Round 4 完成，见下方追加验收记录）。详见 [phase-e-verification.md](superpowers/plans/2026-11-18-phase-e-verification.md)。

## 2026-11-18 阶段 D 补做（goal round 3）：真实公网 CDN 补图 + 诚实缺图 + 例外恢复真机 UI

本机公网 DNS 复核 `img.alicdn.com`/`tongyi.aliyun.com` 等已可访问（未改 DNS/代理/证书、未绕过公网校验、未伪造 Logo）。
- 真实千问 CDN：真实 4173 收藏 `tongyi.aliyun.com/qianwen/`（声明跨域 img.alicdn.com 80×80 PNG）→ 入队 → 本地调度器 once → `run_icon_jobs` 默认 fetcher 真实抓取 CDN PNG → 只填空写 80×80/1366B WebP → Job complete → 工作台卡片渲染真实蓝色 Logo（icon HTTP 200 image/webp）。补齐 §9「千问CDN正常自动补图」。
- 诚实缺图：真实公网无图站点经 3 次有界重试 → 终态 `no_icon`（result 明确 code）、0 图标资产、字母回退、无「图标获取中」。补齐 §9「没有则准确说明失败」。
- kept_existing：用户本地上传 PNG 后仍在排队的 Job 执行 → `kept_existing`、图标 bytes/source/revision 完全未变。补齐 §6 迟到结果保留现有图。
- 例外恢复真机 UI：详情 `<details>` 展开后 UIA 找到「重新排队补图」「上传本地 PNG/WebP 图标」；InvokePattern 真实点击「重新排队补图」→ 新 `IconJob(pending)`、0 图标（只排队不覆盖）；refetch/upload_local 真机 HTTP 200，备注/分类完整保留。
- 清理后 4 站点/3 图标/4 预览/0 Job integrity ok；本轮未改产品代码，ZIP/release/加载目录/4173 仍 1.9.0 同哈希。证据 phased-real-cdn-icon.png / phased-cdn-final.png / phased-recovery-expanded.png，详见 [phase-d-verification.md](superpowers/plans/2026-11-18-phase-d-verification.md)。

仍缺：429/认证真机注入、真人同账号重新配对/第二账号不转投(需配合)、正式商店发行(授权外)。四阶段仍为候选，不宣称全面验收完成。

## 2026-11-18 阶段 D 补做：真机断网 + 完整浏览器重启 + 客户端同源图标端到端

用受控回环夹具（仅 127.0.0.1:4191，页面声明同源 PNG 图标；scope=本机，服务端不访问、浏览器可读——「浏览器能访问、服务器不能访问」边界，不改 DNS/代理、不伪造 Logo）。真机 1.9.0：
- 客户端同源图标端到端：工具栏→表单「截图：已压缩/图标：已压缩」→提交「截图：已上传/图标：已上传/已入库」；DB 站点(本机) + preview 960×540(source_url=站点入口) + icon 64×64 WebP，无 IconJob（本机入口诚实不排队）。
- 含素材真实断网→关闭表单→完整浏览器重启→恢复：停 4173→提交「已保存本地，等待网络」→关闭表单→只读复制 IndexedDB 确认 Outbox 保留任务+Blob→杀全部 Edge→重启 4173→重开真实配置(dev mode On/扩展 1.9.0)→worker 自动补齐站点+preview+icon+notes，1 站点/1 采集回执/1 preview 回执/1 icon 回执/notes 仅 1 次，工作台卡片显示 Logo + 查看截图、无「图标获取中」。
- 清理后恢复 4 站点/3 图标/4 预览/0 Job，integrity ok；本轮未改产品代码，ZIP/release/加载目录/4173 仍 1.9.0 同哈希。证据 phased-client-icon.png / phased-offline-form.png / phased-restart-workbench.png；详见 [phase-d-verification.md](superpowers/plans/2026-11-18-phase-d-verification.md)。

仍缺：429/认证真机注入、真实公网 CDN 补图(本机 DNS 受限按设计明确缺图)、真人同账号重新配对/第二账号不转投(需用户最小配合)、正式商店发行(授权外)。四阶段仍为候选，不宣称全面验收完成。

## 2026-11-18 阶段 D 候选 1.9.0（服务端公开图标 Job + 真实调度 + 发行准备）

阶段 A 通过、阶段 B/C/D 候选 1.7.0/1.8.0/1.9.0 各阶段实现并有回归/真机/真实 HTTP 证据；**四阶段均不宣称全面验收完成**，剩余真机演练与正式商店发行见 [phase-d-verification.md](superpowers/plans/2026-11-18-phase-d-verification.md)。

### 实现
- 服务端（`server/`）：`IconJob`（迁移 0006，按 site+入口来源指纹去重）、`icon_jobs.py`（只入队不抓取、`run_icon_jobs` 有界串行单次 4 项/单任务 3 次退避/租约防并发/墙钟预算、只填空不覆盖、SVG/私网/超时终态降级、基线变化取消、迟到结果 kept_existing）；`captures()` 同事务入队、`autoIcon` 可拒绝、HTTP 不等待外网；`summary/capture_site_dto/site_dto` 暴露 `iconJob`；`run_jobs` 融入 `run_icon_jobs`（生产复用现有 systemd timer）；抓取复用 `favicons` 每跳公网 DNS/端口/重定向/字节/像素/时间预算，无 Cookie/Bearer/Referer、不接受任意 URL 代理。例外恢复端点 `icon/refetch`（只重排队）与 `icon/upload`（高级本地 PNG/WebP）。
- 本机调度器 `scripts/local_jobs.py`（once/loop + jobs.log/pid/stop 进程控制，调用同一 SQLite 库，不另建库/不常驻 Node/Redis）；`deploy/README.md` 记录生产 timer 与本机用法。
- 客户端：扩展带 `autoIcon`、透传 `iconJob`、表单显示「已入库，图标获取中」并可拒绝补图；SW 早于阶段 B/C 已移除重复服务器兜底排程。前端 `iconJobState` 卡片标记、详情后台说明、`refetchIcon`/`uploadLocalIcon` 例外恢复、`api.request` 支持 multipart。

### 回归
新增 Django 15 + 扩展 2 + 前端 5 + scripts 3；全量扩展 150 / Django 178 / 前端 48 / Sites 4 / 脚本 35；check 71 文件、前端 build、迁移无漂移、check 0 issues。

### 真机/真实 HTTP/真实调度证据
真实 Edge 1.9.0 工具栏→「不要自动补齐图标」入口→提交「已入库，图标获取中」；真实收藏 HTTP 0.05s 入队 `iconJob.queued`；本地调度器 once 与 loop（PID 5992、24 cycles、stop-file 干净停止）实际领取执行 Job（`iconJobs.processed=1`，DNS 受阻有界退避）；autoIcon=false 不入队；refetch/本地 PNG 上传 complete；千问 CDN/ChatGPT SVG/私网边界由既有 favicons 测试覆盖；真实 DB 备份后迁移 0006、清理后 4 站点/3 图标/4 预览/0 Job、integrity ok。

### 发布/运行时
ZIP 112,985 B SHA-256 `b78874b3…`；加载目录 51 文件逐字节一致、运行 1.9.0、ID 不变；4173 回环 release/download 同哈希、新路由实活，未另建库、未部署云端。正式 Edge Add-ons 仅准备资料 `docs/extension-store-readiness.md`，未发布/不制造商店链接/不承诺审核。

### 未完成
各候选真机：重新配对/账号切换/错误注入、含素材真实断网+完整浏览器重启、客户端图标端到端；真实公网 CDN 补图受本机 DNS 环境限制按设计有限重试→明确缺图；商店账号/条款/提交/发布（授权外）、Chrome/低内存 Debian/云端。

## 2026-11-18 阶段 C 候选 1.8.0（截图/客户端图标 + 独立 revision 条件写入）

阶段 A 通过、阶段 B 候选 1.7.0 剩余真机演练仍为待办（用户选择保持现状先进阶段 C）；阶段 C 候选 1.8.0 已实现并有回归/真机/真实 HTTP 证据；阶段 D 未开始。**任何候选版都不宣称全面验收完成。**

### 实现
- 服务端（`server/`）：新增 `asset_baseline.py`/`extension_v3.py`、模型 `AssetTombstone` + `SiteIconAsset.source_fingerprint`（迁移 0005）、v2/lookup 暴露 `previewBaseline`/`iconBaseline`、DELETE 写 tombstone；v3 两端点事务内核对入口来源指纹、独立素材 revision、tombstone(防删图后 ABA)、owner/siteId/capture 许可与 `clientAssetId`+内容指纹幂等，成功回执给出已知新版本，安全判断不靠 `Site.version+1`/lookup。
- 客户端（`extension/`）：`capture-entry.js` 打开表单前完成目标前后复核 + 截图/元数据/同源客户端图标采集；`capture-compress.js` 在普通扩展页 DOM/canvas 压成有界 WebP、sourceUrl 与 displayUrl 分离；Outbox 把 Blob 与任务同事务持久化、压缩原子替换并清 raw、独立附件子阶段、条件上传成功才释放 Blob；冲突/网络/认证/重复各有明确处理；worker 靠持久化+alarm 恢复，不用 CDP/保活。

### 回归
新增 17 项扩展 + 8 项 Django 端到端；全量扩展 148、Django 163、前端 47、Sites 4、脚本 32、check 71 文件、前端 build 成功；迁移无漂移、check 0 issues。

### 真机/真实 HTTP 证据
真实 Edge 1.8.0 工具栏点击→表单「截图：已压缩，等待上传」→提交「截图：已上传/已入库」；DB 站点 v2 + preview 960×540 WebP + PreviewReceipt complete；4173 实跑：absent 首传 200、换图后旧基线重发 409 asset_conflict 不覆盖、幂等重放返回首次结果、删图 tombstone 后 absent 409(ABA)、改入口 409 asset_source_changed；真实 DB 备份后迁移 0005；清理后恢复 4 站点/3 图标/4 预览 integrity ok。

### 发布/运行时
ZIP 111,744 B SHA-256 `6472e855…`，加载目录 51 文件逐字节一致、运行版本 1.8.0、ID 不变；4173 回环 release/download 1.8.0 哈希一致、v3 路由实活，未另建库、未部署云端。

### 未完成
阶段 C 真机尚缺：含素材的真实断网恢复+完整浏览器重启、客户端同源图标端到端、429/认证真机注入；阶段 D（服务端公开图标 Job/受限执行器/千问CDN/ChatGPT边界/重新获取与本地上传例外）、正式商店发行（本轮授权外）、Chrome/低内存 Debian/云端。详见 [phase-c-verification.md](superpowers/plans/2026-11-18-phase-c-verification.md)。

## 2026-11-18 阶段 A 通过 + 阶段 B 候选 1.7.0（普通扩展页 + 单一 Outbox）

按 [稳定收藏架构](superpowers/specs/2026-11-18-stable-capture-architecture.md) 分阶段重构，**阶段 A 通过、阶段 B 候选 1.7.0 已实现并有真机核心证据；阶段 C/D 未开始，不标记全面验收完成**。

### 阶段 A（通过）
真实 Edge 运行版本/加载目录/启用状态客观核实（1.6.1、dev mode On、扩展启用、加载目录与 ZIP 逐字节一致、4173 回环）；用户在目标网页真人单击一次工具栏按钮回报「弹出收藏表单」。结论：正常工具栏入口可用，过去「自动化点不开」与 Edge 重启关闭开发人员模式（禁用未打包扩展）及焦点/工具限制相关，不是入口业务代码缺陷。未用独立 popup.html 替代验收；未改受保护偏好/企业策略/DNS/代理。记录见 [phase-a-entry-verification.md](superpowers/plans/2026-11-18-phase-a-entry-verification.md)。

### 阶段 B（候选 1.7.0）
- 保留产品行为/前端/后端 API/账号、收藏、配对、队列、Blob；新增普通扩展标签页 `capture.html` + 不可猜 `draftId` 草稿协议，`action.onClicked`（移除 `default_popup`）绑定点击时真实 tab/window，快捷键走同一入口。
- 收敛 queue/assetJobs/iconTasks/captureReceipts 四套状态为**单一 IndexedDB Outbox**（任务+Blob 同库同事务），`workspace.js` 为统一串行业务写入入口；先本地事务反馈「已存本地」，联网按 owner+captureId+指纹幂等提交才反馈「已入库」；短租约防并发、worker alarm 恢复、有界退避、身份隔离、同账号重配恢复。
- 迁移：备份旧四套状态→独立副本核对任务数/身份/Blob 摘要→原子写入带 `schemaVersion` 的新库；冲突/auth/拒绝任务不迁成自动提交；失败旧数据可恢复、不清空。
- 回归：扩展 130、Django 155、前端 47、Sites 4、脚本 32；check 63 文件；前端 build 成功。
- 真机：工具栏→普通标签页、快速提交「已存本地→已入库」、停 4173 制造真实断网后任务保留、两 capture 交错断网、完整浏览器重启后配对+2 任务保留、恢复服务器后 worker 自动补齐、关闭表单仍完成、迁移备份/标记真实落盘；测试站点经 API 删除，最终 4 站点/3 图标/4 预览、integrity ok。
- 发布：ZIP 101,582 B，SHA-256 `ca5a3ff0…`；加载目录 46 文件逐字节一致；4173 release/download 1.7.0 哈希一致、仅回环；浏览器运行版本 1.7.0、ID 不变。

### 未完成/限制（不得当作全面验收）
- 阶段 B 真机尚缺：重新配对/账号切换演练（会改动唯一真实配对，未擅动；回归已覆盖）、429/认证失效/冲突真机注入、非空旧队列迁移真机演练（真实升级前队列为空）。
- **1.7.0 暂不抓截图/图标**（阶段 C 接入），不能当每日替代版本；阶段 D 服务端公开图标 Job、千问 CDN、ChatGPT 网络边界、正式商店发行均未开始/未授权。
- Chrome、低内存 Debian、云端未测。详见 [phase-b-verification.md](superpowers/plans/2026-11-18-phase-b-verification.md)。


## 2026-11-18 1.6.1：409 安全续传（未完成验收）

新增 P1：旧 409 逻辑把所有 409 当版本冲突，lookup 最新版本后重传旧 Blob，可覆盖用户新图。现按错误码区分 ersion_conflict、来源变化、幂等冲突；仅当原 siteId、savedUrl 入口、对应素材 revision 均未变且版本只推进 1 时才安全续传；用户换图/删图/来源变化/幂等冲突保留 Blob 并进入 conflict，不自动覆盖。服务端 capture_site_dto 增加 icon/preview revision 与 sourceUrl 供校验。新增 4 组冲突回归（已有新图/已删图/来源变化/幂等冲突、同任务附件推进、revision 未变安全续传），扩展 96 项通过。

真实浏览器验收**未完成**：Edge 157 重启后开发人员模式关闭导致未打包扩展被禁用（action popup 无法打开）；开启后本机自动化仍无法稳定触发 action popup，独立 popup.html 正常但不作为验收替代。因此 ChatGPT 首次快速收藏→关闭 popup→后台上传、实体断网恢复未执行；未用直接 API/popup.html 冒充。运行时加载 1.6.1，直接 popup 调试页已连接/队列 0；真实库 4 站点/3 图标/4 预览完整。发布 ZIP 82,606B，SHA-256 7d72472d…。

# 项目状态

## 2026-11-18 稳定方案候选（待决策/实施）

用户要求若现方案不稳定则采用可靠方案。形成 [稳定收藏架构](superpowers/specs/2026-11-18-stable-capture-architecture.md)：先区分真人入口与自动化限制；普通扩展表单页、单一IndexedDB Outbox、短窗口快照、独立素材revision条件写、服务端公开图标Job、正式商店分发。仅文档，未重构/部署，不将1.6.1改标验收完成。公开网络/授权能力边界明确，不承诺所有站点自动取图。

## 2026-11-18 图标素材任务恢复修复与扩展 1.6.0（本机验收）

针对 `docs/icon-lifecycle-1.5.0-review-2026-11-18.md` 的队列/附件丢失问题完成修复。

### 修复
- 迟到素材不再改写文字队列状态：新增独立持久化 `assetJobs`，文字未确认时只合并引用，保持 pending/auth/blocked 与退避；文字回执写入 `captureReceipts` 后才补 siteId/siteVersion 并进入上传。
- 上传前先持久化附件任务与 Blob；网络/超时/5xx/429/401 保留 Blob 和任务，403 仅单次权限失败不暂停连接，409 先刷新站点版本；只有服务端确认或用户取消才删除。
- 两 capture 交错时按 capture ID 恢复归属，不依赖唯一 `lastResult`。
- popup 关闭后，service worker 用现有 activeTab/scripting 权限在目标页获取同源栅格图标（`icon-page-capture.js`），跨域/页面关闭仍走服务端受控兜底；图标上传 sourceUrl 统一为站点入口 URL。
- 修正原“文字还在队列时…”错误测试预期；新增真实 engine/queue/asset 组合回归（离线→迟到素材→恢复网络、上传断网→新引擎实例恢复、交错 capture、401/413 保留 Blob、409 刷新版本、用户取消才删除）。

### 验证
- 扩展 92 项、后端 155 项、前端 47 项、Sites 4 项、脚本 32 项通过；扩展 check 49 文件；前端 build 成功。
- 扩展 1.6.0：ZIP 81,385B，SHA-256 `bbdc2fe2a3cade2a2ca75ae884875f90d1bd148645e2c66a784b47b521fcd739`；加载目录 38 文件与 ZIP 逐字节一致；重载后 popup 实测“已连接 · v1.6.0”，待同步 0 条；release/download 哈希一致。
- 真实浏览器首次快速收藏 ChatGPT（capture 435c88ea…）后 popup 已关闭，service worker 仍取得客户端 PNG Blob（1548B，来源 chatgpt.com 同源 favicon）并持久化任务；当次上传因 sourceUrl 使用候选路径被服务端拒绝，Blob 未删除；该 bug 已修复并补回归。Edge action popup 在后续自动化中无法再打开（直接 popup.html 正常），因此未能在同一浏览器重跑首次自动上传成功闭环，已如实记录，不将第二次手动更新算作首次成功。
- 真实库保留 4 条用户收藏、3 图标、4 预览，`integrity_check=ok`；未删除用户数据/队列。

### 未验证
- Edge action popup 自动化失效导致 ChatGPT 首次自动上传未在同一实体浏览器闭环；真实断网/完整浏览器重启下的 HTTP 上传恢复由引擎级真实模块组合测试覆盖；Chrome、低内存 Debian、云端未复测。

## 2026-11-17 图标采集通用化：跨域声明候选、持久化任务与 1.5.0（本机验收完成）

本轮按 `docs/icon-capture-user-path-review-2026-11-17.md` 的“用户补充与通用修订范围”实现，未针对千问/ChatGPT 硬编码域名、图片地址或品牌。

### 根因
- 旧客户端 `buildIconCandidates` 把非同源候选全部过滤：千问页面只声明两张 `img.alicdn.com` 的 80×80 PNG（media 区分明暗），同源 `/favicon.ico` 返回 404，因此永远拿不到图标；这不是 ICO 大小问题。
- 旧提交链路在点击收藏时最多等 2 秒并锁定素材结果，晚到的图标被丢弃且没有待获取任务；popup 关闭后采集闭包消失。文字保存成功会让界面误以为素材也会自动完成。
- 服务端只接受与站点 endpoint 同源的候选，且大 HTML 直接回退默认 favicon；ChatGPT 这类声明同源 PNG 的页面在部分网络环境下会失败，SVG-only 页面没有明确终态。

### 实现
- **候选发现**：读取 tab favicon、rel icon/apple-touch-icon，保留 href/rel/type/sizes/media，相对路径按页面 URL 规范化；浅色/无主题优先、dark 排后；SVG 不执行、与 PNG 并存时优先栅格；跨域声明候选标记 crossOrigin，客户端不直接抓取，交由服务端兜底。
- **服务端兜底**：`favicons.py` 解析页面声明的跨域公共 CDN 候选，每个 URL/每跳 DNS 与重定向独立公网校验、端口守卫、无 Cookie/Bearer/Referer 外泄，拒绝私网/凭据/危险协议；HTML 超限改为读取有界前缀并解析 `<head>`，不再直接丢弃声明候选；候选仍限 4、总字节 2MiB、总墙钟 5s、2MP、输出 ≤128×128/32KiB。
- **持久化任务**：popup 在提交文字前登记 `workspaceIconTasks`（绑定 server/user/capture ID/URL/是否允许更新），文字立即入库；图标获取/兜底/上传由 service worker 按 alarm 和有限退避继续，关闭 popup 或浏览器重启后恢复。新增 `icon-task-runner.js`、`icon-tasks.js`，任务状态 pending_acquisition/acquiring/ready_to_upload/complete/retryable_failure/unsupported/cancelled。
- **设备 Bearer 自动兜底接口**：`POST /api/extension/v2/captures/<capture_id>/icon/fallback`，只按 capture 所属站点抓取其页面声明/默认候选，不接受客户端任意 URL；已有图标返回 `icon_exists` 绝不覆盖；私网返回 `icon_refresh_private`，SVG-only 返回 `icon_svg_only`，失败不写资产；成功写 AuditEvent 并做版本乐观更新与配额检查。
- **历史补图**：服务端批量缺图刷新与自动兜底共用安全抓取，只补缺图、保留 notes/分类/截图；已有自定义或较新图标不覆盖。真实用户阿里云登录页由缺图补为 32×32 阿里云 CDN ICO，备注/分类/截图保留；DeepSeek 开放平台页面仅 SVG，明确返回 `icon_svg_only`，不伪造图标。
- **反馈**：区分获取中、候选为空、跨源待兜底、SVG-only、权限/网络/解码失败、待上传；缺图时不再提示“资料和素材已确认”，关闭 popup 后再打开显示上次任务补齐/降级结果；重复收藏仍默认保留原资料，显式选择才更新。
- 扩展版本升至 **1.5.0**，权限未新增。

### 真实验证（本机 Edge 157，真实账号与真实站点）
- 千问：popup 打开后约 1.2 秒点击收藏（图标尚未 ready，popup 显示“图标暂不可用…404”），关闭 popup；约 9.4 秒后同一 capture ID `d6ee81aa-…` 由服务端从 `img.alicdn.com` 浅色候选补为 80×80 WebP 1366B，卡片显示千问 Logo。
- ChatGPT：快速收藏时客户端尚未完成；本机 DNS 把 `chatgpt.com` 解析到不可达地址，服务端兜底被网络环境阻断（不是 SVG 原因）。客户端在同源授权下选中 48×48 PNG（非 SVG），显式更新后图标 48×48 WebP 1084B；限制已记录。
- 多帧 ICO：GitHub 快速收藏由客户端选中 16/32 ICO 的 32px 帧，32×32 WebP 644B。
- 浏览器重启：淘宝快速收藏后立即关闭 popup 并重启 Edge；重启后约 9.2 秒由持久化任务补为 114×114 WebP 2334B（img.alicdn.com apple-touch），证明任务跨浏览器重启恢复。
- 坏候选夹具：首候选 404、第二候选 HTML 损坏、第三候选 PNG 有效，最终图标 64×64 WebP 206B；慢/私网夹具关闭 popup 后不伪造图标，反馈“图标暂不可用”，不假报完成。
- 历史修复：阿里云登录页图标 32×32 518B（img.alicdn.com ICO），notes“阿里云”/分类“云C”/截图保留；DeepSeek 开放平台保持缺图并明确 SVG-only 降级。

### 自动化与发布
- 前端 47、扩展 82、Django 155、脚本 32、Sites 4 项全部通过；扩展 check 44 个源码文件；前端 build 成功。
- 扩展 1.5.0：ZIP 72,922B，SHA-256 `07ea99e0880c1a53f207b2a6d2bb720e33424b4d045e7cef53adb1effe0c353c`；实际加载目录 34 文件与 ZIP 逐字节一致；普通重载后 popup 显示“已连接 · v1.5.0”，配对/队列保留。站内 `/downloads` 与 release.json 哈希一致（需登录）。
- 4173 已重启加载新后端（备份 `.local/manual-test/backups/pre-icon-lifecycle-2026-11-17.sqlite3`）；原有 4 条收藏保留，阿里云补图成功，DeepSeek 开放平台仍缺图且明确降级；测试新增的千问/ChatGPT/GitHub/淘宝/夹具站点已通过 API 移入回收站并永久删除，最终 4 站点、3 图标、4 预览、`integrity_check=ok`。

### 未验证/限制
- ChatGPT 服务端兜底在本机受 DNS 污染/网络策略阻断，未完成真实公网抓取；客户端 PNG 选择已验证，换正常 DNS 环境仍需复测。
- 真实“图标 2.1s/4s 后才完成”的公网慢请求未单独构造（服务端兜底与重启恢复已证明异步生命周期；慢/坏候选由受控夹具和单测覆盖）；真实离线断网恢复未在实体浏览器演练。
- Chrome 未安装；SVG-only 明确降级而非栅格化；自定义本地图标上传仍未实现；低内存 Debian/云端未复测。

## 2026-11-17 展示优化第二版：宽屏轨道、真实 Logo 与工具栏精简（本机验收完成）

本轮按 `docs/superpowers/specs/2026-11-17-workspace-polish-v2.md` 完成，未重写已验收的收藏链路、notes、直接入库、显式素材更新和离线队列。

### 宽屏与布局
- 根因是两套工作台级宽度叠加：旧 `styles.css` 的 `.workspace{max-width:1550px;margin:auto;padding-inline:36px}` 与 `cards.css` 的 `.workspace{max-width:1440px;padding-inline:28px}` 互相覆盖，媒体查询再加一层 padding；网格还被 inline auto-fill 与三列 CSS 双重控制，卡片本身也有旧 styles.css 与 cards.css 两套尺寸。
- 现在只有一个主区骨架：`.workspace` 取消工作台级最大宽度，主区占满侧栏之外可用宽；顶部栏、标题、搜索、工具栏、网格、页脚共用 `--content-padding`（<768 16px，768–1599 24px，≥1600 28px）。侧栏由 `--sidebar-width` 统一驱动：展开 232px、折叠 72px，`<768` 抽屉。CSS 不再重复加 width/max-width，网格列数只由 `layout.js` 纯函数 + `useCardGrid` 的 ResizeObserver 写入 inline `repeat(n,minmax(0,1fr))`，CSS auto-fill 仅作测量前 fallback。
- 算法按 `(W+g)/(t+g)` 向下/向上取整为候选，实际卡宽 `(W-(n-1)g)/n`，只接受 200–340px，取最接近目标宽度的列数（距离相同取更宽/更少列）；完整行均分、最后一行同列宽左对齐，不补假卡片、不把少量数据拉成巨型卡。

### 简化工具栏与分类
- 卡片档位、200–340 微调、恢复默认、侧栏形态全部收进“显示设置”popover；主工具栏只保留排序、显示设置、网格/列表和分类筛选。
- 移除写死的“图片处理/开发部署/效率工具”，工具栏分类直接来自 `workspace.categories` 的真实分类与真实计数，最多 5 个入口（全部+4），余下进“更多分类”；侧栏、筛选、表单同源。
- 搜索覆盖已载入全库（批次只限制渲染数量），分类/排序/尺寸偏好互不清空；无最近访问记录时整段隐藏；筛选为空时提供“清空搜索与筛选”。
- 加载、后台同步、连接异常、空结果分别反馈；字体改为系统中文栈，删除 Google Fonts 远程依赖；对比度按 WCAG 公式实测并提高（正文/说明 ≥4.5:1，焦点环 4.83:1，表单边界 3.06:1，卡片容器边框属装饰性保留浅色并记录）。

### 真实网站 Logo（DeepSeek 鲸鱼）
- 根因不是候选缺失或服务端拒绝：`https://www.deepseek.com/favicon.ico` 实测 **209,762 字节、225×225、32bpp 单帧 BMP(DIB) ICO**，页面只有这一个同源图标候选，apple-touch 等兜底 404；旧客户端在解码前用 `blob.size > 200KiB` 直接拒绝，差 4,962 字节。
- 客户端重写为源预算/保存预算分离：流式读取单文件 ≤1MiB、候选累计 ≤2MiB、最多 4 个候选、总墙钟 5s；先用魔数嗅探并拒绝 SVG/HTML，再对 PNG/JPEG/WebP/ICO 做解码前尺寸检查（≤2MP）；多帧 ICO 解析目录并按“≤128 且最接近 128”选帧，重建单帧 ICO 交给 Chromium 原生解码（PNG/BMP 帧均验证），最终 canvas 等比缩放 ≤128×128、WebP ≤32KiB，仍走私有同源媒体。候选顺序为当前 tab favicon → 页面 rel icon/apple-touch-icon（按声明尺寸）→ 同源 /favicon.ico、/apple-touch-icon.png；跨源无授权候选不发请求。
- 新增服务端公开站点刷新（`POST /api/sites/<pk>/icon/refresh`、`POST /api/sites/icons/refresh-missing`）：SSRF 校验（私网/回环/保留地址、每跳重定向复验、同源候选、无 Cookie）、流式预算、Pillow 真实解码（含多帧 ICO）、版本与配额事务保护，只写 SiteIconAsset/版本，不动 notes、分类、简介或截图。卡片菜单“更新网站图标”、详情“网站图标”区、设置“资料维护 → 修复缺失图标（N）”均已接入；私网/本机站点明确引导用扩展在目标页更新，批量只串行处理最多 6 个公网站点。
- 真实验证：旧 DeepSeek 收藏（site `c3ff049a-7625-4e36-83d3-bf546bd73ec4`）通过服务端刷新得到 **www.deepseek.com /favicon.ico、sourceType=link、frame=225、128×128 WebP、5,856 字节**，DB revision `e013297d-…`，卡片实际显示蓝色鲸鱼；notes 与分类 AI 保留，截图仍存在。扩展 1.4.0 在 DeepSeek `/en/` 新收藏中同样显示“网站图标已就绪”，私有上传 128×128 WebP 5,222 字节，证明 >200KiB 客户端链路可用。GitHub 新收藏通过扩展采集多帧 ICO（16/32 帧 BMP）并选中 32px 帧，上传 32×32 WebP 644 字节。服务端还实测 GitHub 首页 524KB HTML 不再致命，会回退 `/favicon.ico`；失败/超限/损坏/跨源/无候选/历史缺图均有回归覆盖。

### 自动化与本机状态
- 前端 47 项、扩展 62 项、Django 127 项、脚本 32 项、Sites 4 项全部通过；前端 build 成功，扩展静态检查通过（36 文件），发布物下载与 release.json 字节/哈希一致。
- 扩展 1.4.0：ZIP `extension/dist/website-workspace-extension-1.4.0.zip`，61,162 字节，SHA-256 `bf4483643eba21c67a0b6bda3fd4eba98cf87e29faafdbff215af01a23aa0efe`；实际加载目录已逐字节更新并在普通重启后确认 popup“已连接 · v1.4.0”，账号、设备配对、收藏和队列保留。
- 4173 因后端新增图标刷新接口已按实际监听进程重启一次（launcher 23760 / 监听进程 38972），保留原账号、6 条收藏（原 4 条 + 本轮 GitHub 与 DeepSeek /en 验收收藏）、11 条回执、5 个预览、5 个图标、2 台设备，`integrity_check=ok`，备份 `pre-polish-2026-11-17.sqlite3`。
- 独立合成库（100 条、7 个真实分类、部分 Logo/备注/多入口/长名称）在 360/768/1440/1920/2560/3440、侧栏展开/折叠、三档尺寸与 200% 缩放等效宽度下完成实际测量：主区内容左缘与顶部栏/标题/搜索/页脚完全对齐；1440/1920/2560 展开时 4/6/8 列、卡宽约 274/256/268；折叠后 5/7/9 列；3440 折叠 12 列；4 条数据保持同列宽左对齐，无假填充；无横向溢出。证据在 `.local/polish-qa/`（测量 JSON、截图、真实图标解码图），合成截图已复制到 `prototype/qa/workspace-v2-*.png`。

### 未验证/限制
- Chrome 未安装；真实浏览器只在 Edge 157 验收。200% 缩放以等效 CSS 视口（1920→960、1440→720）测量，未直接改浏览器缩放级别。
- 卡片菜单“更新网站图标”的实际点击因本机窗口焦点竞争未能稳定自动化，最终使用真实用户会话调用同一接口完成服务端刷新并验证；菜单项存在性与前端错误分支已由 UIA/单测确认。
- 自定义本地图标上传（规格可选）未实现；批量缺图修复是用户显式触发的同步、最多 6 个站点，不是常驻后台任务，也暂不支持中途停止；同源重复刷新会重新抓取并 +1 版本。
- 200% 缩放、超长名称、移动抽屉、批量失败等已覆盖或记录，但低内存 Debian 实机与云端未复测；部分容器边界（卡片描边等）对比度低于 3:1，属装饰性，已在验证文档记录测量值。

## 2026-11-17 展示二版设计（待实施）

用户确认功能测试无异常，转入展示优化：宽屏两侧留白、DeepSeek图标回退D和全站细节。已基于当前1920宽屏页面及代码形成 [展示优化二版](superpowers/specs/2026-11-17-workspace-polish-v2.md)，包含宽屏容器/网格、图标ICO预算/解码/旧图修复、简化工具栏及验收。仅文档设计，未修改业务或部署；截图保留.local私有目录。

## 2026-11-17 扩展 1.3.3 多窗口目标绑定与真实素材链路（本机真实验收完成）

本轮先纠正上一轮遗留判断并用真实原浏览器完成闭环。真实浏览器此前运行的是 **1.2.0**：重启前 Service Worker 注册版本、服务端设备 `extension_version`、扩展自检 `release.currentVersion` 三处均为 1.2.0，而 1.2.0 没有自动素材模块；加载目录虽在 02:32 被替换为 1.3.2 文件但没有重新加载。重启核实时还发现 Edge 157 在开发者模式关闭时会禁用未打包扩展（`DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION`），本轮已在真实 profile 开启开发者模式并让 1.3.3 实际启用。因此本机此前的 `PreviewAsset=0/SiteIconAsset=0` 是“旧运行时从未自动采集上传”，不是服务端保存、鉴权或读取失败。

- 多窗口目标最终行为：只取调用扩展窗口的活动标签（`tabs.query({active:true,currentWindow:true})`），`tabs.getCurrent()` 区分工具栏 popup 与独立调试页，`windows.getCurrent()` 复核窗口；不支持/隐身/扩展设置页/调试页/授权失败明确提示返回目标网站重新打开，绝不静默改选其他窗口，未新增权限。真实双窗口分别得到各自活动页。
- 隔离复现混合态：新 popup 文件 + 旧 1.2.0 后台会生成文字回执和预览，但静默丢弃 notes；旧逻辑无目标时只报底层 URL 错误。已加 BUILD_VERSION 一致性拦截，混合态阻止收藏并提示重新加载；素材上传后保留服务端分类/重复状态，重复素材更新明确显示“保留原备注和分类”。
- 真实验收（最终 1.3.3、真实 OS 工具栏点击 activeTab）：新收藏回执→截图/图标上传→服务端资产与媒体→首页 Logo→查看截图大图；重复收藏素材更新不覆盖 notes/分类且换新 revision；断网收藏、重载扩展队列与账号保留、恢复服务后自动同步均通过。DeepSeek 的大 ICO favicon 按设计降级为无图标，文字与截图正常。
- 自动化：Django 101、扩展 53（含新增目标绑定/混合态/重复更新反馈回归）、前端 32、脚本 32、Sites 4 项通过；扩展静态检查、前端构建、迁移漂移与发布包解包检查通过。
- 发布物：扩展 1.3.3 ZIP 54931 字节 SHA-256 `7f6b15559de6fd74a4d0b6b3a348b02842ec851dd449ef9bb732ba8fd475cda9`；完整包 `release/website-workspace-20261117T084230201232Z.tar.gz` SHA-256 `f9ffc687a58b3ab820a0e50aa10fc1ae7417e44bf5238de548fb16445d60c7f7`。站内下载字节/哈希一致，实际加载目录与 ZIP 一致。
- 本机 4173 保持运行，保留账号、设备配对与队列；原 WildAI 收藏未改动，本轮新增 3 条真实收藏（MDN zh-CN、DeepSeek、MDN en-US 离线验证）作为证据，数据库完整性正常（4 站点、9 条 CaptureReceipt、3 PreviewAsset、2 SiteIconAsset）并已备份；验证用 CDP 目录联接关闭后普通启动时 Edge 重置过一次受保护偏好，已在普通 profile 内重新加载同一目录扩展、开启开发者模式并重新授权本机服务器，完整重启后复核 popup“已连接 · v1.3.3”、素材就绪且设备 last_active 正常更新。未部署云端。Chrome、隐身真实调用、全部导航竞态与低内存 Debian 实机仍未验证。

## 2026-11-17 实际安装扩展排查与 1.3.2（实体验证未闭环，已由上一节取代）

已定位实际收藏无素材的首要原因：`C:\Users\无名\Downloads\website-workspace-extension` 中实际加载的是 1.2.0，缺少 automatic-assets.js，并非 1.3.x ZIP 已安装。已备份并更新该目录到 1.3.2，同时修复多窗口下 popup 误选扩展页的问题，重复收藏现在明确提示默认不更新图片，并提供“更新截图和图标（保留原备注和分类）”操作。

当前实际集合仍未生成 PreviewAsset/SiteIconAsset，不能把问题标为已解决。已确认克隆的运行时为 1.3.2、原账号和 schema 2 队列保留；普通网页 popup 能显示预览和图标就绪，但 activeTab/表单提交未形成新回执，IndexedDB 没有可恢复的 Blob。现有 WildAI 收藏未被删除或覆盖，4173 服务保持运行，未部署云端。后续必须在真实普通窗口完成 activeTab 和提交，不能拿旧回执或合成查看测试代替。

## 2026-11-17 Logo 主体卡片与独立截图查看器

已实现 Logo 主体卡片、卡片直接打开的同源鉴权截图查看器，以及紧凑/标准/宽松和 200–340px 尺寸微调。查看器支持加载/失败分类、重试、最新元信息、适应窗口、100% 原尺寸和 50%–200% 缩放；失败后的新 revision 自动恢复，成功阅读中只提示新图。尺寸偏好按 origin+userId 存本机，ResizeObserver 按实际卡片外宽切换信息策略，不写 Site、不触发网站库或截图重复请求。

根因核对：4173 现有收藏确实没有 PreviewAsset/SiteIconAsset，不是媒体 404；旧卡片只有小缩略图且需进详情，旧详情失败后禁用放大且不重试，失败标志也不随 revision 重置。已保留无图诚实提示并修复完整查看链路。真实 Edge 覆盖刷新、新图替换、失败重试、图标恢复、30 条卡片、239/240/299/300px 阈值、200% 缩放和偏好持久化。扩展源码未改，版本仍为 1.3.1；4173 已更新且保留原账号收藏，未部署云端。

## 2026-11-16 少操作收藏与扩展 1.3.1 候选修复

已按修订规格贯通分类/notes 主流程、自动当前页预览与私有网站图标、普通收藏直接入库、全部收藏首页排序、轻量自动刷新、详情深链、紧凑卡片、统一操作反馈和品牌资源。workspace `0004` 增量迁移保留预览与图标独立配额、上传、GC 和含媒体备份，上一轮被拒绝任务新 UUID、首页显式更新和删除版本保护均保留。

1.3.1 修复自动预览的网页地址/图片地址混用，以及慢图标导致已完成截图被等待超时丢弃的问题。当前自动化为 Django 101、扩展 48、前端 25、脚本 32、Sites 4 项通过，前端构建、扩展静态检查与迁移漂移检查通过。实体 Edge 已完成解压加载、原生权限、popup 分类备注收藏、截图/图标上传、刷新显示及重载队列检查；Chrome、完整重启、旧版实体升级和全部竞态边界仍未验收。**1.3.0 与 1.3.1 均不标记为全面验收完成。** 本机 4173 保留既有账号和收藏，未部署云端，详见 local-testing-2026-11-15.md。

## 2026-11-15 扩展与卡片开发实现、本地验证

已按规格落地协议 2、简介/首页字段、私有预览资产与附件回执、扩展 1.2 离线图片队列、网站卡片/详情/编辑、扩展中心、固定哈希 ZIP、含媒体备份和延迟 GC。增量迁移为 workspace `0003`，协议 1 收藏和书签导入保留。

代码与本地自动化验证属于开发结果，不是生产部署或实体浏览器验收。真实 Chrome/Edge 手动安装、授权、截图、更新保留队列，以及目标低内存主机的 Pillow 内存/磁盘/延迟与含图恢复仍需实测。接口与运维约定见 extension-v2-and-media.md，实际命令和未验证项见 implementation-verification.md。正式用户库未用于开发测试。

2026-11-15 代码审查后的三项修复已完成：被拒绝收藏修改使用新 UUID 并按持久化顺序记录替代关系；已有收藏可显式确认/更新首页地址后补传首页截图；截图删除在事务内核验版本并检查条件更新结果。完整自动化回归为 Django 96、扩展 42、前端 24、脚本 32、Sites 4 项通过，前端构建与扩展静态检查通过。未操作正式用户数据，未部署生产；实体扩展流程仍未实测。

## 2026-11-15 设计交接补充

用户要求设计与本站配套的浏览器扩展、站内下载安装、随项目部署，以及包含名称/地址/首页截图/简介的网站卡片；明确本轮只写文档，开发交由其他 agent。

已形成 [完整设计](superpowers/specs/2026-11-15-extension-and-website-cards.md) 和 [实施交接](superpowers/plans/2026-11-15-extension-and-website-cards.md)。这是待实施方案，不改变下面的历史实现状态。站内 ZIP 下载后需用户手动加载；截图主动预览确认、首页与当前页区分、私有媒体鉴权、图片配额和完整备份均已纳入设计。没有开发、部署或新功能测试通过声明。

更新：2026-10-26，Asia/Shanghai。

| 项目 | 实际状态 | 证据/下一步 |
| --- | --- | --- |
| 需求 | 多人各自网站库；独立密码管理器；完整实施授权 | 用户明确选择，原型后回复“没问题，继续” |
| 服务器约束 | Debian 12，单核，约 700MB | 用户明确答复；默认 SQLite，取消同机 PostgreSQL/Redis/Node 常驻方案 |
| 视觉 | 第 1 版浅色侧栏、绿色卡片 | selected-home.png；原型体验已认可，正式功能验收仍待用户 |
| 真实前后台 | 本地与公网 IP HTTPS 已运行 | 云端 https://203.0.113.10:8443/；不依赖 SSH；本地开发 4173 |
| 数据与权限 | 会话、邀请、私有网站、分组、导入导出、多入口、账号说明 | Django 72 项测试通过，含真实 HTTP 和双账号隔离 |
| 浏览器扩展 | MV3 源码与登录后下载 ZIP 已提供 | 23 项测试及资源检查通过；实际 Chrome/Edge 安装授权待用户 |
| 增强 | 分享、公开元信息、文本快照、监控、站内提醒 | 增强测试与真实 HTTP 验证；生产 timer 需启用 |
| 低内存部署 | Debian/systemd 已实际运行，回环监听 | 后台约 51MiB + Nginx 约 5MiB；备份/jobs/证书续期 timer 启用，公网 HTTPS 已验证 |
| 页面检查 | 独立测试库完成登录、收藏、账号说明、刷新、退出重登、设置浏览器检查 | 测试资料不进入正式库；截图 prototype/qa/persistent-workspace-2026-10-26.png |
| Git | feat/website-prototype，未提交，无远程 | 缺少真实作者身份，不编造身份 |
| 云端与维护 | 已按用户授权部署公网 IP HTTPS；尚未正式人工验收移交 | 用户创建管理员、安装扩展；暂无域名；真实维护身份仍待确认 |

## 本轮边界

- 正式库与 ?demo=1 内存演示分开。新账号为空库，示例须明确预览导入。
- 默认每用户最多 10000 条网站；单条 JSON 最多 64KiB；读取每页最多 250 条。该配额不是 700MB 实机性能承诺。
- 扩展设备 token 不能读取账号说明/私人备注；收藏只返回必要摘要。所有写操作以服务端归属为准。
- 云端只能保存局域网/本机入口；访问是否可达取决于当前设备和网络。服务端抓取禁止访问内网，不会伪造“本地在线”。
- AI 语义搜索、邮件、原生书签双向同步、移动系统分享入口尚未实现；普通用途/备注/标签/别名检索已实现。
- 实际 Debian 已检查初始资源、备份恢复和 5000 条合成分页；不代表长期/并发/极端体积保证、实体扩展权限验证或人的最终认可。

## 继续工作入口

先读 public-ip-deployment-2026-10-26.md。当前云端入口为 https://203.0.113.10:8443/，旧 SSH 隧道已经停止。用户自行查看 .local 私有配置中的 SETUP_TOKEN 并创建管理员；之后关闭初始化。IP HTTPS 与续期演练已通过；实体扩展和多人体验继续验收；维护责任人/备用人及接受记录不由代理伪造。

## 实机补充

实际主机 nproc 返回 2，与此前用户“单核”描述不同；仍保持单 worker。初始可用内存 289MiB，运行后约 217MiB。系统已有业务服务，未更改其配置、SSH 或防火墙。当前 PUBLIC_URL 为公网 IP HTTPS 地址，分享链接和扩展配置均可使用该地址，无需域名或 SSH。

## 公网 IP 变更

用户明确要求直接 IP+端口后，修正了无域名必须走隧道的限制。已签发可信 IP 证书，Nginx 专用单 worker 入口在 8443，应用仍仅回环 8000；安全 cookie/可信来源同步配置。证书短任务每天两次检查并通过模拟续期；新增可信代理限流回归 2 项，后台 69 项通过。CUA 本轮超时，新的浏览器操作未声称通过；真实公网 TLS/HTTP 检查通过。

## 浏览器导入更新

2026-10-26 已上线「设置 → 资料与导入」的浏览器来源选择（Chrome、Edge、ego(lite)、Firefox、Safari、其他）及导出指引。支持标准 HTML 和 Chromium Bookmarks JSON，保留文件夹路径，先预览再去重确认；每批 500 条/2MiB。72 项后台、21 项前端、4 项模板运行时、构建和合成 UI 流程通过，公网新静态文件已核对；见 browser-import-verification-2026-10-26.md。

## 免文件主导入流程（2026-10-26）

用户纠正文件选择门槛后，云端已切换扩展 1.1.0 直接读取/预览/确认/自动分批方案；网页文件入口默认折叠。后台 78、扩展 29、前端 21、模板 4 项与构建通过，IAB 合成 1001 条丢响应恢复通过，公网资源和匿名鉴权已验证。旧状态表测试计数是历史，本段为最新。实际扩展安装/可选书签权限仍由用户操作；正式维护接受未伪造。详见 native-import-verification-2026-10-26.md。

## 2026-11-18 阶段 D 错误边界（goal round 3 续）

真实 4173 HTTP 边界注入（QA 设备/站点，不碰唯一真实配对、不改 DNS/代理/产品代码）：撤销 QA 设备后 Bearer 调 lookup → 401 auth_required（扩展 needs_auth 暂停）；连续越过只读端点 rate 上限 → 429 rate_limited（扩展 waiting_network 有界退避）；同 clientCaptureId 内容改动重发 → 409 idempotency_conflict（扩展 conflict 不覆盖）。清理后仅 3 个「我的浏览器」设备、4 站点/3 图标/4 预览/0 Job integrity ok。实体浏览器里对同一 Outbox 任务的 429/认证真机注入仍需用户配合重新配对。

## 2026-11-18 Round 4 追加验收（1.10.0 候选，未全面验收）

用户要求的「随后继续」项已在独立配置/测试库完成：独立 4174 SQLite + 独立 Edge profile3/4 + 独立测试账号/配对设备，日常 4173 数据全程隔离。真实公网首次收藏：千问 `https://qianwen.aliyun.com/`（内容丰富的蓝色双11页，预览 960×540 41184 B）与 ChatGPT `https://chatgpt.com/`，均走完整弹窗路径（截图已就绪 → 选「验收分类A」+ 备注 → 已同步），标签数点击前后不变、无新标签页；工作台 5 张 Logo 紧凑卡片 + 5 个「查看截图」按钮，点千问卡片打开真实大图查看器（适应窗口/原尺寸/缩放/重置）。自动补图：`runjobs --limit 4` 经独立 server.py 转发到独立库（不碰日常库），千问 IconJob 真实抓取 `img.alicdn.com` 得到 32×32 518 B WebP、HTTP 200 image/webp、工作台显示真实橙色阿里云 Logo；ChatGPT Job 返回 `kept_existing` 不覆盖已上传图标。非空队列升级：独立 profile 加载权威 1.9.0 ZIP（无 default_popup），配对 4174 后停服离线保存 2 条（选项页「待同步 2 条」）；原地替换同目录 51 文件为 1.10.0 的 54 文件（同路径同扩展 ID）、真人式点「重新加载」，重载后「当前版本 1.10.0」+ 同账号 + 「待同步 2 条」仍在；仅重启 4174、无用户动作/无重新配对，两条按有界退避先后自动续传，notes 精确保留，7 站点/7 图标/7 预览/7 回执无重复无丢失、integrity ok。截图不可用真机注入：仅回环 4192 高熵噪声页（2560×1440 随机 RGB PNG 11 MB）使原始快照超过 8MB 有界上限，弹窗显示「截图不可用」+「这次未附截图（当前页截图不可用），收藏仍可保存。」+「重新截图」；仍可选分类/写备注/收藏 → 已同步，独立库该站点 notes/分类精确、`preview.present=false`（诚实缺图不伪造、不阻塞文字），8 站点/7 预览/8 回执、integrity ok。Round 4 未改产品代码/发布物：ZIP 1.10.0 114,814 B SHA-256 09551f05365a55f87f3194a539a6f3a6259a5d26f91450508d236a1155fee12d，4173 release/download 同哈希，日常 Edge 运行 1.10.0。回归复跑：扩展 168、前端 57+Sites 4、脚本 35、后端 178 全绿，扩展 check 76 文件、前端 build、迁移无漂移、check 0 issues。日常 4173 数据复核：5 站点/4 图标/4 预览、3 个「我的浏览器」设备、notes/分类不变、integrity ok。剩余：未打包扩展依赖 Edge 开发人员模式（重启可能关闭，Phase A 环境约束）；正式 Edge Add-ons 仅准备资料未发布；Chrome/低内存 Debian/云端未测、不部署云端；「重新截图」切换页面拒绝与更早版本队列迁移仅回归覆盖；四阶段与 1.10.0 仍为候选，不宣称全面验收完成。详见 docs/superpowers/plans/2026-11-18-phase-e-verification.md 第六节。
