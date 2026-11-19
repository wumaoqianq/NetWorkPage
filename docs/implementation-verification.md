# 实际验证与交接限制

日期：2026-10-26，Asia/Shanghai。环境：Windows 开发机，Python venv、Node 24.19、Django 5.2.18。以下是本会话实际工具输出的整理，不是 Debian 生产验收。

## 自动化与构建

| 范围 | 实际命令 | 观察结果 |
| --- | --- | --- |
| 真实后台 | cd server 后 ../.venv/Scripts/python.exe manage.py test workspace enhancements -v 1 | 67 项通过；含私有隔离、CSRF、初始化竞争、版本冲突、导入幂等、设备权限、分享脱敏、网络限制、任务幂等 |
| HTTP 联调 | 上述套件包含 workspace.tests.test_live_http | LiveServer 真实 HTTP 验证会话/保存/重登/双账号隔离、扩展配对/重复收藏/撤销、分享字段和提醒；使用隔离测试数据库 |
| 迁移 | cd server 后 ../.venv/Scripts/python.exe manage.py makemigrations --check --dry-run | No changes detected |
| 前端行为 | npm --prefix prototype test | 17 项通过，含 CSRF/错误/会话失效、默认入口、用途检索、模态栈、分页与跨账号页拒绝 |
| 前端产物 | npm --prefix prototype run build | 成功；主 JS 390.75kB，gzip 112.83kB；CSS 31.19kB |
| 模板运行时 | npm --prefix prototype run test:sites | 4 项通过，保持静态模板兼容；不代表 Django 可以被静态托管替代 |
| 扩展 | npm --prefix extension test | 23 项通过，含真实 Node HTTP 传输、不发送 cookie、拒绝重定向、原账号队列和确认语义 |
| 扩展结构 | npm --prefix extension run check | Manifest、HTML 引用、4 个 PNG、15 份源码语法和 300 行检查通过 |
| 备份与发布 | .venv/Scripts/python.exe -m unittest discover -s scripts/tests -v | 26 项通过；含 WAL 快照、原子发布、认证篡改/错误密钥、拒绝覆盖、保留策略、秘密排除 |
| 大备份 | 同上 test_stream_backup | 36MiB 实际 SQLite 往返，Python 分配峰值低于 12MiB；不等同于完整进程 RSS |

测试总计 137 项（67 + 17 + 4 + 23 + 26）。最初从仓库根目录运行不带应用标签的 Django test 发现 0 项，未将其记为成功证据；已改为上表明确应用标签的完整命令。

分页、64KiB 总体积限制、设备响应白名单和后端 X-Frame-Options 各自先观察到回归用例失败，再实现并通过；没有用“代码已写”替代验证。

## 页面检查

通过 Codex IAB，在独立 .local/ui-qa/ 数据库、8001 临时后端使用合成测试账号：

1. 登录后得到真实空库；新增网站用途、别名、备注、置顶和账号说明/登录页。
2. 提交后显示保存成功；刷新仍显示同一收藏，详情读回备注和账号用途，账号默认隐藏。
3. 打开状态/提醒、真实资料设置、扩展下载/配对页面、个人账号设置，接口无页面错误。
4. 退出返回登录页；重新登录后网站仍在，浏览器 error/warn 日志为空。

证据图：../prototype/qa/persistent-workspace-2026-10-26.png。截图为合成测试资料，视口截图存在工具缩放限制；该文件不包含实际账号凭据。

正式 4173/8000 页面显示首次管理员初始化，未写入上述测试账号与收藏。扩展安装、配对授权和首个正式管理员密码由用户在自己浏览器中完成。

## 部署配置检查与限制

- 使用 DEBUG=False、COOKIE_SECURE=True、SECURE_SSL_REDIRECT=True 运行 manage.py check --deploy：补上后端防嵌入 middleware；HSTS 默认关闭会保留 W004，待真实 HTTPS 证书验证后设置 SECURE_HSTS_SECONDS。
- 在测试进程设置 SECURE_HSTS_SECONDS=3600 后检查保留 W005/W021：当前不对所有子域强制 HSTS，也不申请浏览器 preload，避免替用户锁定未经确认的子域。这些是明确记录的策略，未静默屏蔽检查。
- 尚未运行真实 Debian 12、Caddy/systemd 或容器。Docker 构建尝试在拉取官方 Python 基础镜像时因 auth.docker.io 网络/DNS 失败，未获得运行测量；没有切换到不明镜像。
- Windows Waitress 曾观察约 50.6MiB 工作集，仅为本地空载参考。700MB Debian 的 OS/Caddy/Gunicorn 峰值、5000 条资料场景与 P95 指标未测，不作容量保证。
- 生产关闭访问日志，避免把分享/邀请 token 或完整收藏 URL 写入常规 access log；修改部署配置时须继续避免记录这些数据。
- 备份密文依赖独立 BACKUP_KEY，恢复到新文件后验库再停机切换。真实主机的磁盘预算、备份异机复制和恢复演练仍需执行。

## 范围与审查状态

多人私有网站库、浏览器快速收藏和核心增强已接入本地真实应用。AI 语义搜索、邮件、原生书签双向同步和移动系统分享入口尚未实现；普通用途/备注/标签/别名检索不依赖 AI。

原型阶段独立审查发现的两项 P2 已修复。完整系统的独立审查代理因额度限制未完成，本轮由主代理自查、测试及浏览器验证，不冒充独立审查通过。仍需要真实用户体验与生产验收。

没有配置 Git 作者身份或远程，代码保留在工作区，未伪造提交。人的维护负责人/备用人和正式接受日期未登记，不将技术检查描述为维护移交 accepted。历史原型记录见 prototype-ownership.md，当前维护入口见 ai-context-map.md 和 deploy/README.md。

2026-10-26 运行所有权记录结构校验：docs/implementation-ownership.md 返回 1，明确缺少正式 accepted、真实负责人/备用负责人和接受日期，共 4 项。未伪造人的身份来通过；技术验证结果与维护接受分别记录。

静态检查：67 份 Python 文件通过 Python 3.11 语法解析；107 份手写 Python/JS/JSX/MJS/CSS/SH 文件均不超过 300 行，迁移文件从行数策略中排除。

## 候选部署包检查

本轮实际生成包后复核 SHA256、106 个归档成员、前端 index.html 引用的构建资产；没有 .env、数据库、依赖目录或测试夹具。将包解到独立临时目录，使用全新随机配置执行 manage.py check 和 migrate --noinput 均通过；临时目录自动清理。该验证覆盖包的解压/管理命令与迁移，不代替 Debian/systemd/Caddy 实机启动。

正式后台重启后检查 session：setupRequired=True、user=null、X-Frame-Options=DENY。独立 UI 测试的 8001 后端与测试页已关闭；4173/8000 正式本地预览保留。

## 2026-10-26 后续：实际云端部署

用户提供目标服务器并说明暂无域名后，已经执行 Debian 回环部署和 SSH 隧道验收。前文“真实 Debian 尚未运行”等描述为候选包生成时的历史状态，现以 [实机记录](debian-deployment-2026-10-26.md) 为准：服务、两个 timer、权限、备份和独立恢复均有实际证据；首页/资产经隧道返回 200，浏览器初始化页无 error/warn。5000 条合成资料在独立库完成有界分页检查，单页 Test Client P95 46.66ms，不等于网络搜索或并发性能。公网域名 HTTPS、实体扩展安装和人的最终验收仍待进行。

## 公网 IP HTTPS 后续验证

按用户最新要求已启用 https://203.0.113.10:8443/、停掉 SSH 隧道。完整依据与范围见 public-ip-deployment-2026-10-26.md：真实 TLS 信任/IP 验证、请求及资产 200、Secure cookie、完整 CSRF/初始化拒绝、私有读 401、续期 dry-run 和 hook reload 均通过。新增代理限流回归 2 项，本轮完整后台 69 项通过；累计行为测试记录为 139 项（前端/扩展/工具本轮未改，未重复声称重新运行）。新的浏览器复核因 CUA 超时未完成，未将旧隧道截图冒充公网证据。

## 浏览器导入补充

本轮新增功能与实际部署证据见 browser-import-verification-2026-10-26.md。新后台 72、前端 21、模板运行时 4 项与构建通过；浏览器仅操作独立合成测试库；公网上线与私人导入鉴权已检查。额外扩展/备份工具未修改，未将其旧测试说成本轮重跑。


## 2026-11-15：扩展 1.2、预览卡与含图备份

