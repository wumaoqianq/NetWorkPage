# 阶段 D 验证记录：服务端公开图标 Job + 真实调度 + 发行准备

日期：2026-11-18。对应 [稳定收藏架构](../specs/2026-11-18-stable-capture-architecture.md) 阶段 D / §6。
**状态：阶段 D 候选 1.9.0（服务端 Job + 本机真实调度 + 前端/扩展反馈 + 例外恢复已实现，回归与真机/真实 HTTP/真实调度证据齐备）；正式商店发行仅在准备资料阶段（未发布）。四阶段均仍为候选，不宣称全面验收完成：剩余真机演练见文末。**

## 一、本阶段交付范围

### 服务端（`server/`）
- 新增 `IconJob`（迁移 `0006`）：`site + source_version(入口来源指纹)` 唯一去重，`phase` pending/leased/complete/kept_existing/no_icon/cancelled，租约、attempts、next_attempt_at、result、last_error_code。
- `icon_jobs.py`：`enqueue_icon_job`（调用方事务内、只入队不抓取）、`run_icon_jobs`（有界串行，单次 4 项、单任务最多 3 次退避、条件 update 抢租约防并发、墙钟 25s 预算）、`requeue_icon_job`（重新获取）、`icon_job_dto`（暴露「图标获取中」）。
- `extension_v2.captures()`：`INPUT_FIELDS += autoIcon`（默认 True、非 bool 拒绝）；created/existing/updated 三个成功分支**同事务入队**、trashed/archived 与幂等 receipt 直返不入队；`summary` 加 `iconJob`。`extension.capture_site_dto`、`library.site_dto` 同样加 `iconJob`（前端卡片可见）。
- **HTTP 收藏不等待外网抓取**：只对缺图+用户允许+存在公网候选的站点入队；`favicons.has_public_candidate` 为本机/局域网诚实跳过。
- `enhancements.jobs.run_jobs()` 末尾调用 `run_icon_jobs`，返回新增 `iconJobs` 键，`processed` 语义不变、`skipped:another_run_active` 早返回不变、`runjobs` 命令/参数不变 → **生产复用现有 systemd `website-workspace-jobs.timer`**（无常驻 worker）。
- 抓取复用 `favicons.py`（未改其安全逻辑）：`public_endpoint` + `fetch_icon`，每跳公网 DNS/端口/重定向/字节/像素/时间预算、CDN 声明候选、PNG/ICO 真实解码、SVG 终态降级、无 Cookie/Bearer/Referer、不接受任意 URL 代理。执行器**只填空**：站点已有图标 → `kept_existing`（迟到结果不覆盖）、基线变化 → `cancelled`、SVG-only/私网/超时/超限 → 终态 `no_icon`、其余网络错误有界退避到明确缺图；媒体事务外发布、失败删文件、版本递增在事务内。
- 两个例外恢复端点：`POST /api/sites/<pk>/icon/refetch`（只重排队、不覆盖、不改 version）、`POST /api/sites/<pk>/icon/upload`（高级本地 PNG/WebP 上传，用户明确动作可替换已有图标，`source_url='local-upload'` 哨兵不冒充站点 URL）。

### 本机调度器（`scripts/`）
- `scripts/local_jobs.py`：`once`（单次有界 `runjobs` 并打印）/ `loop --interval 20`（周期循环）。经 `.local/manual-test-server.py` 转发到**同一 SQLite 库**，不另建库、不常驻 Node/Redis/无头浏览器；`jobs.log` 每次 cycle 起止与输出、`jobs.pid` PID、`jobs.stop` 停止文件，分段睡眠及时响应停止。
- `deploy/README.md` 记录生产 timer 复用与本机调度器用法；说明「排队后无人执行」可被观察（收藏后查库有 pending，跑一次 once 后 phase 变化、log 有 cycle）。

