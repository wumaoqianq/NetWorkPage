# 网站工作台真实系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把已通过用户体验的第 1 版界面接入真实登录、按用户隔离的持久网站库与浏览器收藏扩展，并准备 Debian 12 低内存部署。

**Architecture:** 保留 React/Vite 前端，Django 5.2 LTS 提供会话认证和 JSON API。按用户过滤所有网站资料，默认 SQLite WAL 持久化；正式服务器为单核约 700MB，静态前端在开发机预先构建，后端单 worker、少量线程，后台任务限量串行，不常驻数据库或 Node 服务。

**Tech Stack:** React、Django 5.2 LTS、SQLite；外置 PostgreSQL 适配暂未实现；Chrome/Edge Manifest V3；Debian 12 systemd、Gunicorn、Caddy。

## 已确认与默认调整

- 用户“没问题，继续”确认原型视觉和流程，授权接入正式系统。
- 用户明确生产环境为单核 CPU、约 700MB 内存的 Debian 12。
- SQLite 代替同机 PostgreSQL 作为默认；同机不使用 Redis、向量库或常驻 AI 模型。
- TypeScript/Next.js 是早期建议而非用户硬约束；保留现有页面，采用成熟 Django 认证，避免重做 UI 和自创密码认证算法。
- 独立密码管理器保存网站密码的边界保持不变。
- 本轮不创建默认管理员密码；首次启动由用户在初始化页设置账号。

## 文件职责与并行边界

| 区域 | 文件范围 | 责任 |
| --- | --- | --- |
| 后台 | server/ | 配置、数据模型、会话、邀请、私有网站库、组织、导入导出、扩展 API 与测试 |
| 前端 | prototype/src/、prototype/vite.config.mjs | 真实 API 接入、初始化与登录、真实状态及设置；保留演示入口 |
| 扩展 | extension/ | 用户主动收藏、配对、凭证、重复提示、离线队列与账号绑定 |
| 部署 | deploy/、scripts/、requirements*.txt | 依赖锁定、低内存 systemd、可选 Docker、发布包、备份恢复 |
| 增强 | server/workspace/enrichment/ 等独立模块 | 受限抓取、检查、提醒与共享；在基础 API 稳定后实现 |

## 稳定 API 契约

所有 JSON 错误响应为 `{ "error": "中文说明", "code": "stable_code" }`。浏览器写操作必须有 Django CSRF；扩展只用独立设备 bearer token，不共用网页 cookie。

- GET /api/auth/session → `{user, setupRequired, csrfToken}`；user 为 null 或 `{id,email,name,isAdmin}`。
- POST /api/auth/setup，/login，/logout，/register；setup/login/register 返回 `{user}`。
- POST /api/auth/invites（管理员）；GET /api/auth/invites/:token；GET /api/auth/users；PATCH /api/auth/users/:id。
- GET /api/workspace → `{sites,siteCount,nextSitePage,collections,categories,recent,user}`，首批最多 250 条，GET /api/sites?page=N&limit=250 读取后续 `{sites,nextPage,userId,siteCount}`，用户网站数量上限默认 10000，可配置，杜绝无界返回。
- GET/POST /api/sites；GET/PATCH/DELETE /api/sites/:id；DELETE 仅对回收站记录永久删除。
- 网站 DTO 与已确认前端保持一致：id、name、purpose、notes、aliases、tags、category、kind、icon、pinned、inbox、archived、deleted、endpoints、accounts、collections。
- endpoints 为 `{id,label,url,scope}`；accounts 为 `{label,username,method,notes,endpointId?,loginUrl?}`。网址仅 http/https，拒绝 URL 中的用户名密码。
- POST /api/visits → `{siteId,endpointId}`；仅记录当前用户从本站打开的资料。
- POST/PATCH/DELETE /api/collections 与 /api/categories 管理当前用户组织资料。
- POST /api/imports/preview → `{content,format}`，format 为 json 或 html；返回预览任务 id、count、duplicates、preview、warnings。
- POST /api/imports/:id/commit；GET /api/exports；预览与提交都验证当前用户，提交幂等且原子。
- POST /api/extension/pairing-code → `{code,expiresAt}`；POST /api/extension/pair → `{code,name}`，返回 `{token,user,device,expiresAt}`。
- GET /api/extension/devices；DELETE /api/extension/devices/:id；GET /api/extension/lookup?url=...（bearer）。
- POST /api/extension/captures（bearer）→ `{clientCaptureId,url,title,purpose,updateExisting?}`，返回 `{site,duplicate}`。