本轮开发使用独立测试数据库和独立 Edge 配置，没有读取或写入正式用户收藏。原 venv 的解释器 home 指向失效路径，已通过 `python -m venv --upgrade .venv` 修复；原私有配置中的旧数据库盘符不适用于当前目录，因此 Django 命令显式设置独立 `DATA_DIR/DATABASE_PATH`，未修改私有配置。

| 范围 | 实际命令/操作 | 本轮结果 |
| --- | --- | --- |
| Django 配置与迁移 | `manage.py check`、`makemigrations --check --dry-run` | 无问题；No changes detected |
| 后台与真实 HTTP | `manage.py test workspace.tests enhancements` | 91 项通过；含协议 1/2、显式更新、双账号媒体隔离、坏图/配额/GC、LiveServer 文字→图片→撤销→同账号恢复 |
| 扩展 | `npm --prefix extension test`、`npm --prefix extension run check` | 37 项通过；28 个源码文件语法、权限、资源和 300 行检查通过 |
| 前端 | `npm --prefix prototype test` | 24 项通过，含简介检索、query/hash 卡片脱敏、导入字段独立 |
| 前端构建 | `npm --prefix prototype run build` | 成功；JS 413.88kB（gzip 120.00kB），CSS 40.26kB（gzip 9.24kB） |
| Sites 模板 | `npm --prefix prototype run test:sites` | 4 项通过，保留规定构建文件 |
| 工具 | `python -W error::ResourceWarning -m unittest discover -s scripts/tests` | 32 项通过；含 ZIP 可复现、含图容器恢复、共享磁盘预算、旧备份兼容，且无 ResourceWarning |
| 扩展发布 | `python scripts/build_extension.py` | 退出码 0；1.2.0 ZIP 与 release.json 哈希一致 |
| 完整发布 | `python scripts/build_release.py` | 退出码 0；秘密扫描通过 |

### 真实 Edge 页面流程

本机只有 Microsoft Edge 157.0.4341.46，未发现 Chrome。使用全新浏览器配置和本机 Django 服务，通过 CDP 操作真实页面：

1. 登录独立账号，通过网页表单保存名称、简介、用途、首页和带秘密 query/hash 的地址；卡片显示简介和路径，不显示 query/hash 值。
2. 通过真实 HTTP 配对、协议 2 收藏和 multipart 图片上传，刷新后显示私有缩略图及详情主图；卡片 2 张、预览图 1 张，媒体请求共 2 次，无全库图片请求。
3. 查看卡片、详情和扩展中心；1440px 与 360px 截图已人工读取，360px 无横向溢出，200% 缩放的操作按钮仍可见，控制台异常列表为空。

证据图：`prototype/qa/extension-cards-desktop-2026-11-15.png`、`extension-site-detail-2026-11-15.png`、`extension-center-2026-11-15.png`、`extension-cards-mobile-2026-11-15.png`。图中均为合成测试资料。

### 发布物验证

- 文件：`release/website-workspace-20261115T114805612393Z.tar.gz`
- 外层 SHA-256：`a2b52ccf64672d20f6b039e7b2b49dcbed46b15865b34baf53663226ea08af0c`
- 扩展 1.2.0 SHA-256：`e289e375719e582fce580401a6be622457b3480f146a3f7f032a3e80dc136882`
- 共 146 个成员，无 `.env`、数据库或测试目录；内部 ZIP 与清单匹配。解到独立临时目录后，`manage.py check` 和全量 `migrate --noinput` 均通过。

### 尚未完成的验收

- Chrome 未安装，未执行 Chrome 验收；Edge 上述是网站和真实 HTTP 流程，不是扩展实体安装。Chrome/Edge 的解压加载、权限弹窗、activeTab/scripting、真实截图与导航竞态、扩展重启/升级队列保留仍需人工分别验证。
- 未部署本轮代码到正式服务，未操作正式用户数据；企业策略、其他 Chromium、Firefox/Safari 未标为支持。
- 未在目标低内存 Debian 实测 Pillow 峰值内存、上传延迟和磁盘；含图备份恢复由独立临时目录自动化覆盖，目标服务器恢复、GC/备份并发和性能仍需实测。
- 768/1280px、完整键盘路径、多入口及长文本主要由代码和单元/构建检查覆盖，未全部形成实体浏览器证据；不能把本轮结果描述为规格全部生产验收通过。

## 2026-11-15：三项代码审查修复

本轮只使用 Django 隔离测试数据库和扩展内存替身，没有读取或写入正式用户数据，也没有部署生产。三个问题均先新增测试并观察失败，再修改实现：首页字段更新返回 400、首页版本冲突用例未进入预期校验、交错删除错误返回 200；扩展同 ID 替代未拒绝且在新任务持久化前取消旧任务。修正删除测试夹具时先刷新上传后的站点版本，确保交错写确实发生；冲突事务回滚后版本仍为 2，图片引用保留。

| 范围 | 实际命令 | 本轮结果 |
| --- | --- | --- |
| 后端定向回归 | `manage.py test workspace.tests.test_extension_v2 workspace.tests.test_preview` | 17 项通过；覆盖历史首页为空、显式变更/非隐式覆盖、版本冲突、当前页图片、成功上传、无图幂等删除和交错版本更新 |
| 后端完整回归 | `manage.py test workspace.tests enhancements` | 96 项通过 |
| Django 配置/迁移 | `manage.py check`、`makemigrations --check --dry-run` | 无问题；No changes detected |
| 扩展 | `npm --prefix extension test`、`npm --prefix extension run check` | 42 项通过；29 个源码文件语法、权限、资源和 300 行检查通过 |
| 前端 | `npm --prefix prototype test`、`npm --prefix prototype run build` | 24 项通过；构建成功，JS 413.88kB（gzip 120.00kB），CSS 40.26kB（gzip 9.24kB） |
| Sites 模板 | `npm --prefix prototype run test:sites` | 4 项通过 |
| 工具 | `python -W error::ResourceWarning -m unittest discover -s scripts/tests` | 32 项通过，无 ResourceWarning |

上述扩展测试使用内存存储/网络替身，证明新 UUID、附件关联、两阶段本地持久化、失败保留和回执驱动状态，不等于真实浏览器弹窗验收。本轮未执行 Chrome/Edge 实体扩展加载、权限弹窗、真实 activeTab 截图、导航竞态、浏览器重启或升级队列保留；也未执行目标低内存 Debian 的资源和恢复实测。

### 本轮发布物核对

- 扩展：`extension/dist/website-workspace-extension-1.2.0.zip`，SHA-256 `ad343e922e9d8bf73db25d255f34c0df5782ca4ac96ef8c9aa0a425be37b3431`；与 `extension/release.json` 的大小和哈希一致。
- 完整包：`release/website-workspace-20261115T131741384743Z.tar.gz`，SHA-256 `bec1501a3954963dce685882d3d98566265e87be48fdf71c88e26cfd09c783de`，共 146 个成员；包内扩展 ZIP 与上述哈希一致，且包含本轮三处修复，无 `.env`、数据库或测试目录。
- 重建后重新运行 `workspace.tests.test_downloads`：2 项通过，站内下载响应的字节、大小和 SHA-256 与发行清单一致。
- 完整包解到独立临时目录后，使用临时数据库和仅用于验证的 SECRET_KEY 执行 `manage.py check` 与全量 `migrate --noinput`，均通过；临时目录已删除。首次解包命令因工作目录未进入 `server/`、随后因全新包没有生产 SECRET_KEY 而未执行检查，补齐正确目录和验证环境后通过；这些不是代码测试失败。

## 2026-11-16：少操作收藏修订自动化验证

本轮关键行为先补失败回归：普通收藏仍自动进入收件箱、重复 notes 被未知字段拒绝、首页只剩置顶、自动素材模块不存在。实施后覆盖 notes 独立保存与幂等追加、lookup 不泄露旧备注、直接入库/主动 later、私有图标读写/归属/格式/版本冲突、预览失败不阻塞图标、首页排序、轻量变更版本和可选收件箱整理。

| 范围 | 实际命令 | 结果 |
| --- | --- | --- |
| Django | `manage.py test workspace.tests enhancements` | 101 项通过（最终完整复跑） |
| 迁移 | `makemigrations --check --dry-run` | No changes detected；新增 `0004` |
| 扩展 | `npm --prefix extension test`、`npm --prefix extension run check` | 46 项通过；33 个源码文件检查通过，PNG 尺寸正确 |
| 前端 | `npm --prefix prototype test`、`npm --prefix prototype run build` | 25 项通过；构建成功，JS 412.64kB（gzip 120.01kB），CSS 39.80kB（gzip 9.23kB） |
| Sites | `npm --prefix prototype run test:sites` | 4 项通过 |
| 工具与备份 | `python -W error::ResourceWarning -m unittest discover -s scripts/tests` | 32 项通过；含预览和图标媒体恢复，无 ResourceWarning |

