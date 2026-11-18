# 本机测试交付

日期：2026-11-16（更新候选扩展 1.3.1）。用途：用户手动测试工作台及扩展，非生产部署。**1.3.0 与 1.3.1 均不标记为全面验收完成。**

## 访问与数据保留

- 入口：http://127.0.0.1:4173/ ，Waitress 两线程，仅监听 IPv4 loopback，直接提供构建后的 React 页面及 API，无需 Vite。
- 独立数据：`.local/manual-test/workspace.sqlite3`；图片和图标：`.local/manual-test/media/`。没有读取、迁移或覆盖云端及原有业务库。
- 已保留本机测试账号和收藏。迁移前后均为 1 个账号、1 条收藏，SQLite `integrity_check=ok`；`0004` 增量迁移已应用。迁移前备份为 `.local/manual-test/backups/pre-1.3.1.sqlite3`。
- 启动器：`.local/manual-test-server.py`；进程号：`.local/manual-test/server.pid`；stdout/stderr 在该数据目录。启动器与密钥处于 Git 忽略目录，密钥不写入本文。
- 本机环境已重启并保持运行，未部署云端。

## 扩展 1.3.1 更新步骤

1. 登录 http://127.0.0.1:4173/ ，进入「设置 → 浏览器扩展」，核对版本 1.3.1 与 SHA-256，下载 ZIP。
2. 等待或保留本地队列，备份旧扩展目录；将新 ZIP 解压覆盖原加载目录。不要先卸载，以免删除队列。
3. 在 `chrome://extensions` 或 `edge://extensions` 的原扩展条目点击「重新加载」，确认版本为 1.3.1，并复核原配对账号和队列。
4. 配对服务器填写 `http://127.0.0.1:4173`。打开弹窗后，主界面直接选择分类、填写“我的备注”并收藏；名称、简介、图标和当前页预览自动准备。
5. 自动预览默认开启，可在弹窗或设置的“自动素材”中按当前服务器和账号关闭；每次也可选择“这次不带截图”。

扩展 ZIP：`extension/dist/website-workspace-extension-1.3.1.zip`  
SHA-256：`f2279f4341964a4124d3538c29f832349eef8acda5cebe305b046c5d6f9d7d71`

完整候选包：`release/website-workspace-20261115T181509952160Z.tar.gz`  
SHA-256：`e61dc0d8d0115d226b3dd80ab97d5afdefaf220c97b2b1c433ddd032f19dbd0b`

已逐字节核对 ZIP 全部运行文件与源码一致，完整包内 ZIP 与磁盘一致；站内下载响应哈希与清单一致。完整包解到独立临时目录后，`manage.py check` 和至 `0004` 的全量迁移通过。

## 自动化结果

- Django 101 项通过；迁移漂移无变化，配置检查通过。
- 扩展 48 项通过；34 个源码文件语法、权限、HTML 资源和 300 行检查通过。
- 前端 25 项通过，生产构建成功；Sites 4 项通过。
- 工具 32 项通过，包含预览和图标的含媒体备份恢复，无 ResourceWarning。
- 初始化并发用例曾在一次完整运行中间歇失败；单独运行及随后完整 101 项复跑通过，既有不稳定性保留记录。

## 真实 Edge 页面与 API 验证

使用独立 QA 数据库和真实 Microsoft Edge，通过 CDP 操作构建后的页面及同源 API；QA 服务、浏览器配置和数据库验证后已删除。4173 仅用临时会话读取现有页面和下载，没有修改现有收藏。

- 初始生成 30 条合成收藏，最终重复验证为 33 条。1280px 为 3 列，1440px 为 4 列，1920px 为 5 列；卡片实际高度均为 174px，测得宽度约 265.75–305px。
- 360px 为单列、卡片 170px、无横向溢出；200% 缩放下打开操作目标至少 44px，键盘可聚焦标题。
- 页面保持打开时通过 API 新增收藏，触发可见性检查后出现新卡片，无需手动刷新；正在编辑的名称未被覆盖。
- `?site=` 详情深链准确打开新收藏；notes 搜索、普通收藏 inbox=false、重复备注幂等追加、lookup 不返回旧 notes、图标私有读取均通过。
- 扩展清单版本为 1.3.1，实际下载 SHA-256 与清单一致，响应为 `private, no-store`；4173 现有收藏和 Logo 正常显示，控制台异常列表为空。

合成数据证据图：`prototype/qa/frictionless-30-cards-1440-2026-11-16.png`、`prototype/qa/frictionless-mobile-2026-11-16.png`。验证脚本为 `prototype/qa/verify-frictionless-2026-11-16.mjs`。4173 含现有用户信息的临时截图未保留。

## 1.3.1 候选修复与实体扩展证据

独立审查发现 data URL 覆盖网页 URL 和素材等待耦合后，新增真实 `deriveImage` 返回结构回归及慢图标交错测试，均在旧实现失败后转绿。采集、显示、IndexedDB、队列和上传现在分别使用 `sourceUrl` 与 `displayUrl`；预览和图标独立就绪，慢图标不再使已完成截图失效。

使用解压后的 1.3.1 ZIP 在有界面 Microsoft Edge 中实际加载扩展，完成原生权限确认，并通过真实工具栏快捷键获得 activeTab：

- popup 选择“设计工具”、填写实体测试备注并收藏；预览和图标状态均为已就绪。
- 服务端收到文字、当前页预览和网站图标；刷新详情后两张图片的 `naturalWidth` 均大于 0，分类和备注一致。
- 离线队列重载前后的数量均为 1，账号保持 `entity@example.test`；恢复 QA 服务后队列最终为 0。
- 证据图：`prototype/qa/extension-1.3.1-popup-entity-2026-11-16.png`、`extension-1.3.1-detail-entity-2026-11-16.png`。脚本为 `verify-extension-entity-2026-11-16.mjs` 和 `verify-extension-queue-entity.mjs`，数据均为独立合成资料。

## 尚未完成的验收与限制

