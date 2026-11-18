> 状态更新：本文保留初始 SSH 隧道部署历史。按用户最新要求，已改为公网 https://203.0.113.10:8443/，旧隧道停止；当前配置与证据以 public-ip-deployment-2026-10-26.md 为准。

# 2026-10-26 Debian 实机部署记录

## 授权与边界

用户提供目标主机和 root 登录方式，随后明确暂时没有域名，授权继续部署。凭据不写入记录。当前采用回环监听 + 本机 SSH 隧道验收；公网 HTTP 不提供账号登录。保留服务器已有服务与配置，不安装/接管 Caddy 或更改现有代理、SSH、防火墙。

## 已观察环境

- Debian GNU/Linux 12 bookworm，Linux 6.1.0-52-amd64，Python 3.11.2。
- 内存 701MiB，初始可用约 289MiB，swap 1023MiB；根磁盘剩余约 19GiB。
- nproc 返回 2，用户此前描述为单核；使用单 Gunicorn worker，不据此增加并发。
- 目标应用目录和专用用户原先不存在，8000 端口未占用。
- 已有其他业务常驻服务，部署只新增 website-workspace 专用账号、目录、服务和 timer。

## 当前步骤

1. SSH 认证和只读预检完成；默认 SFTP 上传曾创建 0 字节文件后超时。
2. 使用 IPQoS=none、4096 字节传输块和 2 个在途请求，2MB 发布包在约 20 秒上传成功。只能确认此组合有效，未断言唯一网络根因。
3. 独立配置在本机私有目录生成，Windows ACL 限定当前用户；上传后安装为 /etc/website-workspace.env，root:website-workspace、0640。服务器凭据未写入该文件。
4. 应用配置 DEBUG=False、ALLOW_LOCAL_SETUP=False，回环地址 http://127.0.0.1:4174 为 PUBLIC_URL；SSH 加密传输场景 COOKIE_SECURE=False、SSL redirect 关闭。未来域名 HTTPS 接入时必须同步改回安全 cookie、PUBLIC_URL/origin、SSL redirect。
5. 发布物为 website-workspace-20261025T185250747336Z.tar.gz，上传后检查 SHA256。后续进度将据实际结果补充。

私有初始化/备份配置保存在本机 .local/debian-47-80-15-249/website-workspace.env，不进 Git 或发布包。首次管理员需用户自行设置；查看该私有文件的 SETUP_TOKEN 后输入初始化页，不复制到聊天或日志。BACKUP_KEY 须由用户另外离线保存。

## 实机执行结果

部署版本 SHA256：3a0dacfb07658c65df0896291051618e0c6437ed063c9b6d4d5587000166503e。

- 上传包校验成功，锁定依赖最终通过 https://pypi.org/simple 重新安装，全部使用 wheel，无服务器端编译。
- 以 website-workspace 专用用户执行 migrate --noinput 与 check，迁移成功、Django 普通检查无问题。
- systemd-analyze verify 校验本项目 5 个 unit 未报项目错误；扫描已存在的 cloudmonitor.service 时提示其原有 KillMode/PIDFile 警告，未修改其他业务配置。
- website-workspace.service 已开机启动并运行，单 Gunicorn worker、2 threads，仅监听 127.0.0.1:8000；NRestarts=0。
- 空载/访问初始化页面后 systemd MemoryCurrent 约 42.3–44.8MiB；整机剩余可用约 217MiB、swap 使用 0。这是当前初始库的观察，不能保证复杂大资料或并发峰值。
- backup 与 jobs 两个 timer 已启用，实际 oneshot 均 Result=success、ExecMainStatus=0。工作台默认没有监控站点，jobs 不产生主动抓取。
- 实际生成流式加密备份，恢复到新文件后 integrity_check=ok，30 张表行数与生产初始空库一致；独立恢复文件随后清理，未覆盖生产库。
- 数据目录 0700、数据库 0600；私有环境文件 root:website-workspace、0640。上传目录中的额外配置副本比对一致后清理；运行配置与本机私有离线副本保留。

## 容量检查边界与结果

在本机 Debian 上以低优先级独立短进程，新建临时 SQLite 库、迁移并写入 5000 条合成网站，再以 Django Test Client 请求分页 API。不会写入正式库；结束关闭连接并删除临时库。

| 指标 | 观察值 |
| --- | --- |
| 合成网站数 | 5000 |
| 每页 | 250 |
| 相同首页采样数 | 30 |
| 单页 P50 / P95 | 13.73ms / 46.66ms |
| 顺序读取 20 页 | 483.87ms |
| 容量进程峰值 RSS | 69824KiB，约 68.2MiB |

范围：Django 进程内 Test Client，包含查询、序列化与中间件，不包含网络、Gunicorn 排队、SSH 延迟或浏览器渲染/本地关键词搜索，也不是并发压测。资料为普通短文本，不代表 64KiB 上限的极端单条内容。原规格中“搜索 API P95”不能直接由该结果替代，因为当前检索在浏览器内执行。

## 隧道与浏览器

- 已建立当前电脑 127.0.0.1:4174 → SSH → 云端 127.0.0.1:8000。
- 实际请求首页、JS、CSS 均 HTTP 200；session 返回 user=null、setupRequired=true、setupTokenRequired=true。
- IAB 浏览器已打开云端初始化页，显示“服务器初始化码”，error/warn 日志为空；未输入或设置用户正式密码。
- 证据截图 prototype/qa/cloud-setup-2026-10-26.png；恢复隧道方法见 deploy/SSH-TUNNEL.md。
- 还未配置域名或公网 HTTPS，未安装/启动 Caddy，也未开放公网 HTTP 登录。当前分享链接/扩展地址使用 127.0.0.1:4174，仅适用于同一台有隧道的电脑；外部多人日常使用需后续正式域名入口。

## 后续与恢复

用户自行在页面设置首个管理员，初始化码取本机私有配置 SETUP_TOKEN。完成后可关闭 SETUP_ENABLED；公开域名接入前重新设置 HTTPS、安全 cookie 和可信 origin。BACKUP_KEY 另行离线保管，密文备份还需要用户配置异机复制。

应用如需暂停，仅停止 website-workspace.service 及本项目 timers，保留 /var/lib/website-workspace 与 /etc/website-workspace.env。不要卸载/停止服务器其他业务，也不要在运行中替换数据库或单独丢弃 WAL/SHM。

收尾复核：本项目服务和两个 timer 均 active，应用 NRestarts=0；现有业务进程仍在，最近 20 分钟内核日志没有 OOM/Killed process 记录。管理 SSH 会话已退出，仅保留当前访问用的 SSH 转发。所有权结构校验仍明确缺少人工 accepted/实名负责人/备用人/日期 4 项，不伪造成最终接受；技术运行事实与人工维护接受分开记录。