首次将下载版本断言改为 1.3.1 时，后端正确发现站内仍为 1.2.0 ZIP；重建后消除。另一次完整后端运行中 SetupRaceTests 间歇返回零个 200，该用例单独运行和随后的完整 101 项复跑均通过；此既有不稳定性已记录，没有隐去。

Logo PNG 使用 `scripts/generate_brand_assets.py` 从 docs/brand/workspace-mark.svg 通过本机 Edge 生成，已实际读取 32/128px 图片检查。自动化存储、网络和图片替身不等于实体 Chrome/Edge 扩展验收。

### 本机部署、发布物与真实 Edge 验证

- 4173 已在备份后应用 `0004` 并用新版重启；迁移前后均为 1 个账号、1 条收藏，完整性检查正常。未部署云端。临时 4180 QA 服务及数据库已清理，4173 保持运行。
- 扩展 1.3.1 ZIP SHA-256：`f2279f4341964a4124d3538c29f832349eef8acda5cebe305b046c5d6f9d7d71`。全部运行文件逐字节匹配源码。
- 完整包：`release/website-workspace-20261115T181509952160Z.tar.gz`；SHA-256：`e61dc0d8d0115d226b3dd80ab97d5afdefaf220c97b2b1c433ddd032f19dbd0b`。包内 ZIP 一致，解包后的 `check` 和全量迁移通过。
- 真实 Edge 在独立 QA 库验证至少 30 条合成收藏：1280/1440/1920px 为 3/4/5 列，高度 174px；360px 单列 170px 无横向溢出，200% 缩放和标题键盘聚焦可用。
- 已验证可见页面自动发现新增、编辑内容保留、详情深链、notes 搜索与幂等追加、普通 inbox=false、私有图标、1.3 清单及实际下载哈希；控制台无异常。4173 现有页面与下载也正常。

证据图：`prototype/qa/frictionless-30-cards-1440-2026-11-16.png` 和 `frictionless-mobile-2026-11-16.png`。这些仅为合成资料；含现有用户信息的临时截图已删除。真实扩展 popup、activeTab/favicon 权限和升级恢复未执行，详细边界见 local-testing-2026-11-15.md。

## 2026-11-16：1.3.1 候选修复（未标记全面验收完成）

独立审查复现后，先新增失败回归：实际 `deriveImage` 返回 data URL 时旧预览没有 displayUrl，旧等待接口也不存在独立任务控制。修复后明确拆分 sourceUrl/displayUrl，并贯通 popup、IndexedDB、队列和 multipart 上传。新增慢图标交错测试，证明截图已就绪时只有慢图标会在保存期限降级。

- `npm --prefix extension test`：48 项通过，含真实衍生结构及慢图标交错。
- `npm --prefix extension run check`：34 个源码文件检查通过。
- Django 101、前端 25、工具 32、Sites 4 项通过；前端构建成功。
- 扩展 ZIP：`extension/dist/website-workspace-extension-1.3.1.zip`，SHA-256 `f2279f4341964a4124d3538c29f832349eef8acda5cebe305b046c5d6f9d7d71`。
- 完整包：`release/website-workspace-20261115T181509952160Z.tar.gz`，SHA-256 `e61dc0d8d0115d226b3dd80ab97d5afdefaf220c97b2b1c433ddd032f19dbd0b`。ZIP 运行文件与源码一致，解包检查和迁移通过。
- 4173 实际清单为 1.3.1，下载哈希一致；既有账号和收藏未修改，未部署云端。

### 实体 Edge 补充证据

在有界面 Edge 中加载解压 ZIP，完成原生权限确认和真实工具栏快捷键 popup 操作。选择分类、填写备注、收藏后，文字、当前页预览和图标均上传；刷新详情时两图 naturalWidth 均大于 0。离线队列重载前后均观察到 1 条且账号不变，恢复后最终为 0。

证据：`prototype/qa/extension-1.3.1-popup-entity-2026-11-16.png`、`extension-1.3.1-detail-entity-2026-11-16.png`。QA 数据库、浏览器配置和临时服务已删除，4173 保持运行。

权限无头限制、其他扩展阻止、程序 openPopup 不授予 activeTab、worker 离线模拟及启动器/子进程 PID 差异均在 local-testing-2026-11-15.md 中记录。Chrome、完整浏览器重启、旧版实体升级和跨源/导航全部边界仍未验收，因此不将 1.3.0 或 1.3.1 标为全面验收完成。

## 2026-11-17：Logo 卡片与截图查看器

### 根因与实现证据

4173 当前 1 条收藏的数据库核对结果为 PreviewAsset=0、SiteIconAsset=0，因此该收藏无图不是媒体读取失败。此前独立实体上传已证明 PreviewAsset、文件和 fullUrl 可正常工作。旧展示层存在三项确定问题：卡片只有 88×50 缩略图且点击进详情、DetailPreview 失败后禁用放大、SiteCard/DetailPreview 的失败标志不随 revision 恢复。新实现保留无图说明，不删除资产掩盖问题。

新增 `screenshot-resource` 与 `card-preferences` 回归，并纳入默认 `npm --prefix prototype test`，使前端标准测试从 25 增至 32 项。后端 101、扩展 48、工具 32、Sites 4 项通过；生产构建成功。扩展源码未改，继续使用 1.3.1 ZIP 和原哈希。

### 真实 Edge 与故障恢复

独立合成库包含 30 条收藏和清晰 A/B/C 图片。验证列表截图请求为 0，打开一张才请求一张；主图 960px naturalWidth 且文字可读。刷新后重新打开成功，文件缺失时显示错误、恢复后重试成功；失败时替换新 revision 自动恢复，成功阅读中只提示“有新截图，点击刷新”。归档和回收站均可读取。

尺寸偏好刷新保留且仅写本机 origin+userId 键，尺寸调整期间 POST/PATCH/DELETE 为 0。239/240/299/300px 的 Logo 实测为 36/48/48/64px，200% 缩放无横向溢出且操作可达。图标旧 revision 404 后回退首字母，新 revision 恢复后 naturalWidth=128。真实脚本为 `verify-logo-cards-viewer-2026-11-17.mjs`、`verify-card-thresholds.mjs`、`verify-icon-recovery.mjs`。

证据：`prototype/qa/logo-cards-standard-2026-11-17.png`、`logo-cards-wide-2026-11-17.png`、`screenshot-viewer-original-2026-11-17.png`。4173 已加载新构建，原账号收藏未修改；QA 数据与进程已清理，未部署云端。Chrome、完整实体升级、跨浏览器触控手势与 100/1000 条实机密度仍未验收。

本轮完整包：`release/website-workspace-20261116T172416468656Z.tar.gz`，SHA-256 `45110c027a0f0023fbbc4d8abe1485125ad00800ae1c22be4f2beae9b46c0068`。扩展 ZIP 版本和哈希仍为 1.3.1 / `f2279f4341964a4124d3538c29f832349eef8acda5cebe305b046c5d6f9d7d71`，全部运行文件与源码一致；解包配置检查和全量迁移通过。

## 2026-11-17：实际安装扩展排查（素材验证未闭环）

### 已证实的根因与修复

实际安装项为 `mgoiiimmoehjajddbejpjljhmondnbem`，加载目录是 `C:\Users\无名\Downloads\website-workspace-extension`。该目录 manifest 为 1.2.0，缺少 automatic-assets.js，因此下载新版 ZIP 并没有使自动采集生效。已备份并更新到 1.3.2，且克隆运行时已确认 1.3.2、原账号和 schema 2 队列保留。

另一个实际缺陷是多窗口下 `currentWindow` 可指向扩展 options 页，造成 popup `Invalid URL`。`activeCaptureTab` 现在从所有窗口选择最近活动的非隐身 HTTP(S) 标签，新增回归。重复资料默认不更新图片的提示已明确，并提供“更新截图和图标（保留原备注和分类）”操作。

### 未完成的证据

普通网页 popup 曾显示预览和图标就绪，但 activeTab/表单提交没有形成新的文字回执。当前最新 `lastResult` 仍是旧 WildAI，IndexedDB 检查没有可恢复 Blob，PreviewAsset/SiteIconAsset 仍为 0。不能把旧回执或合成图片查看器结果冒充本次采集上传成功。

