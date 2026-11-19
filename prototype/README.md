# 前端工作台

目录名 prototype/ 保留历史路径，目前已包含真实应用前端。用户选择的浅色侧栏、绿色强调、用途卡片继续作为视觉依据。

[本地工作台](http://127.0.0.1:4173/)：会话认证、数据库保存与真实设置。[演示入口](http://127.0.0.1:4173/?demo=1)：独立内存示例，刷新重置。不要把演示中的保存当成正式入库。

## 开发

后端先运行在 127.0.0.1:8000；启动方法见根 README。

```powershell
npm ci
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

## 验证

```powershell
npm test
npm run build
npm run test:sites
```

当前 17 项行为测试、4 项模板运行时测试。src/api.js 负责 CSRF/会话/错误，workspace-loader.js 分页载入，useWorkspace.js 管理成功写入后的页面状态，Root.jsx 管理身份与公开分享入口，components/ 按功能划分设置与网站操作。

历史视觉验证见 design-qa.md；真实持久化和登录页面检查见 ../docs/implementation-verification.md。源图 reference/selected-home.png，品牌与图标来源 public/assets/SOURCES.md。正式部署只需 dist/client；Sites 模板运行时保留兼容，但不能通过静态托管替代 Django 私有后台。