- 以上仅证明本机 Edge 的本次候选流程，**不将 1.3.0 或 1.3.1 标为全面验收完成**。Chrome 未安装，未执行 Chrome 扩展验证。
- 自动化权限确认曾遇到无头窗口不可操作、其他扩展导致 `ERR_BLOCKED_BY_CLIENT`、程序 `openPopup()` 不授予 activeTab 等问题；最终在有界面、仅允许待测扩展的配置中完成，未绕过权限模型。
- 离线模拟中曾发现 CDP 网络模拟不能可靠拦截 worker 请求，且启动器 PID 与实际 Python 子进程不同；最终按 QA 命令行停止/恢复独立服务验证，未影响 4173。
- 未逐项实体验证跨源图标降级、导航/切 tab 竞态、浏览器完整重启和从旧版实体升级；未执行 100/1000 条密度场景或目标低内存 Debian 资源实测。

## 2026-11-17：Logo 卡片与截图查看器更新

本轮只修改网页，扩展版本和 ZIP 不变。4173 已提供新构建并保留原账号收藏，现有收藏的 PreviewAsset/SiteIconAsset 均为 0，因此显示“暂无截图”是真实状态，不是读取失败。旧缩略图不可直接读图、详情失败禁用放大、失败标志不随 revision 恢复的问题已修复。

卡片“查看截图”直接打开同源鉴权查看器，支持适应窗口、100% 原尺寸、50%–200% 缩放、错误分类和重试；详情复用同一组件。失败后的新 revision 自动恢复，成功阅读中不会突然换图。尺寸支持紧凑/标准/宽松和 200–340px 微调，偏好按 origin+userId 本机隔离，ResizeObserver 按实际卡片外宽调整，不写 Site。

真实 Edge 验证 30 条合成收藏、刷新、新图替换、失败重试、图标恢复、归档/回收站、偏好持久化和零拖动 API 写入。阈值实测 239/240/299/300px 对应 Logo 36/48/48/64px，200% 缩放无横向溢出。前端标准测试 32、后端 101、扩展 48、工具 32、Sites 4 项通过，构建成功。

证据图：`prototype/qa/logo-cards-standard-2026-11-17.png`、`logo-cards-wide-2026-11-17.png`、`screenshot-viewer-original-2026-11-17.png`。Chrome、完整实体升级、100/1000 条实机密度和跨浏览器触控手势仍未验证。

本轮完整候选包为 `release/website-workspace-20261116T172416468656Z.tar.gz`，SHA-256 `45110c027a0f0023fbbc4d8abe1485125ad00800ae1c22be4f2beae9b46c0068`。扩展 1.3.1 ZIP 哈希未变，解包检查与迁移通过。

## 2026-11-17：实际安装扩展排查补充（未完成素材验收）

实际加载目录 `C:\Users\无名\Downloads\website-workspace-extension` 原为 1.2.0，缺少自动素材模块，现已备份并更新为 1.3.2。多窗口误选扩展页问题已修复，重复收藏已明确默认不更新图片，并提供保留备注分类的显式更新操作。

**本次仍未证明实际收藏生成 PreviewAsset/SiteIconAsset。** 普通网页曾显示预览和图标就绪，但 activeTab/表单提交未形成新回执，IndexedDB 没有可恢复 Blob。现有集合仍无素材，不能用旧回执或合成图片测试代替。原账号和队列保留，现有 WildAI 未被删除或覆盖，4173 正常运行，未部署云端。

扩展 49 项测试与下载回归通过。1.3.2 ZIP SHA-256 为 `76c677ba73ea4b51362fb1e3bfdf218eefc1217414f4898842751eb4148d7012`；完整包 `release/website-workspace-20261116T192334627276Z.tar.gz` SHA-256 为 `f4941004986ecb0d29ce94ad5778edc626aa220afa6e0c057c46522f24f6d348`。原浏览器需重新加载此目录后继续真实 activeTab/收藏验收。

## 2026-11-17：扩展 1.3.3 多窗口目标绑定与真实素材链路验收（已完成）

### 根因（有证据）

1. 真实浏览器此前运行的是 **1.2.0**，不是目录里的 1.3.x：重启前 `Secure Preferences` 的 `service_worker_registration_info.version=1.2.0`；服务端两台设备 `extension_version` 均为 1.2.0；扩展自检写入的 `release.currentVersion=1.2.0`（2026-11-17 00:24 本地）。1.2.0 缺少 `automatic-assets.js`，因此实际收藏不可能自动产生截图/图标。服务端 `PreviewAsset=0`、`SiteIconAsset=0` 是“根本没有上传请求”，不是服务端保存、鉴权或读取失败。
2. `C:\Users\无名\Downloads\website-workspace-extension` 在 02:32 被替换成 1.3.2 文件，但未打包扩展必须“重新加载/重启浏览器”才会换运行时；原浏览器进程自 11/15 起持续运行，后台仍是旧 1.2.0。
3. 本机核实重启后还发现：Edge 157 在**开发者模式关闭**时会以 `DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION (16777216)` 禁用未打包扩展。也就是说即使重启浏览器，开发者模式未开启时 1.3.2 也不会运行。本轮已在该 profile 开启开发者模式并核实扩展以 1.3.3 启用；安装/更新文档已补充该要求。
4. 混合态复现（隔离 QA 库/独立 profile）：目录文件替换后，popup 页面会从磁盘加载新的 1.3.2 代码（存在 `#update-assets` 等元素），但 `chrome.runtime.getManifest().version` 仍是 1.2.0。该状态下提交会生成文字回执和预览，却**静默丢弃本次 notes**（旧后台 payload 无 notes 字段），这是“素材就绪但操作没有完整回执/字段丢失”的具体环节。复现记录：`.local/hybrid-repro/RESULT.md`、`logs/phase5-run.log`。
5. 旧多窗口逻辑 `activeCaptureTab(chrome.tabs.query({}))` 会从所有窗口的 active HTTP(S) 标签按 lastAccessed 选一个，可能静默收藏另一个窗口的网站；把 popup.html 当独立标签页打开时也没有区分调试上下文。无目标时旧行为只显示底层 `Failed to construct 'URL': Invalid URL` 并置灰保存，没有“返回目标网站重新打开”的指引。