### 客户端
- 扩展：`buildPayload` 带 `autoIcon`（默认允许、表单可「不要自动补齐图标」）；`receiptOf`/`capture-status` 透传 `iconJob`，`complete` 阶段在 Job 排队中显示「已入库，图标获取中」，且不假报已有图标。**Service Worker 早在阶段 B/C 已移除重复服务器兜底排程**（无 icon-task/fallback 引用），本阶段不另维护。
- 前端：`model.iconJobState`（缺图+排队中才显示获取中）、卡片「图标获取中」标记、详情显示后台补齐说明，`refetchIcon`（重新排队补图）与 `uploadLocalIcon`（高级上传 PNG/WebP ≤200KiB）作为例外恢复；`api.request` 支持 multipart `form`（boundary 交浏览器）。
- 前端每 30s 轮询 `/api/workspace/revision`，Job 填充图标会 bump `site.version` → 后台补齐后卡片自动出现图标，不承诺固定耗时。

## 二、回归（先写测试再实现，旧实现先失败再转绿）
- 新增 Django `test_icon_jobs.py` **15 项**：入队不抓外网、autoIcon false/非 bool、已有图标重复收藏不排队、私网不排队、幂等去重不重置终态、成功填空+version+1、终态 code 不重试、可重试错误有界退避、抓取期间已有图 kept_existing、基线变化 cancelled、requeue 不碰图标、refetch/upload_local 端点、run_jobs 融入、跨账号隔离。
- 新增扩展回归：`workspace.test.mjs` 2 项（autoIcon 默认/拒绝、iconJob 透传）、`outbox.test.mjs` 更新 buildPayload 允许字段与 autoIcon。
- 新增前端 `icon-job-ui.test.mjs` 4 项（iconJobState 缺图排队/已有图不覆盖/无 Job/终态误传）、`api.test.mjs` 1 项（multipart 不设 Content-Type）；`scripts/tests/test_local_jobs.py` 3 项（日志、超时、路径）——**35** scripts、**48** 前端、**150** 扩展、**178** Django 全绿。
- 全量：扩展 150、Django 178、前端 48、Sites 4、脚本 35；扩展 check 71 文件；前端 build 成功；`makemigrations --check` 无漂移、`manage.py check` 0 issues。

## 三、真机 / 真实 HTTP / 真实调度证据（不是仅测试数量）

| # | 场景 | 实际结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 真实 Edge 1.9.0 工具栏点击 | 普通标签页表单含「不要自动补齐图标」入口；提交后显示 `已入库，图标获取中` + `已保存本地`（两阶段反馈、不假报已有图） | `phased-real.png` |
| 2 | 真实收藏入队 | HTTP `0.05s` 返回（不等待外网）、`site.iconJob={queued:true,phase:pending,attempts:0}`；真实 4173 DB 出现 `IconJob(pending)` | 只读 DB 快照 |
| 3 | 本地调度器 `once` 真执行 | `runjobs` 输出 `iconJobs.processed=1`，Job 领取后因本机公网 DNS 受阻落 `pending`（attempts=1, `icon_refresh_failed`）有界退避——**任务确实被执行，不是只写表** | `jobs.log` |
| 4 | 本地调度器 `loop` 真实起停 | `jobs.pid`=5992、`jobs.log` 每 5s 一个 cycle 共 24 次、期间新收藏的 Job 被该循环领取 `iconJobs.processed=1`；`jobs.stop` 后 PID 删除、日志 `scheduler stopped cycles=24` | `jobs.log` |
| 5 | autoIcon=false | 收藏返回 `iconJob={queued:false}`，DB 无新 Job | 真实 HTTP |
| 6 | 重新获取 / 高级本地上传 | `refetch` 返回排队且不覆盖；`upload_local` 用真实小 PNG multipart → 200 `complete`、`sourceUrl=local-upload`、version+1；随后已有图标的任务 `kept_existing` 不覆盖 | 真实 HTTP |
| 7 | 千问 CDN / ChatGPT / SVG / 私网 / 端口 / 重定向 / 超限边界 | 由既有 `test_icon_fallback.py`（千问式 `img.alicdn.com` 跨域 light 候选填补、ChatGPT SVG+栅格混排、SVG-only 降级、私网/危险端口/重定向/字节/像素上限）与 `test_icon_refresh.py`（跨域声明候选、CDN host）覆盖；`favicons` 安全逻辑未改，由 Job 执行器复用 | 后端测试 |
| 8 | 真实 DB 迁移 | 备份 `pre-phaseD-2026-11-18.sqlite3` 后 `0006_iconjob` 建表；重启 4173 加载新模型/路由 | 迁移日志 |
| 9 | 数据保护 | 清理全部测试站点/「阶段D验证设备」后恢复 **4 站点 / 3 图标 / 4 预览 / 0 Job**，`integrity_check=ok`、notes/分类不变 | 只读快照 |

