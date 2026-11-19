# 阶段 B 验证记录：普通扩展收藏页 + 单一权威 Outbox

日期：2026-11-18。对应 [稳定收藏架构](../specs/2026-11-18-stable-capture-architecture.md) 阶段 B。
**状态：阶段 B 候选版本 1.7.0（已实现 + 回归 + 真机核心生命周期证据），尚未标记「阶段 B 全面验收通过」；阶段 C/D 未开始。**

## 一、本阶段交付范围（实现）

- 保留：产品行为（分类/notes/普通收藏直接入库、稍后整理进收件箱、重复不覆盖）、前端、Django/SQLite/Waitress 与现有 `/api/extension/v2/captures`、`/api/extension/options`、`lookup`、`pair`、`release`、账号/收藏/设备配对/队列/Blob、`api.js`/`queue.js`/`ui.js`/`preferences.js`/书签导入/`popup.html` 调试页及其目标保护。
- 新增：普通扩展标签页 `capture.html`/`capture.css`/`capture.js` + 不可猜 `draftId` 草稿协议；`action.onClicked`（移除 `default_popup`）绑定用户点击时的真实 tab/window；单一 IndexedDB Outbox `outbox-store.js`（任务+Blob 同库同事务）、`outbox.js`（单记录阶段机 + 短租约 + 幂等重发 + 有界退避 + 身份隔离）、`workspace.js`（统一串行业务写入入口，兼容旧消息）、`migration.js`/`migration-run.js`（备份→独立副本核对→原子迁移）。
- 收敛：queue/assetJobs/iconTasks/captureReceipts 四套并行状态 → 一条 Outbox 记录里按阶段与附件子状态表达；旧模块与旧 chrome.storage 字段保留作只读备份，Service Worker 不再加载/写入四套状态。
- 明确滞后：`attach`/截图/图标/服务端公开图标 Job 属阶段 C/D，本版文字收藏不抓图；旧 `popup.html` 保护未删除。
- 未改浏览器受保护偏好/企业策略/系统 DNS/代理/防火墙；断网验证用「停止本机回环服务」制造真实连接失败。

## 二、回归（先写测试，再实现）

`extension/tests/`：`outbox.test.mjs`(11)、`outbox-store.test.mjs`(4)、`migration.test.mjs`(8)、`migration-run.test.mjs`(5)、`workspace.test.mjs`(6) = 34 项新回归；扩展全量 **130 通过**。
覆盖：本地事务先行/联网确认后才 complete；重启以同 captureId 幂等重发不重复建站/备注；两 capture 交错；关闭表单不丢；草稿不上传且 TTL 清理；断网/5xx 有界退避；429 遵守 Retry-After；401 暂停+needs_auth；409 转 conflict 不重传；身份切换不转投/同账号重配恢复；短租约防并发；cancel/remove 为显式动作；buildPayload 固定入口 URL、指纹稳定；任务+Blob 单事务原子性与中止回滚；迁移计划（pending→local_saved、auth/blocked/conflict/cancelled 不迁成可自动提交、preview_pending 补回执、身份/Blob 摘要核对）；迁移运行器（备份不覆盖、核对失败不标记、独立副本试迁移失败回滚、幂等跳过）。
全量：扩展 130、Django 155、前端 47、Sites 4、脚本 32；扩展 check 63 文件；前端 build 成功。

## 三、真机（真实 Edge 157 / 真实账号 user@example.com / 4173 回环）证据

