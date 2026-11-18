# Django 私人网站库后端

运行目录是仓库根目录，Python 3.12+、Django 5.2 LTS。首次启动不创建账号：

```powershell
.venv/Scripts/python.exe server/manage.py migrate
.venv/Scripts/python.exe server/manage.py runserver 127.0.0.1:8000
.venv/Scripts/python.exe server/manage.py test workspace.tests -v 1
```

配置从根 `.env.local` 读取，已存在环境变量优先。`DEBUG=False` 必须显式提供 `SECRET_KEY`；首次初始化默认需要 `SETUP_TOKEN`，也可用 `SETUP_ENABLED=False` 关闭。页面只返回是否需要初始化凭证，从不公开初始化密钥。开发便利模式需要同时开启 `DEBUG=True` 和 `ALLOW_LOCAL_SETUP=True`，且真实来源为回环地址；不相信 `X-Forwarded-For`。所有网页写操作，包括登录、注册、初始化和恢复，都要求 CSRF。

`DATA_DIR` 默认根 `data/`，数据库默认 `DATA_DIR/workspace.sqlite3`，可用 `DATABASE_PATH` 覆盖。SQLite 使用 WAL、20 秒忙等待和 IMMEDIATE 事务；没有 Redis 或数据库常驻服务。`MAX_SITES` 默认每用户 10000 条。低内存生产进程参数见根部署目录。生产前端入口读取 `prototype/dist/client/index.html`，静态文件通过 FileResponse 回退提供，也可交给 Caddy。

安全 Cookie 由 `COOKIE_SECURE` 控制，默认生产启用；HTTPS 重定向只按 `SECURE_SSL_REDIRECT` 启用；只有显式 `TRUST_PROXY=True` 才相信代理 `X-Forwarded-Proto`。必须把后端监听在受控回环或内网端口，防止用户绕过可信反向代理。`ALLOWED_HOSTS` 和 `CSRF_TRUSTED_ORIGINS` 应只列真实域名。`PUBLIC_URL` 用于生成邀请、恢复链接。

## 前端契约

稳定路径见 `../docs/superpowers/plans/2026-10-25-persistent-workspace.md`。错误统一 `{error: 中文说明, code: 稳定代码}`。401 统一 `auth_required`，登录凭据错误为 `invalid_credentials`。API 不接收客户端 owner 授权信息，所有 Site、ImportJob、Collection、Device、Visit 都按当前用户过滤。

- GET `/api/auth/session`：`{user,setupRequired,setupTokenRequired,csrfToken}`。登录/注册/初始化成功后 CSRF 会轮换，前端需重新读取 session。
- POST `/api/auth/setup`：`{email,name,password,setupToken}`；login：`{email,password}`；register：`{email,name,password,token}`（也接受 inviteToken）。返回 `{user}`。
- POST `/api/auth/invites`：可指定 email，返回 `{token,email,expiresAt,url}`。GET `/api/auth/users` 返回 `{users}`；PATCH `/api/auth/users/:id` 接收 `{isActive?,isAdmin?}`。
- GET workspace 返回私有 `sites,collections,categories,recent,user`。categories 是名称数组；collections 是 `{id,name,description}` 数组；recent 是 Site UUID 数组。
- POST sites、GET/PATCH sites/:id 直接返回 Site DTO。GET sites 返回 `{sites}`。Site 新增 ID 始终由服务端生成；默认入口通过 `defaultEndpointId` 标记，无显式选择时取第一个入口。
- PATCH Site 必须带当前 `version`，版本不匹配返回 409 `version_conflict`。永久 DELETE 必须先进入回收站，并提交 `{version}`。组织修改自动增加受影响网站的 version。
- collections 支持根 POST 与 `/:id` PATCH/DELETE；categories 支持根 POST 与 `/:旧名称` PATCH `{name: 新名称}` / DELETE。GET 两者返回相应命名数组。
- POST imports/preview 接受 `{format:'json'|'html',content}`；JSON content 可为字符串或对象。最多 5MB、500 条。POST `imports/:id/commit` 返回 `{imported,skipped}`，同任务重复提交返回相同结果。预览有效期 1 小时。
- GET exports 返回 `{version:1,exportedAt,sites,collections,categories}`，包含网站账号说明，不含平台密码散列、会话或设备凭证。
- POST extension/pairing-code 返回 `{code,expiresAt}`。配对码有效 5 分钟，只能使用一次。POST extension/pair `{code,name}` 返回 `{token,user,device,expiresAt}`，设备凭证有效 30 天。
- GET extension/devices 返回 `{devices}`；DELETE `/:id` 返回 `{deleted:true}`。
- GET extension/lookup?url 返回 `{site,duplicate}`，未找到时 site 为 null。POST extension/captures 接收 `{clientCaptureId,url,title,purpose,updateExisting?}` 返回 `{site,duplicate}`。

只有配对兑换、扩展 lookup 和 captures 豁免 CSRF；lookup/captures 必须使用设备 Bearer 凭证，网页 cookie 不能替代。相同 owner + clientCaptureId 跨设备去重，原账号重新配对可恢复旧请求。改密/停用会撤销旧设备和未使用配对码；停用还删除网页会话，重新启用不会恢复旧 cookie。

## 恢复与改密

POST `/api/auth/password` 使用 `{currentPassword,password}`，完成后退出并使所有旧会话/设备失效。密码至少 12 位，且大小写字母、数字、符号中至少三类，另有 Django 相似性与常见密码校验。

管理员核验用户身份后，可 POST `/api/auth/users/:id/recovery`，返回 `{token,expiresAt,url}`。令牌有效 15 分钟，只可使用一次；POST `/api/auth/recover` 使用 `{token,password}`。令牌只存散列。没有邮件发送集成，必须通过可信渠道交付。管理员不能停用或降权自己，系统至少保留一个启用管理员。

服务器运维恢复使用隐藏密码输入，不把明文密码写进命令历史：

```powershell
.venv/Scripts/python.exe server/manage.py recover_account --email owner@example.com
.venv/Scripts/python.exe server/manage.py recover_account --email owner@example.com --issue-token
```

第二个命令会明确向终端输出一次性恢复令牌，终端录屏/历史应按凭据管理。不会创建账号、启用停用账号或自动提升角色。关键身份变化记录在 AuditEvent，不记录请求体或明文凭证。

## 维护位置与验证边界

模型/迁移：`workspace/models.py`、`workspace/migrations/`；公共身份/错误/归属工具：`workspace/http.py`；身份与恢复：`identity.py`；网站及版本控制：`library.py`；白名单校验：`validation.py`；组织：`organization.py`；导入导出：`transfer.py`、`bookmarks.py`；扩展：`extension.py`；环境/入口：`config/`。全部手写 Python 文件低于 300 行。

三个首查点：401 先查 session 或 Device 的 expires_at/revoked_at/auth_hash；409 先查 Site.version、Endpoint 的 owner+url 唯一约束；503 database_busy 先查进程数量、数据库文件权限与是否有长写事务。生产业务数据库从未创建真实管理员，测试仅使用 Django 独立临时库。

已执行的验证记录由父任务汇总至根项目状态文档。真实 Debian 主机的性能、系统备份恢复、浏览器联调和 HTTPS 域名需要整体部署验证；本模块的 SQLite 事务测试不能替代这些结果。SQLite 多进程不共享 LocMem 限流；当前部署要求单 worker，如改成多 worker，须先换共享限流实现。