原 profile 持久化状态（重启前读取）：最新回执仍是 2026-11-16 23:53 的 WildAI；队列 0、IndexedDB 0 条；只留有 02:52:56 与 03:04:32 两条自动草稿。说明此前那次操作没有形成有效提交（点击未触发提交或提交前即被阻塞），不能解释为服务端未保存；本轮按上述机制修复并用真实链路重新验收。

### 多窗口目标选择的最终行为与权限依据

- 目标只取 `chrome.tabs.query({ active: true, currentWindow: true })` 返回的“调用扩展的那个窗口”的活动标签；不再遍历所有窗口、不再按 lastAccessed 改选。`chrome.tabs.getCurrent()` 在工具栏 popup 中返回 `undefined`（官方文档：非 tab 上下文返回 undefined），在把 popup.html 当普通标签页打开时返回该扩展页，据此区分调试上下文。
- 实测：工具栏 popup 中 `getCurrent()=null`、`currentWindow` 查询到的标签 `windowId` 与 `chrome.windows.getCurrent().id` 一致；窗口 A 调用得到 A 的 MDN 页面，窗口 B 调用得到 B 的 Bing 页面。
- 无法确定目标或授权失效时给出明确文案并禁用保存，绝不改选其他窗口：独立扩展调试页、扩展设置页/浏览器设置页等非 HTTP(S) 页、隐身页、无活动标签、查询失败、窗口不一致、页面读取权限失败分别提示“回到目标网站点击工具栏图标或 Alt+Shift+S 重新打开”。未新增任何权限（manifest 权限列表未变）。
- 新增构建版本一致性保护：popup 内 `BUILD_VERSION` 与浏览器已加载 manifest 版本不一致时（典型的“换文件未重载”混合态）阻止收藏并提示到扩展管理页重新加载，避免旧后台静默丢 notes。

### 修改文件

- `extension/queue.js`：新增 `describeCaptureTarget`、`targetMessage`、`resolveInvocationTarget`，移除跨窗口 `activeCaptureTab`。
- `extension/popup.js`：目标解析与授权探测、BUILD_VERSION 混合态拦截、版本显示（已连接 · v1.3.3）、重复收藏分类预填、素材更新成功文案、无匹配回执时的可恢复提示。
- `extension/engine.js`：素材上传完成后保留服务端返回的 `category/duplicate/outcome`，并为重复素材更新标记 `updatedAssets`，修复“更新素材后提示变成未分类/created”的反馈缺陷。
- `extension/manifest.json`、`package.json`、`options.*`、`engine.js` 兜底、`release.json`（脚本重建）：版本 1.3.3。
- `extension/tests/queue.test.mjs`、`preview-queue.test.mjs`：新增目标绑定、调试页/隐身/不支持协议/窗口不一致/查询失败、重复素材更新元数据保留回归（先失败后转绿）。
- `extension/scripts/check.mjs`：增加 BUILD_VERSION 与 manifest 版本一致性检查。
- `scripts/build_extension.py`：1.3.3 发行说明。
- `server/workspace/tests/test_downloads.py`：下载清单版本 1.3.3。

### 真实浏览器验收（最终构建 1.3.3）

运行时：原 profile 经目录更新 + 重新加载后 `chrome.runtime.getManifest().version=1.3.3`，设备仍是 `3771a268-dbec-4a4d-b11c-729ca723a0cf`，账号、权限、队列与 lastResult 保留。真实调用方式：操作系统级鼠标点击窗口工具栏的扩展按钮（真实 user gesture，获得 activeTab），不是程序化 openPopup、不是克隆 profile 的替身证据。

| 场景 | capture ID | site ID | 结果 |
| --- | --- | --- | --- |
| 真实工具栏点击收藏 MDN（首次完整链路） | `bf0987c8-b1a1-4eed-99cb-d05752cc851b` | `936264cd-a148-4d2c-95a5-9244b5198cff` | 回执、预览 960×540 WebP、图标 48×48 WebP、notes 与分类入库，首页 Logo 与查看截图大图均可用（构建哈希当时为 `76be70162f37…`，后续最终构建只增加反馈字段修正） |
| 重复收藏并勾选“更新截图和图标（保留原备注和分类）” | `9a1d594b-c9e9-4842-994c-cf04e2269ab6` | 同上 | 站点仍 2 条不新增；notes/分类保留；preview revision 与 icon revision 更新，旧媒体保留待 GC；消息为“截图和图标已更新 · 「开发工具」（原备注和分类保留）” |
| 多窗口/上下文回归 | — | — | 窗口 A→MDN，窗口 B→Bing；在扩展设置页活动时阻止并提示，未改选另一窗口；popup.html 独立标签页识别为调试上下文并阻止 |
| 断网收藏→重载扩展→恢复网络自动同步 | `9dae1244-6744-448c-9c66-c4c62297c291` | `e5555714-7582-4c10-b37e-c5d76f767f60` | 断网时“已存本地，联网后自动入库”，队列 1、IndexedDB 预览 29942B+图标 1004B；重载后队列/账号保留；4173 恢复后由 alarm 自动同步，无需手动点重试：队列 0、回执 8、preview 959×539 28136B、icon 520B、notes 写入，首页卡片 Logo 48px、查看截图 959×539 与拍摄时间显示正常 |

断网自动同步后无需人工点击“立即重试”即清空队列。最终数据库：账号 1 个（收藏保持不变）、站点 4 条（原 WildAI + MDN zh-CN + DeepSeek + MDN en-US，后三条为本轮真实验收新增）、CaptureReceipt 9、PreviewAsset 3、SiteIconAsset 2，`integrity_check=ok`；备份 `.local/manual-test/backups/post-1.3.3-2026-11-17.sqlite3`。DeepSeek favicon 为 209KB ICO，被客户端 200KiB/解码校验降级为失败但文字与截图正常，属于设计内降级。

### 本轮自动化结果

