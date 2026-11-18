# 浏览器书签导入设计与实施计划（2026-10-26）

目标：按用户指示添加 Google Chrome、Microsoft Edge、ego(lite) 等浏览器来源选择，上传书签后先预览、去重再保存到自己的账号。浏览器网站不能枚举电脑上的其他浏览器收藏；本轮采用标准导出文件，不索要浏览器账号、密码或完整 Profile，不读取任何现有个人书签。

选择：沿用已有文件预览/提交接口，新增来源指引和原始 Chromium Bookmarks JSON；相较于直接增加扩展书签读取权限，文件方案可覆盖不同浏览器且无需额外安装授权。本轮不引入自动双向同步。用户明确功能指示和 ego lite 名称已确认，常规 UI 决策沿用已认可风格，不另设重复审批。

流程：设置 → 资料与导入 → 选择浏览器 → 对应导出指引 → 选择书签文件 → 显示来源/文件名/新条目/重复/不支持网址 → 确认导入。保留文件夹路径至备注；危险协议、内部浏览器页面和带凭据网址跳过并提示；不覆盖已有个人说明。原始 JSON 仅识别 roots 书签树，限制节点、深度与条数。沿用单次 500 条/前端 2MiB，页面明确显示。

- [x] 先写 Chromium 树解析、Chrome/Edge HTML、危险网址跳过/所有者/提交幂等与前端文件识别回归，确认红灯。
- [x] 实现 server/workspace/browser_bookmarks.py 和 transfer.py 的格式/警告扩展，无模型迁移。
- [x] 新建 bookmark-import.js、BrowserImportPanel.jsx，接入 DataSettings 与来源元信息、指引和 URL 预览修复。
- [x] 运行完整后台、前端、构建和模板运行时；可用时以合成测试库进行浏览器检查，不操作用户真实收藏。
- [x] 备份当前云端版本，部署变更文件和预构建静态资源，检查公网新资源与权限，更新项目状态/知识/索引/记录。无 Git 作者身份，不伪造提交。

来源：Google Chrome 官方导出 HTML 帮助 https://support.google.com/chrome/answer/96816?hl=zh-Hans ；Edge 收藏操作 https://support.microsoft.com/zh-cn/edge/import-your-favorites-and-passwords-in-microsoft-edge ；ego(lite) 官方变更记录 https://www.egolite.app/changelog 确认设置中有 Export data，但未验证其完整导出压缩包布局，因此不声称支持任意 ego 完整备份，仅 HTML/标准 Bookmarks JSON。
