# 不用数据文件的浏览器收藏导入

2026-10-26。用户指出普通用户无法定位浏览器数据文件，本轮把扩展读取作为主流程；实施及云端更新沿用用户已有授权。文件导入收起为备用。技术运行证据不替代真实浏览器安装授权、人的体验和正式维护接受。

## 行为与维护入口

- 网页「设置 → 资料与导入」优先展示连接扩展和直接导入步骤，文件输入在关闭的 details 中。`DirectBrowserImport.jsx` → `SettingsDialog.jsx` → `DevicesSettings.jsx`。首次下载/更新 1.1、解压加载并配对一次；尚未发布商店，不能声称免安装。
- 扩展 popup 打开 `bookmarks.html`。用户点击才申请 optional bookmarks 权限并调用 getTree，本机预览全部或指定目录；确认前无上传。只复制 title/url/folder，不改原收藏，不读历史、Cookie、密码。授权提示可能包含“更改”，本实现没有写书签 API。
- `bookmark-data.js` 过滤 HTTP(S)/带凭据 URL、本机去重，最多 10000 条/4MiB。显式栈限制 50000 节点/64 深度；目录选项最多 2000。超出上限拒绝并提示。
- `bookmark-engine.js` 的 workspaceState.bookmarkImport 持久保存原服务器/用户、批次 UUID、剩余内容与结果。每批 500 条、自动推进，丢响应按原批次重试。换账号不转投；同账号重新配对可恢复。关闭页面暂停推进，再打开继续。停止保留已提交收藏，只删除剩余本地快照。
- worker 与普通收藏共用 serial()，防止账号切换/队列覆盖；不添加网页消息桥接或 content script。bookmarks 权限可从导入页撤回。
- `POST /api/extension/bookmarks/import` 只接受设备 Bearer。后端 `native_bookmarks.py` 白名单 DTO、按用户 URL 去重，整批事务与 ImportJob 小回执原子提交；UUID/用户/原始内容 SHA256 绑定，重复返回原结果，内容变化 409，跨用户/网页导入任务 404。不新增模型迁移。
- `downloads.py` 白名单 ZIP 新增四个运行文件，1.1.0 manifest 可选权限，与部署源文件一起更新。

## 已执行证据

| 检查 | 命令/步骤 | 实际结果 |
| --- | --- | --- |
| 完整后台 | cd server; ../.venv/Scripts/python.exe manage.py test --verbosity 1 | 78 项通过，含原子配额失败、字段/协议拒绝、所有者、同账号换设备、UUID 回执冲突与真实 HTTP 的 500 条整批/重试/后续去重；隔离测试库 |
| 扩展 | npm --prefix extension test; npm --prefix extension run check | 29 项通过；Manifest/资源/PNG/语法/300 行通过；权限与浏览器接口为受控替身 |
| 网页 | npm --prefix prototype test; npm --prefix prototype run test:sites; npm --prefix prototype run build | 21+4 项通过；构建 index-D_cvCnyI.js / index-23ku3Psv.css |
| 扩展合成 UI | IAB → .local/native-import-ui-qa/bookmarks.html，点击读取/选择目录/确认/继续 | 1001 条，预览时 0 上传；模拟首批响应丢失，重试后 4 请求/3 唯一回执，3/3 批、1001 新增；未调用真实浏览器收藏 API |
| 网站 UI | 独立 ui-qa SQLite，设置 → 资料与导入 → 连接或更新扩展 | 默认推荐入口和关闭的文件备用入口；按钮进入扩展安装/更新与配对指引。两测试页 error 日志为空 |
| 公网 | Python urllib 默认可信 TLS 请求首页/两个新静态文件，SHA256 对比；匿名 POST 新接口/GET ZIP | 首页/静态 200 且字节一致；两私有入口 401 auth_required。未写入实际账号或读取真实收藏 |
| 服务器 | 备份 service / SHA256 清单 / systemd | 备份 Result=success；27 文件全部匹配；两个服务 active、NRestarts=0，应用 47702016 字节、入口 4120576 字节（瞬时观察） |

截图：`prototype/qa/native-import-entry-2026-10-26.png` 和 `native-import-complete-2026-10-26.png`，均是隔离合成测试，不是真实用户收藏；临时 QA 页已关闭。

新测试实现前缺少模块/接口失败；批次归一 DTO 随机端点 ID 曾造成指纹不稳定，回归暴露后改为原始白名单内容指纹与稳定端点 ID。确认后隐藏旧预览，避免上传后仍显示“尚未发送”。后续检查保留这些约束。

## 云端变更与回退

地址 https://203.0.113.10:8443/ 。补丁 152379 字节、27 文件，SHA256 `a6cb984e1fa4ebe2e8121f8e519f75e2ee63ee9fe8de688808bbf6938d60f8f4`。校验压缩包成员固定白名单/普通文件/大小/相对路径，在 root 私有目录解包；Debian 3.11.2 不使用不支持的 extractall(filter=...)。

旧 urls.py、downloads.py、index.html 与完整 extension 备份在 `/root/website-workspace-native-import-20261026/before-code.tar.gz`。先更新后台/扩展、重启并查会话健康，再原子切换首页；保留旧静态哈希文件。首次重启后的即时 curl 在监听建立前短暂失败，随后健康检查 200、NRestarts=0、日志无启动错误，未误报失败检查为通过。没有改配置、TLS、其他服务或业务库。实际清单 `/opt/website-workspace/NATIVE-IMPORT.sha256`，记录追加在 DEPLOYED.md。

回退时停止本应用，从上述受控备份还原 urls.py、downloads.py、index.html 和 extension，再启动并验证首页/原接口。native_bookmarks.py 未引用文件可保留；不要恢复覆盖正在使用的业务数据库，已导入收藏由用户正常管理。代码无真实 Git 作者身份，未伪造提交。

## 来源与未运行

- Google 官方：https://developer.chrome.com/docs/extensions/reference/api/bookmarks ，https://developer.chrome.com/docs/extensions/reference/api/permissions 。
- ego(lite) 官方 https://lite.ego.app/zh-cn 说明基于 Chromium、书签/扩展沿用 Chrome 行为；据此采用同一 MV3 方案，兼容性仍需实体浏览器验收。
- 未运行：真实 Chrome/Edge/ego(lite) 扩展安装、原生权限弹窗、实际用户收藏读取、浏览器重启/休眠、极大书签树与长期低内存并发性能。没有代用户授权或读取真实 Profile。
- 保留待办：用户更新扩展并在自己浏览器授权/体验；商店分发尚无发布账号；真实维护负责人/备用人及 accepted/日期不能由代理代填。

追加验证：2026-10-26 Python 3.11 AST/全部手写应用源文件 300 行限制通过；build_release.py 候选包与秘密扫描通过。ownership 结构校验仍退出 1，仅真实负责人、备用人、accepted、接受日期四项待人工，不将其登记为通过；临时 8001/8002 服务和测试标签已关闭。
