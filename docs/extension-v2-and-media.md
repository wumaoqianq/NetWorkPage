# 扩展协议 2、私有图片与运维约定

日期：2026-11-15。本文描述本轮代码实现与本地自动化覆盖范围；真实 Chrome/Edge 安装授权、截图操作和目标服务器资源验收仍需分别执行。

## 2026-11-16 少操作收藏修订

- 扩展 1.3 的主输入为 `category` 和 `notes`。`notes` 最大 2000 字，保存到 Site.payload.notes，不改变 purpose；options.capabilities 用 `notes/appendNotes/iconAttachments` 声明支持，lookup 仍不返回旧 notes。
- 普通新收藏严格使用 `inbox = later === true`。不再根据用途、备注、分类或工作集是否为空推导。历史 inbox 不迁移；`POST /api/inbox/complete` 仅在用户确认当前数量后逐条按 owner/version 清除 inbox，其他字段不变。
- 重复资料默认不变。`appendNotes=true` 与 expectedVersion 同时提供时才由服务端追加备注并记录时间；同 capture ID 重试返回原回执，不重复追加。旧备注不读取到扩展，超长返回 `notes_too_long`，空追加返回 `notes_empty`。
- 已有资料仍可显式更新 homepage、preview；图标使用独立 `icon` 更新字段和 `canAttachIcon` 许可。`POST /api/extension/v2/captures/:id/icon` 接收 clientAssetId、expectedVersion、sourceUrl 和文件，按 owner 回执与来源入口校验。
- SiteIconAsset 仅接受真实 PNG/WebP 解码并重编码，最大 128×128、32KiB；SVG、HTML 和损坏内容拒绝。图标经 `/api/sites/:id/icon?rev=...` session owner 私有读取，配额独立，GC 和含媒体备份同时覆盖预览与图标。
- 自动截图只表示当前页面，不是首页。扩展打开时自动准备简介、图标和当前页预览，收藏最多再等待 2 秒；失败降级不阻塞文字。预览与图标在离线队列中独立上传、重试和确认。
- `GET /api/workspace/revision` 返回账号轻量变更版本；前端可见时每 30 秒及恢复焦点时检查，只有变化才重新分页读取。`?site=<UUID>` 打开当前用户详情深链，不携带 notes、账号或 token。

## 版本兼容与上线顺序

| 客户端 | 服务端行为 |
| --- | --- |
| 扩展 1.1 / 未声明协议 | 继续使用 `POST /api/extension/captures` 和书签导入；配对协议按 1 处理 |
| 扩展 1.2 / 协议 2 | 使用显式字段更新、请求指纹、整理选项、发行清单和独立附件回执 |
| 协议 1 调用协议 2 路径 | 返回 `extension_upgrade_required`，本地队列保留并暂停提交 |
| 数据库 | `0003` 仅新增字段和表；回退代码时保留新表与字段，不执行反向删表 |

先迁移并部署同时支持协议 1/2 的后端，再部署前端和 ZIP/清单。旧客户端兼容窗口至少 30 天；破坏性下线需要另行决策。

## 网站与扩展接口

- `description` 为 0–500 字纯文本；`descriptionSource` 为 `manual/page_meta/server_meta/none`。`purpose` 语义不变。`homepageUrl` 可空并通过 HTTP(S) 安全校验。
- `GET /api/extension/options`：bearer，只返回当前账号分类、工作集 id/name、图片配额和能力。
- `GET /api/extension/lookup?url=...`：返回整理摘要、版本、删除/归档状态和是否有图，不返回 notes、账号或图片内容。
- `POST /api/extension/v2/captures`：新收藏输入 `clientCaptureId,url,title,description,descriptionSource,purpose,category,tags,collectionIds,pinned,later,homepageUrl,scope`。
- 已有地址必须传 `updateFields` 子集：`name,description,purpose,category,tags,collections,pinned,homepage,preview`；涉及更新时同时传 `expectedVersion`。未选字段不变，删除/归档记录不会由扩展恢复。
- `homepage` 是独立的显式确认字段：只有在扩展中选择“站点首页”并勾选“首页地址”后才写入请求的 `homepageUrl`。空地址返回 `homepage_confirmation_required`；仅更新其他字段或截图不会新增、清除或覆盖已有首页。历史收藏可先确认首页再上传首页截图。
- 成功返回 `{site:{id,name,version},duplicate,outcome,acceptedFields,canAttachPreview}`。同 UUID 同请求可安全重试；不同内容为 `idempotency_conflict`。
- `GET /api/extension/release` 允许 session 或 bearer，返回版本、日期、大小、SHA-256、最低浏览器和协议范围，不含秘密。

