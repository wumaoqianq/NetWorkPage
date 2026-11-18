# 网站工作台交互原型实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 忠实还原用户选定的第 1 张视觉稿，交付可本地运行、可操作的中文网站工作台原型。

**Architecture:** React 前端、模块化纯函数和浏览器内存状态，不连接登录、密码库或服务端。原型位于独立 prototype/ 目录，沿用 Product Design 的 Vite 模板及其构建流程。真实多用户隔离、扩展、监控与语义能力留在后续完整实现范围。

**Tech Stack:** React 19、Vite、Phosphor React 图标；静态品牌资产；Node 内置测试。

## 范围和验收

- 视觉源：用户选择的第 1 张生成图片；保留浅色侧栏、绿色主色、3 列用途卡片和最近打开区。
- 功能：搜索、分类、卡片/列表、导航、网站详情、多个入口、账号说明、添加编辑、置顶、归档、回收站、工作集、JSON 导入导出、数据重置。
- 使用演示数据；刷新后恢复默认数据，设置中说明限制；不把浏览器内存状态当作真实账号系统。
- 公开品牌链接正常打开；本机、局域网和保留示例域名先提示访问条件，再由用户选择打开。
- 没有真实服务健康检测，不显示未经检测的在线状态。
- 不创建额外网站页面路由；用现有布局、详情侧板与模态框完成交互。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| prototype/src/App.jsx | 组合布局、导航与动作编排 |
| prototype/src/data.js | 明确标注的示例资料与工作集 |
| prototype/src/model.js | 检索、URL/导入校验和不可变资料更新 |
| prototype/src/useWorkspace.js | 内存资料与提示状态 |
| prototype/src/components/Sidebar.jsx | 左侧导航与用户入口 |
| prototype/src/components/SiteCard.jsx | 卡片、列表项与菜单 |
| prototype/src/components/SiteDetail.jsx | 详情侧板、入口及账号说明 |
| prototype/src/components/SiteForm.jsx | 添加、编辑及入口表单 |
| prototype/src/components/SettingsDialog.jsx | 原型说明、导入导出与重置 |
| prototype/src/components/Dialog.jsx | 可关闭、焦点约束的模态层 |
| prototype/src/styles.css | 字体、颜色、布局与卡片 |
| prototype/src/overlays.css | 对话框、表单、详情和响应式 |
| prototype/tests/model.test.mjs | 搜索、安全输入与导入原子性的行为测试 |
| prototype/design-qa.md | 参考图对照、浏览器验证及限制 |

## Task 1：基础与业务规则

- [x] 在 feat/website-prototype 分支创建官方 prototype 模板；安装依赖。
- [x] 先写行为测试，再以空实现运行并观察断言失败。

```js
assert.equal(filterSites(fixtures, { query: '透明背景' })[0]?.id, 'image');
assert.match(validateSiteInput({ name: '测试', url: 'javascript:alert(1)' }), /http/);
assert.throws(() => normalizeImportedSites([{ name: '危险', url: 'data:text/html,x' }]), /网址/);
```

- [x] 实现 model.js，覆盖用途、备注、标签、筛选、归档隔离及严格 URL 校验。
- [x] 运行 `node --test tests/model.test.mjs`，记录通过数量。

## Task 2：首页和资料交互

- [x] 建立 data.js、useWorkspace.js 和各职责组件，单个手写文件控制在 300 行内。
- [x] 首页默认展示 6 个置顶网站；搜索无结果时显示重置入口。
- [x] 实现新建与编辑，并在保存前检查网址、名称和至少一个入口。
- [x] 详情显示入口条件与示例账号，支持打开、编辑、置顶和归档。
- [x] JSON 导入一次性校验所有条目后再更新内存，禁止部分导入污染原资料。
- [x] 设置窗口明确展示演示限制，导出不包含任何平台凭证。

## Task 3：视觉还原和本地运行

- [x] 将选定参考图复制到项目 reference/；品牌资产使用真实公开来源，头像由资产子任务生成。
- [x] 运行 `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`。
- [x] 使用内置浏览器查看桌面和窄屏，并检查搜索、添加、编辑、入口、归档、恢复与设置。
- [x] 将参考和实际截图放到同一比较图；记录并修复 P0/P1/P2 差异。

## Task 4：验证与交付记录

- [x] 运行 `npm test`、`npm run build`、`npm run test:sites`。
- [x] 检查浏览器错误、核心路径和视觉对比，写入 design-qa.md。
- [x] 更新状态、知识库、文档索引和变更记录；保留待用户评估状态。
- [x] 保持本地预览运行，提供可打开的原型地址；不擅自发布。

## 回退和交付边界

源目录独立于未来后台，停止 Vite 即可关闭预览。所有数据为内存演示，刷新可复原。
当前版本库无提交身份，不能生成真实作者提交；文件保留在分支工作区，不编造身份。
用户已授权选定方向开始制作，因此本轮直接执行，不重复询问实施许可。

## 执行结果（2026-10-25）

10 项行为测试和 4 项运行时测试通过，构建成功，16 份 src 文件均不超过 300 行。浏览器检查和视觉对照见 prototype/design-qa.md。JSON 导入校验已测试，真实文件选择器导入未运行。原型供用户体验，正式多用户与扩展仍待后续开发。

