# 浏览器书签导入验证（2026-10-26）

用户明确要求选择 Google Chrome、Edge、ego 等来源导入，随后确认名称为 ego lite。本轮通过文件导入实现，网页不尝试枚举电脑上的浏览器资料；不会导入 Cookies、密码或完整 Profile。

## 实现

- 设置第一栏改为「资料与导入」，新增 Chrome、Microsoft Edge、ego(lite)、Firefox、Safari、其他浏览器来源卡片与对应导出指引。
- HTML 按内容识别；Chromium 原始 Bookmarks JSON（含无后缀 Bookmarks）按 roots 树识别。本站完整 JSON 另有恢复入口，避免混淆。
- 后端只读取书签名称、URL 与文件夹路径，归一化 URL 后去重。内部网址、脚本、危险协议或带凭据 URL 跳过并显示数量；JSON 本站恢复仍严格校验整批资料。
- 目录路径保留为备注，新增收藏进入收件箱。默认每次最多 500 条、前端 2MiB，与原有导入配额一致；没有添加自动双向同步或额外浏览器权限。
- ego(lite) 选项支持标准 HTML/Chromium Bookmarks，不声称兼容任意完整数据压缩包；其官方更新记录确认设置里有 Export data，但未验证实际完整压缩包结构。

## 实际证据

| 范围 | 命令/步骤 | 观察结果 |
| --- | --- | --- |
| 后台 | cd server 后 ../.venv/Scripts/python.exe manage.py test workspace enhancements -v 1 | 72 项通过；新增原始树/路径/内部网址跳过/去重/归属与上限回归 |
| 前端 | npm --prefix prototype test | 21 项通过；新增来源、BOM HTML、无后缀 JSON、错误/大文件/完整备份拒绝 |
| 构建 | npm --prefix prototype run build | 成功；新 JS index-D-H1uibm.js、新 CSS index-Dko1sYAb.css |
| 模板运行时 | npm --prefix prototype run test:sites | 4 项通过 |
| 先红后绿 | 新测试在实现前运行 | 后台 Chromium 格式 400、HTML 内部网址导致失败；前端模块不存在；实现后通过 |
| 页面 | IAB、独立 ui-qa 数据库、合成文件 | ego(lite) 原始 Bookmarks 预览 1 可新增/1 跳过，确认导入成功；重复文件 0 可新增/1 重复/1 跳过，确认禁用；Edge HTML 预览/文件夹路径正常 |
| 浏览器日志 | qa.dev.logs(error) | 空；未在实际账号中导入测试书签 |
| 云端 | 新静态资源逐字节 SHA256 比对、会话/匿名导入请求 | 资源匹配本地构建，未登录导入仍返回 401 |
| 文件约束 | Python 3.11 AST 与行数 | 变更源码均低于 300 行 |

图：../prototype/qa/browser-import-sources-2026-10-26.png 和 browser-import-2026-10-26.png，均来自合成测试资料，不是用户真实书签。

## 云端发布与回退

已执行加密备份，Result=success；补丁只含两个后台文件、index.html 和新 JS/CSS，共 5 文件，126080 字节。补丁 SHA256 bab8e71925b9dbffc91a1dc7f8d5ff25563e86161f32d18b042c8b4f2350624c。上传后校验并白名单检查归档成员，保存旧 transfer.py 与 index.html 到 /root/website-workspace-browser-import-20261026/before-code.tar.gz；没有数据库迁移。先装后台、重启并验会话，再切换首页，保留旧静态哈希资源供已打开页面使用。实际服务 active，公网首页已引用新构建。

首次受保护解包调用使用了当前 Debian Python 3.11.2 不支持的 extractall(filter=...) 参数，在任何代码替换前停止；改为严格固定 5 个允许文件、限制普通文件和大小、私有 staging 后解包成功，不放宽对任意用户归档的处理。

回退：仅还原上述旧 transfer.py/index.html 并重启应用，不恢复或覆盖业务数据库；新增未引用的静态文件可保留。业务备份依原运维流程单独管理。代码没有 Git 作者身份，未伪造提交。

## 来源与限制

- Google：https://support.google.com/chrome/answer/96816?hl=zh-Hans
- Edge：https://support.microsoft.com/zh-cn/edge/import-your-favorites-and-passwords-in-microsoft-edge
- ego(lite)：https://www.egolite.app/changelog
- Firefox：https://support.mozilla.org/en-US/kb/export-firefox-bookmarks-to-backup-or-transfer
- Safari：https://developer.apple.com/documentation/SafariServices/importing-data-exported-from-safari

本轮验证使用合成的标准 HTML/Chromium JSON，未读取用户真实浏览器收藏；真实 ego(lite) 完整备份包未测试也未支持。人的最终体验及正式维护接受仍由用户确认，不代填 accepted。