## 图片接口与安全边界

`POST /api/extension/v2/captures/:clientCaptureId/preview` 使用 bearer multipart：

- `clientAssetId,expectedVersion,sourceUrl,sourceEndpointId,pageKind,userConfirmedHomepage,capturedAt,file`；`sourceEndpointId` 可留空，由服务端按当前站点的精确来源 URL 绑定。
- 新收藏回执或明确包含 `preview` 的更新回执才授予上传许可。不能凭任意 site ID 上传。
- 首页图要求来源 URL、homepageUrl 一致且用户明确确认；当前页图始终标为 `current`，不会借此补写首页地址。来源入口改变后旧图标为 stale。
- 输入最大 200KiB、2 百万像素，只接受真实 WebP/JPEG/PNG 栅格。服务端解码、去元数据并重编码为最大 960×540 主图和 480×270 WebP 缩略图；原图不发布。
- 同账号同 `clientAssetId` 同指纹重试返回原结果，不被旧 expectedVersion 阻挡；不同内容返回冲突。图片失败不回滚文字，替换失败保留旧图。
- `GET /api/sites/:id/preview` 与 `/preview/image?size=thumb|full&rev=...` 仅 session owner 可读；`DELETE /api/sites/:id/preview` 需要 CSRF 和 version。删除在同一事务内核验归属/版本、条件递增版本并删除引用；条件更新为 0 行时返回 `version_conflict`，引用保留。无图时同版本重复删除保持幂等，文件仍由延迟 GC 清理。
- 文件只存 `DATA_DIR/media` 的随机受管 key，响应为 `private, no-store` 和 `nosniff`，不存在公开静态媒体路由。

稳定错误码包括 `extension_upgrade_required`、`idempotency_conflict`、`homepage_confirmation_required`、`preview_too_large`、`preview_invalid`、`preview_quota_exceeded`、`preview_source_changed`、`relation_unavailable`。401 暂停并重新配对，409 人工复核，413 移除/压缩图片，429 按 Retry-After 退避，5xx 可重试。

## 扩展本地状态与迁移

文字状态为本地待提交、网站已确认、附件待上传、完成；另有认证暂停、拒绝、冲突和取消。Blob 只存 IndexedDB，引用在 `chrome.storage.local` 串行更新。每轮最多 10 条文字和 1 张图，附件最多 20 张/4MiB，超过 7 天暂停而非静默删除。

首次以 schema 2 启动时，先把旧队列完整写入 `workspaceQueueBackupV1`，再保存迁移状态；备份已存在时不覆盖。迁移或存储失败会中止操作，旧队列仍保留，禁止用清空队列修复。被拒绝任务的新编辑生成新 UUID，新任务及其附件引用先成功持久化，再写入旧任务的 `replacedBy`/取消状态；任一写入失败都不删除旧任务、表单或附件，网络重试继续使用已持久化的新 UUID。换账号不会转投文字或图片。

## 配额、清理、导出和备份