- `npm --prefix extension test`：53 项通过；`npm --prefix extension run check`：34 个源码文件语法/权限/HTML/300 行与 BUILD_VERSION 检查通过。
- `Django`：`workspace.tests enhancements` 101 项通过（独立 DATA_DIR/DATABASE_PATH 与测试库，未使用正式库）；`manage.py check` 无问题，迁移无漂移。
- `npm --prefix prototype test`：32 项通过；`npm --prefix prototype run build` 成功（JS 423.96kB，CSS 43.26kB）；`npm --prefix prototype run test:sites`：4 项通过。
- `.venv/Scripts/python.exe -W error::ResourceWarning -m unittest discover -s scripts/tests`：32 项通过，无 ResourceWarning。

### 发布物与本机更新

- 扩展 ZIP：`extension/dist/website-workspace-extension-1.3.3.zip`，54931 字节，SHA-256 `7f6b15559de6fd74a4d0b6b3a348b02842ec851dd449ef9bb732ba8fd475cda9`。ZIP 29 个运行文件逐字节与源码一致；实际加载目录与 ZIP 全部一致；站内下载响应 `200`、`private, no-store`，字节与哈希和 `release.json` 完全一致。
- 完整发布包：`release/website-workspace-20261117T084230201232Z.tar.gz`，2382567 字节，SHA-256 `f9ffc687a58b3ab820a0e50aa10fc1ae7417e44bf5238de548fb16445d60c7f7`；共 166 个文件，无 `.env`/数据库/密钥；包内 1.3.3 ZIP 哈希与上述一致；解到独立目录后 `manage.py check`、全量迁移、迁移漂移检查通过。
- 4173 保持运行，保留原账号与收藏；未部署云端。运行时证据汇总见 `.local/diagnostics/`（`real-capture-1.json`、`final-duplicate-update.json`、`real-multi-window.json`、`real-offline-sync.json`、`real-workspace-verify.json`、`sessions.json` 等，含私有会话信息，不提交）。证据图：`prototype/qa/final-cards-1.3.3-2026-11-17.png`、`prototype/qa/final-viewer-1.3.3-2026-11-17.png`。

### 尚未完成/限制

- 仅本机 Microsoft Edge 157 实测；Chrome 未安装，未执行 Chrome 验收。
- 未测试隐身窗口真实调用（扩展未允许隐身；对应分支由单元回归覆盖）、导航/切 tab 的全部实体竞态（截图前后 tab/URL 一致性检查与既有回归保留）。
- 未在目标低内存 Debian 实机重跑本轮扩展链路；未部署云端。
- 混合态拦截依赖 popup 文件中的 BUILD_VERSION；如果只替换 service worker 文件而不替换 popup，仍需发布纪律与“重新加载”步骤，文档已写明。
- DevTools/CDP 仅用于本机验证的测试通道（使用同 profile 目录联接 + 回环调试端口），不是产品功能，验后已恢复普通启动。

### 更新步骤（本机已执行，供复核）

1. 从站内下载或使用 `extension/dist/website-workspace-extension-1.3.3.zip`，先等待队列同步完毕并备份现有加载目录（不卸载，避免删本地队列）。
2. 解压覆盖原加载目录 `C:\Users\无名\Downloads\website-workspace-extension`，核对 `manifest.json` 版本 1.3.3。
3. 保持开发者模式开启，在 `edge://extensions` 原扩展条目点击“重新加载”；popup 顶部应显示“已连接 · v1.3.3”。若看到“扩展文件版本与浏览器已加载版本不一致”，说明没有重新加载成功。
4. 进入工作台任意普通网站，点击工具栏扩展图标（或已配置的快捷键），选择分类、填写备注并收藏；刷新工作台即可看到 Logo 与“查看截图”。
### 验收后环境恢复与补充核对

- 为启用 CDP 曾使用同一 profile 的目录联接启动验证实例；关闭后以普通方式启动时，Edge 对该 profile 的部分受保护偏好发生一次重置（扩展的未打包设置/可选权限记录丢失，显示名回落为“用户配置 1”）。已在普通 profile 中重新加载 `C:\Users\无名\Downloads\website-workspace-extension`（同一路径产生同一扩展 ID，chrome.storage.local 的账号/设备/队列和最后回执均保留），开启并确认开发者模式，通过扩展自身设置页的配对按钮重新授权 `http://127.0.0.1:4173`。随后完整关闭并重新启动 Edge 复核：扩展仍为 1.3.3 且启用，popup 显示“已连接 · v1.3.3”、预览和图标就绪、待同步 0；服务端设备 `last_active_at` 随 popup 请求更新，证明权限与凭据持久有效。CDP 端口未保留，浏览器以普通方式运行。
- 数据库实际为 4 站点、9 条 CaptureReceipt、3 个 PreviewAsset、2 个 SiteIconAsset（其中 1 条回执为最终构建截图尝试后补完成的重复素材更新 `f300a547-4591-4862-aa14-84802dbab73f`，站点仍为 MDN、notes/分类未变、preview revision 再次更新）。`workspace_device.extension_version` 仍为首次配对时写入的 1.2.0，服务端不在每次请求刷新该字段；实际运行版本以 popup/edge://extensions/Secure Preferences 的 1.3.3 为准。
## 2026-11-17 展示二版本机真实浏览器验收：宽屏、真实 Logo、扩展 1.4.0

### 环境与数据保留
- 本机主服务 `http://127.0.0.1:4173/` 仍仅监听回环。因后端新增图标刷新路由，按实际监听进程（launcher 23760 → 监听 38972）重启一次；重启前备份正式库 `.local/manual-test/backups/pre-polish-2026-11-17.sqlite3`。原有账号、设备配对、收藏、队列保留；最终 6 站点、11 回执、5 预览资产、5 图标资产，`integrity_check=ok`。新增的 GitHub 与 DeepSeek `/en` 两条收藏是本轮真实验收数据，DeepSeek 原收藏（`c3ff049a-…`）保留 notes/分类/截图。
- 前端成品由 4173 直接提供 `prototype/dist/client`；真实 Edge 普通 profile 已实际加载新构建。合成数据环境（4180 + 临时 Edge profile）只为布局测量，不含真实账号数据。

