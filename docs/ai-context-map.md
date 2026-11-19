2026-11-18 Round 4：1.10.0 候选追加验收（独立 4174 库/profile）。真实公网千问/ChatGPT 首次收藏、runjobs 真实 CDN 补图（含 kept_existing 冲突保护）、非空队列 1.9.0→1.10.0 原地升级并自动续传、高熵大图真机注入「截图不可用/这次未附截图」且文字仍入库。日常 4173 数据保留。详见 phase-e-verification.md 第六节。
2026-11-18 1.10.0 交互修正候选：恢复 default_popup 小弹窗、截图三态、查看截图大图查看器（真实 Edge 验证未丢）、真实缺图根因（>700KB 静默丢弃 + submitDraft 丢 raw），放宽 8MB 有界 + OffscreenCanvas 压缩兜底、独立 4174 库/profile/账号验收（无新标签页、已同步、查看截图大图、离线自动续传）。日常 4173 数据保留。详见 docs/superpowers/plans/2026-11-18-phase-e-verification.md。
2026-11-18 阶段 D 补做(goal round 3)：真实公网千问 CDN 自动补图(默认 fetcher)、诚实缺图终态 no_icon、kept_existing 不覆盖用户图标、例外恢复真机 UI(重新排队补图/本地上传)，证据 phased-real-cdn-icon.png 等，详见 docs/superpowers/plans/2026-11-18-phase-d-verification.md。
2026-11-18 阶段 D 补做(goal round 2)：受控回环夹具验证客户端同源图标端到端 + 含素材真实断网→关闭表单→完整浏览器重启→worker 自动补齐，证据 phased-*.png，详见 docs/superpowers/plans/2026-11-18-phase-d-verification.md。
2026-11-18 阶段 D 候选 1.9.0：服务端 IconJob(0006)/icon_jobs.py、captures 同事务入队、run_jobs+systemd timer 与本机 scripts/local_jobs.py 真实调度、refetch/upload_local 例外恢复、扩展 autoIcon/iconJob「图标获取中」、前端 iconJobState/例外恢复；Edge Add-ons 仅准备资料 docs/extension-store-readiness.md。见 docs/superpowers/plans/2026-11-18-phase-d-verification.md。
2026-11-18 阶段 C 候选 1.8.0：capture-entry 打开表单前截图/同源图标采集、capture-compress 页面内有界压缩、Outbox 独立附件子阶段、extension_v3 条件写（独立 revision + 来源指纹 + tombstone 防 ABA）、迁移 0005；阶段 D 未开始。见 docs/superpowers/plans/2026-11-18-phase-c-verification.md。
2026-11-18 阶段 A 通过、阶段 B 候选 1.7.0：普通扩展标签页 capture.html + draftId 草稿协议、action.onClicked、单一 IndexedDB Outbox（outbox-store/outbox/migration/workspace）、统一串行入口、迁移备份与核对；阶段 C/D 未开始，1.7.0 暂不抓图。见 docs/superpowers/plans/2026-11-18-phase-b-verification.md 与 phase-a-entry-verification.md。
2026-11-18 素材任务恢复修复完成：迟到素材独立 assetJobs 不改写文字队列、上传前持久化并在网络/5xx/429/401/403 保留 Blob、409 刷新版本、两 capture 按 capture ID 归属、popup 关闭后 activeTab/scripting 客户端同源采集；扩展 1.6.0。见 docs/icon-lifecycle-1.6.0-review-response-2026-11-18.md 与 .local/polish-qa/icon-lifecycle-evidence.json。
2026-11-17 图标采集通用化完成：候选发现（tab favicon/rel icon/apple-touch-icon、相对路径、sizes、明暗 media、SVG 与栅格排序）、跨域公共 CDN 服务端受控兜底、文字先入库 + 持久化图标任务（popup 关闭/浏览器重启恢复）、历史缺图补图不覆盖、反馈区分获取中/不支持/待上传；扩展 1.5.0。证据见 docs/implementation-verification.md、docs/local-testing-2026-11-15.md 与 .local/polish-qa/icon-lifecycle-evidence.json。
# AI 上下文地图

最新展示设计入口：[2026-11-17工作台展示二版](superpowers/specs/2026-11-17-workspace-polish-v2.md)。修订宽屏轨道、ICO真实Logo获取/历史缺图、工具栏及全站细节，尚待实施；已验收的收藏链路保持不回退。