扩展自动化 49 项通过，下载回归 2 项通过。ZIP SHA-256 `76c677ba73ea4b51362fb1e3bfdf218eefc1217414f4898842751eb4148d7012`；完整包 `release/website-workspace-20261116T192334627276Z.tar.gz` SHA-256 `f4941004986ecb0d29ce94ad5778edc626aa220afa6e0c057c46522f24f6d348`。原浏览器窗口需要重新加载更新后的目录后再做一次 activeTab 与收藏验证；未删除收藏、未清空队列、未部署云端。

## 2026-11-17：扩展 1.3.3 目标绑定、混合态拦截与真实素材链路（本轮完成）

### 根因与证据

- 真实浏览器此前实际运行扩展 **1.2.0**：重启前 `Secure Preferences` 的 Service Worker 注册版本 1.2.0，服务端两台设备 `extension_version=1.2.0`，扩展自检 `release.currentVersion=1.2.0`；1.2.0 无 `automatic-assets.js`。因此本机 `PreviewAsset=0`、`SiteIconAsset=0` 是“没有自动采集与上传请求”，不是服务端持久化/鉴权/读取失败。
- 实际加载目录在 2026-11-17 02:32 被替换为 1.3.2 文件但未重新加载；原浏览器进程自 11/15 持续运行。重启核实时还发现 Edge 157 在开发者模式关闭时以 `DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION (16777216)` 禁用未打包扩展，已在真实 profile 开启开发者模式并用 1.3.3 复核启用。
- 隔离复现“混合态”：替换磁盘文件但不重新加载时，popup 页面加载新 1.3.2 代码（`#update-assets` 存在），而 `chrome.runtime.getManifest().version` 仍为 1.2.0；提交会生成文字回执和预览，却静默丢弃本次 notes（1.2.0 后台 payload 没有 notes 字段）。此外旧逻辑无目标时只显示 `Failed to construct 'URL': Invalid URL`，多窗口时从所有窗口按 lastAccessed 改选。
- 原 profile 持久状态显示：最新回执停在 2026-11-16 23:53，队列为空、IndexedDB 为空、仅有 02:52/03:04 两条草稿，证明此前操作没有形成有效入队；结合上述复现，问题在“旧运行时/混合态与不确定的目标上下文”，不是服务端素材保存失败。

### 修复

- `extension/queue.js` 新增 `resolveInvocationTarget/describeCaptureTarget/targetMessage`：只取 `tabs.query({active:true,currentWindow:true})`（调用窗口的活动标签），用 `tabs.getCurrent()` 区分工具栏 popup 与独立调试页，用 `windows.getCurrent()` 复核窗口，不跨窗口改选；未知/授权失效场景给出明确指引。
- `extension/popup.js`：新增 `BUILD_VERSION` 与已加载 manifest 版本一致性检查（混合态直接阻止收藏并提示重新加载）；目标/授权问题提示；重复收藏分类预填；成功文案区分新建与素材更新；无匹配回执时提示可恢复状态；显示“已连接 · v1.3.3”。
- `extension/engine.js`：素材上传完成后保留服务端 `category/duplicate/outcome`，重复素材更新标记 `updatedAssets`，修复成功提示退化为“未分类/created”。
- 版本提升 1.3.3；`check.mjs` 增加 BUILD_VERSION 一致性检查；新增目标绑定/调试页/隐身/窗口不一致/查询失败/重复素材更新元数据回归。扩展测试 49→53 项。

### 真实浏览器证据（最终构建，非克隆替身）

- 真实 OS 级点击工具栏扩展按钮获得 activeTab；popup 内实测 `getCurrent()=null`、`currentWindow` 标签 windowId 与 `windows.getCurrent().id` 一致；窗口 A/B 分别绑定各自活动页。
- 窗口活动页为扩展设置页时阻止收藏并提示“不会改选其他窗口的页面”；popup.html 独立标签页被识别为调试上下文并阻止。
- 完整链路：真实页面 → 工具栏点击 → 选分类写备注 → 收藏 → 新 capture ID 回执 → 预览/图标上传 → 服务端资产与媒体文件 → 刷新首页 Logo → “查看截图”大图（960×540/959×539 自然尺寸）。
- 重复收藏素材更新：站点不新增，notes/分类保留，preview/icon revision 更新，反馈为“截图和图标已更新 · 「开发工具」（原备注和分类保留）”。
- 断网收藏 → 扩展重载队列/账号保留 → 恢复 4173 后由 alarm **自动同步**（无需手动重试）：队列清空，回执、notes、预览与图标、媒体文件齐全。
- 最终本机库：1 账号、4 站点（原 WildAI 保留，新增 MDN zh-CN/DeepSeek/MDN en-US）、8 CaptureReceipt、3 PreviewAsset、2 SiteIconAsset，`integrity_check=ok`；备份 `post-1.3.3-2026-11-17.sqlite3`。

### 自动化结果（逐项实际运行）

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 扩展 | `npm --prefix extension test` / `run check` | 53 项通过；34 个源码文件与 BUILD_VERSION 检查通过 |
| 后台 | `manage.py test workspace.tests enhancements`（独立 DATA_DIR/DATABASE_PATH） | 101 项通过；check 无问题、迁移无漂移 |
| 前端 | `npm --prefix prototype test` / `run build` / `run test:sites` | 32 项通过；构建成功（JS 423.96kB、CSS 43.26kB）；Sites 4 项通过 |
| 工具 | `python -W error::ResourceWarning -m unittest discover -s scripts/tests` | 32 项通过，无 ResourceWarning |

### 发布物

- 扩展 ZIP：1.3.3，54931 字节，SHA-256 `7f6b15559de6fd74a4d0b6b3a348b02842ec851dd449ef9bb732ba8fd475cda9`；29 个运行文件与源码逐字节一致，实际加载目录与 ZIP 一致。
- 站内下载：`/downloads/website-workspace-extension.zip` 返回 200、`private, no-store`，字节/哈希与 `release.json` 一致。
- 完整包：`release/website-workspace-20261117T084230201232Z.tar.gz`，2382567 字节，SHA-256 `f9ffc687a58b3ab820a0e50aa10fc1ae7417e44bf5238de548fb16445d60c7f7`；166 个文件，无 `.env`/数据库/密钥；包内 ZIP 哈希一致；解包后 check、全量迁移与漂移检查通过。

### 未验证/限制

Chrome 未安装；未做隐身真实调用与全部导航/切 tab 实体竞态（有单元/既有回归）；未在低内存 Debian 重跑本轮链路；未部署云端。DeepSeek favicon 209KB ICO 被客户端校验降级为无图标（文字与截图正常，属预期降级）。CDP 仅为验证通道，验后恢复普通浏览器启动。
环境恢复补充：验证用的同 profile 目录联结局域网 CDP 关闭后，普通启动时 Edge 对部分受保护偏好做过一次重置；已在普通 profile 内重新加载未打包扩展（同路径同 ID，storage 保留）、开启开发者模式并用扩展设置页正常重新授权本机服务器，完整重启后再次确认扩展 1.3.3 启用、popup 已连接且素材就绪、服务端设备 last_active 更新。最终数据库为 4 站点、9 条 CaptureReceipt（含一次重复素材更新回执）、3 PreviewAsset、2 SiteIconAsset；设备记录的 extension_version 仍是首次配对时的 1.2.0（服务端不逐请求刷新），运行版本以浏览器 popup 显示为准。CDP 调试端口已关闭，浏览器按普通方式运行。
## 2026-11-17 展示优化第二版与真实 Logo（本轮完成）

### 布局根因与修复
- 旧实现有三层宽度叠加：`styles.css` 的 `.workspace{max-width:1550px;margin:auto;padding:17px 36px 0}`、`cards.css` 的 `.workspace{max-width:1440px;padding-inline:28px}`、`overlays.css` 的 1200/600 媒体查询 padding；网格同时有 styles.css 三列、overlays.css 两/一列和 inline auto-fill，卡片有 styles.css 与 cards.css 两套尺寸。最大化时两侧空白来自这些 max-width/margin，而不是数据本身。
- 现结构：无工作台级 max-width；`.main-area` 占满侧栏外宽度，`.topbar/.workspace/.workspace-footer` 用同一 `--content-padding`（<768 16、768–1599 24、≥1600 28）；`--sidebar-width` 由 `.app-shell.rail` 切换 232/72；`<768` 抽屉。网格只由 `layout.js::computeCardGrid` 与 `ResizeObserver` 计算 `repeat(n,minmax(0,1fr))`，CSS auto-fill 只在测量前兜底；`cards.css` 删除 `.workspace` 覆盖、`!important` 与重复媒体查询；卡片样式单一来源。
- 计算规则：候选列数取 `floor/ceil((W+g)/(t+g))`，实际卡宽 `(W-(n-1)g)/n`；仅接受 200–340px，按与目标宽度距离选取，距离相同选更宽/更少列；无合法候选单列；完整行均分，最后一行保持同列宽并由 grid 左对齐，不拉伸、不补假数据。