### 独立合成数据布局测量
- 使用 100 条合成收藏（7 个真实分类、5 个私有 WebP 图标、长名称/备注/多入口）在 360/768/1440/1920/2560/3440 视口、侧栏展开/折叠、紧凑/标准/宽松三档、200% 缩放等效宽度（960/720）下测量。完整数据见 `.local/polish-qa/measurements/layout-measurements.json`，摘要见 `docs/implementation-verification.md` 表格。
- 关键结果：1920 展开 6 列 256.16px、折叠 7 列 240.14px；2560 展开 8 列 268.13px；3440 折叠 12 列 260.08px；1440 展开 4 列 274.25px；4 条数据仍保持同列宽左对齐；所有场景 `scrollWidth == clientWidth`，顶部栏/标题/搜索/工具栏/网格/页脚左缘一致；三档与侧栏切换后尺寸/搜索/排序偏好保留。截图存 `.local/polish-qa/evidence/`，合成截图副本 `prototype/qa/workspace-v2-*.png`。

### 真实浏览器 Logo 证据
- 旧 DeepSeek 收藏补图：在真实浏览器会话中调用工作台“更新网站图标”同接口（卡片菜单项已通过 UIA 确认存在），服务端真实访问 `https://www.deepseek.com/favicon.ico`（209,762B、225×225 BMP 单帧 ICO），输出 128×128 WebP 5,856B，sourceHost `www.deepseek.com`、sourceType `link`、frame 225、revision `e013297d-…`；刷新工作台后卡片显示蓝色鲸鱼（截图 `.local/polish-qa/evidence/real-workspace-deepseek-whale.png`），DB 解码图 `deepseek-whale-stored.png`（已复制 `prototype/qa/deepseek-whale-128.png`）。原 notes/分类/截图保留。
- 扩展 1.4.0 客户端链路：真实 Edge 工具栏点击（activeTab）在 `https://www.deepseek.com/en/` 新收藏，popup 显示“网站图标已就绪”与“已收藏到网站库 · 未分类。资料和可用素材已确认”，DB 图标 128×128 WebP 5,222B；在 GitHub 新收藏中采集多帧 ICO（16/32 BMP）并选中 32px 帧，上传 32×32 WebP 644B。两者均由真实网站数据产生，未硬编码品牌、未使用第三方 favicon 服务、未新增常驻权限。
- 扩展运行时核验：普通重启后 popup 显示“已连接 · v1.4.0”，实际加载目录与 ZIP 逐字节一致；设备配对/队列保留。更新过程为备份目录、覆盖解压、浏览器正常重新加载，未卸载扩展。
- 服务端图标刷新还实测了 GitHub 首页 524KB HTML 回退 `/favicon.ico` 的场景（单测 mock + 独立审计实测）；失败/超限/损坏/跨源/无候选/历史缺图等边界均有回归。

### 扩展 1.4.0 发布物
- `extension/dist/website-workspace-extension-1.4.0.zip`：61,162 字节，SHA-256 `bf4483643eba21c67a0b6bda3fd4eba98cf87e29faafdbff215af01a23aa0efe`；30 个运行文件与源码逐字节一致；`release.json` 与站内下载一致（下载接口需登录）。
- 更新步骤：等待队列→备份旧加载目录→用 1.4.0 ZIP 覆盖→保持开发者模式开启→在 `edge://extensions` 原条目重新加载或普通重启浏览器→popup 顶部应显示“已连接 · v1.4.0”。只复制文件不会更新运行时；版本不一致时按提示重新加载。

### 未验证/限制
- 仅 Edge 157；Chrome、隐身真实调用、全部导航竞态未实测。200% 缩放为等效视口测量。
- 卡片菜单“更新网站图标”实际点击受本机窗口焦点竞争影响未能稳定自动化；菜单存在性由 UIA 确认，刷新通过真实会话调用同一 API 并验证。自定义图标上传（可选）未实现；批量修复为同步上限 6 站、不可中途停止；同来源重复刷新会重新抓取并 +1 版本。
- 低内存 Debian 实机与云端未复测；部分装饰性容器边框对比度低于 3:1，已测量记录（正文/说明/焦点/表单边界达标）。
## 2026-11-17 图标采集通用化与扩展 1.5.0 本机验收

### 环境与数据
- 4173 仍仅回环；为加载跨域候选/自动兜底后端重启一次（备份 `.local/manual-test/backups/pre-icon-lifecycle-2026-11-17.sqlite3`）。真实 Edge 157 普通 profile；扩展从 1.4.0 更新到 1.5.0：备份旧加载目录、覆盖 ZIP、在 edge://extensions 原条目重新加载，未卸载；popup 实测“已连接 · v1.5.0”，配对/队列/账号保留。
- 本轮开始时真实库为用户原有 4 条收藏（阿里云登录页、OpenCode Console、DeepSeek 开放平台、DeepSeek 官网），其中阿里云与 DeepSeek 开放平台缺图。未覆盖/删除用户资料；测试新增的千问/ChatGPT/GitHub/淘宝/本地夹具站点在证据保存后通过工作台 API 移入回收站并永久删除，最终仍为 4 站点。

### 真实浏览器操作与结果
- 千问：打开 popup 后约 1.2s 点击收藏（图标未 ready，popup 明确显示 404/待后台），关闭 popup；同一 capture d6ee81aa… 在 +9.4s 由服务端跨域兜底补图 80×80，卡片显示千问 Logo。
- ChatGPT：快速收藏文字成功；本机 DNS 将 chatgpt.com 解析到不可达地址导致服务端兜底失败（不是 SVG 问题）；客户端在显式更新中选中 48×48 PNG 并上传 48×48 WebP。
- GitHub：快速收藏，客户端多帧 ICO 选 32px 帧，32×32。
- 淘宝：快速收藏后关闭 popup 并强制重启 Edge；重启后任务恢复，+9.2s 补 114×114。
- 本地夹具：坏候选后有效候选成功 64×64；慢/私网关闭 popup 后保持缺图并诚实提示，未假报完成。
- 历史缺图：真实账号执行批量缺图修复，阿里云登录页补 32×32 阿里云 CDN ICO，备注/分类/截图保留；DeepSeek 开放平台仅 SVG，明确降级保持缺图。