2026-11-17 本轮状态：扩展 1.3.3 已完成多窗口目标绑定修复与本机真实素材链路验收（真实工具栏 activeTab、回执、截图/图标上传、首页 Logo、查看截图、重复素材更新、离线自动同步）。事实与限制以 docs/project-state.md、docs/implementation-verification.md、docs/local-testing-2026-11-15.md 为准。

2026-11-17 展示优化第二版已完成：无工作台级最大宽度、统一内容轨道与按可用宽度计算网格、显示设置 popover、真实分类筛选、DeepSeek 鲸鱼 Logo（服务端刷新 + 扩展 1.4.0 客户端多帧 ICO 预算）、历史缺图单独修复；测量与证据见 docs/implementation-verification.md、docs/local-testing-2026-11-15.md 与 .local/polish-qa/。
2026-11-17 最新待实施设计：[Logo 卡片、独立截图查看与可调尺寸](superpowers/specs/2026-11-17-logo-cards-and-screenshot-viewer.md)。替代旧内嵌截图缩略图设计；先排查截图未展示，避免仅以布局变化掩盖故障。原图按需鉴权加载，尺寸偏好按本机用户隔离。

最新产品需求：先读 [2026-11-16 无负担收藏修订](superpowers/specs/2026-11-16-frictionless-bookmarking-revision.md)，包括 notes、自动采集、直接入库/首页、紧凑卡片和反馈；Logo 源在 docs/brand/。这些仍待开发，不能按旧版收件箱/置顶规则继续验收。

2026-11-15 实现入口：[协议 2、图片与运维](extension-v2-and-media.md)。后续修改先读主规格及以下新增模块，真实验收状态以 implementation-verification.md 为准。

