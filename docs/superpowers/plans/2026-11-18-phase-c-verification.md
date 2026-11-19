# 阶段 C 验证记录：截图/客户端图标 + 独立 revision 条件写入

日期：2026-11-18。对应 [稳定收藏架构](../specs/2026-11-18-stable-capture-architecture.md) 阶段 C。
**状态：阶段 C 候选 1.8.0（客户端+服务端条件写入已实现、回归与真机/真实 HTTP 证据齐备）；阶段 D 未开始。阶段 B 候选 1.7.0 剩余真机演练仍为待办，不宣称任何候选版全面验收完成。**

## 一、本阶段交付范围

### 服务端（`server/`，条件写入层）
- 新增 `asset_baseline.py`：`site_source_fingerprint`（对入口 id/url 排序 sha256）、`baseline_dto`、`check_baseline`、`record_tombstone`、`source_url_fingerprint`。
- 新增 `extension_v3.py`：两个 `@api(['POST'], bearer=True, rate=60)` 端点 `POST /api/extension/v3/captures/<cid>/{preview,icon}`，multipart。
- `extension_v2.summary()` 与 `extension.capture_site_dto()` 暴露 `previewBaseline`/`iconBaseline`（`{present, revision, sourceFingerprint}`，新建站 `revision=None`→客户端用 `'absent'`）。
- 模型：`AssetTombstone`（迁移 `0005`）、`SiteIconAsset.source_fingerprint`（`0005`）。`preview.detail` DELETE 与 `icons.image` DELETE 删除资产前写 tombstone；`store_refreshed_icon` 等换图路径本就换新 revision 令旧基线失效。
- 条件写安全：`check_baseline` 先比入口来源指纹（变化→`asset_source_changed` 409），再比素材独立 revision（不符→`asset_conflict` 409）；`absent` 基线额外要求该 (site,kind) 无 tombstone，防止「删图后又无图」ABA。幂等（`owner + clientAssetId + 内容指纹`）优先于基线检查，相同请求返回首次 `result`、`绝不重新挂素材`。配额/许可/回执/版本递增都在事务内；媒体事务外先发布、失败删文件。安全判断不依赖 `Site.version+1`（版本递增仅供文字层，操作回执给出已知新版本）。

### 客户端（`extension/`）
- `capture-entry.js`（`createCaptureEntry`）：`action.onClicked` 拿真实 tab，打开表单**之前**完成目标 tab/window/URL 前后复核 → `captureVisibleTab` 截图 → 有限元信息 → 同源客户端图标；导航后丢弃截图，不会把新页面冒充旧页面；失败不阻塞文字草稿；URL 只含不可猜 `draftId`。
- `capture-compress.js`：在普通扩展页 DOM/canvas 内把原始 PNG 降分辨率 + 质量循环压成有界 WebP（≤200KiB），超限/解码失败返回 null 省略截图；`sourceUrl`（入口）与 `displayUrl`（图片）严格分离。
- `outbox-model.js`（抽出纯函数）、`outbox.js`：`openDraft` 把原始快照/图标 Blob 与任务**同事务**持久化；`compressAsset` 原子替换原始快照并清除；`flush` 先文字幂等确认并写入两条基线，再逐附件条件上传；`cancelAsset` 仅用户明确移除才删 Blob。附件子阶段（raw/ready/uploading/uploaded/conflict/skipped/cancelled）在同一记录内，不反向改写文字阶段。
- `asset-upload.js`/`asset-manager.js`：`buildAssetForm` 带 `expectedAssetRevision`（基线或 `absent`）与 `expectedSourceFingerprint`，绝不 lookup 猜版本；成功（服务端确认）才释放 Blob；网络/5xx/429 有界退避保留 Blob；换图/删图/来源变化/幂等冲突→`conflict` 暂停保留 Blob 且不重传；401→`needs_auth` 暂停；403 视为单次冲突不暂停连接；重复收藏 `canAttach=false`→跳过素材不覆盖已有图片。
- `service-worker.js` 用 `createCaptureEntry` 接线，注入 `dataUrlToBlob`；`capture.html/css/js` 显示素材小预览/状态与「这次不带截图/图标」显式移除；`capture-draft` 在浏览器重启恢复已提交表单时返回真实阶段。
- worker 终止靠持久化任务 + cycle alarm 恢复，不用 debugger/CDP/循环保活；不假定 activeTab 跨导航/重启仍有效（恢复只读已持久化 Blob）。

## 二、回归（先写测试、再实现，旧实现先失败再转绿）

新增 17 项扩展回归 + 8 项 Django 端到端测试：
- `open-capture.test.mjs`(6)：采集顺序在打开表单前、URL 只含 draftId、导航后丢弃截图、截图失败/超限不阻塞、checkTarget 拒绝隐身/非HTTP(S)/改窗口、原始快照与图标先持久化。
- `capture-compress.test.mjs`(4)：有界尺寸、WebP 输出、质量循环降质、超限/解码失败返回 null。
- `asset-upload.test.mjs`(8)：截图与任务同事务持久化/sourceUrl-displayUrl 分离、页面内压缩原子替换并清除 raw、按基线条件上传成功后释放 Blob、换图/删图冲突保留 Blob 不覆盖不重传、网络失败有界退避后补传、401 暂停保留 Blob、用户取消才删 Blob、重复收藏 canAttach=false 跳过不覆盖。
- `server/workspace/tests/test_asset_baseline.py`(8)：基线 DTO、absent 成功、幂等重放不覆盖新图、旧 revision→asset_conflict、DELETE tombstone→absent 被拦(ABA)、改 endpoints→asset_source_changed、跨账号/回执 403、idempotency_conflict。