## 四、发布物与实际运行时

- 扩展 **1.9.0**：`extension/dist/website-workspace-extension-1.9.0.zip`，**112,985 B**，SHA-256 `b78874b34583bd740b2327eb512e32861a74e9cb68300901d184d807f3e1a90e`。
- 加载目录 `C:\Users\无名\Downloads\website-workspace-extension` 51 文件逐字节一致、无多余文件；旧目录备份 `.local/polish-qa/loaded-backup-1.8.0`。
- 4173：`/api/extension/release` 与 `/downloads/...zip` 均 1.9.0/112985 B/哈希一致，仅 `127.0.0.1` 回环；2 个新路由实活；服务重启后用既有 `.local/manual-test/workspace.sqlite3`，未另建库、未部署云端。
- `edge://extensions` 运行版本 **1.9.0**，扩展 ID 不变 → chrome.storage/IndexedDB 数据继承。
- 已同步 `docs/extension-store-readiness.md`（Edge Add-ons 准备资料）、`deploy/README.md`（生产 timer/本机调度器）、README、extension/README、project-state、change-log、implementation-verification、local-testing、ai-context-map。

## 五、剩余问题与未完成项（不得视为全面验收）

### 补做：真机断网 + 完整浏览器重启 + 客户端同源图标端到端（goal round 2）

用受控本机回环夹具 `.local/polish-qa/phased-fixture.py`（仅 `127.0.0.1:4191`，页面声明同源 `<link rel=icon href=/icon.png>` 并真实返回 PNG）；该入口 scope=本机，服务端按设计不访问、浏览器扩展可读同源图标——正好是「浏览器能访问、服务器不能访问」边界，不修改 DNS/代理/证书、不伪造 Logo。证据图 `phased-client-icon.png`、`phased-offline-form.png`、`phased-restart-workbench.png`。

| # | 场景 | 实际结果 |
| --- | --- | --- |
| 10 | 客户端同源图标端到端（真机 1.9.0） | 工具栏点击→表单「自动取得的素材 / 截图：已压缩，等待上传 · 图标：已压缩，等待上传」（打开表单前已截当前页、读同源 PNG）→提交「截图：已上传 · 图标：已上传 / 已入库」；DB：site(scope 本机) + preview 960×540 6312B（source_url=站点入口，非候选 URL，sourceUrl/displayUrl 分离）+ icon 64×64 206B WebP；**无 IconJob**（本机入口不排队，诚实）。 |
| 11 | 含素材的真实断网→关闭表单→完整浏览器重启→恢复 | 停 4173 制造真实连接失败→真机提交→`已保存本地，等待网络`（截图+图标均压缩保留）→关闭表单标签→只读复制扩展 IndexedDB 确认 Outbox 保留任务（`restart2`/`waiting_network`/`local_saved`）与 Blob（`data:image/webp`）→杀掉全部 Edge 进程（完整重启）→重启 4173→重开真实配置（dev mode On / 扩展启用 / 运行 1.9.0）→worker 靠 startup/alarm **自动补齐**：站点 v3 + preview + icon + notes 完整、1 站点/1 采集回执/1 preview 回执/1 icon 回执/notes 标记仅 1 次（无重复建站/追加/覆盖）→工作台卡片刷新后显示绿色 Logo + 「查看截图」，无「图标获取中」标记（DTO `icon.present=true`、`iconJob.queued=false`）。 |
| 12 | 数据保护 | 清理夹具测试站点与夹具进程后恢复 **4 站点 / 3 图标 / 4 预览 / 0 Job**，`integrity_check=ok`、notes/分类不变；本轮未改任何产品代码，ZIP/release/加载目录/4173 仍为 1.9.0 同哈希。 |