| 路径 | 职责/上下游 | 主要风险与验证 |
| --- | --- | --- |
| server/workspace/extension_v2.py、preview.py、media.py | 协议 2 指纹/显式更新 → capture 回执 → 图片处理/私有 API | owner+capture 附件许可、expectedVersion、配额、旧图保留；test_extension_v2.py、test_preview.py |
| server/workspace/models.py、migrations/0003_*.py | Device 协议、PreviewAsset/Receipt、孤儿标记 | 增量迁移，不反向删表；makemigrations --check |
| extension/page-data.js、screenshot.js、attachment-store.js | 主 frame 元信息、标签稳定性、IndexedDB Blob | 不读正文、不持久化截图草稿、Blob 丢失只保文字；extension tests |
| extension/engine.js、queue.js、service-worker.js | 协议 2 文字/附件状态机与旧队列备份迁移 | 同 UUID 指纹、同账号恢复、单轮限量、禁止跨身份；preview-queue.test.mjs |
| prototype/src/components/SiteCard.jsx、SiteDetail.jsx、DevicesSettings.jsx、cards.css | 四要素卡片、私有详情图、扩展中心 | 40 张分批、query/hash 卡片脱敏、同源图片、无假安装状态；前端测试与构建 |
| scripts/build_extension.py、media_backup.py | 固定 ZIP/清单、含媒体容器与独立恢复 | ZIP 哈希、白名单、摘要全部验证、旧备份兼容；scripts/tests |
| server/workspace/management/commands/cleanup_media.py、deploy/*media-cleanup* | 标记 7 天后的受管孤儿文件与定时互斥 | 不跟随符号链接，备份/GC 锁，不删当前引用 |

以下为历史模块地图，路径职责仍适用。

2026-11-15 新设计入口：[扩展与网站卡片规格](superpowers/specs/2026-11-15-extension-and-website-cards.md)、[开发交接与验收](superpowers/plans/2026-11-15-extension-and-website-cards.md)。用户本轮仅要求文档，代码尚未实施；后续开发先读这两份，再参考下方历史模块地图。

更新：2026-10-26。顺序：project-state.md → project-knowledge-base.md → implementation-verification.md → 本表模块入口。目录 prototype/ 已演进为正式前端，?demo=1 才是内存演示。

| 路径 | 职责/上下游 | 搜索提示、变更点与主要风险 | 验证 |
| --- | --- | --- | --- |
| server/config/settings.py、urls.py | 环境/认证/数据库/路由 → 全部 API | DEBUG、ALLOW_LOCAL_SETUP、COOKIE_SECURE、TRUST_PROXY；生产必须独立密钥 | manage.py check；部署检查 |
| server/workspace/models.py、migrations/ | 用户归属、版本、组织、设备、导入和恢复实体 | Owned、Endpoint 唯一约束、UserWorkspace；迁移不可直接丢弃私人资料 | makemigrations --check |
| server/workspace/http.py、validation.py | 会话/bearer 与 DTO 白名单 → 业务 API | api、owned、client_address、normalized_site；CSRF、可信代理限流、归属、64KiB、非法网址 | tests/test_library.py、test_hardening.py |
| server/workspace/identity.py | 初始化/邀请/恢复/停用 → Django 会话和摘要 token | setup_required、local_setup_allowed、auth_hash；不能信任转发头来绕过初始化 | test_identity.py、test_contract.py |
| server/workspace/library.py、organization.py | 网站 CRUD/访问/分组 → SQLite | save_site、site_page；250 条分页、version、删除分组不删网站 | test_library.py、test_pagination.py |
| server/workspace/extension.py | 配对/捕获/撤销 → library | capture_site_dto、clientCaptureId；设备不得读取私人资料、重配对幂等 | test_transfer_devices.py、test_device_scope.py |
| server/workspace/transfer.py、bookmarks.py | HTML/JSON 预览提交/完整导出 | ImportJob、preview、commit；原子、幂等、重复 URL、所有者 | test_transfer_devices.py、test_contract.py |
| server/workspace/downloads.py、frontend.py | 授权扩展 ZIP/安全静态文件 | 白名单打包、safe_join；不要打包 .env 或测试夹具 | test_downloads.py、test_hardening.py |
| server/enhancements/ | shares/metadata/archives/monitor/reminders/jobs | 详细接口和文件地图见该目录 README；SSRF、快照字段、任务租约和限量 | enhancements/tests/ |
| server/workspace/tests/test_live_http.py | 真实 HTTP 的会话/CSRF/收藏/隔离/分享/提醒 | LiveServerTestCase 独立库；不操作正式管理员 | Django 完整测试 |
| prototype/src/Root.jsx、components/AuthPage.jsx | 会话/初始化/邀请/恢复/公开分享 → App | query、setupTokenRequired、auth-expired；不能残留旧账号页面 | 浏览器、api 测试 |
| prototype/src/api.js、workspace-loader.js、useWorkspace.js | CSRF/超时/分页/成功保存状态 → React | fresh cookie、userId、nextPage、409；失败保留输入 | tests/api.test.mjs、workspace-loader.test.mjs |
| prototype/src/App.jsx、model.js、data.js | 导航检索/打开 → 内容与表单 | filterSites、getDefaultEndpoint；data 仅演示；不伪造连通状态 | model.test.mjs、浏览器 |
| prototype/src/components/ | 详情/表单/工作集/设置/共享/增强 UI | SettingsDialog、DataSettings、DevicesSettings、SiteOperations；私有字段与明确确认 | 浏览器、HTTP 集成 |
| prototype/src/dialogStack.js | 叠层焦点和滚动锁 → Dialog | 顶层 Escape、引用计数 | dialog-stack.test.mjs |
| extension/ | popup/options/worker → Bearer API 与本地队列 | queue、engine、permissions；不得把旧队列转投新账号 | npm test、npm run check；实体安装待验证 |
| scripts/backup.py、backup_crypto.py | SQLite 快照 → HKDF/AES-GCM → 新文件恢复 | streaming、fsync、认证后发布、symlink、retention；密钥必须独立保存 | scripts/tests/test_backup.py、test_stream_backup.py |
| scripts/generate_env.py、manage_env.py、build_release.py | 私有配置/命令加载/发布物 | 拒绝覆盖、秘密不输出、包排除/扫描；源码与包需同步 | scripts/tests/test_release.py |
| deploy/ | systemd/Caddy/可选 Docker → 运行环境 | 单 worker、MemoryMax、timer 互斥；8000 仅回环 | README、SSH-TUNNEL.md；systemd 已实测，Caddy 未启用 |
| docs/implementation-verification.md、prototype-ownership.md | 证据、限制、历史维护记录 | 自动检查不代表人的 accepted | 项目同步与人工验收 |

变更实现后更新对应测试、真实状态和变更记录。保留 prototype/.openai、worker、prepare-sites-build 与 sites-worker 测试模板文件；生产私有应用使用 Django，不能仅发布静态外壳。

## 实机部署入口

- docs/debian-deployment-2026-10-26.md：已部署版本 SHA256、服务/权限/资源、独立恢复与分页测试范围。
- deploy/SSH-TUNNEL.md：无域名时的回环访问、初始化码位置、HTTPS 切换联动；不要把私有配置或凭据写入源码。
- 云端 /opt/website-workspace/RELEASE.sha256 与 DEPLOYED.md：实际版本与运行方式；业务数据在 /var/lib/website-workspace、配置在 /etc/website-workspace.env。

## 公网 IP HTTPS 入口

- deploy/nginx-public-ip.conf、website-workspace-web.service：8443 TLS → 回环后端，单入口 worker，访问日志关闭、协议/IP 头强制覆盖。
- deploy/website-workspace-renew-tls.sh、tls-renew service/timer、certbot-requirements.lock：短期 IP 证书、原子 PEM、root 私钥、限资源续期、维护锁及 reload。
- deploy/public-ip-https.conf：后端单 worker 仍绑定 127.0.0.1:8000。
- server/workspace/tests/test_proxy_identity.py：代理不同客户端分离限额，外部伪造头不能绕过。
- docs/public-ip-deployment-2026-10-26.md：当前访问地址、证书和公网检查、问题证据、回退。SSH-TUNNEL.md 仅为历史回退，不再是访问前提。

## 浏览器导入模块

| 入口 | 职责与风险 | 验证 |
| --- | --- | --- |
| server/workspace/browser_bookmarks.py | Chromium 显式栈、节点/深度/条数、URL 白名单与路径；不读取密码元信息 | tests/test_browser_import.py |
| server/workspace/transfer.py | html/chromium/json 预览、source/skip 统计、用户归属/提交幂等 | 完整 workspace/enhancements 测试 |
| prototype/src/bookmark-import.js | 浏览器选项/指引、按内容识别文件，拒绝大文件/压缩包/密码 CSV | tests/bookmark-import.test.mjs |
| prototype/src/components/BrowserImportPanel.jsx、DataSettings.jsx | 来源选择 → 文件 → 来源/路径/去重预览 → 确认；本站 JSON 单独入口 | 合成文件 IAB 流程 |
| docs/browser-import-verification-2026-10-26.md | UI/自动验证、实际补丁与回退、来源和限制 | 源图与云端 SHA256 |

## 原生收藏免文件导入（1.1.0）

| 文件/入口 | 上下游与搜索提示 | 风险与验证 |
| --- | --- | --- |
| extension/bookmarks.html、bookmarks-page.js | popup/options → 权限手势/getTree → 本机目录预览 → confirm/run/resume | 原生授权由用户操作，合成 UI 1001 条可恢复；无网页桥接 |
| extension/bookmark-data.js | 原生树 → HTTP(S)/目录路径/本机去重/10000 条4MiB快照 | 原树不变；节点深度上限，单元测试 |
| extension/bookmark-engine.js、service-worker.js | workspaceState.bookmarkImport → serial → 单批 Bearer API | 原 UUID、同账号、先持久化、确认回执后删条目；权限撤回/停止/丢响应测试 |
| server/workspace/native_bookmarks.py、config/urls.py | /api/extension/bookmarks/import → whitelist → IMMEDIATE transaction → ImportJob | token-only、归属、容量回滚、raw-items fingerprint；test_native_bookmarks.py 与真实 HTTP 整批 |
| server/workspace/downloads.py | 登录 → 21 运行文件 ZIP，含四个新增导入文件 | test_downloads.py 检查 1.1.0 与可选权限/完整资源 |
| prototype/src/components/DirectBrowserImport.jsx、DataSettings.jsx、DevicesSettings.jsx | 主入口/关闭的文件备用 → 连接与更新扩展 | IAB 独立库设置流程；旧文件解析保持可用 |
| docs/native-import-verification-2026-10-26.md | 测试/部署 SHA256/失败记录/回退与未运行范围 | 不把合成 chrome 替身当实体权限验收 |
