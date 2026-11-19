# 1.10.0 交互修正验证：恢复工具栏小弹窗 + 截图两入口（候选，未全面验收）

日期：2026-11-18。用户 20:09 实测反馈：「点击扩展会打开新标签页，打断正在浏览的网页，截图入口也找不到了」。本轮按「先诊断实际原因 → 先加回归 → 再实现 → 真机验收」推进。**A/B/C/D 四阶段仍为候选，本版为 1.10.0 交互修正候选，不宣称全面验收完成。**

## 一、按实际原因诊断（不是「查看入口丢了」）

| 症状 | 实际原因 | 证据 |
| --- | --- | --- |
| 点击扩展打开新标签页、打断浏览 | `manifest.json` 无 `action.default_popup`；1.9.0 靠 `chrome.action.onClicked` → `createCaptureEntry.openForTab` → `tabsCreate('capture.html?draft=…')` 每次开新标签页。官方文档：`default_popup` 时 `onClicked` 不派发、`_execute_action` 打开弹窗。 | 源码 `manifest.json`、`service-worker.js`、`capture-entry.js`；[Chrome action.onClicked / _execute_action](https://mv3-extension.com/uiux-patterns-interactive-components/keyboard-shortcuts-commands/the-execute-action-command-and-the-four-shortcut-limit/)、[Chrome tabs API](https://developer.chrome.google.cn/docs/extensions/reference/api/tabs?hl=zh-cn) |
| 工作台「查看截图」按钮/大图查看器 | **没有丢**：真实 Edge 点击「查看截图」打开了「DeepSeek 深度求索 · 页面截图」，显示真实大图 + 适应窗口/100% 原尺寸/缩放/重置；`/api/sites/<id>/preview/image?size=full` 返回 200 `image/webp` 19522B；构建 JS 内含「查看截图」「适应窗口」「100% 原尺寸」。 | `diag-viewer.png`（真实 Edge 截图） |
| 新收藏卡片显示「暂无截图」 | **没采集/没上传**：用户 19:11 真实收藏的 YouTube 站点 `preview=0`（`icon=1`）。两个真实代码原因：(a) `captureVisibleTab` 原始 PNG 数据 URL 超过 `maxRawBytes=700_000` 时被静默丢弃——2560×1440 内容丰富页面必然超限（此前深色纯色回环夹具才 <700KB）；(b) `submitDraft` 把仍是 `raw`（弹窗压缩未完成就点保存）的截图 `next.preview=null` 静默删除，永不上传。 | 真实 DB 诊断 `diag-youtube.py`：`b7ad8295` site preview 0；`capture-entry.js:38`、`outbox.js:78-80`（1.9.0） |

## 二、实现（先回归后实现）

### 扩展（1.10.0）
- `manifest.json`：`action.default_popup = "popup.html"`，版本 1.10.0；移除 `chrome.action.onClicked` 注册（不再自动开新标签页）；`_execute_action`（Alt+Shift+S）由浏览器打开弹窗。
- 新 `popup.html` / `popup.js` / `popup.css`：小弹窗只负责交互——自动显示标题/地址/简介/图标、截图预览三态（**正在截图 / 截图已就绪 / 截图不可用**）、自定义分类下拉、备注、稍后整理（默认关）、不要自动补图（默认关）、收藏按钮；本地保存反馈「已保存，待同步」/「已同步」。不打开新标签页、不跳转工作台、不要求收件箱整理。截图失败仍可保存并明确「这次未附截图」。「重新截图」只在原标签可确认时可用。
- `capture-entry.js`：新增 `openForPopup(tab)`（不创建标签页）、`recapture(draftId)`（原标签 URL/窗口不变才重采，切换/关闭拒绝）、`MAX_RAW_PREVIEW_BYTES = 8MB`（有界放宽，修复真实缺图根因）。`openForTab` 保留为调试/恢复页，不由工具栏触发。
- `outbox.js`：删除 `submitDraft` 丢弃 raw 截图的逻辑（改为保留，同 captureId 已落盘）；新增 `setRawPreview` / `compressPendingRaw`（抽到 `raw-preview.js` 保持 ≤300 行）；`compressPendingRaw` 有界重试 3 次，不无限循环。
- `worker-compress.js`：service worker 原生 `createImageBitmap` + `OffscreenCanvas` 压缩（不是模拟 Image/document），弹窗关闭后后台也能把已落盘的原始快照压成有界 WebP；`service-worker.js` 的 `synchronize()` 先调用 `compressPendingRaw` 再 `flush`。
- `service-worker.js`：新增 `capture-open` / `capture-recapture` 消息处理；全部采集在后台短窗口完成，目标前后 `tabsGet` 复核（切换页面不冒充）；文字草稿+原始截图 Blob+图标 Blob 同一个 captureId 一次性事务落盘。
- `capture-compress.js` / `capture.js` 协议保持；`popup.css` / `worker-compress.js` / `raw-preview.js` 加入 `RUNTIME_FILES`。

### 前端（回归加固，不改布局）
- `model.js` 新增纯函数 `canViewScreenshot(site)`（present + 非空 fullUrl 才 true）与 `screenshotEntryLabel`；`SiteCard.jsx` 用它们统一判定，保留 Logo 主体紧凑卡片、footer 结构与 `onViewScreenshot` 回调，消除「present 但 fullUrl 缺失」的伪入口。`SiteDetail.jsx` 无需改。
- 新增 `prototype/tests/screenshot-entry.test.mjs`（9 例）：伪入口、标签文案、**重开工作台看图**（`screenshotResourceKey` 稳定/变化）、zoom 夹取与 ready/error/empty。前端 agent 报告：`npm test` 57 pass、Sites 4 pass、build 成功，未改 hosting/worker/prepare 脚本、无 transform:scale。

## 三、回归数字（先新增回归再实现；回归断言对应已诊断的 1.9.0 缺陷，实现后全部转绿）
- 扩展：`npm test` **168 pass / 0 fail**（新增 `popup-entry.test.mjs` 15 例、`worker-compress.test.mjs` 4 例；旧 open-capture/outbox/workspace 回归全绿）。`npm run check` 76 个源码文件语法 + ≤300 行 + 4 个 PNG 尺寸 + 无 inline script + 无 node_modules 通过。
- 前端：57 pass、Sites 4 pass、`npm run build` 成功（`dist/client/index.html`、`dist/server/index.js`、`dist/.openai/hosting.json`）。
- 脚本：35 pass；后端：178 pass（含 `test_downloads.py` 版本断言 1.10.0）、`makemigrations --check` 无漂移、`manage.py check` 0 issues。

回归覆盖的关键点：`default_popup` 存在；`openForPopup` 不创建标签页；900KB 原始快照不再被丢弃；>8MB 仍省略；源页导航后不冒充；recapture 切换/关闭/已上传拒绝；`submitDraft` 保留 raw 截图；`compressPendingRaw` 成功原子替换、失败有界重试不丢文字；worker 压缩有界 WebP、解码失败返回 null。

## 四、独立配置 + 独立测试库（保留日常数据）
按用户要求「测试用独立配置和测试库，保留我的日常账号、配对、收藏和队列」：
- 独立服务器 `127.0.0.1:4174`（`.local/acceptance/server.py` + 独立 `workspace.sqlite3` + 独立密钥），`migrate` 建表；日常 4173 服务/库始终独立运行、未读写其数据。
- 独立 Edge profile（`.local/acceptance/edge-profile2`，`--load-extension` + 兼容 flag），1.10.0 扩展已安装（选项页「当前版本 1.10.0」），与日常「用户配置 1」完全隔离。
- 独立测试账号 `qa-acceptance@example.test` + 独立配对设备；自定义分类「验收分类A」在独立库创建。
- 验收前/后核对日常 4173：**5 站点 / 4 图标 / 4 预览 / 1 Job**、notes/分类不变、3 个「我的浏览器」设备保留、`integrity_check=ok`。日常数据未被增删。

## 五、真实 Edge 验收整条路径（独立环境）
| # | 场景 | 实际结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 在普通网页（`http://127.0.0.1:4191/`）按 Alt+Shift+S 打开扩展 | **标签数 7→7，没有新标签页**；用户留在当前网页。弹窗显示连接 4174、自动取得的标题/地址/简介/图标与**真实当前页截图预览**（「截图已就绪」绿点）、「这次不带截图」、自定义分类（当前账号 4 个分类）、备注。 | `popup-shortcut.png`、`popup-open.png` |
| 2 | 选「验收分类A」、写备注「阶段E真机验收-分类与备注保留-20261118」→ 点收藏 | 弹窗显示「**已同步**」+「已收藏到「验收分类A」，截图与备注都已入库」。 | `popup-saved.png` |
| 3 | 出现本地保存反馈后**立即关闭弹窗**（Escape）→ 刷新工作台 | 独立库：1 站点、category=验收分类A、notes 精确匹配、icon+preview 均 present（960×540 7512B）、1 采集回执（无重复）、`integrity ok`。 | `verify-db.py`、`workbench-after.png` |
| 4 | 工作台卡片「查看截图」→ 大图查看器 | 打开「阶段D本机夹具 · 页面截图」，显示**对应网页的大图**（绿色夹具页与「截图与图标采集验证」文字），工具栏「适应窗口 / 100% 原尺寸 / − 100% + / 重置」。 | `viewer.png` |
| 5 | 重开工作台后看图 | 前端回归锁定 `screenshotResourceKey` 稳定：同 siteId+revision+fullUrl 重开不误重载；revision 变化才重新加载。 | `screenshot-entry.test.mjs` |
| 6 | 离线保存 → 自动续传（干净循环，无重新配对） | 停 4174 → 弹窗保存显示「已保存，待同步」+「当前离线，任务与备注已保留，恢复后自动续传；关闭弹窗也会继续」→ 立即关弹窗 → 仅重启 4174，**无用户动作、无重新配对**，靠 SW alarm 自动续传：3 站点 / 3 图标 / 3 预览 / 3 回执，`integrity ok`。 | `offline-saved.png`、`clean-offline.ps1`、`final-workbench.png` |
| 7 | 认证兜底（附带验证） | 因测试脚本为 UI 登录修改测试账号密码，设备凭据 `auth_hash` 失效 → 401 诚实暂停、本地队列保留「待同步 1 条」；同账号重新配对后 `resumeOwner` 恢复并同步、无数据丢失、不转投其他账号。 | `options-queue.png`、`repaired.png` |
| 8 | 日常运行时 | 日常 Edge 重载后运行 **1.10.0**（同扩展 ID，配对/队列继承）。4173 回环 `/api/extension/release` 与 `/downloads/...zip` 均为 1.10.0、114814 B、SHA-256 `09551f05365a55f87f3194a539a6f3a6259a5d26f91450508d236a1155fee12d`；加载目录 54 文件逐字节一致。 | `daily-runtime-110.png`、`verify-daily.ps1` |

发布物：`extension/dist/website-workspace-extension-1.10.0.zip`，114,814 B，SHA-256 `09551f05365a55f87f3194a539a6f3a6259a5d26f91450508d236a1155fee12d`。

## 六、Round 4 追加验收（2026-11-18 22:25–23:40，用户要求的「随后继续」项）

仍用独立配置/测试库：重启 `127.0.0.1:4174` 独立 SQLite、独立 Edge profile（`edge-profile3` 用于公网/截图、`edge-profile4` 用于升级）、独立测试账号/配对设备；日常 4173 数据全程隔离。Edge 157 未打包扩展在强制重启后曾出现渲染器空白/开发人员模式关闭，按 Phase A 既有结论记录为环境约束，换全新独立 profile 解决，未修改业务代码。

| # | 场景 | 实际结果 | 证据 |
| --- | --- | --- | --- |
| 9 | 千问真实公网首次收藏 | `https://qianwen.aliyun.com/` 真实内容页，弹窗「截图已就绪」+ 预览缩略图；选「验收分类A」+ 备注「阶段E-R4千问真实公网首次收藏」→ 「已同步」。独立库：站点名「千问AI双11，好价好AI」、category/notes 精确、preview 960×540 **41184 B**（真实内容丰富页面大图，非夹具 7.5KB）、1 采集回执、同事务入队 1 个公开图标 Job。标签数点击前后 11→11，无新标签页。 | `public-qianwen.png` |
| 10 | ChatGPT 真实公网首次收藏 | `https://chatgpt.com/` 真实深色页，弹窗「截图已就绪」、分类/备注 → 「已同步」；独立库 5 站点/5 预览/5 回执。标签数 7→7。工作台 5 张 Logo 紧凑卡片、5 个「查看截图」按钮。 | `public-chatgpt.png`、`public-workbench-logged.png` |
| 11 | 自动补图（真实 CDN 抓取） | `runjobs --limit 4` 经独立 `server.py` 转发到**独立库**（未碰 `.local/manual-test`）：千问 Job `phase=complete/attempts=1`，真实抓取 `img.alicdn.com` 得到 32×32 518 B WebP，`source_fingerprint` 非空；`/api/sites/<id>/icon` HTTP 200 `image/webp` `RIFF….WEBP`；工作台千问卡片显示真实橙色阿里云 Logo、ChatGPT 显示真实 OpenAI 螺旋 Logo（客户端同源图标）。ChatGPT Job 返回 `kept_existing`（迟到 Job 不覆盖已上传图标，素材冲突保护）。 | `public-workbench-logged.png`、`runjobs` 输出 |
| 12 | 「查看截图」大图（真实公网内容页） | 工作台点千问卡片「查看截图」→「千问AI双11，好价好AI · 页面截图」，显示真实蓝色 Qwen4-Max 双11 大图（对应网页），工具栏适应窗口/100% 原尺寸/− 100% +/重置。 | `qianwen-viewer.png` |
| 13 | 非空队列升级 1.9.0 → 1.10.0 | 独立 profile 加载权威 `1.9.0 ZIP`（无 `default_popup`，选项页显示「当前版本 1.9.0」），配对 4174；停 4174 后用 1.9.0 普通标签页流程离线保存 2 条（「升级前离线任务A/B-1.9.0」，均「已保存本地，等待网络」），选项页「**待同步 2 条**」。**原地**把同目录 51 文件替换为 1.10.0 的 54 文件（同路径 → 同扩展 ID → 配对/IndexedDB 保留），在 `edge://extensions` 真人式点「重新加载」；重载后选项页「**当前版本 1.10.0**」、同账号同服务器、**待同步 2 条**仍在。仅重启 4174、无用户动作/无重新配对，两条任务按有界退避先后自动续传，notes 精确保留；最终 7 站点/7 图标/7 预览/7 回执（无重复、无丢失）、`integrity ok`。升级后另测弹窗快捷键时标签 9→9（无新标签页），但快捷键被 Edge 自带浮层拦截、弹窗未打开，故「升级后弹窗本体」未单独真机验证（见剩余问题）。 | `upgrade-190-options.png`、`upgrade-190-queue.png`、`upgrade-state.png` |
| 14 | 「截图不可用 / 这次未附截图」真机注入 | 仅回环 `127.0.0.1:4192` 高熵噪声页（2560×1440 随机 RGB PNG 11,075,423 B，服务端不访问外部、不引用外部脚本）；最大化 Edge 后 `captureVisibleTab` 原始快照超过 8MB 有界上限被省略，弹窗显示红点「**截图不可用**」+「**这次未附截图（当前页截图不可用），收藏仍可保存。**」+「重新截图」。仍可选「验收分类A」、写备注、用 InvokePattern 点收藏 → 「已同步」；独立库 8 站点/7 预览/8 回执，该站点 category/notes 精确、`presentation.preview.present=false`（诚实缺图，不伪造、不阻塞文字），`integrity ok`。 | `diag-unavailable.png`、`screenshot-unavailable-saved.png` |

Round 4 未改任何产品代码/发布物：发布 ZIP 仍 1.10.0、114,814 B、SHA-256 `09551f05365a55f87f3194a539a6f3a6259a5d26f91450508d236a1155fee12d`，4173 release/download 同哈希，日常 Edge 运行 1.10.0。回归复跑：扩展 168、前端 57+Sites 4、脚本 35、后端 178 全绿；扩展 check 76 文件、前端 build、迁移无漂移、check 0 issues。

## 七、剩余问题（不宣称全面验收完成）
- 未打包扩展仍依赖 Edge 开发人员模式；强制重启后可能把该开关关掉/渲染器空白并禁用未打包扩展（Phase A 已记录为环境约束，非业务代码缺陷）。本轮升级后弹窗快捷键被 Edge 自带「Visual Search/翻译页面」浮层拦截，未另做真人点击验证；弹窗本体已在 profile3 与 Round 3 反复验证。
- 正式 Edge Add-ons 发行仅准备资料 `docs/extension-store-readiness.md`，未创建账号/接受条款/提交审核/发布，不制造商店链接、不承诺审核。Chrome / 低内存 Debian / 云端未测；不部署云端。
- 真实公网 CDN 补图受本机 DNS 环境影响，按设计有限重试→明确缺图；未改 DNS/代理、未绕过公网校验、未伪造 Logo。本轮真实 `img.alicdn.com` 抓取成功，ChatGPT 为客户端同源图标 + `kept_existing`。
- 截图压缩在弹窗 DOM/canvas 完成后才显示保存结果；若弹窗在压缩前被强制关闭，后台 `compressPendingRaw` + OffscreenCanvas 兜底有界重试。三态中「正在截图」「截图已就绪」「截图不可用」均已在真实 Edge 出现；「重新截图」的原标签/权限复核由回归覆盖，本轮未真机注入切换页面凑数的拒绝场景。
- 「非空队列升级」只验证了 1.9.0→1.10.0 一次；更早版本（1.6.x/1.7.x/1.8.x）到 1.10.0 的队列迁移由 `migration-run.js` 回归覆盖，未逐版真机演练。
- 四阶段 A–D 仍为候选，1.10.0 同为候选，不宣称全面验收完成。
