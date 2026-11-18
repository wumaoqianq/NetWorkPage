# 历史回退说明：SSH 隧道

2026-10-26 用户要求直接访问后，已改为 https://203.0.113.10:8443/，以下隧道已停止、不再是访问前提。当前方案见 ../docs/public-ip-deployment-2026-10-26.md；下文只保留作维护回退参考。

# SSH 隧道访问（无域名阶段）

云端应用仅监听 127.0.0.1:8000。当前电脑通过 SSH 将服务器端口映射到本机 4174，浏览器打开 http://127.0.0.1:4174/。浏览器到本机回环是 HTTP，电脑到服务器是 SSH 加密；不要把该端口改成 0.0.0.0 或对公网开放 HTTP 登录。

由代理建立的隧道仅在本机对应 SSH 进程存活期间有效。以后需要重新连接，可在自己的终端执行以下命令，按 SSH 提示认证；不要把登录凭据写进命令或脚本：

```powershell
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o IPQoS=none -L 127.0.0.1:4174:127.0.0.1:8000 root@203.0.113.10
```

首次管理员由你在页面创建。初始化凭证来自本机私有配置 .local/debian-47-80-15-249/website-workspace.env 的 SETUP_TOKEN；请在自己编辑器查看并填入页面，不在聊天中发送。该文件也含 BACKUP_KEY，应另作离线安全保存。初始化完成后关闭服务器 SETUP_ENABLED 并重启应用。

多人日常访问建议后续绑定域名并启用 HTTPS。届时更新 PUBLIC_URL、ALLOWED_HOSTS、CSRF_TRUSTED_ORIGINS、COOKIE_SECURE=True、TRUST_PROXY=True、SECURE_SSL_REDIRECT=True；启用 Caddy 后再考虑撤除仅供当前验收的 SSH 隧道。