全量：扩展 **148**、Django **163**、前端 47、Sites 4、脚本 32；扩展 check 71 文件；前端 build 成功；`makemigrations --check` 无漂移、`manage.py check` 0 issues。

## 三、真机 / 真实 HTTP 证据（不是仅测试数量）

| # | 场景 | 实际结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 真实 Edge 工具栏点击 1.8.0 | 打开普通标签页，表单显示「自动取得的素材 / 截图：已压缩，等待上传」（截图在打开表单前已取并压缩） | `phasec-capture-form.png` |
| 2 | 快速提交含截图 | `已保存本地` → `截图：已上传` → `已入库` | 表单文本 + 截图 |
| 3 | DB 落库 | 站点 **v2**（文字 v1 + 素材操作回执 v2）、preview 资产 960×540 WebP 10,260 B、`PreviewReceipt.status=complete` | 只读 DB 快照 |
| 4 | 真实 HTTP 首次条件上传 | `expectedAssetRevision=absent` + 来源指纹 → 200 `complete`，得到独立 revision | 4173 实跑脚本 |
| 5 | 用户换图 | 用新合法 revision 上传另一图 → 200；**旧任务用过期 `absent` 重发 → 409 `asset_conflict`，不覆盖新图** | 4173 实跑 |
| 6 | 幂等重发 | 同 clientAssetId+同内容 → 200 返回首次 assetId，`不重复建站/不追加/不覆盖` | 4173 实跑 |
| 7 | 删图后 ABA | DELETE 写 tombstone 后，`absent` 上传 → 409 `asset_conflict`（不与「从未有图」混淆） | 4173 实跑 |
| 8 | 改入口来源 | PATCH 改 endpoint 后，旧 `expectedSourceFingerprint` → 409 `asset_source_changed` | 4173 实跑 |
| 9 | 迁移 0005 | 对真实 4173 DB 备份后迁移，`workspace.0005` 已应用、tombstone 表与 `source_fingerprint` 列存在 | 迁移日志 + 快照 |
| 10 | 数据保护 | 清理全部测试站点/QA 设备后，恢复为原有 **4 站点 / 3 图标 / 4 预览**，`integrity_check=ok`、notes/分类不变 | DB 快照 |

## 四、发布物与实际运行时

- 扩展 **1.8.0**：`extension/dist/website-workspace-extension-1.8.0.zip`，**111,744 B**，SHA-256 `6472e85527050364090141390f6d0ceebfb149592ac91532758d17ba5321c0df`（重复构建哈希一致）。
- 加载目录 `C:\Users\无名\Downloads\website-workspace-extension` 51 个 ZIP 条目逐字节一致、无多余文件；旧目录备份 `.local/polish-qa/loaded-backup-1.7.0`。
- 4173：`/api/extension/release` 与 `/downloads/...zip` 均 1.8.0 / 111744 B / 哈希一致，仅 `127.0.0.1` 回环；v3 两路由实活（未授权 POST 返回 401 而非 404）；服务重启后加载新模型/路由，用既有 `.local/manual-test/workspace.sqlite3`，未另建库、未部署云端。真实 DB 迁移前备份 `.local/manual-test/backups/pre-phaseC-2026-11-18.sqlite3`。
- 浏览器运行版本 1.8.0（edge://extensions 卡片），扩展 ID 不变 → chrome.storage/IndexedDB 数据继承。

## 五、剩余问题与未完成项（不得视为全面验收）

### 阶段 B 候选 1.7.0 仍缺的真机演练（用户选择「保持现状，先进阶段 C」）
- 重新配对 / 账号切换 / 429·认证失效·冲突真机注入、非空旧队列迁移真机演练：仅回归覆盖，未改动唯一真实配对，未擅动。

### 阶段 C 尚未做的真机演练
- **含素材的真实断网恢复 + 完整浏览器重启**：阶段 B 已用纯文字任务做过；阶段 C 的「截图已持久化但断网 → 重启 → worker 恢复上传」仅由回归/引擎级组合测试覆盖，未在实体浏览器重跑。
- 客户端图标在真实同源可读取场景下的端到端（本轮 example.com 无同源栅格候选，故只验证了截图路径）；图标 v3 端点由后端 8 项真实 multipart 测试覆盖。
- `429`/`认证失效` 真机注入未做（回归覆盖）。

### 阶段 D 未开始
- 服务端公开图标 Job（SQLite 任务表 + 受限短任务执行器、本机/生产真实调度方式）、HTTP 收藏接口不等待外网、页面声明公共 CDN / PNG / 已验证 ICO、每跳 DNS/公网/端口/重定向/字节/像素/时间限制、SVG 安全栅格化或明确降级、仅填空不覆盖、千问 CDN 补图、ChatGPT 浏览器可读/服务器受阻边界、「重新获取」与高级本地 PNG/WebP 上传例外入口 —— 均未实现。
- 不修改用户 DNS/代理、不关闭公网校验、不伪造 Logo。

### 安装分发（本轮授权外）
- 继续用未打包扩展验证，依赖 Edge 开发人员模式（重启可能关闭并禁用）；正式长期使用需 Edge Add-ons 方案，商店账号/条款/提交/审核/公开发布不在本轮授权范围，仅可准备资料、不代发布、不制造商店链接、不承诺审核通过。商店扩展 ID 可能变化，需规划无凭据泄露的队列迁移与重新配对，不能先卸载旧版丢数据。
- Chrome、低内存 Debian、云端未测；不部署云端。

### 环境
- 测试期间在真实浏览器打开多个标签页，未擅自关闭用户原有标签；QA 设备「阶段C验证设备」已全部撤销，仅保留用户既有设备；测试站点全部删除。
