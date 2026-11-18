# 阶段 A：入口核实（进行中，待真人一次点击结论）

日期：2026-11-18。稳定架构方案 `docs/superpowers/specs/2026-11-18-stable-capture-architecture.md` 阶段 A。

## 已完成的客观核实（不依赖真人点击）

| 项 | 实际结果 | 依据 |
| --- | --- | --- |
| 原浏览器实际运行版本 | 1.6.1（解压缩扩展，`扩展开启`） | `edge://extensions` 卡片 `版本 1.6.1 解压缩扩展 扩展开启`，ID `mgoiiimmoehjajddbejpjljhmondnbem` |
| 开发人员模式 | On | `edge://extensions` 底部开关 UIA ToggleState=On |
| 扩展启用状态 | On | 卡片 `开启 网站工作台 · 快速收藏` ToggleState=On |
| 加载目录 | `C:\Users\无名\Downloads\website-workspace-extension` | 38 个 ZIP 条目逐字节一致（missing/mismatch 均为空），manifest=1.6.1，icons 齐全 |
| action 按钮 | 已固定、enabled，rect 2152,127 32×32，名称「收藏到网站工作台 希望访问此站点」 | UIA；`phase-a-toolbar.png` 可见绿色图标 |
| 本机 4173 | 回环 `127.0.0.1:4173` 监听（PID 26188），`/` 返回 200，`/api/extension/release` 未登录返回 401 | 服务由 `.local/manual-test-server.py` 用既有 `.local/manual-test/workspace.sqlite3` 恢复，未新建库 |
| 现有数据 | 4 站点 / 3 图标 / 4 预览，`integrity_check=ok` | 只读快照 |
| Git | `feat/website-prototype` 分支，零 commit，全部为 `??` 未跟踪 | 未使用 clean/reset，未删除任何用户项目 |

证据图：`.local/polish-qa/evidence/phase-a-target.png`（example.com 目标页）、`phase-a-clean.png`、`phase-a-toolbar.png`（工具栏绿色图标）。

## 结论边界

- 之前多轮自动化合成点击/快捷键无法稳定打开 action popup，这是**自动化手段**的结果，不能据此断定真人失败，也不能据此断定入口故障。
- 按方案：真人能开、自动化不能开 → 记为工具限制，不再为此改业务代码；真人也不能开 → 先定位安装/启用/入口故障。
- 独立 `popup.html` 正常但未作为入口验收依据。
- 未编辑浏览器受保护偏好、数据库、企业策略，未关闭安全保护，未改 DNS/代理。

## 真人点击结论（阶段 A 通过）

- 用户于 2026-11-18 在 example.com 标签页**真人单击一次**工具栏绿色扩展图标，回报「弹出收藏表单」。
- 另做一次干净的自动化点击作为旁证：在「开发人员模式 On + 扩展启用 + 1.6.1 + 回环服务正常」的健康运行态下，`popupFound=True`，弹出内容显示「已连接 · v1.6.1」。
- 结论：**真人能开，正常工具栏入口可用**。过去多轮「自动化点不开」发生在 Edge 重启把开发人员模式关掉（未打包扩展被禁用）或窗口焦点异常之后，属于分发/环境状态与自动化手段问题，**不是入口业务代码缺陷**，按方案不为此继续修改业务代码。
- 方案决策树命中「真人能开、自动化不能开 → 记为工具限制」。入口保持现状进入阶段 B；阶段 B 会把执行主体换成普通扩展标签页，但正常工具栏点击入口不变。
- 未使用独立 popup.html 替代入口验收；未改受保护偏好/企业策略/安全保护/DNS/代理；未卸载或重装扩展，配对与队列保留。

证据图：`phase-a-ready.png`（真人点击前就绪画面）、`phase-a-toolbar.png`（工具栏图标）、`phase-a-target.png`。

**阶段 A：通过。** 阶段 B/C/D 尚未开始，不标记全面验收完成。
