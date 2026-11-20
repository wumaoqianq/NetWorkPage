# Debian 12 低内存部署与恢复

推荐一台原生 Debian 12 主机运行 Caddy + Django/Gunicorn + SQLite。目标环境为单核、约 700MB 内存；不常驻 PostgreSQL、Redis、Node、任务队列进程或本地 AI。以下保留通用域名 Caddy 部署模板；当前主机实际采用公网 IP HTTPS + 专用 Nginx，见 ../docs/public-ip-deployment-2026-10-26.md。

## 开发机生成发布物

在仓库根目录，先用已有开发依赖构建前端；`npm` 只在开发机运行：

```powershell
cd prototype
npm ci
npm run build
cd ..
.\.venv\Scripts\python.exe -m unittest discover -s scripts/tests -v
.\.venv\Scripts\python.exe scripts/build_release.py --version 1.10.0-rc.11 --tag v1.10.0-rc.11 --track prerelease --extension-version 1.10.0
```

Linux/macOS 开发机使用 `.venv/bin/python`。从干净的待发布提交运行；示例版本替换为实际候选。输出版本化服务包、相同字节的配套扩展 ZIP、签名清单和 `SHA256SUMS`。包中含后台、预构建前端、部署脚本和依赖锁。签名私钥仅用于发布机，部署时通过可信渠道设置固定公钥，勿信任替换包自带的新公钥。发布前检查归档文件清单和公开文档。

单独生成配置；将示例域名换成真实域名，文件不能跟发布包一起公开：

```powershell
.\.venv\Scripts\python.exe scripts/generate_env.py --public-url https://workspace.example.com --output .env.local
```

工具拒绝覆盖现有文件，生成 `SECRET_KEY`、`SETUP_TOKEN`、`BACKUP_KEY`，终端不显示值。`.env.local` 被 Git 忽略。Windows 上文件权限由所在目录 ACL 决定，应放在仅自己可读的位置。通过受保护渠道把配置单独放到服务器；另在离线安全位置保存 `BACKUP_KEY`，与密文备份分开。丢失该密钥无法恢复；更换密钥前保留旧密钥对应的旧备份。

## 安装应用（服务器 root 会话人工执行）

先设置真实域名 DNS A/AAAA，允许入站 TCP 80、443；8000 仅监听回环。确认主机架构有 Python/cryptography 预编译 wheel；安装命令明确禁止现场编译依赖，避免小内存机器编译失败。

```sh
apt update
apt install --yes python3 python3-venv ca-certificates caddy sqlite3 util-linux
useradd --system --user-group --home-dir /var/lib/website-workspace --shell /usr/sbin/nologin website-workspace
install -d -o root -g root -m 0755 /opt/website-workspace
install -d -o website-workspace -g website-workspace -m 0700 /var/lib/website-workspace
```

如果用户已存在，跳过 `useradd`。`apt install caddy` 使用 Debian 仓库包；如需 Caddy 官方仓库包，按[官方 Debian 安装说明](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)配置，安装会自动运行其默认服务，因此域名与防火墙应先准备好。