### 独立合成数据实测（4/30/100 条；100 条库、7 个真实分类）
测量脚本 `.local/polish-qa/measure-layout.mjs`，原始 JSON `.local/polish-qa/measurements/layout-measurements.json`；`W` 为网格实际宽、`M` 为主区左缘（=侧栏+内边距），含 15px 滚动条差异。

| 视口 | 侧栏 | 内容/网格宽 | 左缘 | 列数 | 卡宽 | 行/末行 | 卡高 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 360 | 抽屉（关） | 345/313 | 16 | 1 | 313.00 | 1/1 | 209 |
| 768 | 折叠 72 | 681/633 | 96 | 2 | 308.50 | 2/2 | 249（wide） |
| 768 | 展开 232 | 521/473 | 256 | 2 | 228.50 | 2/2 | 184（compact） |
| 1440 | 展开 232 | 1193/1145 | 256 | 4 | 274.25 | 4/4 | 230 |
| 1440 | 折叠 72 | 1353/1305 | 96 | 5 | 248.19 | 5/5 | 230 |
| 1920 | 展开 232 | 1673/1617 | 260 | 6 | 256.16 | 6/4 | 230～252 |
| 1920 | 折叠 72 | 1833/1777 | 100 | 7 | 240.14 | 7/5 | 230 |
| 2560 | 展开 232 | 2313/2257 | 260 | 8 | 268.13 | 8/8 | 230 |
| 2560 | 折叠 72 | 2473/2417 | 100 | 9 | 254.33 | 9/4 | 230 |
| 3440 | 展开 232 | 3193/3137 | 260 | 11 | 270.63 | 11/7 | 252 |
| 3440 | 折叠 72 | 3353/3297 | 100 | 12 | 260.08 | 12/4 | 252 |
| 1920，4 条 | 展开 | 1688/1632 | 260 | 6 | 258.66 | 4/4 | 252 |
| 2560，4 条 | 展开 | 2328/2272 | 260 | 8 | 270.00 | 4/4 | 252 |
| 3440，4 条 | 展开 | 3208/3152 | 260 | 11 | 272.00 | 4/4 | 252 |
| 960（1920@200% 等效） | 折叠 | 873/825 | 96 | 3 | 264.33 | 3/1 | 230 |
| 720（1440@200% 等效） | 抽屉（关） | 705/673 | 16 | 3 | 213.66 | 3/1 | 196 |

- 规格示例 1440/1920/2560 展开为 4/6/8 列（本机含滚动条故卡宽约 274/256/268，与规格约 278/259/270 相符）；侧栏折叠后列数实时增加；全部测量无横向溢出（`scrollWidth == clientWidth`）。顶部栏、标题、搜索、工具栏、网格、页脚左缘一致（如 1920 均为 260）。三档尺寸在 1440/1920/2560 下分别得到紧凑 5–10 列、标准 4–9 列、宽松 4–7 列（宽度不足 340 时按合法候选取最接近值）；改动尺寸/排序/筛选不会清空搜索或其它偏好。
- 4 条与 30 条数据时最后一行保持同列宽并左对齐，右側留白是数据不足，不拉伸、不补假卡片；无最近访问时整段不渲染。合成截图：`prototype/qa/workspace-v2-1920.png`、`workspace-v2-1920-rail.png`、`workspace-v2-360.png`。

### 工具栏、搜索与细节
- 硬编码“图片处理/开发部署/效率工具”已删除；chips 来自 `workspace.categories` 的真实分类与真实计数（全部+最多 4 个+更多分类），侧栏/筛选/表单同源；分类重命名/删除会清理失效筛选。
- 搜索对已载入全库过滤（40 条只是渲染批次，有“加载更多”说明与回归）；排序支持置顶优先/最近收藏/名称并持久化；尺寸、排序、侧栏偏好分 key 保存互不覆盖；最近访问仅在真实记录时渲染；空结果保留查询并提供清空筛选。
- 字体系统栈（无 Google Fonts）；实测对比度：正文 15.02:1、说明 5.79:1、弱化 4.63:1、分类绿字 6.14:1、白字绿底 5.03:1、焦点环 4.83:1、表单输入边界 3.06:1；旧弹层/设置/认证页的浅灰文字批量替换为 ≥4.5:1 的 `#596776/#4f5d66/#66736c`。卡片容器描边等纯装饰边界仍为浅色（约 1.2–1.5:1），不用于识别控件，已在限制中记录。
- dialogStack 复核：详情/表单/设置/截图/确认框统一走 Dialog，Escape 只关顶层、关闭后焦点返回触发按钮；收件箱 `window.confirm` 改为 Dialog；显示设置 popover 不会在模态打开时抢占 Escape；Ctrl+K 改用 `modalManager.hasOpen()`；移动抽屉支持 Escape 关闭并保留焦点返回按钮。

### 真实网站 Logo
- 实测 DeepSeek：`https://www.deepseek.com/favicon.ico` 209,762B、`image/vnd.microsoft.icon`、225×225、32bpp **BMP(DIB) 帧**、单帧；首页只有 `rel=icon` 指向该文件，apple-touch/favicon.png 均 404；旧客户端 `blob.size > 200KiB` 在解码前拒绝（204,800 上限，差 4,962B）。
- 客户端新链路（`icon-format.js` + `site-icon.js`）：源预算 1MiB/单文件、2MiB/累计、4 候选、5s 总墙钟，流式读取超限立即取消；魔数嗅探拒绝 SVG/HTML；PNG/JPEG/WebP/ICO 解码前尺寸检查 2MP；多帧 ICO 目录解析→选“≤128 且最接近 128”的帧→重建单帧 ICO，由 Chromium 原生解码（PNG/BMP 帧均实测）；canvas 等比缩放至 ≤128×128、WebP ≤32KiB；候选顺序 tab favicon → rel icon/apple-touch-icon（声明尺寸排序）→ 同源 /favicon.ico、/apple-touch-icon.png，跨源无授权不请求。
- 服务端新增 `POST /api/sites/<pk>/icon/refresh` 与 `POST /api/sites/icons/refresh-missing`（`favicons.py` + `icons.py` + 路由）：公网/IP 固定、每跳重定向复验、同源候选、无 Cookie/授权、流式预算、Pillow 真实解码（含 ICO 多帧）、像素/最终大小限制、版本+配额事务保护、AuditEvent；只写图标资产与版本，不触碰 notes/分类/简介/PreviewAsset。大 HTML 超限/失败改为回退默认同源候选（GitHub 首页 524,666B 场景不再 413）。批量接口同步、串行、最多 6 个站点、共享 20s，私网/本机站点返回引导扩展。
- 真实证据：
  | 场景 | 来源/类型 | 输入 | 选帧/输出 | 结果 |
  | --- | --- | --- | --- | --- |
  | 旧 DeepSeek 收藏补图（服务端刷新） | www.deepseek.com /favicon.ico，link | 209,762B ICO（BMP 单帧 225） | frame 225 → 128×128 WebP 5,856B | siteVersion 3、revision e013297d…，卡片显示蓝色鲸鱼，notes“最终构建 1.3.3 真实收藏…”与分类 AI 保留，截图仍在 |
  | 扩展 1.4.0 新收藏 DeepSeek /en（客户端） | 同站 favicon，tab favicon | >200KiB ICO | 128×128 WebP 5,222B | popup“网站图标已就绪”+“已收藏到网站库”，DB 图标 128×128 |
  | 扩展 1.4.0 新收藏 GitHub（客户端多帧） | github.com /favicon.ico | 2 帧 BMP（16/32） | 选中 32px 帧 → 32×32 WebP 644B | popup“网站图标已就绪”+保存成功，DB 图标 32×32 |
