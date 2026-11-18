# 网站资源工作台

把云端服务、本地入口和常用第三方网站收进自己的空间，按用途、备注、别名和标签找回。支持多人登录，每个账号独立管理资料；网站密码继续交给独立密码管理器。

当前云端应用：[公网 IP HTTPS 工作台](https://203.0.113.10:8443/)，不需要 SSH 隧道。开发机另有[本地工作台](http://127.0.0.1:4173/)。首次打开由你设置管理员账号；也可进入[独立演示](http://127.0.0.1:4173/?demo=1)。正式库没有预设管理员或示例收藏。

## 已实现

- 邀请注册、登录退出、账号停用、密码更新和一次性恢复链接。
- 私有网站库、用途检索、分类标签、工作集、置顶、收件箱、归档和回收站。
- 一个网站多个访问入口、默认入口、账号用途、登录方式与登录页关联。
- Chrome/Edge/ego(lite) 等来源选择、HTML/Chromium Bookmarks JSON 导入预览、跳过重复、幂等提交和完整 JSON 导出。
- Chrome/Edge MV3 扩展、设备配对/撤销、工具栏小弹窗（留在当前页，不打开新标签页）+ 单一 IndexedDB 发件箱 + 迁移备份、按原账号绑定的离线队列（关闭弹窗后自动续传）；截图三态预览与工作台「查看截图」大图查看器；截图/客户端图标按独立 revision 条件写入、缺图服务端公开图标 Job 后台补齐（1.10.0 交互修正候选）。正式商店发行仅准备资料、未发布，1.9.0 不宣称全面验收完成。
- 主区不设工作台级最大宽度、统一内容轨道与按可用宽度计算的均衡网格；真实用户分类筛选、显示设置 popover、真实网站 Logo 与历史缺图修复。
- 主动首页/当前页截图、私有 WebP 预览、网站 Logo 主体卡片、独立截图查看器与可调宽度；历史用途保持不变。
- 可撤销且有期限的分享、公开入口检查、纯文本快照、可选定时监控和站内到期提醒。
- SQLite WAL、分批读取、串行定时任务、含引用图片的流式加密备份、延迟媒体清理和独立恢复工具。

## 文档入口

- [工作台展示优化第二版](docs/superpowers/specs/2026-11-17-workspace-polish-v2.md)：宽屏布局、真实网站图标、筛选与全站细节，已实现并完成本机 Edge 验收。
- [最新卡片与截图查看修订](docs/superpowers/specs/2026-11-17-logo-cards-and-screenshot-viewer.md)：2026-11-17，网站 Logo 主体、独立查看截图、可调尺寸与响应策略，已实现。
- [最新用户体验修订与开发提示词](docs/superpowers/specs/2026-11-16-frictionless-bookmarking-revision.md)、[Logo 设计资产](docs/brand/README.md)：2026-11-16 用户反馈，已实现接入。
- [扩展与网站卡片升级设计](docs/superpowers/specs/2026-11-15-extension-and-website-cards.md)、[开发交接与验收计划](docs/superpowers/plans/2026-11-15-extension-and-website-cards.md)：需求与验收基线；实现约定见[协议 2、私有图片与运维文档](docs/extension-v2-and-media.md)。真实浏览器本机已验收，生产验收待执行。
- [Debian 12 部署与恢复](deploy/README.md)：面向单核约 700MB，推荐 Caddy + 单 worker Gunicorn + SQLite；服务器无需 Node。
- [实际验证与限制](docs/implementation-verification.md)：命令、结果和未实测项。
- [扩展安装与使用](extension/README.md)：解压后由用户在浏览器中加载、授权和配对。
- [稳定收藏架构与分阶段验证](docs/superpowers/specs/2026-11-18-stable-capture-architecture.md)：[阶段A](docs/superpowers/plans/2026-11-18-phase-a-entry-verification.md) / [阶段B](docs/superpowers/plans/2026-11-18-phase-b-verification.md) / [阶段C](docs/superpowers/plans/2026-11-18-phase-c-verification.md) / [阶段D](docs/superpowers/plans/2026-11-18-phase-d-verification.md)；均为候选版本，未全面验收。
- [Edge Add-ons 正式发行准备](docs/extension-store-readiness.md)：仅准备资料，未发布、不制造商店链接。
- [前端开发](prototype/README.md)、[项目状态](docs/project-state.md)、[模块地图](docs/ai-context-map.md)。

## 本地开发

当前代理已启动服务，无需重复执行。重启或换开发机时，在根目录建立 Python venv 并安装 requirements.txt，使用 scripts/generate_env.py 生成独立配置，再执行迁移。Windows 后端使用 Waitress，Linux 生产使用 Gunicorn。

```powershell
.venv/Scripts/python.exe server/manage.py migrate --noinput
cd server
../.venv/Scripts/python.exe -m waitress --listen=127.0.0.1:8000 --threads=2 config.wsgi:application
```

另一个终端在 prototype/ 执行 npm ci 和 npm run dev -- --host 127.0.0.1 --port 4173 --strictPort。Vite 将 API 与扩展下载转发至 8000。构建后，后台 8000 也可直接提供完整页面。

已部署 Debian 公网 IP HTTPS 并通过证书、请求、权限和续期演练；人的最终体验与维护验收仍待完成。外部 AI 语义搜索、邮件通知、原生书签双向同步和移动系统分享入口仍在后续路线；当前检索无需 AI 或外部凭据。数据库资料不是端到端加密，服务器维护者需妥善保护数据目录和备份密钥。
