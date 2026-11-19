# 在线升级与发布验收记录（2026-11-19）

状态：**候选验证记录，不等于全面验收完成**。稳定轨道仍默认忽略本组预发布；Chrome、正式商店发布、云端多实例未验证。

## 1. 发布物（GitHub 预发布）

仓库：<https://github.com/wumaoqianq/NetWorkPage>

| 版本 | 提交 | 说明 |
| --- | --- | --- |
| [v1.10.0-rc.10](https://github.com/wumaoqianq/NetWorkPage/releases/tag/v1.10.0-rc.10) | `115bb0563926c3c6f0a9ed74d7af1e9c1bf96176` | **当前线上版本**，含在线升级与回退加固 |
| [v1.10.0-rc.8](https://github.com/wumaoqianq/NetWorkPage/releases/tag/v1.10.0-rc.8) | `0a78a259488fd73bbdb5b594e2fe5bd0e7a809da` | 首次成功升级所用的上一版本 |
| [v1.10.0-rc.1](https://github.com/wumaoqianq/NetWorkPage/releases/tag/v1.10.0-rc.1) | `f00c0ad41c6e61ad88dead685b7aab45d6992201` | 初始部署版本 |

rc.10 资产与哈希：

- `website-workspace-v1.10.0-rc.10.tar.gz` — 2,152,767 B — SHA-256 `25f162a69720b44ca19fba6e76b6b1cfec61844f394a71384c5d788d52851f45`
- `website-workspace-extension-1.10.0.zip` — 114,814 B — SHA-256 `09551f05365a55f87f3194a539a6f3a6259a5d26f91450508d236a1155fee12d`
- `release-manifest.json` / `.sig` / `SHA256SUMS` / `release-public-key.pem`

清单签名：Ed25519，公钥固定安装于服务器 `/etc/website-workspace-release.pem`（sha256 前缀 `423fce48d16b35bc`）。私钥仅在构建机 `.local/release-keys/`，不入库、不入包。

## 2. 升级与回退命令（管理员在服务器执行）

```bash
# 查看可用版本（稳定轨道默认忽略预发布）
/opt/website-workspace/current/.venv/bin/python manage.py checkupdate --track stable
/opt/website-workspace/current/.venv/bin/python manage.py checkupdate --track prerelease --refresh

# 预检：下载、验签、校验资产、安全解包；不动线上数据与服务
/opt/website-workspace/current/.venv/bin/python manage.py upgrade --release-version 1.10.0-rc.10 --precheck

# 执行升级：维护锁 → 停写 → 加密备份并试恢复 → 迁移 → 原子切换 → 健康检查 → 恢复流量与定时器
/opt/website-workspace/current/.venv/bin/python manage.py upgrade --release-version 1.10.0-rc.10
```

维护期：写请求返回 `503` + `Retry-After: 60`，读请求放行；扩展本地 Outbox 不丢，恢复后自动续传。

### 旧部署的一次性引导

早于本功能的部署不含升级命令，需要一次性把以下文件放进当前版本目录（之后版本自带）：

- `server/workspace/release_manifest.py`
- `server/workspace/upgrade.py`
- `server/workspace/management/commands/{checkupdate,upgrade}.py`

并把发布公钥安装到 `/etc/website-workspace-release.pem`（644）。

### 离线/跨境网络受限时的资产准备

从 GitHub Releases 下载在国内服务器上不稳定（实测 `api.github.com` 可达，但 `objects.githubusercontent.com` 常超时）。正当做法：在能访问的机器下载同一 Release 资产后上传，服务器上用固定公钥验签并校验哈希，再解包到
`/opt/website-workspace/releases/.staging-<version>/`，随后执行 `upgrade --release-version <version>` 复用该暂存目录。信任链不变，只是换了传输通道。

## 3. 实测结果

| 场景 | 结果 |
| --- | --- |
| 带数据升级 rc.1 → rc.8 | 成功；实测停机 **65.0 秒**；数据 5 站点/4 图标/4 预览/14 设备不变 |
| 带数据升级 rc.8 → rc.10 | 成功；实测停机 **38.9 秒**；备份试恢复 `integrity ok`、媒体 12 文件 |
| 故障注入：新版启动即失败 | 回退成功；停机 **61.4 秒**；数据库与媒体成对恢复，失败现场保留为 `workspace.sqlite3.failed-*` / `media.failed-*` |
| 恢复写入后再次自动回退 | 被拒绝并提示需人工确认（未触碰线上） |
| 定时任务 | `jobs/backup/media-cleanup` 三个 timer 在升级后自动恢复并按时执行 `website-workspace-jobs`，**无需手动 `runjobs`** |
| 维护期写请求 | `503` + `Retry-After: 60`；读请求 200 |
| 内存 | 服务常驻约 52–55 MB（701 MB 机器） |

回退后数据核对：`pragma integrity_check = ok`、站点 5、设备 14、媒体 12、外部 `200`；人工确认后才清除防护标志继续升级（证据 `upgrade-state.rolled_back.evidence.json`）。

## 4. 验收过程中发现并修复的缺陷

1. `--version` 与 Django 管理命令内置参数冲突 → 改用 `--release-version`。
2. 升级时重复下载扩展 ZIP（跨境易失败）→ 只下载服务包，校验其内嵌 ZIP 与清单同字节。
3. `sudo -u` 丢弃环境变量（`BACKUP_KEY` 缺失）→ 改用 `runuser` 保留环境。
4. `backup.py --env-file` 需在子命令前，且该文件 600 root-only 应用用户不可读 → 不再传 `--env-file`，依赖保留的环境。
5. 恢复目录位于 `/tmp` root 700 目录导致应用用户不可写；且 `restore` 的 target 是数据库文件路径（媒体为其 `.media`）→ 恢复工作目录改到 `DATA_DIR` 并归属应用用户。
6. 新版崩溃循环触发 systemd start-limit，回退启动被拒 → 回退前 `systemctl reset-failed`。
7. `apply()` 在回退抛错后二次回退，媒体目录重命名冲突 → 回退只执行一次，失败现场路径幂等。
8. 回退成功后最终状态被覆盖为 `failed` → 保留 `rolled_back` 并单独记录原因。

## 5. 未验证 / 已知限制

- **真实 Edge 扩展在维护窗口内排队并自动续传**：本轮只做了 HTTP 层证据（写请求 503+Retry-After、恢复后 200）与既有 Outbox 重试机制，未重跑真机扩展端到端场景。
- 首次升级把依赖安装放在维护窗口内，停机较长（65 秒）；后续可前移到预检阶段。
- 正式 Edge Add-ons 商店发布、Chrome、长期稳定性观察未做。
- 本组版本均为预发布候选，**不得描述为全面验收完成**。