### 证据
- 详细 JSON：`.local/polish-qa/icon-lifecycle-evidence.json`（capture ID、站点、图标尺寸/字节/来源/时间、清理记录）。
- 真实卡片截图：`.local/polish-qa/evidence/real-workspace-icons-2026-11-17.png`；可发布裁剪：`prototype/qa/icon-lifecycle-real-cards-2026-11-17.png`。
- 测试：前端 47、扩展 82、Django 155、脚本 32、Sites 4 通过；扩展 check 44 文件；前端 build 成功；下载与 release.json 哈希一致。
- 发布物：`extension/dist/website-workspace-extension-1.5.0.zip` 72,922B，SHA-256 `07ea99e0880c1a53f207b2a6d2bb720e33424b4d045e7cef53adb1effe0c353c`。

### 未验证/限制
- ChatGPT 服务端兜底受本机 DNS/网络策略阻断；真实离线断网、公网慢请求未单独构造；Chrome/低内存 Debian/云端未复测；SVG-only 未做隔离栅格化。
## 2026-11-18 素材任务恢复修复与扩展 1.6.0 本机验收

- 扩展从 1.5.0 更新到 1.6.0：备份旧加载目录、覆盖 ZIP、在 edge://extensions 原条目重新加载，未卸载；运行时 popup 调试页显示“已连接 · v1.6.0”，待同步 0 条。重载后真实库仍为 4 条用户收藏、3 图标、4 预览，`integrity_check=ok`。
- 真实 Edge 首次快速收藏 ChatGPT（capture 435c88ea…）后关闭 popup：service worker 仍取得同源 PNG Blob（1548B）并持久化 assetJob，preview 上传成功；icon 上传因 sourceUrl 候选路径被服务端拒绝，Blob 未删除。该 sourceUrl bug 已修复并新增回归；由于 Edge action popup 在后续自动化中无法再打开（直接 popup.html 正常），未能在同一实体浏览器重跑首次自动上传成功闭环。
- 队列/附件恢复由 `asset-jobs.test.mjs` 的真实 engine/queue/asset 组合覆盖：离线→迟到素材→恢复网络；上传断网→新引擎实例（模拟浏览器重启）恢复；两 capture 交错；401/413/409/取消；图标任务不抢跑服务端兜底。
- 回归：扩展 92、后端 155、前端 47、Sites 4、脚本 32 通过；扩展 check 49 文件；前端 build 成功；release/download 哈希一致。
- 发布物：`extension/dist/website-workspace-extension-1.6.0.zip` 81,385B，SHA-256 `bbdc2fe2a3cade2a2ca75ae884875f90d1bd148645e2c66a784b47b521fcd739`。
## 2026-11-18 阶段 A/B 候选扩展 1.7.0 本机交付

- 本机 4173 保持 `127.0.0.1` 回环（PID 见 server.pid）、用既有 `.local/manual-test/workspace.sqlite3`，未另建空库；重启服务仅用于制造真实断网与恢复，数据未丢。
- 扩展从 1.6.1 更新到 1.7.0：备份旧加载目录（`.local/polish-qa/loaded-backup-1.6.1`）、ZIP 覆盖并在原条目「重新加载」，未卸载、ID 不变、配对与队列继承。
- 入口改为普通扩展标签页（无 default_popup）；阶段 A 真人点击正常，阶段 B 工具栏点击打开 capture.html?draft=<uuid>。
- 真机证据：快速提交「已存本地→已入库」；停 4173 断网后 options 页「待同步 N 条」保留；两 capture 交错；完整浏览器重启后配对（设备：我的浏览器 / 凭据有效期）与队列保留；恢复服务器后 worker alarm 自动补齐；关闭表单仍完成；迁移备份键 + Outbox IndexedDB 标记落盘。
- 测试用 example.* 站点经 API 删除；最终 4 站点/3 图标/4 预览，notes/分类不变，`integrity_check=ok`。
- 发布物：`extension/dist/website-workspace-extension-1.7.0.zip` 101,582 B，SHA-256 `ca5a3ff019b0d1988a53633fe9e81c51cfc27957734b63598779cdb619256ca3`；加载目录 46 文件逐字节一致；站内 release/download 哈希一致。
- 限制：1.7.0 暂不抓截图/图标（阶段 C）；阶段 D 服务端图标任务/正式商店发行未开始；真机重配/账号切换与错误注入待用户最小配合；不标记全面验收完成。
## 2026-11-18 阶段 C 候选扩展 1.8.0 本机交付

- 4173 保持 `127.0.0.1` 回环；真实 DB 迁移前备份 `.local/manual-test/backups/pre-phaseC-2026-11-18.sqlite3`，经启动器 `migrate` 应用 0005（tombstone 表 + source_fingerprint 列），重启服务加载新模型/路由，未另建库、未部署云端。
- 扩展 1.7.0→1.8.0：备份旧加载目录（`.local/polish-qa/loaded-backup-1.7.0`）、ZIP 覆盖并在原条目重载，未卸载、ID 不变、配对继承。
- 真机：Edge 1.8.0 工具栏点击→普通标签页「自动取得的素材/截图：已压缩，等待上传」→提交「截图：已上传/已入库」；DB 站点 v2 + preview 960×540 WebP + PreviewReceipt complete。
- 4173 真实 HTTP 条件写演示：absent 首传 200、换图后旧基线 409 asset_conflict（不覆盖）、幂等重放返回首次结果、删图 tombstone 后 absent 409（ABA）、改入口 409 asset_source_changed；脚本创建的测试站点与「阶段C验证设备」全部清理。
- 最终数据：4 站点/3 图标/4 预览、notes/分类不变、`integrity_check=ok`。
- 发布物：`extension/dist/website-workspace-extension-1.8.0.zip` 111,744 B，SHA-256 `6472e85527050364090141390f6d0ceebfb149592ac91532758d17ba5321c0df`；加载目录 51 文件逐字节一致；站内 release/download 同哈希。
- 限制：1.8.0 为阶段 C 候选；阶段 D 服务端公开图标任务/正式商店发行未开始；含素材真机断网+完整重启、客户端图标端到端、错误注入待办；不标记全面验收完成。
## 2026-11-18 阶段 D 候选扩展 1.9.0 本机交付