- 默认图片配额 `PREVIEW_QUOTA_BYTES=104857600`，按当前主图和缩略图实际字节计算，替换和并发检查位于串行事务。
- `manage.py cleanup_media` 先标记无引用文件，至少 7 天后删除；跳过备份/恢复维护锁、符号链接和非受管路径。回收站图片仍计配额，永久删除后由 GC 回收。
- JSON 导出包含 description/homepageUrl 和展示来源元信息，不包含图片二进制、私有存储 key 或 token；导入不会恢复图片。
- 命令行备份默认创建 v2 加密容器，包含一致 SQLite 快照及快照引用的全部图片和 SHA-256。旧单库 `.wwb`/Fernet 恢复继续可用。

```sh
python scripts/backup.py create --media-directory /var/lib/website-workspace/media
python scripts/backup.py restore 备份.wwb 新目录/workspace.sqlite3 --media-directory 新目录/media
python manage.py cleanup_media
```

恢复目标和新图片目录必须不存在。只有数据库及全部媒体摘要、SQLite 完整性均通过后才发布。密钥仍需独立保管，备份副本遵守运维保留政策，不因源站删除立即消失。

## 发布与实测边界

`python scripts/build_extension.py` 先运行扩展测试和静态检查，再生成固定时间戳 ZIP、SHA-256 与 `extension/release.json`。`scripts/build_release.py` 在完整项目发布时自动执行该步骤，下载接口校验大小和哈希，缺失或不匹配返回 503。

真实浏览器仍需逐项验证：手动加载、权限弹窗、首页/当前页截图、导航竞态、关闭重启恢复、Chrome 与 Edge 更新。目标低内存服务器还需实测 Pillow 解码内存、上传延迟、磁盘和含图备份恢复；配置值不是性能承诺。

## 2026-11-17 图标采集通用化与自动兜底

- 候选发现由页面元数据驱动：tab favicon、`link rel~=icon`、`shortcut icon`、`apple-touch-icon(-precomposed)`，保留 `href/type/sizes/media`；相对路径按最终页面 URL 规范化；浅色/无主题候选优先，dark 候选排后；SVG 不执行，SVG 与 PNG 并存时优先栅格。跨域声明候选不直接请求，交由服务端兜底。
- 新增设备 Bearer 接口 `POST /api/extension/v2/captures/<capture_id>/icon/fallback`（rate 60）：不解析请求体 URL；只认该设备 owner 的 CaptureReceipt 及其所属 Site，重新读取站点公开页面，仅使用页面声明/默认候选；每个 URL 和重定向独立做公网/DNS/端口校验，不发送网站 Cookie、Bearer、Referer；HTML 超限读取有界前缀解析 `<head>`；预算沿用 4 候选/HTML 256KiB/单图标 1MiB/累计 2MiB/总 5s/2MP/输出 ≤128×128、32KiB WebP。
- 幂等与保护：已有 SiteIconAsset 返回 200 `{status:'icon_exists'}` 且不抓取、不覆盖；成功后条件创建图标、版本乐观更新、配额检查、写 `icon_fallback_filled` 审计；失败不写 Site/资产/媒体。错误码：`capture_not_found` 404、`icon_refresh_private` 400、`icon_svg_only` 415、`icon_refresh_too_large` 413、`icon_refresh_invalid` 400、`icon_refresh_failed` 502、`icon_refresh_timeout` 504、`icon_quota_exceeded` 413、`version_conflict` 409。
- 扩展任务：提交文字前登记 `workspaceIconTasks`，绑定 server/user/captureId/savedUrl/是否允许更新；文字立即入库。图标获取/兜底/上传由 service worker 执行，状态 pending_acquisition/acquiring/ready_to_upload/complete/retryable_failure/unsupported/cancelled，有限退避，关闭 popup/浏览器重启后恢复；同一 capture ID 幂等，不新增网站、不重复写备注，跨账号不转投。
- 反馈：区分获取中、候选为空、跨源待兜底、SVG-only、权限/网络/解码失败、待上传、真实完成；缺图时不提示“资料和素材已确认”。重复收藏默认保留原资料，只有显式选择才更新图标；历史缺图可通过自动兜底、卡片菜单/详情刷新或设置批量修复补图，已有较新/自定义图标不覆盖。