# Prototype Instructions

2026-11-18 用户实测纠偏（已按此实现 1.10.0，优先于 1.7.0–1.9.0 的「普通扩展标签页」方向）：**恢复工具栏小弹窗**，用户留在当前网页，点击扩展后在弹窗内选自定义分类、写备注、点收藏；标题/地址/简介/网站图标/当前页截图自动取得。成功存到本机后弹窗显示「已保存，待同步」或「已同步」；**不要自动打开新标签页、跳转工作台或要求再去收件箱整理**。弹窗内显示当前页截图预览，区分「正在截图/截图已就绪/截图不可用」；截图失败仍可保存并明确「这次未附截图」。工作台保留以网站 Logo 为主体的紧凑卡片，恢复「查看截图」按钮打开已有大图查看器（适应窗口/原尺寸/缩放），重新打开工作台后也能看图。弹窗只负责交互，后台继续用单一 Outbox：文字任务先可靠落盘、已取得截图关联同一 captureId 持久化后再显示保存结果；关闭弹窗已落盘任务继续同步；截图尚未取得时只在仍能确认原标签和权限时继续采集，不能拿切换后的页面凑数；图标慢或失败不阻塞保存。**真机验收必须用真实 Edge 走完整操作路径；测试用独立配置和测试库，保留日常账号、配对、收藏和队列**；不能用测试数量代替场景证据，候选版本不得称为全面验收完成。详见 ../docs/superpowers/plans/2026-11-18-phase-e-verification.md。

2026-11-17 展示二版（已实施并完成本机 Edge 验收）：工作台取消固定居中 max-width，主区按侧栏外可用宽度使用统一内容轨道；网格列数按真实可用宽度与目标卡宽计算，完整行均分、最后一行同列宽左对齐，少量数据不拉伸；卡片档位/滑杆/恢复默认/侧栏收进“显示设置”，真实分类筛选（全部+最多4个+更多）替换写死的用途筛选。真实站点 Logo 已修复：DeepSeek 209KB BMP 单帧 ICO 经源/保存预算分离、流式读取、多帧选帧与原生解码得到鲸鱼图标，并支持历史缺图单独刷新（不动截图/备注/分类）；扩展升级 1.4.0。测量/证据见 ../docs/implementation-verification.md 与 ../.local/polish-qa/。

2026-11-17 最新用户视觉反馈（已实现并完成本机 Edge 验证）：卡片以网站自己的 Logo 为主体，不再内嵌难辨认的截图缩略图；提供明确“查看截图”按钮直接打开可缩放全图查看器。卡片尺寸控制使用 ResizeObserver 按实际卡片外宽切换布局与信息密度，不使用 transform:scale。普通收藏直接入库、首页可见、分类备注和操作反馈保持有效。新规范 ../docs/superpowers/specs/2026-11-17-logo-cards-and-screenshot-viewer.md 优先于下文旧的小缩略图规则；截图未展示的根因已排查，未以更换布局掩盖媒体问题。

2026-11-16 用户体验纠偏（已按修订规格实现，优先于旧视觉尺寸/收藏默认行为）：插件主流程是选择工作台自定义分类、填写 notes 备注、点击收藏；名称/简介/当前页截图/图标自动获取。普通收藏直接入库且首页可见，收件箱只用于主动稍后整理，首页不能只展示置顶。默认使用紧凑卡片、小缩略图，避免大图占满；操作与设置提供 loading/成功/失败/恢复反馈。新版规格见 ../docs/superpowers/specs/2026-11-16-frictionless-bookmarking-revision.md；Logo SVG 源见 ../docs/brand/，扩展 PNG 由 scripts/generate_brand_assets.py 可复现生成。

用户已选择第 1 个视觉方向并授权实施：浅色侧栏、绿色强调、用途卡片。源图位于 reference/selected-home.png。用户已认可原型并要求继续完整实施；目前正式模式接入 Django/SQLite 私有后台，只有 ?demo=1 是内存演示。生产目标为单核约 700MB 的 Debian 12，不新增常驻 Node/PostgreSQL/Redis。保持所选视觉方向。

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