- 失败/边界回归：>1MiB 单文件、累计 >2MiB、>4 候选、5s 墙钟、2MP、损坏/SVG/HTML/截断 ICO、跨源候选、无候选、无授权、私网 endpoint 零请求、历史缺图成功刷新、版本冲突/配额失败不落资产、批量部分成功/clamp、刷新不覆盖截图/备注/分类，均有新增或既有测试覆盖；卡片/详情/设置的失败提示与重试路径保留，自动获取失败诚实显示字母回退。

### 本轮实际运行
- 前端 `npm --prefix prototype test` **47 项通过**；`npm run build` 成功（dist 更新）；`npm run test:sites` **4 项通过**。
- 扩展 `npm --prefix extension test` **62 项通过**；`npm run check` 36 文件/权限/HTML/300 行/BUILD_VERSION 通过。
- Django `manage.py test workspace enhancements` **127 项通过**（独立 DATA_DIR/DATABASE_PATH，未使用正式库）；新增 `test_icon_refresh.py` 26 项；`check` 无问题。
- 脚本 `python -W error::ResourceWarning -m unittest discover -s scripts/tests` **32 项通过**。
- 扩展 1.4.0 构建：ZIP 61,162B，SHA-256 `bf4483643eba21c67a0b6bda3fd4eba98cf87e29faafdbff215af01a23aa0efe`；`release.json`、`/api/extension/release` 与实际 ZIP 一致；`/downloads/website-workspace-extension.zip` 用真实会话返回 200/application/zip/61,162B/同哈希（该下载口要求登录）。

### 本机更新
- 扩展运行时从 1.3.3 更新到 1.4.0：按“备份旧目录→覆盖解压→浏览器正常重新加载/重启”执行，加载目录 `C:\Users\无名\Downloads\website-workspace-extension` 与 ZIP 30 个文件逐字节一致；普通重启后 popup 实际显示“已连接 · v1.4.0”，配对/权限/队列/收藏保留。本次没有卸载扩展。
- 4173 因后端新增路由/模块，按实际监听进程重启一次（launcher 23760、监听 38972），备份 `.local/manual-test/backups/pre-polish-2026-11-17.sqlite3`；数据 6 站点（原 4 + GitHub + DeepSeek /en 验收）、11 回执、5 预览、5 图标、2 设备，`integrity_check=ok`；原账号/收藏/配对/队列保留，未部署云端。

### 未验证/限制
- 仅 Edge 157 实测（Chrome 未安装）；200% 缩放以等效 CSS 视口测量，非真实浏览器缩放层级。
- 卡片菜单“更新网站图标”的点击因本机多窗口焦点竞争未能稳定自动化：菜单项存在性已由 UIA 确认，实际刷新使用真实浏览器会话调用同一 API 完成；真实卡片渲染/鲸鱼图案/DB 资产已核验。
- 自定义本地图标上传（可选）未实现；批量修复为同步最多 6 站、不可中途停止；同一来源重复刷新会重新抓取并 +1 版本，未做短时幂等去重。
- 部分旧页面容器边框/装饰色对比度低于 3:1（非控件识别信息），已测量记录；低内存 Debian 实机与云端未复测。
## 2026-11-17 图标采集通用化与 1.5.0（本轮完成）

### 代码与契约
- 扩展 `icon-format.js`：候选发现保留 `href/rel/type/sizes/media`，相对路径按页面 URL 规范化；浅色/无 media 优先、dark 排后；SVG 不执行、与栅格并存时栅格优先；跨域声明候选标记 crossOrigin，客户端只抓同源/data。`site-icon.js` 逐候选尝试，首个 404/损坏不终止，跨源/无候选/SVG-only 有稳定错误码与诊断（host/type/theme/bytes/elapsed，不含完整敏感 URL）。
- 新增 `icon-tasks.js`（持久化任务 schema、状态、server+user 隔离、有限退避、通知）、`icon-task-runner.js`（service worker 兜底执行）、`asset-attach.js`（文字先入库后按 capture ID 幂等附加素材）、`popup-tasks.js`（准确文案与后台素材阶段）；`service-worker.js` 增加 icon alarm、startup 恢复和 grace 后的一次性 alarm；`popup.js` 提交不再等待图标，先发文字再后台附加。
- 服务端 `favicons.py`：页面声明的跨域候选允许，每个候选/重定向独立公网校验、端口守卫、无 Cookie/Bearer/Referer；HTML 超限读取有界前缀解析 `<head>`，不再丢弃声明候选；候选上限 4、HTML 256KiB、单图标 1MiB、累计 2MiB、总 5s、2MP、输出 ≤128/32KiB。`icons.py` 新增 `POST /api/extension/v2/captures/<capture_id>/icon/fallback`（Bearer，rate 60）：只认 capture 所属站点，已有图标返回 `icon_exists` 不覆盖，条件创建/版本乐观/配额/审计，私网 400、SVG-only 415、失败不写资产；不接受请求体 URL。路由已加在 catch-all 前。

### 真实验证证据（`.local/polish-qa/icon-lifecycle-evidence.json`，截图 `prototype/qa/icon-lifecycle-real-cards-2026-11-17.png`）
| 场景 | capture ID | 结果 |
| --- | --- | --- |
| 千问快速收藏（popup 打开约 1.2s 点击、图标未 ready、关闭 popup） | d6ee81aa-4949-4de9-85fb-fe26a9b6c8dc | 文字立即入库；+9.4s 服务端从 img.alicdn.com 浅色 80×80 PNG 补图，80×80 WebP 1366B，sourceHost img.alicdn.com |
| ChatGPT 快速收藏 + 显式更新 | d9588ad1… / 3a18ca48-40c2-4b26-a70f-e48bac57c5f1 | 快速收藏文字入库；服务端兜底受本机 DNS 阻断（chatgpt.com 解析到不可达地址），客户端选中 48×48 PNG（非 SVG）上传 48×48 WebP 1084B |
| GitHub 多帧 ICO | 58a2ef0e-fac9-4d9a-9dfd-30aa850d92c8 | 16/32 ICO 选 32px 帧，32×32 WebP 644B |
| 淘宝 + 浏览器重启 | 1fea8800-7899-45df-8d9d-e75c79351dd3 | 点击后关闭 popup 并重启 Edge；重启后 +9.2s 由持久化任务补 114×114 WebP 2334B（img.alicdn.com apple-touch） |
| 坏候选夹具 | 0dd1ba75-5aa8-4b90-9398-b30ac09889c6 | 404 → 损坏 HTML → 有效 PNG，最终 64×64 WebP 206B；未因首候选失败放弃 |
| 慢/私网夹具 | 2d00c7d6… 等 | 关闭 popup 后服务端拒绝私网，保持缺图并提示“图标暂不可用”，不假报完成 |
| 历史阿里云登录页补图 | 站点 251aed10…（服务端刷新） | 32×32 WebP 518B（img.alicdn.com ICO），notes“阿里云”/分类“云C”/截图保留 |
| DeepSeek 开放平台 SVG-only | 站点 f3598f6f… | 明确 `icon_svg_only`，保持缺图不伪造 |

### 测试与发布
- 前端 `npm test` 47 pass、`test:sites` 4 pass、`npm run build` 成功；扩展 `npm test` 82 pass、`check` 44 个源码文件通过；Django `manage.py test workspace enhancements` 155 pass；脚本 32 pass。
- 扩展 1.5.0 ZIP 72,922B，SHA-256 `07ea99e0880c1a53f207b2a6d2bb720e33424b4d045e7cef53adb1effe0c353c`；加载目录 34 文件与 ZIP 逐字节一致；重载后 popup 实测“已连接 · v1.5.0”，配对/队列保留；`/api/extension/release` 与 `/downloads`（登录）哈希一致。
- 真实库最终 4 站点/3 图标/4 预览，`integrity_check=ok`；测试新增站点已删除，阿里云补图保留，备份 `pre-polish` 与 `pre-icon-lifecycle`。

### 未验证/限制
- ChatGPT 服务端兜底因本机 DNS/网络策略阻断未真实完成（客户端 PNG 选择已验证）；换正常 DNS 需复测。
- 公网 2.1s/4s 慢图标未单独构造真实请求（持久化任务/重启恢复与慢夹具、单测覆盖）；真实离线断网恢复未在实体浏览器演练。
- Chrome 未安装；SVG-only 选择明确降级而非隔离栅格化；自定义图标上传未实现；低内存 Debian/云端未复测。
## 2026-11-18 素材任务恢复修复与 1.6.0（本轮完成）