- 4173 保持 `127.0.0.1` 回环；真实 DB 迁移前备份 `.local/manual-test/backups/pre-phaseD-2026-11-18.sqlite3`，经启动器 `migrate` 应用 0006（IconJob 表），重启服务加载新模型/路由，未另建库、未部署云端。
- 扩展 1.8.0→1.9.0：备份旧加载目录（`.local/polish-qa/loaded-backup-1.8.0`）、ZIP 覆盖并在原条目重载，未卸载、ID 不变、配对继承。
- 本机任务调度：`scripts/local_jobs.py once` 与 `loop --interval 5` 真实运行：`jobs.pid`/`jobs.log` 记录 24 次 cycle，期间真实收藏入队的 Job 被领取执行（`iconJobs.processed=1`，DNS 受阻按设计有界退避 `icon_refresh_failed`，未改 DNS/代理/证书、未伪造 Logo）；`jobs.stop` 干净停止、PID 删除。生产复用 `deploy/website-workspace-jobs.timer`。
- 真机：Edge 1.9.0 工具栏→「不要自动补齐图标」入口→提交「已入库，图标获取中」；真实 HTTP：收藏 0.05s 入队、autoIcon=false 不入队、refetch 重排队、本地 PNG 上传 complete；千问 CDN/ChatGPT SVG/私网边界由后端测试覆盖。
- 清理测试站点与「阶段D验证设备」后：4 站点/3 图标/4 预览/0 Job、notes/分类不变、`integrity_check=ok`。
- 发布物：`extension/dist/website-workspace-extension-1.9.0.zip` 112,985 B，SHA-256 `b78874b34583bd740b2327eb512e32861a74e9cb68300901d184d807f3e1a90e`；加载目录 51 文件逐字节一致；站内 release/download 同哈希；正式 Edge Add-ons 仅准备资料 `docs/extension-store-readiness.md`，未发布/不制造链接/不承诺审核。
- 限制：1.9.0 为阶段 D 候选；四阶段均不宣称全面验收完成（各候选剩余真机演练、商店发布授权外、Chrome/低内存 Debian/云端未测）。
## 2026-11-18 阶段 D 补做（goal round 2，真机断网+完整重启）

受控回环夹具 `.local/polish-qa/phased-fixture.py`（仅 127.0.0.1:4191，同源 PNG，scope 本机；服务端不访问、浏览器可读，不改 DNS/代理、不伪造 Logo）。实体 Edge 1.9.0：
- 客户端同源图标端到端：工具栏→表单「截图：已压缩/图标：已压缩」→提交「截图：已上传/图标：已上传/已入库」；DB 站点 + preview 960×540(source_url=站点入口) + icon 64×64 WebP，无 IconJob（本机入口诚实不排队）。
- 含素材真实断网→关闭表单→完整浏览器重启→恢复：停 4173→「已保存本地，等待网络」→关闭表单→只读复制扩展 IndexedDB 确认 Outbox 保留任务(`restart2`/`waiting_network`/`local_saved`)与 Blob(`data:image/webp`)→杀全部 Edge→重启 4173(127.0.0.1 回环、既有库)→重开真实配置(dev mode On/扩展启用/运行 1.9.0)→worker 自动补齐站点+preview+icon+notes，1 站点/1 采集回执/1 preview 回执/1 icon 回执/notes 标记 1 次→工作台卡片刷新显示 Logo + 查看截图、DTO `icon.present=true`/`iconJob.queued=false`。
- 清理夹具站点与进程后恢复 4 站点/3 图标/4 预览/0 Job，integrity ok；本轮未改产品代码，ZIP/release/加载目录/4173 仍 1.9.0 同哈希。证据 phased-client-icon.png / phased-offline-form.png / phased-restart-workbench.png。
- 未改系统 DNS/代理/证书、未绕过公网校验、未伪造 Logo；仍缺 429/认证真机注入、真实公网 CDN(本机 DNS 受限)、真人重配对/第二账号(需配合)、商店发行(授权外)。四阶段仍候选。
## 2026-11-18 阶段 D 补做（goal round 3）

本机公网 DNS 复核 img.alicdn.com/tongyi.aliyun.com 等可访问（未改 DNS/代理/证书、未绕过公网校验、未伪造 Logo）。真实千问 CDN 自动补图：真实 4173 收藏 tongyi.aliyun.com/qianwen/ → 同事务入队 → scripts/local_jobs.py once → run_icon_jobs 默认 fetcher 真实抓取 img.alicdn.com 80×80 PNG → 只填空写 1366B WebP → Job complete → 工作台卡片渲染真实蓝色 Logo（icon HTTP 200 image/webp）。诚实缺图：真实公网无图站点 3 次有界重试 → 终态 no_icon、0 图标资产、字母回退、无「图标获取中」。kept_existing：用户本地上传 PNG 后迟到 Job 不覆盖（bytes/source/revision 未变）。例外恢复真机 UI：详情展开后 UIA 找到「重新排队补图」「上传本地 PNG/WebP 图标」，InvokePattern 真实点击只排队不覆盖；refetch/upload_local 真机 HTTP 200、备注/分类保留。清理 QA 站点/设备后 4 站点/3 图标/4 预览/0 Job integrity ok；本轮未改产品代码，ZIP/release/加载目录/4173 仍 1.9.0 同哈希。证据 phased-real-cdn-icon.png / phased-cdn-final.png / phased-recovery-expanded.png。四阶段仍候选。
## 2026-11-18 阶段 D 错误边界（goal round 3 续）

