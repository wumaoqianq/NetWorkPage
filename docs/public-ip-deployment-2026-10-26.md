# 公网 IP 直连实施记录（2026-10-26）

用户明确要求通过服务器 IP 和端口访问、不依赖 SSH，允许网站入口公开。含义为公开网络入口；私有网站库、管理员初始化码、邀请注册和账号隔离仍保留。

实施模式：implementation/release-maintenance，高风险部署配置调整。关键授权来自本轮用户指示，不再次要求同一发布许可。既有技能/治理版本与 implementation-ownership.md 一致。

计划优先使用 IP HTTPS：核对 Let's Encrypt 官方 2026-03-11 文档，Certbot 5.4+ 支持 IP + shortlived profile，可通过 HTTP-01 standalone 验证；无需域名。原先“无域名必须走隧道”的约束修正。初步预检：80/443/8443 未占用，现有业务保留。

- 原应用保持运行，先准备证书，再切换公网 TLS 8443；不在无证书阶段公开账号 HTTP。
- Gunicorn 使用已有单 worker/2 threads，直接 TLS，避免新增常驻代理。
- 证书文件 root 管理、仅应用组可读，环境的 PUBLIC_URL/Host/CSRF/Cookie 同步更改。
- 自动续期使用限资源的 systemd 短任务，更新证书后重启应用；续期与现有维护锁协调。
- 切换前保留私有配置回退副本。验证公网首页、资产、会话、CSRF、安全 cookie、证书匹配和浏览器，成功后结束旧访问隧道。

官方依据：https://letsencrypt.org/2026/03/11/shorter-certs-certbot 。后续补充实际执行结果，未签发时不声称 HTTPS 可用。

## 实际执行与验证

最终入口为 https://203.0.113.10:8443/，无需域名或 SSH。旧隧道已停止，停止后公网会话仍返回 200。个人资料仍需账号登录；未取消任何身份/归属验证，首个管理员仍需初始化码，尚未创建默认正式管理员。

- Certbot 5.8.0 从 HTTPS PyPI 独立 venv 安装，实际依赖见 deploy/certbot-requirements.lock，不改变应用 venv。
- HTTP-01 公网 80 探测成功；Let's Encrypt 实际签发 IP SAN=203.0.113.10 的受信任证书。初份证书 notAfter=2026-11-01 10:53 UTC（上海时间 18:53）；由短期证书续期 timer 管理，不将其当成长期手动证书。
- 最终由本站专用 Nginx（1 worker）在 0.0.0.0:8443 终止 TLS，Gunicorn 保持 127.0.0.1:8000。额外入口进程 cgroup 约 4.8MiB，后台约 50.6MiB；不是并发峰值保证。
- Django PUBLIC_URL、Host、可信 Origin 与安全 Cookie 同步更新，TRUST_PROXY=True；Nginx 覆写真实 IP 和协议头，后端仅回环。
- 证书合并 PEM 仅 root 可读（目录 0700、文件 0600），由 root Nginx 主进程加载；应用用户不再拥有私钥读取权限。
- 自动续期每 12 小时检查，另有最多 30 分钟 systemd 随机延迟，Certbot 内部随机等待关闭，避免占维护锁等待数分钟。仅续本站证书，与备份/jobs 共用维护锁；成功后原子发布已验证 PEM 并 reload 入口。
- certbot renew --cert-name website-workspace-ip --dry-run --non-interactive --no-random-sleep-on-renew：实际输出 all simulated renewals succeeded。续期 hook 另行实测语法、PEM 加载、Nginx 配置校验与 reload 成功；普通续期 oneshot Result=success/ExecMainStatus=0。

## 问题与回归

初始尝试 Gunicorn 直接 TLS 时，携带未消费 POST body 且客户端 Connection:close 的 CSRF 拒绝出现 403 响应体截断。空 body/keepalive 对照能返回完整 JSON，确认是直接 TLS 的连接关闭边界，而非权限绕过；最终改用 Nginx TLS 入口后相同请求收到完整 csrf_failed JSON。

代理后匿名访客若使用回环源地址作为限流键，会共享登录额度。本轮在 workspace.http.client_address 中只信任显式启用、连接真实来自回环且格式合法的 X-Real-IP。加入回归：不同真实 IP 有独立额度；公网客户端伪造转发头不能绕过限流。先观察到独立额度测试失败，再实现；完整 Django workspace/enhancements 69 项通过。

## 公网请求证据

- 未禁用证书或主机名验证的 Python TLS 连接：信任链通过，IP SAN 匹配。
- 首页与编译 JS/CSS 200；session 200，CSRF cookie 有 Secure。
- 同站 Origin 的空初始化请求返回完整 setup_token_invalid 403；外国 Origin 返回完整 csrf_failed 403；没有创建管理员。
- 匿名读取网站库、导出、扩展下载均为 401，错误 JSON 完整。
- 停止旧 SSH 转发后，127.0.0.1:4174 无监听；公网地址仍返回 200。
- 本轮 CUA 导航和重新取页均超时，未取得新的浏览器截图，未将浏览器复核记为通过。前端资产未改，本轮公网结论来自真实 TLS/HTTP 请求；可由用户直接在自己的浏览器打开验证。

## 文件与回退

实际配置：deploy/nginx-public-ip.conf、website-workspace-web.service、public-ip-https.conf、website-workspace-renew-tls.sh、website-workspace-tls-renew.service/timer。原域名 Caddy 模板仍保留作为其他部署选项，本机没有启动 Caddy。

切换前私有配置和旧 http.py 备份在服务器 /root/website-workspace-ip-tls/。需要回退时先停公网入口和续期 timer，在维护窗口恢复私有环境、移除本次 drop-in 并重启后端为回环服务；保留数据库、备份与证书材料，不覆盖或删除业务数据。旧 SSH 访问只作为人工回退选项，已非当前使用方式。