## Task 1：成熟认证与持久网站库

- [x] 先添加 Django 测试：未登录返回 401，跨用户详情/编辑/删除/导出不能访问，CSRF 缺失拒绝写入。

```python
response = self.client.get(f'/api/sites/{other_site.pk}')
self.assertEqual(response.status_code, 404)
```

- [x] 实现邀请、首次管理员初始化、登录退出、会话、强密码校验与限流。
- [x] 实现按用户过滤的持久站点 DTO、组织资料、归档、回收站与访问记录。
- [x] 实现 JSON/HTML 导入预览与幂等提交，完整 JSON 导出。
- [x] 实现设备配对码、30 天设备凭证、撤销与收藏幂等。
- [x] 使用 Django 测试数据库执行集成测试；逐项验证权限、凭据失效和重复提交。

## Task 2：浏览器扩展

- [x] 先测试队列原账号隔离、服务器地址校验、失败保留和幂等 capture id。
- [x] 实现 MV3 popup、options、service worker，权限只在用户配置服务器时申请。
- [x] 通过配对码连接；收藏自动带当前地址和标题，支持用途说明和重复更新。
- [x] 断网保存待同步；服务器与用户身份绑定，切换账号不得转投旧队列。
- [x] 构建可加载的扩展目录与可下载 ZIP；浏览器安装由用户自行完成。

## Task 3：真实前端接入

- [x] API helper 处理 CSRF、认证失效和可见错误；会话初始化后载入私有资料。
- [x] 首次初始化、邀请注册、登录、退出以及个人资料；不预设管理员密码。
- [x] 保存成功后才关闭表单；写入失败保留输入，不能仅在前端假装保存。
- [x] 真实组织、导入导出、设备配对与撤销、管理员邀请及账号管理接入设置。
- [x] 保留 ?demo=1 的独立演示模式，正式模式新用户从空库开始，可显式导入示例。
- [x] 刷新与退出重登录后数据库资料不丢失，用户之间不会出现其他人的数据。

## Task 4：低内存部署与增强能力

- [x] 提供本机构建发布包，Debian 12 只解包、安装 Python 依赖并启动单 worker。
- [x] 生产环境默认 HTTPS、安全 cookie、受信任代理、配置独立密钥，禁止公开匿名初始化抢占。
- [x] systemd service 配置内存限制和自动重启；串行后台任务以 timer 触发。
- [x] 受限网络抓取必须阻断内网、回环、链路本地、云元数据和重定向绕过。
- [x] 共享默认仅分享网站公开资料，账号说明单独授权；监控状态明确检查来源和时间。
- [x] 加密备份与独立恢复验证；保留 7 个日备份和 4 个周备份。
- [x] AI/邮件/云端发布等外部依赖在有实际凭据或域名时接入，不伪造已连接状态。

## 验证与证据

运行 Django 集成测试、扩展 Node 测试、已有前端测试、构建、运行时测试、浏览器页面检查和只读审查。
Docker 或原生低内存配置应记录实际内存测量；真实 Debian 12 主机未提供连接时，不声称已上云部署。
项目记录同步实际已完成模块、仍需配置项和完整产品待办。继续在当前功能分支开发，缺少 Git 作者身份时不编造提交。

## 2026-10-26 实施核对

上述勾选表示相应代码和自动验证已实施，不代表部署或人工验收。第 4 项外部 AI/邮件/云发布仍未接入，保持真实未连接状态；个人资料当前只展示身份与改密，不含独立资料编辑。实体扩展安装、Debian 资源/5000 条性能验收仍待实机。最新实际状态以 docs/project-state.md 与 implementation-verification.md 为准。