真实 4173 HTTP 边界注入（QA 设备/站点，不碰唯一真实配对、不改 DNS/代理/产品代码）：撤销 QA 设备后 Bearer 调 lookup → 401 auth_required（扩展 needs_auth 暂停）；连续越过只读端点 rate 上限 → 429 rate_limited（扩展 waiting_network 有界退避）；同 clientCaptureId 内容改动重发 → 409 idempotency_conflict（扩展 conflict 不覆盖）。清理后仅 3 个「我的浏览器」设备、4 站点/3 图标/4 预览/0 Job integrity ok。实体浏览器里对同一 Outbox 任务的 429/认证真机注入仍需用户配合重新配对。
## 2026-11-18 1.10.0 本机交付（独立验收）

用户 20:09 实测反馈「点击扩展开新标签页、截图入口找不到」。真实原因：default_popup 缺失 + 原始 PNG >700KB 静默丢弃 + submitDraft 丢 raw 截图（用户 19:11 真实 YouTube 收藏 preview=0）。修复：恢复 default_popup，弹窗三态、截图失败仍可保存并明确「这次未附截图」；工作台「查看截图」入口与大图查看器经真实 Edge 验证未丢。SW 同一 captureId 一次性事务落盘文字+截图+图标；放宽有界 8MB、DOM/canvas / OffscreenCanvas 压 WebP；submitDraft 保留 raw；recapture 原标签校验；compressPendingRaw 有界重试。前端 canViewScreenshot 加固 + 9 例回归。独立配置/测试库：`127.0.0.1:4174` 独立 SQLite + 独立 Edge profile（edge-profile2）+ 独立测试账号/配对设备 + 自定义分类「验收分类A」；日常 4173 库与「用户配置 1」profile 全程隔离，验收前后核对日常 5 站点/4 图标/4 预览、3 个「我的浏览器」设备、notes/分类不变、integrity ok。真实 Edge：Alt+Shift+S 打开弹窗，标签 7→7 无新标签页；截图「截图已就绪」；验收分类A + 备注 → 「已同步」；立即关弹窗 → 刷新工作台 1 站点/1 回执/预览 960×540 7512B；「查看截图」打开对应网页大图（适应窗口/100% 原尺寸/缩放/重置）。离线保存 → 关弹窗 → 仅重启 4174、无用户动作、无重新配对，靠 SW alarm 自动续传 3 站点/3 图标/3 预览/3 回执 integrity ok。附带：改测试账号密码 → 401 诚实暂停、队列保留；同账号重新配对 resumeOwner 恢复、不转投。发布物 1.10.0 ZIP 114,814 B，SHA-256 09551f05365a55f87f3194a539a6f3a6259a5d26f91450508d236a1155fee12d；4173 release/download 同哈希、日常 Edge 重载运行 1.10.0、加载目录 54 文件逐字节一致。回归：扩展 168 / 前端 57+Sites 4 / 脚本 35 / 后端 178 全绿；扩展 check 76 文件、前端 build、迁移无漂移、check 0 issues。四阶段仍候选，1.10.0 同为候选，不宣称全面验收完成。证据在 docs/superpowers/plans/2026-11-18-phase-e-verification.md。

## 2026-11-18 Round 4 追加验收（1.10.0 候选，未全面验收）

用户要求的「随后继续」项已在独立配置/测试库完成：独立 4174 SQLite + 独立 Edge profile3/4 + 独立测试账号/配对设备，日常 4173 数据全程隔离。真实公网首次收藏：千问 `https://qianwen.aliyun.com/`（内容丰富的蓝色双11页，预览 960×540 41184 B）与 ChatGPT `https://chatgpt.com/`，均走完整弹窗路径（截图已就绪 → 选「验收分类A」+ 备注 → 已同步），标签数点击前后不变、无新标签页；工作台 5 张 Logo 紧凑卡片 + 5 个「查看截图」按钮，点千问卡片打开真实大图查看器（适应窗口/原尺寸/缩放/重置）。自动补图：`runjobs --limit 4` 经独立 server.py 转发到独立库（不碰日常库），千问 IconJob 真实抓取 `img.alicdn.com` 得到 32×32 518 B WebP、HTTP 200 image/webp、工作台显示真实橙色阿里云 Logo；ChatGPT Job 返回 `kept_existing` 不覆盖已上传图标。非空队列升级：独立 profile 加载权威 1.9.0 ZIP（无 default_popup），配对 4174 后停服离线保存 2 条（选项页「待同步 2 条」）；原地替换同目录 51 文件为 1.10.0 的 54 文件（同路径同扩展 ID）、真人式点「重新加载」，重载后「当前版本 1.10.0」+ 同账号 + 「待同步 2 条」仍在；仅重启 4174、无用户动作/无重新配对，两条按有界退避先后自动续传，notes 精确保留，7 站点/7 图标/7 预览/7 回执无重复无丢失、integrity ok。截图不可用真机注入：仅回环 4192 高熵噪声页（2560×1440 随机 RGB PNG 11 MB）使原始快照超过 8MB 有界上限，弹窗显示「截图不可用」+「这次未附截图（当前页截图不可用），收藏仍可保存。」+「重新截图」；仍可选分类/写备注/收藏 → 已同步，独立库该站点 notes/分类精确、`preview.present=false`（诚实缺图不伪造、不阻塞文字），8 站点/7 预览/8 回执、integrity ok。Round 4 未改产品代码/发布物：ZIP 1.10.0 114,814 B SHA-256 09551f05365a55f87f3194a539a6f3a6259a5d26f91450508d236a1155fee12d，4173 release/download 同哈希，日常 Edge 运行 1.10.0。回归复跑：扩展 168、前端 57+Sites 4、脚本 35、后端 178 全绿，扩展 check 76 文件、前端 build、迁移无漂移、check 0 issues。日常 4173 数据复核：5 站点/4 图标/4 预览、3 个「我的浏览器」设备、notes/分类不变、integrity ok。剩余：未打包扩展依赖 Edge 开发人员模式（重启可能关闭，Phase A 环境约束）；正式 Edge Add-ons 仅准备资料未发布；Chrome/低内存 Debian/云端未测、不部署云端；「重新截图」切换页面拒绝与更早版本队列迁移仅回归覆盖；四阶段与 1.10.0 仍为候选，不宣称全面验收完成。详见 docs/superpowers/plans/2026-11-18-phase-e-verification.md 第六节。
