# 扩展与网站卡片：开发交接及验收计划

日期：2026-11-15。状态：设计交接，未实施。  
主规格：[完整设计](../specs/2026-11-15-extension-and-website-cards.md)。实现有歧义时先依据主规格；不能以本计划的简写省略权限、冲突、隐私与数据兼容约束。

## 开始前

- 阅读根 README、docs/project-state.md、docs/project-knowledge-base.md、docs/ai-context-map.md、prototype/AGENTS.md。
- 保存当前工作区基线：主要项目文件尚未被 Git 跟踪，不能用清理未跟踪文件、重置目录或覆盖正式库的方式建立“干净环境”。
- 独立临时数据库和测试账号完成开发验证，不读取/修改正式用户收藏，不在报告中输出 `.env.local` 或 `.local` 凭据。
- 保留现有视觉、Sites 模板文件和旧扩展 1.1.0 兼容；本次不是重新做浏览器书签管理器。
- 先执行现有测试记录真实基线，再实施。本文不包含任何新的“已通过”记录。

## 实施顺序

### A. 契约与数据

主要位置：server/workspace/models.py、validation.py、library.py、extension.py、migrations/、config/urls.py。

先新增简介字段与预览资产/附件回执模型，固定协议 2 的请求指纹、字段更新白名单、expectedVersion、附件写权限及错误码。新接口独立于旧 captures；检查分享白名单和导出路径，不让新增 payload 字段绕过限制。单独实现媒体模块，避免继续堆进 extension.py。

完成条件：旧客户端仍工作；双账号不可交叉读写；重复/版本冲突可预测；字段与媒体不超过现有 payload 限制；迁移可增量上线。

### B. 私有媒体与备份

主要位置：新增 server/workspace/ 下媒体服务模块、scripts/backup.py、backup_crypto.py、build_release.py、deploy/。

实现上传验证、重编码、配额、原子替换、鉴权读取、GC 和版本化备份。增加图片库依赖时锁定经过验证的版本，服务端解码内存需实测。数据库快照与媒体引用的一致性先解决，再开始收集真实截图。

完成条件：拒绝伪类型/恶意尺寸/越权；失败仍可显示旧图；回执重复不重复计费；完整备份可独立恢复；不暴露公开 media 目录。

### C. 扩展收藏与附件状态机

主要位置：extension/manifest.json、popup.*、api.js、queue.js、engine.js、service-worker.js；新增描述读取/截图/附件存储模块。

保留旧文字队列和书签导入；升级协议与队列先做迁移设计。添加 scripting、主 frame 元描述白名单、URL/标签稳定性复核、截图预览、IndexedDB Blob、附件 ID 与串行重试。不在 popup 直接上传绕过队列。

完成条件：关闭弹窗/浏览器后文字和附件可恢复；换账号不转投；明确局部成功；重复收藏不隐式上传覆盖；无截图依然可用。

### D. 工作台卡片与详情

主要位置：prototype/src/components/SiteCard.jsx、SiteDetail.jsx、SiteForm.jsx、WorkspaceContent.jsx、model.js、useWorkspace.js、styles.css。

增加简介编辑和检索、预览图、地址、来源/日期、缺图状态与媒体操作。保持默认入口、多入口、回收站和 dialogStack 行为。图片使用同源鉴权，限制渲染和请求数量，禁止公开分享复用私人图 URL。

完成条件：完整四要素均有真实内容或诚实占位；各尺寸和键盘可操作；刷新后数据一致；旧 purpose 语义不变。

### E. 扩展中心与发布

主要位置：prototype/src/components/DevicesSettings.jsx、DirectBrowserImport.jsx、SettingsDialog.jsx；server/workspace/downloads.py；extension/README.md；scripts/build_release.py。

增加下载清单、安装向导、配对和版本状态；构建稳定 ZIP 与 sha256、原子切换产物；确保运行白名单包含新模块。安装步骤和 UI 不能写“下载即安装”或“自动安装”。

完成条件：发布物无需服务器 Node，ZIP 不含秘密；新旧 API 兼容窗口；升级/回退实操保留身份与待同步任务。

## 必须补充的测试矩阵

| 层次 | 重点场景与证据 |
| --- | --- |
| Django API | 新旧协议、字段显式更新、冲突、回收站、关系校验、身份和回执归属 |
| 媒体服务 | 真实解码坏图/伪 MIME/超尺寸、配额竞争、原子替换、缓存头、私有读取、源 URL 改变 |
| 扩展纯逻辑 | 首页/当前页判定、描述竞态、队列升级、任务指纹、Blob 丢失、存储失败和权限撤回 |
| HTTP 集成 | 文字确认后附件失败/丢响应重试、撤销设备、同账号重新配对、旧协议仍成功 |
| 前端行为 | 简介检索、缺图、错误反馈、部分成功、长文本、两种视图、多入口与版本冲突 |
| 打包与恢复 | ZIP 哈希、文件白名单、无秘密、旧备份恢复、新备份媒体摘要、备份/GC 互斥 |
| Chrome 实测 | 下载→加载→权限→配对→首页捕获→上传→刷新卡片→重启恢复→更新 |
| Edge 实测 | 同上独立执行，不把 Chrome 的结果复制为 Edge 通过 |
| 实机资源 | 原目标低内存环境中记录峰值内存、磁盘、上传/重编码耗时、并发和限额实际值 |

建议回归命令（由实施 agent 实际执行并记录输出）：

```powershell
.venv/Scripts/python.exe server/manage.py check
.venv/Scripts/python.exe server/manage.py makemigrations --check --dry-run
.venv/Scripts/python.exe server/manage.py test workspace.tests enhancements
.venv/Scripts/python.exe -m unittest discover -s scripts/tests
npm --prefix prototype test
npm --prefix prototype run build
npm --prefix prototype run test:sites
npm --prefix extension test
npm --prefix extension run check
```

若新测试需额外设置，必须记录原因和环境，不能通过跳过失败项标记整套通过。自动化网络/浏览器替身与真实 Chrome/Edge 结果分别写明。

## 交付清单

1. 实现代码、增量迁移、锁定依赖和可复现发布包。
2. API 字段/错误码文档、队列迁移策略、版本兼容表。
3. 独立测试数据的截图与录制：扩展弹窗、截图确认、配对安装页、正常/无图/失败卡片、移动布局。
4. 实际测试命令与结果，未验证项明确列出，特别是企业策略/其他 Chromium 浏览器。
5. 含图片备份恢复报告、升级与回退步骤、图片磁盘配额/清理说明。
6. 更新根 README、扩展 README、项目状态/知识库/变更记录/上下文地图；不能把设计状态直接改为已实现。

## 本次文档交付的边界

本次只新增主规格与本实施计划，以及文档导航记录；未调整代码、权限清单、数据库、发布包、正式服务或部署。用户已要求把开发交给其他 agent；后续实施不得把这份文档的存在当作已完成开发或生产验收。