### 根因与修复
- P1：`asset-attach` 在文字未确认时把 queue 项改成 preview_pending，导致 `eligibleItems` 不再提交文字，且图标后台等待该 capture 移出队列，形成互等。现改为独立 `assetJobs`（`asset-attach.js` + `engine-assets.js`）：迟到素材只合并引用，队列状态/退避不变；文字回执写入 `captureReceipts` 后才补 siteId/siteVersion 并上传。
- P1：直接上传失败即删 Blob、无重试记录。现 `attach` 先校验 IndexedDB 并持久化任务，`asset-jobs-runner.js` 再联网；网络/超时/5xx/429/401 保留 Blob 与任务并有限退避；403 为单次权限失败不暂停整个连接；409 先 lookup 刷新版本再重试；只有成功或用户取消删除。图标上传 sourceUrl 使用站点入口 URL，历史候选 URL 做 savedUrl 兜底。
- P2：popup 关闭后无客户端获取路径。现 popup 提交时持久化同源栅格候选+tabId；service worker 用现有 activeTab/scripting 在目标页执行 `icon-page-capture.js` 获取同源图标，保存 Blob 后走素材任务；跨域/页面关闭仍服务端受控兜底，不新增权限。
- 两 capture 交错不依赖 lastResult：captureReceipts/assetJobs 都按 capture ID 持久化。

### 回归（真实模块组合）
- `asset-jobs.test.mjs`：离线收藏→迟到素材→恢复网络自动完成；文字确认→上传断网→新引擎实例（模拟浏览器重启）自动恢复；两 capture 交错附加/确认各自归属；401 保留 Blob 并暂停；413 终态失败保留 Blob；409 刷新版本后重试；用户取消才删除。
- `asset-attach.test.mjs`：任务只登记引用、成功才移除、失败保留、403 不暂停、退避分类。
- `icon-task-runner.test.mjs`：客户端 Blob 待上传时不抢跑服务端兜底。
- 全量：扩展 92、后端 155、前端 47、Sites 4、脚本 32 通过；扩展 check 49 文件；前端 build 成功。

### 真实浏览器与发布
- 真实 Edge 首次快速收藏 ChatGPT（capture 435c88ea…）后 popup 关闭，service worker 仍获取同源 PNG Blob（1548B，来源 chatgpt.com/unauth-mweb/images/favicon.ico）并持久化 assetJob；preview 已上传，icon 上传当次因 sourceUrl 候选路径被服务端拒绝，Blob 保留。sourceUrl bug 已修复并补测试。
- 本机 Edge action popup 在后续自动化中无法通过工具栏/快捷键打开（直接 popup.html 正常，显示已连接 v1.6.0、队列 0），故未能在同一浏览器重跑首次自动上传闭环；未把第二次手动更新当首次成功。
- 扩展 1.6.0 ZIP 81,385B，SHA-256 `bbdc2fe2a3cade2a2ca75ae884875f90d1bd148645e2c66a784b47b521fcd739`；加载目录 38 文件逐字节一致；release/download 哈希一致；真实库 4 站点/3 图标/4 预览，`integrity_check=ok`。

### 未验证/限制
- Edge action popup 自动化失效导致 ChatGPT 首次自动上传未在实体浏览器闭环；真实断网/浏览器重启下的 HTTP 上传恢复由引擎级组合测试覆盖；Chrome、低内存 Debian、云端未复测。
## 2026-11-18 阶段 A/B 稳定架构重构（候选 1.7.0）

- 阶段 A 通过：真人点击确认正常工具栏入口可用；过去自动化点不开根因为 Edge 重启关闭开发人员模式禁用未打包扩展及焦点/工具限制。
- 阶段 B 实现：普通扩展标签页 capture.html + draftId 草稿协议；action.onClicked 绑定真实 tab（移除 default_popup）；单一 IndexedDB Outbox（任务+Blob 同库同事务）、统一串行入口 workspace.js、迁移备份/独立副本核对/原子写入；本地「已存本地」与幂等联网「已入库」分离。
- 回归：扩展 130（新增 34：Outbox 阶段机、事务原子性、迁移核对与回退、统一路由）、Django 155、前端 47、Sites 4、脚本 32、check 63 文件、前端 build 成功。
- 真机：入口→普通标签页；快速提交两阶段反馈；停 4173 真实断网任务保留；两 capture 交错；完整浏览器重启后配对+2 任务保留；恢复服务器 worker alarm 自动补齐；关闭表单仍完成；迁移备份键与 Outbox IndexedDB 标记真实落盘。
- 发布/数据：ZIP 101,582 B SHA-256 ca5a3ff0…；加载目录 46 文件逐字节一致；4173 仅回环、release/download 1.7.0 哈希一致；运行版本 1.7.0、ID 不变；最终 4 站点/3 图标/4 预览 integrity ok。
- 未测/未完成：真机重配与账号切换、429/认证失效/冲突真机注入、非空旧队列迁移真机；阶段 C 截图/客户端图标与阶段 D 服务端公开图标 Job、千问 CDN、ChatGPT 网络边界、正式商店发行；Chrome/低内存 Debian/云端。1.7.0 暂不抓截图/图标，不宣称全面验收完成。详见 docs/superpowers/plans/2026-11-18-phase-b-verification.md。
## 2026-11-18 阶段 C 候选 1.8.0（素材条件写入）

- 服务端：迁移 0005（AssetTombstone + SiteIconAsset.source_fingerprint）、asset_baseline/extension_v3、v2 与 lookup 暴露 previewBaseline/iconBaseline、DELETE 写 tombstone；v3 条件写事务内复核入口来源指纹、独立素材 revision、tombstone 防 ABA、许可与幂等。
- 客户端：打开表单前短窗口截图/元数据/同源图标采集与目标前后复核；页面内 canvas 有界压缩、sourceUrl/displayUrl 分离；单一 Outbox 里 Blob 与任务同事务、独立附件子阶段、条件上传成功才释放 Blob、冲突/网络/认证/重复处理、worker alarm 恢复。
- 回归：扩展 148（新增 17）、Django 163（新增 8）、前端 47、Sites 4、脚本 32、check 71 文件、前端 build、迁移无漂移、check 0 issues。
- 真机/真实 HTTP：Edge 1.8.0 截图两阶段反馈、DB preview WebP+receipt；4173 实跑 absent 首传/换图 409/幂等重放/删图 ABA 409/改入口 409；真实 DB 备份迁移 0005，清理后 4 站点/3 图标/4 预览 integrity ok。
- 发布：ZIP 111,744 B SHA-256 6472e855…、加载目录 51 文件逐字节一致、运行 1.8.0、4173 回环 release/download 哈希一致、v3 路由实活。
- 未测/未完成：含素材真机断网+完整重启、客户端同源图标端到端、429/认证真机注入、阶段 D 服务端公开图标 Job/CDN/ChatGPT 边界、正式商店发行（授权外）、Chrome/低内存 Debian/云端；不宣称全面验收完成。详见 docs/superpowers/plans/2026-11-18-phase-c-verification.md。
## 2026-11-18 阶段 D 候选 1.9.0（服务端公开图标 Job）

- 服务端：IconJob(0006) 按 site+入口来源指纹去重、captures 同事务只入队不抓取、autoIcon 可拒绝、run_jobs 融入 run_icon_jobs（生产复用 systemd timer）；执行器有界串行/租约防并发/只填空不覆盖/终态降级/基线取消/kept_existing，复用 favicons 每跳公网 DNS/端口/重定向/字节/像素/时间预算与 CDN/ICO/PNG/SVG 处理。refetch 只重排队、upload_local 高级本地 PNG/WebP。
- 本机 scripts/local_jobs.py：once/loop + jobs.log/pid/stop 进程控制，调用同一 SQLite 库，不另建库/不常驻 Node/Redis。deploy/README 记录生产 timer + 本机用法。
- 客户端：扩展 autoIcon、iconJob 透传、表单「已入库，图标获取中」、可拒绝补图；SW 无重复兜底排程。前端 iconJobState 卡片标记、详情后台说明、refetchIcon/uploadLocalIcon 例外恢复、api.request multipart。
- 回归：扩展 150（新增 2）、Django 178（新增 15）、前端 48（新增 5）、Sites 4、脚本 35（新增 3）；check 71 文件、前端 build、迁移无漂移、check 0 issues。
- 真机/真实 HTTP/真实调度：Edge 1.9.0「不要自动补齐图标」入口→「已入库，图标获取中」；真实收藏 0.05s 入队；本地调度器 once 与 loop(24 cycles,stop-file) 实际执行 Job；autoIcon=false 不入队；refetch/本地 PNG 上传 complete；千问 CDN/ChatGPT SVG/私网边界由既有 favicons 测试覆盖；真实 DB 备份迁移 0006、清理后 4 站点/3 图标/4 预览/0 Job integrity ok。
- 发布：ZIP 112,985 B SHA-256 b78874b3…，加载目录 51 文件逐字节一致、运行 1.9.0、4173 回环 release/download 同哈希、新路由实活，未另建库/未部署云端。Edge Add-ons 仅准备资料 docs/extension-store-readiness.md，未发布/不制造链接。
- 未完成：各候选真机重配对/账号切换/错误注入、含素材真实断网+完整浏览器重启、客户端图标端到端；真实公网 CDN 补图受本机 DNS 限制按设计有限重试→明确缺图；商店发布（授权外）、Chrome/低内存 Debian/云端。详见 docs/superpowers/plans/2026-11-18-phase-d-verification.md。
## 2026-11-18 阶段 D 补做（goal round 2）

