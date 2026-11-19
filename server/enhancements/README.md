# 增强模块接口与维护

本模块仅持有增强模型，不修改 `workspace.Site.payload`。入口在 `urls.py`，主配置需加入 `enhancements` 并将 URL 挂到 `/api/enhancements/`。迁移 `0001_initial` 依赖 `workspace.0002_userworkspace`。

所有私人接口使用会话认证；写操作保留全局 CSRF 校验。统一错误 `{error,code}`。公开分享端点允许匿名，其余端点只返回当前账号资料。

## 分享

- `GET shares` → `{shares:[{id,title,kind,expiresAt,revokedAt,includeAccounts,createdAt}]}`，最多最近 100 份。
- `POST shares` → 上述单项加 `{token,url}`。请求必须二选一 `{siteId}` 或 `{collectionId}`，可加 `expiresInDays:7`（1..30）。默认不含私人 `notes` 或任何 `accounts`。
- 只有同一请求同时传 `includeAccounts:true,confirmAccounts:true` 才包含账号说明（含账号说明里的 notes）。网站私人 notes 始终排除。
- `DELETE shares/:id` → `{revoked:true}`；只允许所有者撤销。
- `GET public/shares/:token` → `{title,kind,sites,expiresAt}`。白名单网站字段是 name/purpose/aliases/tags/category/kind/icon/endpoints，显式确认后追加 accounts。不包含 owner、邮箱、原站点 id、collections、设备资料。
- token 使用 32 个随机字节生成，数据库只存 SHA-256；原 token 仅创建时返回。url 为 `PUBLIC_URL + '/?share=' + token`。
- 公开访问时验证原资料仍属于分享者且未删除、未归档；任一原站点不存在或集合已删除，则整份快照返回 404。快照不随原站点编辑更新。
- 每份最多 200 网站、1MiB；每账号最多 100 份有效分享。

## 元信息与纯文本存档

- `GET sites/:id/metadata` → `{metadata:null|result,cached:boolean}`，只读缓存，不产生网络访问。
- `POST sites/:id/metadata` 请求 `{endpointId?,archive?:false}` → 同上；同 URL 一分钟内复用缓存。
- result 为 `{title,description,text,url,checkedAt,source:'server',httpStatus,status,endpointId,requestedUrl,error?}`；status 为 available/http_error/unsupported/error。拒绝的内网入口返回 unsupported、httpStatus=null；不会被伪装为离线。
- `GET sites/:id/archives` → `{archives:[{id,title,url,text,checkedAt}]}`。只有 available 结果可存档；每站最多三份，每份文本最多 120KiB，为标题和地址留出空间。
- `GET sites/:id/monitor`、`PUT sites/:id/monitor` → `{enabled,intervalHours,endpointId,nextCheckAt}`；PUT 必须显式传 enabled，可传 endpointId、intervalHours（6..720，默认24）。默认关闭，开启后最早下一次 timer 才访问。

`safe_fetch.py` 完成 URL/DNS/重定向校验和 HTMLParser 纯文本提取，`network.py` 固定连接已验证 IP，并用原域名验证 TLS。禁止凭据、非 HTTP(S)、非 80/443、所有非公网 IP、IPv4 映射、NAT64/6to4/Teredo 和站点本地 IPv6。DNS 返回的每个地址均须通过；每一跳重新校验，最多三次重定向。

五秒总预算覆盖 DNS 等待、连接及响应读取；DNS 最多两条工作线程且无无界等待队列。响应头、分块控制行和正文合计最多512KiB，不解压、不用环境代理、不带浏览器 cookie/token、不执行 HTML 或脚本。缓存与存档是 JSON 里的纯文本，前端必须按普通文本显示。

## 提醒与任务

- `GET reminders` → `{reminders:[{id,siteId,dueAt,advanceDays,description,notifiedAt}]}`。
- `POST reminders` 请求 `{siteId,dueAt:ISO8601,advanceDays:0,description:'续费'}` → 单 Reminder。日期2000..2200年，advanceDays为0..365；每账号最多1000条。
- `DELETE reminders/:id` → `{deleted:true}`，级联删除其通知。
- `GET notifications` → `{notifications:[{id,siteId,description,dueAt,createdAt,read}]}`，最多最近200条。
- `PATCH notifications/:id` 请求 `{read:true}` → 单 Notification。
- `python server/manage.py runjobs --limit 10` 返回 `{processed:N}`；已有执行中租约时 `{processed:0,skipped:'another_run_active'}`。硬上限100；每项顺序执行、每个监控最多四次 HTTP 请求（含重定向）。单行数据库10分钟租约避免timer重叠。提醒写入与 notifiedAt 同事务，重复执行不产生重复通知。
- 仅处理显式开启且到期的监控；提前预约下一次，失败不会密集重试。删除/归档资料不触发检查或提醒。没有常驻 scheduler、邮件、外部 AI、向量库或隐式自动抓取。

## 验证与维护入口

Windows 独立验证：

```powershell
.venv/Scripts/python.exe server/manage.py test enhancements --settings=enhancements.test_settings
.venv/Scripts/python.exe server/manage.py makemigrations --check --dry-run --settings=enhancements.test_settings
```

2026-10-25 实际观察：22项测试通过、迁移无漂移。网络测试仅mock DNS、HTTP或socket，不访问真实网址或内网；未声称验证真实Debian主机、邮件、外部AI或用户体验验收。

| 文件 | 职责/入口 | 上游与下游 | 搜索/风险 |
| --- | --- | --- | --- |
| shares.py | shares/public_share | 会话/匿名 → Share/Site | 白名单、token_hash、源失效、确认账号 |
| safe_fetch.py | fetch/target | metadata → network | SSRF、每跳DNS、纯文本 |
| network.py | resolve/transport/PinnedHTTP | safe_fetch → socket/ssl | 固定IP、TLS、总预算、响应头预算 |
| metadata.py | metadata/archives/monitor | API/jobs → fetch/models | 不修改个人用途/notes、存档数量 |
| reminders.py | reminders/notifications | 会话 → owned模型 | 归属、CSRF、时间校验 |
| jobs.py | run_jobs | timer → 提醒/监控 | 串行、租约、幂等、任务上限 |
| tests/ | 安全及业务回归 | Django临时SQLite → mock网络 | 双账号、泄漏、SSRF、配额、并发边界 |

故障定位：抓取失败先查metadata.result.status/error；提醒未出现先查timer日志、trigger_at/notified_at与JobLease.expires_at；分享404先查expires_at/revoked_at和source_ids对应站点状态。紧急停用可停止timer并在主配置撤下enhancements URL；保留模型表和备份，避免回滚时误删用户增强资料。

治理使用 `C:/Users/阿俄拉伍/.agents/skills/spec-driven-ai-dev/SKILL.md` v1.5.0（可用的同名r0旧版摘要与当前强制目录版本相比，采用r1完整强制规范），本任务按implementation/高风险和父任务已明确的接口、安全、隔离边界实施。Companion activation: spec-driven-ai-dev loaded and applied；证据为本子任务首个读取工具调用。人的最终验收和正式部署仍由父任务汇总，不代替人填写accepted。根项目状态、变更记录和AI索引由父任务统一更新以避免并发覆盖。