这两项补齐了上一版记录里「含素材的真实断网恢复 + 完整浏览器重启」与「客户端同源图标端到端」的空白。

### 补做：真实公网 CDN 补图 + 诚实缺图 + 例外恢复真机 UI（goal round 3）

本机公网 DNS 在早期轮次对部分域名受阻，本轮复核 `img.alicdn.com` / `tongyi.aliyun.com` / `www.baidu.com` 等真实公网主机已可解析并访问（**未修改系统 DNS/代理/证书、未绕过公网校验、未伪造 Logo**）。真实页面 `https://tongyi.aliyun.com/qianwen/` 声明跨域 `https://img.alicdn.com/imgextra/...80-80.png`（light/dark），CDN PNG 实测 HTTP 200 / 1658B / `89504e47` PNG magic。证据图 `phased-real-cdn-icon.png`、`phased-cdn-final.png`、`phased-recovery-expanded.png`。

| # | 场景 | 实际结果 |
| --- | --- | --- |
| 13 | **真实千问 CDN 自动补图（无注入）** | 真实 4173 HTTP 收藏该公网 URL（缺图、autoIcon 默认）→ 同事务入队 `IconJob(pending)`；`scripts/local_jobs.py once` 真实调度 → `run_icon_jobs` **默认 fetcher**（非注入）经 `favicons` 每跳公网校验抓取真实 `img.alicdn.com` PNG → 只填空写入 `SiteIconAsset(80×80, 1366B WebP, source_url=CDN URL)` → Job `complete`。工作台 DTO `icon.present=true` / `iconJob.queued=false`，卡片渲染**真实蓝色 Logo**（`/api/sites/<id>/icon` HTTP 200 `image/webp` 1366B `RIFF....WEBP`）。补齐 §9「千问CDN正常自动补图」，此前仅注入网络的后端测试覆盖。 |
| 14 | **服务器受阻时准确说明缺图、不伪造 Logo** | 真实公网但页面/默认 favicon 均无图的站点 → Job 经真实调度有界重试 3 次（每次真实网络失败 `icon_refresh_failed`）→ 终态 `no_icon`，`result={"status":"no_icon","code":"icon_refresh_failed"}`，**0 图标资产**（字母回退），工作台 DTO `icon.present=false` / `iconJob.queued=false`，卡片无「图标获取中」标记。补齐 §9「没有则准确说明失败」。 |
| 15 | **迟到结果保留现有图（kept_existing）** | 用户用高级本地 PNG 上传替换缺图后，仍在排队的 Job 执行 → `kept_existing` / `{"status":"kept_existing"}`，图标 bytes/source/revision **完全未变**（`source_url='local-upload'`）。补齐 §6「仅填空、不覆盖客户端上传或用户自定义图标，迟到结果完成为已保留现有图」。 |
| 16 | **例外恢复真机 UI** | 工作台详情「服务器无法访问该网站？例外恢复」`<details>` 展开后，UIA 在真实浏览器 DOM 找到 **「重新排队补图」** 与 **「上传本地 PNG/WebP 图标」** 两个按钮；`InvokePattern` 真实点击「重新排队补图」→ DB 出现新 `IconJob(pending, attempts=0)`、站点仍 0 图标（只排队不覆盖）；`refetch` 与 `upload_local` 端点真机 HTTP：`refetch` 200 `{queued:true}`、`upload_local` 200 `complete` `sourceUrl='local-upload'` version+1，**备注/分类完整保留**。普通收藏不需手工补图。 |
| 17 | 数据保护 | 清理全部 QA 站点与设备后恢复 **4 站点 / 3 图标 / 4 预览 / 0 Job**，`integrity_check=ok`、notes/分类不变；本轮未改任何产品代码，ZIP/release/加载目录/4173 仍 1.9.0 同哈希。 |

