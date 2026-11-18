# 真实系统实施证据与维护记录

## Context

真实私有应用，高风险；实施与本地验证有用户授权，正式生产验收待实机。

## Task Contract

Identifier: 2026-10-26-persistent-workspace
Governing-rule source / location: 本会话用户授权、prototype/AGENTS.md、spec-driven-ai-dev、code-ownership。
Resolved spec-driven-ai-dev path: C:/Users/阿俄拉伍/.agents/skills/spec-driven-ai-dev/SKILL.md
Resolved companion version or content hash: v1.5.0；SHA256 AFAB3B310CD7B4FE0147CDAF22DB2E9CD90BF1A3FE01AE40E17E50C4037B67E4。
Same-name conflict resolution: 延续会话已选 .agents v1.5.0；.codex 同名旧版的 SHA256 12379AA91E111D94F2C9D0953F803448406CA72857091F0407DCA5CB2DB56E17，不混用政策。
Companion activation: spec-driven-ai-dev loaded and applied
Companion activation evidence: 2026-10-25 原型及真实系统计划读取；2026-10-26 续作再次读取选定 SKILL.md、验证矩阵、项目状态与地图，本会话工具输出。
Reduced-assurance fallback reason: N/A — 不申请证据豁免。
Risk record location: 本节；implementation/high，涉及真实私有资料、认证、网络抓取、凭据和备份；用户已授权并执行云端回环部署，人的正式维护移交尚未发生。

Contract location: docs/superpowers/plans/2026-10-25-persistent-workspace.md。
Goal: 已认可界面连接真实多用户私有资料与浏览器快速收藏；适配用户单核约 700MB Debian 12。
Authorization: 用户“这个方案以最完整的形态进行实施”“选1，开始实施”“没问题，继续”及后续“继续”；用户确认多人独立空间和独立密码管理器。
Boundary: 第三方密码不进入普通字段；不创建默认正式管理员；仅记录实际云端回环运行，不声称公网 HTTPS、外部 AI、邮件或完整路线全部完成。
Accountable human owner: 项目发起用户，尚未提供实名；不编造维护身份。

## Change Map

| Location | Change | Reason | Acceptance ID | Owner |
| --- | --- | --- | --- | --- |
| server/ | 真实身份、私有资料、扩展、增强和迁移 | 持久化与按账号管理 | AC-1 | 实施代理；最终维护人待定 |
| prototype/src/ | API、认证、真实设置、分享和增强界面 | 保留选定视觉并接通数据 | AC-2 | 实施代理 |
| extension/ | 最小权限配对与离线幂等收藏 | 浏览器快速收入网站 | AC-3 | 实施代理 |
| deploy/、scripts/ | 低内存配置、流式加密备份、发布工具 | 700MB 约束与恢复 | AC-4 | 实施代理；运维责任待定 |

## Traceability Table

| Acceptance ID | Implementation Location | Evidence Method | Actual Result | Status |
| --- | --- | --- | --- | --- |
| AC-1 | server/ | tests run — cd server 后 ../.venv/Scripts/python.exe manage.py test workspace enhancements -v 1 | 2026-10-26，67 项通过；命令与范围见 implementation-verification.md，本会话工具输出 | complete |
| AC-2 | prototype/ | tests run — npm --prefix prototype test；npm --prefix prototype run test:sites | 2026-10-26，17+4 项通过；同上 | complete |
| AC-3 | extension/ | tests run — npm --prefix extension test | 2026-10-26，23 项通过；实际扩展安装未运行 | complete |
| AC-4 | scripts/ | tests run — .venv/Scripts/python.exe -m unittest discover -s scripts/tests -v | 2026-10-26，26 项通过，含 36MiB SQLite 往返 | complete |
| AC-5 | frontend/build | static checks run — npm --prefix prototype run build；npm --prefix extension run check；manage.py makemigrations --check --dry-run | 2026-10-26，构建/扩展检查通过，迁移无漂移 | complete |
| AC-6 | 本地真实 UI | manual checks run — 实施代理在 Windows IAB 独立测试库登录、收藏、账号说明、刷新、退出重登和设置检查 | 2026-10-26，资料持久化、日志无 error/warn；截图 prototype/qa/persistent-workspace-2026-10-26.png | complete |
| AC-7 | Debian/实体扩展 | not run — 无实际主机连接，扩展权限须用户浏览器确认 | 2026-10-26，需实机资源/权限/恢复/HTTPS 验收，不宣称通过 | not run |
| AC-8 | 人的最终体验与维护 | not run — 原型已认可；真实系统最终验收和维护责任尚待人工确认 | 2026-10-26，不代人填写 accepted | not run |

## Decisions and Invariants

Decisions: SQLite WAL/单 worker/预构建前端；后台任务串行；网站资料分页与体积有界；设备摘要白名单；独立密码管理器。
Provenance: AI 实现、Django/React 官方依赖、Phosphor/公开品牌资产、内置 ImageGen 头像；详细来源见 prototype/public/assets/SOURCES.md。
Scope deviation: 低内存条件替代早期 Next.js/PostgreSQL 建议；未实现 AI、邮件、原生书签同步和移动系统分享入口，已记录真实范围。
Review: 原型有独立只读复核；本轮完整审查代理额度失败，当前为主代理自查与实际验证，不记独立通过。

## 60-Second Handoff