| # | 场景 | 实际结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 入口 | 真人点击（阶段A）+ 重载后工具栏点击 → 打开**普通标签页** `capture.html?draft=<uuid>`，显示 `v1.7.0`、真实配对 `http://127.0.0.1:4173 · user@example.com`、5 个分类、固定目标 URL；URL 只含 draftId | `phase-b-capture-tab.png`、`phase-a-ready.png` |
| 2 | 快速提交 | 填 notes 点收藏 → `已保存本地` → `已入库 / 已收藏到网站库`；服务端建 1 条站点、notes 保留、非收件箱、无重复 | DB 查询 + 截图 |
| 3 | 真实断网 | 停止 4173 回环服务（连接失败）→ 提交 → `已保存本地，等待网络`；options 页 `待同步 1 条`、含精确 URL 与网络错误文案 | `phase-b-two-offline-queue.png` |
| 4 | 两 capture 交错 + 关闭表单 | 两个不同站点在断网下各自提交，Outbox `待同步 2 条`；提交后立即关闭表单标签仍不丢任务 | options 队列 + DB |
| 5 | 完整浏览器重启 | 杀掉全部 Edge 进程后重启真实配置：开发人员模式 On、扩展启用、版本 1.7.0、ID 不变；配对（设备：我的浏览器 / 凭据有效期）与 2 条任务全部保留 | 重启后 options 页 `待同步 2 条` |
| 6 | 恢复与幂等 | 重启服务器后由 MV3 worker 周期 alarm 自动恢复，两条任务都建站、notes 各自保留、每 capture 仅 1 条站点；无手工重试、无 debugger/CDP/保活 | DB 查询（sites 9→清理） |
| 7 | 迁移 | 真实扩展存储出现 `workspaceOutboxBackupV1` 备份键 + `website-workspace-outbox` IndexedDB 及 `migration`/`schemaVersion` 标记 | 只读 LevelDB 复制检查 |
| 8 | 数据保护 | 最终恢复为原有 4 站点 / 3 图标 / 4 预览，notes 与分类不变，`integrity_check=ok`；5 个测试站点经 API 删除 | DB 快照 |

## 四、发布物与实际运行时

- 扩展 **1.7.0**：`extension/dist/website-workspace-extension-1.7.0.zip`，101,582 B，SHA-256 `ca5a3ff019b0d1988a53633fe9e81c51cfc27957734b63598779cdb619256ca3`。
- 加载目录 `C:\Users\无名\Downloads\website-workspace-extension` 46 个 ZIP 条目逐字节一致、无多余文件；旧目录备份于 `.local/polish-qa/loaded-backup-1.6.1`。
- 4173：`/api/extension/release` 与 `/downloads/...zip` 均 1.7.0 / 101582 B / 哈希一致，仅 `127.0.0.1` 回环监听；服务用既有 `.local/manual-test/workspace.sqlite3`，未另建库。
- 浏览器运行版本 1.7.0（edge://extensions 卡片），扩展 ID `mgoiiimmoehjajddbejpjljhmondnbem` 未变 → chrome.storage/IndexedDB 数据继承。

## 五、剩余问题与未完成项（不得视为全面验收）

### 阶段 B 尚缺的真机证据（需用户最小配合）
- **重新配对 / 账号切换真机演练未做**：会改动当前唯一真实设备配对，未擅自执行；已由回归覆盖（同账号重配恢复 needs_auth、切账号不转投）。最小动作：在 4173 设置生成一次配对码并用同账号重新配对（不改变账号），或另建第二账号验证不转投；完成后我继续跟踪队列。
- **429 / 认证失效 / 冲突的真机演练未做**（仅回归 + 引擎级），需可控错误注入或第二账号。
- 迁移在真实配置上旧队列为空（升级前「待同步 0 条」），故**非空旧队列迁移**仅由独立副本回归验证，未在真机演练。

### 本候选版本的能力缺口（阶段 C/D 未开始）
- **1.7.0 暂不抓取截图/图标**：按分阶段计划，文字/分类/notes 先跑通，素材在阶段 C 接入。因此当前候选版收藏的站点没有新截图与图标，不能作为「替代 1.6.x 的每日使用版本」，也不宣称素材行为已验收。
- 阶段 D 服务端公开图标 Job、千问公共 CDN 补图、ChatGPT 浏览器可读/服务器受阻边界、受限短任务执行器**均未实现**。
- 「重新获取」与高级本地 PNG/WebP 上传例外入口未实现（阶段 D）。
- Chrome、低内存 Debian、云端、正式 Edge Add-ons 商店发行（账号/条款/审核/发布不在授权范围）均未验证或未准备。

### 环境约束
- 未打包扩展依赖 Edge 开发人员模式；重启可能把该开关关掉并禁用扩展（阶段 A 已确认这是过去「自动化点不开」的根因之一），属分发环境，正式长期使用需商店发行方案。
- 测试期间在真实浏览器打开了多个标签页，未擅自关闭用户原有标签。