真机 1.9.0 用受控回环夹具(127.0.0.1:4191 同源 PNG、scope 本机) 验证「浏览器能访问、服务器不能访问」边界：客户端同源图标端到端(截图+图标均客户端采集→v3 上传→DB preview+icon，无 IconJob)；含素材真实断网→关闭表单→完整浏览器重启→恢复(停 4173→本地已存→IndexedDB 只读确认任务+Blob 保留→杀全部 Edge→重启 4173→worker 自动补齐站点+preview+icon+notes，无重复)。清理后 4 站点/3 图标/4 预览/0 Job integrity ok，未改产品代码。证据 phased-client-icon.png / phased-offline-form.png / phased-restart-workbench.png，详见 docs/superpowers/plans/2026-11-18-phase-d-verification.md。仍缺 429/认证真机注入、真实公网 CDN(本机 DNS 受限)、真人重配对/第二账号(需配合)、商店发行(授权外)。
## 2026-11-18 阶段 D 补做（goal round 3）

真实公网 CDN 补图（无注入）：真实 4173 收藏千问页面→入队→本地调度器 once→run_icon_jobs 默认 fetcher 真实抓取 img.alicdn.com 80×80 PNG→只填空 80×80/1366B WebP→complete→工作台卡片渲染真实蓝色 Logo（/api/sites/<id>/icon 200 image/webp）。诚实缺图：3 次有界重试→终态 no_icon、0 图标资产、字母回退、无「图标获取中」。kept_existing：本地上传后迟到 Job 不覆盖（bytes/source/revision 未变）。例外恢复真机 UI：详情展开后 UIA 确认「重新排队补图」「上传本地 PNG/WebP 图标」，InvokePattern 点击只排队不覆盖；refetch/upload_local HTTP 200、备注分类保留。清理后 4 站点/3 图标/4 预览/0 Job integrity ok，未改产品代码。证据 phased-real-cdn-icon.png / phased-cdn-final.png / phased-recovery-expanded.png。仍缺 429/认证真机注入、真人重配对/第二账号、商店发行(授权外)。
## 2026-11-18 阶段 D 错误边界（goal round 3 续）

真实 4173 HTTP 边界注入（QA 设备/站点，不碰唯一真实配对、不改 DNS/代理/产品代码）：撤销 QA 设备后 Bearer 调 lookup → 401 auth_required（扩展 needs_auth 暂停）；连续越过只读端点 rate 上限 → 429 rate_limited（扩展 waiting_network 有界退避）；同 clientCaptureId 内容改动重发 → 409 idempotency_conflict（扩展 conflict 不覆盖）。清理后仅 3 个「我的浏览器」设备、4 站点/3 图标/4 预览/0 Job integrity ok。实体浏览器里对同一 Outbox 任务的 429/认证真机注入仍需用户配合重新配对。
## 2026-11-18 1.10.0（交互修正候选）。真实 Edge 整条路径与离线续传见 docs/superpowers/plans/2026-11-18-phase-e-verification.md。根因与修复：default_popup 缺失开新标签页；2560×1440 原始 PNG >700KB 静默丢弃 + submitDraft 丢 raw 截图 → 用户 19:11 真实收藏 YouTube preview=0。修复：default_popup、弹窗三态、8MB 有界原始快照、OffscreenCanvas 压缩兜底、`submitDraft` 保留 raw、recapture 原标签校验、compressPendingRaw 有界重试，前端 canViewScreenshot + 回归。独立 4174 库/profile/账号验收：Alt+Shift+S 7→7 无新标签页、截图已就绪、验收分类A + 备注 → 已同步、关弹窗刷新入库（1 站点/1 回执/预览 960×540 7512B）、查看截图大图 + 适应窗口/原尺寸/缩放。离线保存→关弹窗→仅重启 4174 自动续传 3 站点/3 预览/3 回执 integrity ok。日常 4173 数据保留（5 站点/4 图标/4 预览、3 我的浏览器设备）。发布 1.10.0 ZIP 114,814 B SHA-256 09551f05365a55f87f3194a539a6f3a6259a5d26f91450508d236a1155fee12d；4173 release/download 同哈希、日常 Edge 重载运行 1.10.0、加载目录 54 文件逐字节一致。回归：扩展 168、前端 57+Sites 4、脚本 35、后端 178、扩展 check 76 文件、前端 build、迁移无漂移、check 0 issues。四阶段仍候选，1.10.0 同为候选，不宣称全面验收完成。

## 2026-11-18 Round 4 追加验收（1.10.0 候选，未全面验收）

用户要求的「随后继续」项已在独立配置/测试库完成：独立 4174 SQLite + 独立 Edge profile3/4 + 独立测试账号/配对设备，日常 4173 数据全程隔离。真实公网首次收藏：千问 `https://qianwen.aliyun.com/`（内容丰富的蓝色双11页，预览 960×540 41184 B）与 ChatGPT `https://chatgpt.com/`，均走完整弹窗路径（截图已就绪 → 选「验收分类A」+ 备注 → 已同步），标签数点击前后不变、无新标签页；工作台 5 张 Logo 紧凑卡片 + 5 个「查看截图」按钮，点千问卡片打开真实大图查看器（适应窗口/原尺寸/缩放/重置）。自动补图：`runjobs --limit 4` 经独立 server.py 转发到独立库（不碰日常库），千问 IconJob 真实抓取 `img.alicdn.com` 得到 32×32 518 B WebP、HTTP 200 image/webp、工作台显示真实橙色阿里云 Logo；ChatGPT Job 返回 `kept_existing` 不覆盖已上传图标。非空队列升级：独立 profile 加载权威 1.9.0 ZIP（无 default_popup），配对 4174 后停服离线保存 2 条（选项页「待同步 2 条」）；原地替换同目录 51 文件为 1.10.0 的 54 文件（同路径同扩展 ID）、真人式点「重新加载」，重载后「当前版本 1.10.0」+ 同账号 + 「待同步 2 条」仍在；仅重启 4174、无用户动作/无重新配对，两条按有界退避先后自动续传，notes 精确保留，7 站点/7 图标/7 预览/7 回执无重复无丢失、integrity ok。截图不可用真机注入：仅回环 4192 高熵噪声页（2560×1440 随机 RGB PNG 11 MB）使原始快照超过 8MB 有界上限，弹窗显示「截图不可用」+「这次未附截图（当前页截图不可用），收藏仍可保存。」+「重新截图」；仍可选分类/写备注/收藏 → 已同步，独立库该站点 notes/分类精确、`preview.present=false`（诚实缺图不伪造、不阻塞文字），8 站点/7 预览/8 回执、integrity ok。Round 4 未改产品代码/发布物：ZIP 1.10.0 114,814 B SHA-256 09551f05365a55f87f3194a539a6f3a6259a5d26f91450508d236a1155fee12d，4173 release/download 同哈希，日常 Edge 运行 1.10.0。回归复跑：扩展 168、前端 57+Sites 4、脚本 35、后端 178 全绿，扩展 check 76 文件、前端 build、迁移无漂移、check 0 issues。日常 4173 数据复核：5 站点/4 图标/4 预览、3 个「我的浏览器」设备、notes/分类不变、integrity ok。剩余：未打包扩展依赖 Edge 开发人员模式（重启可能关闭，Phase A 环境约束）；正式 Edge Add-ons 仅准备资料未发布；Chrome/低内存 Debian/云端未测、不部署云端；「重新截图」切换页面拒绝与更早版本队列迁移仅回归覆盖；四阶段与 1.10.0 仍为候选，不宣称全面验收完成。详见 docs/superpowers/plans/2026-11-18-phase-e-verification.md 第六节。
