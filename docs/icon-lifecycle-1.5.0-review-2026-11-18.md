# 1.5.0 独立审查：队列与附件恢复

日期：2026-11-18。仅审查，未修改业务代码/运行环境。用户提交本轮开发报告后检查当前源码，发现以下阻塞项。

## P1：文字尚未入库时被错误改为素材上传状态

extension/asset-attach.js 的 attach 分支只要 queue 中有 capture，就无条件把 state 写成 preview_pending，即使 siteId/siteVersion 为空且文字仍 pending/auth/blocked。

queue.js 的 eligibleItems 只处理 pending，导致文字永远不再自动提交。图标后台又等待该 capture 从文字队列移除，形成互等。用户手动retry可能重置状态，但不能当作自动恢复已完成。

使用当前 createAssetAttacher + eligibleItems 复现：初始 pending、siteId=null 的文字任务收到迟到截图，结果为：

```json
{"state":"preview_pending","siteId":null,"eligibleTextTasks":0}
```

修复要求：无服务端文字回执时，仅附加素材引用，保持文字阶段、认证/拒绝/退避状态；只有文字确认且具备siteId/siteVersion才进入素材阶段。既有测试“文字还在队列时…”目前反而断言preview_pending，须改成端到端正确行为，不以错误测试预期约束修复。

## P1：直接上传失败会删除本地素材且不持久化重试

asset-attach.js 的 directAsset 从lastResult获取文字回执，直接发请求；attach中的catch对任何错误调用attachments.remove。截图没有独立重试记录，图标则只交给服务端重新抓取，丢掉客户端已获取的有效Blob。

注入网络错误并调用当前 attacher，结果：attach正常返回、Blob已删除、queue仍为空。

```json
{"returnedSuccess":true,"deletedBlobs":["preview-2"],"pendingQueue":0}
```

修复要求：先持久化可恢复附件任务和Blob，再联网提交；网络/5xx/429/401等错误保留内容与正确状态，确认成功或用户明确取消后才能移除。截图不能用服务端重新抓取来恢复。丢响应使用稳定ID幂等重试，不覆盖新素材。

## P2：ChatGPT首次快速收藏仍未闭环

报告明确：ChatGPT首次capture缺图，之后显式更新才由客户端PNG成功。当前icon-task-runner仅请求服务端fallback，没有popup关闭后的客户端候选获取路径。服务器无法访问但用户浏览器可访问时，服务端反复重试无法补齐；这与用户“无需再操作”的目标仍有差距。

要求：为客户端已获取的素材保留Blob和上传任务；对尚未取得、服务器不可达的情形，评估已授权客户端背景采集能力或可恢复的候选任务，不扩大为全站常驻权限、不绕过私网/DNS安全策略。确实无法在授权/生命周期内实现的范围明确说明，不能用手动第二次更新当首次自动成功。

## 验收要求

- 离线点击收藏→迟到素材附加→恢复网络→文字/截图/图标自动完成；无需手动retry。
- 文字先确认→图片上传断网/超时/5xx/429/401→关闭popup/重启→保留Blob且恢复提交。
- 文字被拒绝或设备撤销时附加素材不改写受阻状态。
- 两个capture交错提交不依赖唯一lastResult恢复归属。
- ChatGPT服务器不可达、浏览器可读PNG的实际条件下验证首次快速收藏结果，报告真实能力边界。
- 新增覆盖上述真实模块组合的回归，不能只mock最终成功结果；保留原用户数据、安装身份与队列，升级发布包后核实运行时。

本审查使用受控存储和网络替身复现代码行为，未改变用户收藏、未执行真实断网或安装操作。