从 [GitHub Releases](https://github.com/wumaoqianq/NetWorkPage/releases)取得服务包、清单和签名。首次安装服务器还没有项目验签命令时，在受信工作机按「更新与回退」中的 `--precheck --asset-dir` 使用独立取得的公钥验签，并记录已验证的服务包 SHA-256。上传到服务器受保护的临时目录，按这个已验证的摘要复核传输结果；不能只把未经认证的 `SHA256SUMS` 当签名用。下面是新安装布局示例，用真实版本和文件名替换：

```sh
version=1.10.0-rc.10
target="/opt/website-workspace/releases/$version"
install -d -m 0755 /opt/website-workspace/releases
mkdir -m 0755 "$target"
tar -xzf "website-workspace-v$version.tar.gz" --strip-components=1 -C "$target"
python3 -m venv "$target/.venv"
"$target/.venv/bin/pip" install --only-binary=:all: --no-cache-dir -r "$target/requirements.lock"
ln -s "$target" /opt/website-workspace/current
install -o root -g root -m 0644 /受保护临时目录/可信发布公钥.pem /etc/website-workspace-release.pem
install -o root -g website-workspace -m 0640 /受保护临时目录/.env.local /etc/website-workspace.env
```

代码目录由 root 拥有、应用用户只读；`DATA_DIR=/var/lib/website-workspace` 由应用用户写入。环境文件为 root 所有、应用组可读，其他用户不可读；不放在 Caddy 静态目录中。使用私有编辑器核对环境文件：

| 项目 | 生产值 |
| --- | --- |
| DEBUG | False |
| PUBLIC_URL | 真实 `https://域名` |
| ALLOWED_HOSTS | 真实主机名，不含协议，不用 `*` |
| CSRF_TRUSTED_ORIGINS | 同一个真实 HTTPS origin |
| COOKIE_SECURE | True |
| TRUST_PROXY | True（仅信任回环 Caddy） |
| SECURE_SSL_REDIRECT | True |
| DATA_DIR | /var/lib/website-workspace |
| 数据库 | 默认 DATA_DIR/workspace.sqlite3，不配置 PostgreSQL URL |

迁移、检查使用同一个私有文件，避免误建另一份数据库：

```sh
cd /opt/website-workspace/current
runuser -u website-workspace -- .venv/bin/python scripts/manage_env.py --env-file /etc/website-workspace.env migrate --noinput
runuser -u website-workspace -- .venv/bin/python scripts/manage_env.py --env-file /etc/website-workspace.env check --deploy
install -o root -g root -m 0644 deploy/website-workspace.service /etc/systemd/system/
install -o root -g root -m 0644 deploy/website-workspace-backup.service deploy/website-workspace-backup.timer /etc/systemd/system/
install -o root -g root -m 0644 deploy/Caddyfile /etc/caddy/Caddyfile
```

编辑 `/etc/caddy/Caddyfile` 中的域名，与环境文件一致。前端由 Caddy 直接读取 `/opt/website-workspace/current/prototype/dist/client`，API 反代回环 Gunicorn。

```sh
caddy validate --config /etc/caddy/Caddyfile
systemd-analyze verify /etc/systemd/system/website-workspace.service /etc/systemd/system/website-workspace-backup.service /etc/systemd/system/website-workspace-backup.timer
systemctl daemon-reload
systemctl enable --now website-workspace.service
systemctl reload caddy
systemctl enable --now website-workspace-backup.timer
```

先确认 HTTPS 证书有效，再访问真实地址。初始化页面要求本机私有环境文件中的 `SETUP_TOKEN`；从受保护编辑器取值，不发送到聊天或命令日志，不公开首个管理员认领入口。完成首个管理员创建后，在环境文件增加 `SETUP_ENABLED=False` 并重启应用。它使用邀请注册，后续邀请由管理员发出。

## 可选定时任务

仅在 `manage.py help runjobs` 存在且理解其外网抓取边界后启用；没有独立常驻 worker：

```sh
cd /opt/website-workspace/current
install -o root -g root -m 0644 deploy/website-workspace-jobs.service deploy/website-workspace-jobs.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now website-workspace-jobs.timer
```

每次最多处理 10 项，前一次结束约 10 分钟后再次执行。与备份共享 `flock`，备份最多等 240 秒，任务遇到备份则跳过当次，防止两个短进程同时占用内存。未启用时，元信息任务不自动处理。

`runjobs` 同时驱动**服务端公开图标补齐 Job**（阶段 D）：收藏 HTTP 接口只在同事务登记唯一缺图任务、立即返回，不等待外网抓取；由这里的 timer（生产）或本机调度器（开发测试）有界串行执行。执行器复用 `favicons` 的每跳公网 DNS/端口/重定向/字节/像素/时间预算，只填空不覆盖客户端上传或用户自定义图标；SVG-only/私网/超时/超限为终态降级并有限重试到明确缺图，不无限重试、不改系统 DNS/代理、不绕过公网校验、不伪造 Logo。日志在 systemd journal（生产）与下文本机 `jobs.log`（开发）。

### 本机（Windows/回环 4173）轻量调度器

生产用上面的 systemd timer；本机没有 systemd，用 `scripts/local_jobs.py` 起一个有明确日志/PID/stop-file 进程控制的短循环，调用同一个 `manage.py runjobs`（经 `.local/manual-test-server.py` 转发到同一 SQLite 库），**不另建库、不常驻 Node/Redis/无头浏览器**：

```powershell
# 单次执行并打印结果（可验证任务被调度）
.venv/Scripts/python.exe scripts/local_jobs.py once
# 常驻循环：每次间隔 20s、单次 runjobs 上限 4、超时 90s；日志 .local/manual-test/jobs.log
.venv/Scripts/python.exe scripts/local_jobs.py loop --interval 20
# 停止：在 .local/manual-test/ 建 jobs.stop 文件（或终止该进程）；PID 写在 jobs.pid
```

每次循环只做一次有界 `runjobs`，stdout/stderr 追加到 `jobs.log`，循环分段睡眠以便及时响应 `jobs.stop`。任务「排队后无人执行」是可观察的：收藏后查库有 `pending` 任务，跑一次 `once` 后任务进入 `pending`(退避)/`no_icon`(终态)/`complete`，`jobs.log` 有每次 cycle 的起止与 `runjobs` 输出。

## 备份与独立恢复演练

每日约 03:15（服务器本地时区，带随机延迟）运行；使用 `sqlite3.Connection.backup` 获取包含 WAL 已提交事务的一致快照，再以 1MiB 分块执行 AES-256-GCM 认证加密。每次使用随机 salt/nonce，并通过 HKDF-SHA256 从现有 BACKUP_KEY 分域派生 AES 密钥。私有明文快照在临时目录，完成或异常退出会清理；异常断电留下的 `.snapshot-*` 目录需要在确认无备份进程后人工清理。备份目录仅应用用户可读。[格式与认证边界](FORMAT.md)记录了具体布局和旧格式兼容策略。

```sh
systemctl start website-workspace-backup.service
systemctl status website-workspace-backup.service --no-pager
journalctl -u website-workspace-backup.service --since today --no-pager
```

默认目录 `/var/lib/website-workspace/backups/`；保留最近 7 个 UTC 日和 4 个 ISO 周各最新一份，重复桶只存一份。只清理严格匹配本工具名称的普通文件，忽略无关文件和符号链接。新备份成功后才执行保留策略。至少把密文复制到独立磁盘/其他机器；同机备份不能应对主机丢失。

新文件后缀为 `.sqlite3.wwb`，备份与恢复均按块处理，不再受 32MiB 内存上限限制。默认**单份快照磁盘上限为 1GiB**，环境文件可设置 `BACKUP_MAX_BYTES=1073741824`，或单次使用 `create --max-bytes 字节数` / `restore 源文件 新目标 --max-bytes 字节数`。在线数据库增长超限会中断复制，不删除旧备份。配置上限须为正整数且不超过 AES-GCM 单消息标准限制；这不是无限制磁盘写入许可。

快照与加密临时文件同时存在，创建时需要约 **2 倍数据库大小的额外可用空间**，另留 WAL/SHM、日志和操作系统余量；保留 7 日与 4 周时最多 11 个不同密文文件，1GiB 满额库可能另占约 11GiB。恢复的新文件和当前生产库也会同时占空间。必须监控实际磁盘容量并据此降低上限或缩短保留策略，不因内存足够而忽略磁盘预算。

旧 `.sqlite3.fernet` 文件可用同一主密钥只读恢复；因为旧格式采用[整体 Fernet 认证](https://cryptography.io/en/latest/fernet/#limitations)，旧格式恢复仍限制为 32MiB 明文，新工具只生成流式格式。新旧文件共同使用上述保留策略。旧备份密钥也必须随其存续期保存。

恢复先到新文件，认证错误、损坏密文、无效 SQLite 或已有目标均失败；**工具不会覆盖数据库**：

```sh
cd /opt/website-workspace/current
runuser -u website-workspace -- .venv/bin/python scripts/backup.py --env-file /etc/website-workspace.env restore /var/lib/website-workspace/backups/实际文件.sqlite3.wwb /var/lib/website-workspace/restore-check.sqlite3
runuser -u website-workspace -- sqlite3 /var/lib/website-workspace/restore-check.sqlite3 'PRAGMA integrity_check;'
runuser -u website-workspace -- sqlite3 /var/lib/website-workspace/restore-check.sqlite3 'SELECT count(*) FROM auth_user; SELECT count(*) FROM workspace_site;'
```

比较行数和抽查业务内容；不要将完整导出的私人内容贴到日志。恢复文件本身包含私人资料，演练后同样需要保管或删除。

仅在确认独立文件可用、保留当前库备份且进入维护窗口后切换：

```sh
systemctl stop website-workspace-jobs.timer website-workspace-backup.timer
systemctl stop website-workspace-jobs.service website-workspace-backup.service
systemctl stop website-workspace.service
```

在停止应用后检查没有持有数据库的进程，将当前 `workspace.sqlite3` 以及存在的 `-wal`、`-shm` **一起移入新建的私有回退目录**；随后将验证后的恢复文件移动为 `workspace.sqlite3`，权限 `0600`、属主 `website-workspace`。不要在运行中替换主库，也不要把旧 WAL 留给新库。再运行同配置 `migrate --noinput`、`check --deploy`，启动应用，确认登录、私有资料、导入和收藏可用，再恢复先前启用的 timers。迁移失败时保持停机并从保留的旧库及其 WAL/SHM 回退；不要混用不同代的数据库附件。

## 资源预算和日常运维

| 组件 | 限制/预期 |
| --- | --- |
| Gunicorn | 1 worker，gthread 2 threads，MemoryHigh=256M，MemoryMax=320M |
| 单次备份 | MemoryMax=128M，1MiB 加密块，CPUQuota=25%，低 IO 优先级 |
| 可选 jobs | MemoryMax=128M，CPUQuota=25%，最长 180 秒 |
| SQLite | 本地磁盘，无独立服务；小规模并发，写事务串行 |
| OS、Caddy、磁盘缓存 | 需要额外余量；上述硬限额不是内存预留或容量保证 |

单核 700MB 只适合小规模资料与轻并发，应观察真实 RSS、OOM 日志、磁盘容量和备份体积。流式格式的 Python 缓冲区与数据库总大小无关；36MiB 实际数据库往返测试要求 Python 分配峰值低于 12MiB，但该指标不包含 SQLite/OpenSSL、解释器与 OS 缓存，不能代替真实 Debian RSS 测量。旧 Fernet 恢复需整体内存，宜停应用后在维护窗口执行或放到较大开发机验证。预计多个组件同时接近上限时会挤压 OS；应降低并发、安排维护窗口或升级内存。可由维护者按磁盘条件配置少量 swap 缓冲突发，但 swap 不增加持续容量。不在该机器运行 Node 构建、全站抓取或本地向量模型。

```sh
systemctl status website-workspace.service caddy --no-pager
systemctl list-timers 'website-workspace-*'
systemctl show website-workspace.service -p MemoryCurrent -p MemoryPeak
journalctl -u website-workspace.service --since today --no-pager
df -h /var/lib/website-workspace
free -m
```

限制 journal 日志容量需由运维统一配置。日志不可包含密码、初始化 token、备份密钥、完整资料导出；检查失败时只记录错误类型和必要 ID。每月至少一次在独立目录演练还原。

## 更新与回退

本节使用当前源码的升级接口；已发布的 rc.10 不包含 `--asset-dir`，不要手工预解包新资产并塞入旧版 `.staging-*`。GitHub 历史发布说明里的 `--version` 是误写，实际目标参数是 `--release-version`。

新装或旧部署迁移时，将程序与独立 venv 安装在 `/opt/website-workspace/releases/<版本>/`，并使 `/opt/website-workspace/current` 指向该目录。系统服务和站点反向代理使用 `current`，数据库、媒体和环境配置保留在原位置。旧部署迁移须先备份并验证恢复；在维护窗口对齐 systemd 服务的 `WorkingDirectory`、`ExecStart`、作业 timer 和代理静态路径，验证应用及定时器后再开放。发布目录及公钥由 root 管理，应用账号只读；如果旧版程序目录曾归应用账号所有，先用已知可信的签名资产恢复代码，再从中运行管理员命令。

```sh
cd /opt/website-workspace/current
sudo .venv/bin/python scripts/manage_env.py --env-file /etc/website-workspace.env checkupdate --refresh
sudo .venv/bin/python scripts/manage_env.py --env-file /etc/website-workspace.env upgrade --release-version <目标版本> --precheck
sudo .venv/bin/python scripts/manage_env.py --env-file /etc/website-workspace.env upgrade --release-version <目标版本>
```

若 GitHub 下载不稳定，把原始服务端归档、`release-manifest.json` 与签名 `.sig` 放到受控目录，在预检和执行命令上都加 `--asset-dir /path/to/assets`。每次都用独立固定公钥重新验证，不借用旧备份或过往解包结果。可安装并启用 `website-workspace-update-check.service` 和 `.timer`，定时刷新管理员面板缓存；调度失败不会中断收藏。

执行时先在线准备新目录和依赖，再维护停写、停作业、创建并试恢复新备份，然后迁移、切换和验证。维护标记开启且应用进程在线时，写请求得到 `503`；进程停机期间也可能收到代理的 `502`，扩展会保留任务供重试。迁移一旦开始，任何异常都要成对恢复数据库与媒体；确认恢复和旧版健康均通过才重新开放。维护标记仍在或状态为 `rollback_failed` 时禁止直接重跑：检查 `/var/lib/website-workspace/upgrade-state.json`、systemd 日志和保留的失败现场。若已开放写入，先停写并保存现有数据库与媒体，再决定前滚或按[独立恢复演练](#备份与独立恢复演练)人工回退。不能用指定旧版本的升级命令代替人工回退。

这里提供的 systemd/Caddy 文件尚未在真实 Debian 主机执行；本机只验证 Python 工具、测试和发布包。真实域名证书、网络、防火墙、Debian 服务权限及峰值资源需要部署时验证。

## HSTS 与访问日志

后端和 Caddy 都拒绝页面被 iframe 嵌入。首次部署先验证真实 HTTPS，然后可在私有环境文件加入 SECURE_HSTS_SECONDS=3600，观察无误再延长。默认不锁定全部子域、不申请 HSTS preload；check --deploy 的 W004（未启用）或 W005/W021（不覆盖子域/preload）需按域名实际情况评估，不应为了清空警告盲目开启。

生产 Gunicorn 配置不启用 access log，Caddy 也未启用访问日志。邀请、恢复和分享链接含短期凭证，扩展 lookup 也含收藏 URL；新增日志、代理或监控时避免记录完整路径与查询字符串。错误日志只保留排查所需的类型与 ID。

## 可选 Docker 状态

已提供 Dockerfile 和 container-entrypoint.sh，使用开发机预构建的 dist/client，启动前迁移，容器以非 root 用户运行。当前开发机拉取官方 python:3.11-slim-bookworm 受网络/DNS 阻断，因此 Docker 构建与运行未验证；推荐上述原生 systemd 路径。不要把“配置文件存在”当成容器已测试成功。

当前应用只配置 SQLite，不支持 DATABASE_URL 或 PostgreSQL 自动切换；如后续需要外置数据库，须单独实现、迁移和验证，不能仅安装驱动后改变环境变量。

实际部署进度已更新：见 ../docs/debian-deployment-2026-10-26.md。无域名阶段采用 ../deploy/SSH-TUNNEL.md 的加密隧道，仅回环服务；本文正式 Caddy/HTTPS 步骤在取得域名后执行。

## 2026-11-15：扩展媒体与备份补充

依赖锁新增 Pillow；安装仍使用 `--only-binary=:all:`，服务器不需要 Node、Chromium 或截图服务。扩展 ZIP 由开发机 `scripts/build_extension.py` 先生成，完整 `build_release.py` 会先运行扩展测试和静态检查。运行中的下载接口只读取 `extension/release.json` 对应产物并复核 SHA-256，不再每次动态打包。

媒体位于 `DATA_DIR/media`，只由 Django owner 鉴权读取，不能配置 Nginx/Caddy 公开 alias。默认账号配额为 100MiB，可用 `PREVIEW_QUOTA_BYTES` 调整。回收站图仍占配额；永久删除、移除或替换后的无引用文件先标记，至少 7 天后才由以下 timer 清理：

```sh
install -o root -g root -m 0644 deploy/website-workspace-media-cleanup.service deploy/website-workspace-media-cleanup.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/website-workspace-media-cleanup.service /etc/systemd/system/website-workspace-media-cleanup.timer
systemctl daemon-reload
systemctl enable --now website-workspace-media-cleanup.timer
```

命令行 `backup.py create` 现在默认包含 SQLite 快照引用的媒体，恢复时必须指定一个不存在的新媒体目录：

```sh
runuser -u website-workspace -- .venv/bin/python scripts/backup.py --env-file /etc/website-workspace.env restore /var/lib/website-workspace/backups/实际文件.sqlite3.wwb /var/lib/website-workspace/restore-check.sqlite3 --media-directory /var/lib/website-workspace/restore-check-media
```

备份窗口通过媒体 `.maintenance.lock` 与 GC 互斥，并与既有 flock 维护锁配合。额外磁盘预算需按“数据库 + 当前引用图片”计算，容器、加密临时文件和恢复副本会同时存在；不再只按数据库两倍估算。旧单库备份可直接恢复且图片显示缺失，新容器会验证全部图片摘要后才发布。JSON 资料导出不含图片二进制，不能代替此运维备份。

应用回退保留新增字段和图片表，不执行反向删表。实体 Chrome/Edge 升级保留队列、Pillow 峰值内存、含图恢复及 GC/备份并发均须在独立数据目录或目标主机实测，不能由配置文件推断通过。