### 补做：错误边界真实 HTTP 注入（goal round 3，QA 设备/站点，不碰唯一真实配对）

| # | 场景 | 实际结果 |
| --- | --- | --- |
| 18 | 认证失效 | 配对 QA 设备→撤销→用其 Bearer 调 `/api/extension/lookup` → **401 `auth_required`**（撤销前 200）。扩展 `classifyError` 将 401/403 → `needs_auth` 暂停连接、不误标入库。 |
| 19 | 429 限流 | 对只读低速率端点连续越过 `rate` 上限 → **429 `rate_limited`**。扩展 `classifyError` 429 → `waiting_network`，`delay=max(30s, Retry-After)` 且 ≤1h，有界不无限重试。 |
| 20 | 409 幂等冲突 | 同一 `clientCaptureId` 内容改动重发 → **409 `idempotency_conflict`**。扩展 → `conflict`，不覆盖已确认收藏。 |
| 21 | 数据保护 | 清理 QA 设备/站点后：仅余 3 个 `我的浏览器` 设备、**4 站点/3 图标/4 预览/0 Job**、`integrity_check=ok`。 |

以上为真实 4173 HTTP 边界注入（服务端确实返回这些状态码/code），客户端分类由回归 `outbox.test.mjs` / `asset-upload.test.mjs` 覆盖；**实体浏览器里把同一份 Outbox 任务打到 401/429/409 的真机注入仍需用户配合重新配对**（不擅改唯一真实配对）。

### 各阶段候选仍缺的真机演练
- 阶段 B 候选 1.7.0：非空旧队列迁移真机演练（仅回归覆盖）；真人同账号重新配对 / 第二账号验证旧任务不转投（需用户最小配合，未擅自改动唯一真实配对）。
- 阶段 C 候选 1.8.0 与阶段 D 候选 1.9.0：实体浏览器里对同一 Outbox 任务的 429/认证真机注入（上表 18–20 已在服务端 HTTP 边界验证状态码、客户端分类由回归覆盖；真机注入需重新配对）；真人同账号重新配对 / 第二账号不转投。
- 真人配合：含素材断网+完整重启已用受控夹具在实体浏览器重跑（上表 10/11）；如需「真人手动断网/账号切换」的更严口径，最小动作是在 4173 工作台用同账号重新配对一次、或另建第二账号验证旧任务不转投，完成后继续跟踪。

### 安装分发（本轮授权外，仅准备资料）
- `docs/extension-store-readiness.md`：Edge Add-ons 账号/文案/权限理由/隐私说明/商店 ID 变化与无凭据队列迁移/重新配对规划。
- **未**创建商店账号、未接受条款、未提交审核、未公开发布、未制造商店链接、不承诺审核通过；Chrome 另发官方商店另行处理。商店签名/更新、真实商店 ID、公开发布后安装稳定性未验证；本机继续用未打包 ZIP（依赖开发人员模式，重启可能被关闭并禁用扩展）。
- Chrome、低内存 Debian、云端未测；不部署云端。

### 环境
- 测试期间在真实浏览器打开多个标签页，未擅自关闭用户原有标签；QA 设备/测试站点全部清理；本地调度器 loop 已用 stop-file 干净停止（PID 删除）。