Owner acceptance: pending — 本地体验与技术证据齐备，正式维护移交未接受。
Owner confirmation reference: 用户认可原型并授权继续，不冒充真实系统最终接受。
Confirmation date: 未发生正式维护接受。
Accountable human owner: 项目发起用户，真实姓名与维护角色待确认。
Backup owner: 未指定。
Reviewers: 实施主代理；完整系统独立审查未完成。
Decisions: SQLite、单 worker、有界抓取与分页、独立密码管理器。
Flow: 网页 session/CSRF 或扩展 bearer → 用户归属/DTO 校验 → SQLite → 页面；增强抓取与任务有资源限制；快照独立加密恢复。
Failure point 1: 登录或初始化失败；先查 server/workspace/identity.py、config/settings.py、私有环境的 origin/cookie/初始化开关，不输出秘密。
Failure point 2: 收藏失败或资料冲突；先查 workspace/library.py、extension.py、前端 api/workspace-loader，确认 owner、version 和 clientCaptureId。
Failure point 3: 备份或监控失败；先查 scripts/backup.py、backup_crypto.py、enhancements/jobs.py 与 systemd timer 状态；不覆盖现有数据库。
Future edit locations: ai-context-map.md 给出模块、变更点与测试联动。
Verification: implementation-verification.md 的 137 项测试、构建、迁移及页面检查。
Rollback: deploy/README.md 的停服务、独立还原、WAL/SHM 整体回退；代码未提交，勿强制重置工作区。
Known gaps: Debian/实体扩展/5000 条性能/最终人验收；未配置云连接及 Git 作者。

## Synchronization and Closure

Project state: docs/project-state.md。
Change log: docs/project-change-log.md。
Knowledge base: docs/project-knowledge-base.md。
AI context map: docs/ai-context-map.md。
Closure decision: 提供本地真实应用与候选部署包；不宣称完整路线、正式维护移交或生产验收完成。
Closure authority/reference: 本会话实施授权，最终人的接受尚未记录。
Open follow-up: 用户设置正式管理员并实际体验；真实浏览器安装/配对；后续主机、域名及维护责任确认。

## Operations and Rollback

本机 4173 前端和 8000 后端保留；独立 UI QA 的 8001 进程结束，不成为常驻生产进程。生产目录只读、数据目录私有；生成的配置和 BACKUP_KEY 不入发布包。监控、异机备份、每月独立恢复演练及版本回退步骤见 deploy/README.md。

## Known Gaps and Waivers

没有证据豁免，也不借豁免代替人的接受。未验证项及影响已在 implementation-verification.md 列出。维护身份、备用人、accepted 与日期不能由代理捏造，结构校验应保留相应失败事实。

结构校验：2026-10-26 实际执行 validate_ownership_record.py，退出 1，仅余 accepted、真实负责人/备用负责人、接受日期 4 项；没有将未接受登记为通过。技术验证与生产验收范围见 implementation-verification.md。

## 实机部署补充证据

用户提供服务器登录方式并确认暂无域名，构成继续部署的明确指示；未将用户凭据持久化。2026-10-26 已按其指示启动回环服务和两个 timer，经 SSH 隧道打开页面，实际加密备份/独立恢复与合成 5000 条分页检查通过，证据见 debian-deployment-2026-10-26.md。当前仅能声称相应云端运行事实；人的账号设置、实体扩展、域名 HTTPS 与正式维护 accepted 仍未发生。

## 公网部署补充（2026-10-26）

用户明确要求“直接通过IP端口访问，不通过ssh”，授权公开入口。已按其指示部署可信 IP HTTPS，不改变账号私有库与初始化验证。新增 Nginx/续期配置和可信代理限流修复，变更与回退见 public-ip-deployment-2026-10-26.md。69 项后台测试、公网 TLS/HTTP、安全 cookie、错误拒绝、续期 dry-run 和实际证书发布/reload 均有本轮工具证据；CUA 超时未记为浏览器通过。正式人工体验/维护 accepted 不由部署授权自动代替。

## 浏览器导入变更记录

2026-10-26 用户明确要求来源选择并确认 ego lite；按已认可文件导入边界实施，无重复审批。范围、来源、72/21/4 项测试、独立 UI 与云端发布/回退见 browser-import-verification-2026-10-26.md。没有读取或上传用户真实浏览器数据；没有创建真实管理员或伪造维护接受。原负责人/备用人/accepted/日期仍按实际待人工确认。

## 原生收藏导入补充（2026-10-26）

用户反馈不应要求普通用户定位数据文件，沿用明确的实施与部署授权，改为扩展 1.1.0 自主授权/getTree/本机预览/确认/自动批次/原 UUID 恢复；文件入口折叠。风险：可选浏览器权限、设备写接口及跨账号任务；边界与回退详见 native-import-verification-2026-10-26.md。

Evidence: tests run — cd server; ../.venv/Scripts/python.exe manage.py test --verbosity 1（78 通过，隔离库真实 HTTP 500 条整批）；tests run — npm --prefix extension test（29 通过）；tests run — npm --prefix prototype test / run test:sites（21+4 通过）；static checks run — node extension/scripts/check.mjs / npm --prefix prototype run build（通过）；manual checks run — IAB 合成 UI/独立 QA 库入口检查（代理执行，非真人原生授权）；not run — 真实 Chrome/Edge/ego(lite) 安装/权限弹窗/真实用户收藏读取（由用户操作）。

云端备份成功，27 文件哈希匹配，公网资源一致/匿名接口 401；部署运行事实不自动视为人的 accepted。维护身份/备用人/接受日期仍保持未确认，不伪造 Gate 6/7 接受。

追加验证：2026-10-26 Python 3.11 AST/全部手写应用源文件 300 行限制通过；build_release.py 候选包与秘密扫描通过。ownership 结构校验仍退出 1，仅真实负责人、备用人、accepted、接受日期四项待人工，不将其登记为通过；临时 8001/8002 服务和测试标签已关闭。
