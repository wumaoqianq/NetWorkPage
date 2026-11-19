# 加密备份格式 v1 / 含媒体容器 v2

实现入口：`scripts/backup.py` 管理快照、临时目录、独立恢复和保留；`scripts/backup_crypto.py` 调用 cryptography 的 `Cipher(AES, GCM)` 与 `HKDF(SHA256)`。没有自行实现密码算法。新增备份统一为 `ww-backup-UTC时间-随机ID.sqlite3.wwb`。

## 二进制布局

| 偏移 | 长度 | 内容 |
| --- | --- | --- |
| 0 | 8 bytes | 固定魔数/版本 `57 57 42 4b 01 47 43 4d`，即 `WWBK` + `01` + `GCM` |
| 8 | 16 bytes | 每次 `os.urandom(16)` 的随机 salt |
| 24 | 12 bytes | 每次 `os.urandom(12)` 的随机 GCM nonce |
| 36 | SQLite 快照长度 | AES-256-GCM 密文，无压缩、无填充 |
| 文件末尾 | 16 bytes | 完整 128-bit GCM tag，不截短 |

整个 36-byte 头作为 additional authenticated data（AAD）。头可公开，但任意版本、salt、nonce 修改都会导致格式拒绝或认证失败；密文或 tag 修改、截断和追加也不能通过认证。文件长度和文件名中的备份时间属于可见元信息。

`BACKUP_KEY` 继续使用原有 Fernet 配置格式：URL-safe base64 编码的 **32 字节随机主密钥**，不是人工口令。每份备份执行：

```text
HKDF-SHA256(
    input_key_material = decode_base64(BACKUP_KEY),
    salt = header[8:24],
    info = UTF-8 "website-workspace/sqlite-backup/aes256gcm/v1",
    length = 32
)
```

使用所得 32 字节作为 AES-256 key，以头内 nonce 作为 GCM IV。密钥生成与处理使用库函数；不把主密钥或派生密钥写入文件、参数、文件名或日志。随机 salt 与 nonce 每次重新生成，不能复用固定值。HKDF 的域分隔避免直接复用主密钥作为 AES key；它不能把弱口令变成随机主密钥。

加密按不超过 1MiB 的块调用 `update`，最后 `finalize` 并写入完整 tag。解密按密文实际长度分块调用 `update`，最后用 `finalize_with_tag(tag)` 验证；具体 API 与 nonce/tag 要求见 [cryptography GCM 文档](https://cryptography.io/en/47.0.0/hazmat/primitives/symmetric-encryption/#cryptography.hazmat.primitives.ciphers.modes.GCM)，派生参数见 [HKDF 文档](https://cryptography.io/en/47.0.0/hazmat/primitives/key-derivation-functions/#hkdf)。

## 发布与恢复边界

备份先在仅应用用户可读的临时目录获得一致 SQLite 快照；磁盘预算复制前、复制中、复制后都检查。加密文件完整写盘并 `fsync` 后，通过同卷硬链接原子发布，不覆写同名文件；失败不会把半成品交给保留策略。

GCM `update` 返回的明文在最终 tag 校验之前**尚未认证**。它只写入目标父目录下权限 0700 的独立临时目录，候选文件创建即 0600；不作为数据库打开，不返回给应用、不发布到最终目标。只有 tag 校验成功、文件完整 `fsync` 且 SQLite `integrity_check` 成功之后，才以不会覆写的硬链接发布新文件。认证、截断、磁盘写入或 SQLite 校验失败时，上层清理候选文件。意外断电时可能遗留受保护的临时目录，需要停相关进程后人工检查清理。

恢复不切换生产数据库，也不替代维护窗口、数据抽查和应用级验收。切换步骤见 [部署说明](README.md#备份与独立恢复演练)。外层认证格式不变；不含媒体参数的旧调用仍只保存 SQLite。命令行默认使用 v2 容器，额外保存快照引用的图片，但不包含密钥、环境配置、未被引用文件或任何远端服务数据。

## v2 含媒体容器

- 加密前明文为 ZIP_STORED 容器：`manifest.json`、`database.sqlite3` 和 `media/<数据库相对 key>`。清单记录数据库与每个媒体文件的字节数和 SHA-256，格式版本为 2。
- 快照只读取 `workspace_previewasset` 当时引用的 key；文件缺失、路径逃逸或符号链接会终止备份。媒体目录的 `.maintenance.lock` 与 GC 互斥，新图片可继续写入，旧文件只由延迟 GC 删除。
- 恢复要求一个不存在的新媒体目录，先验证整个 GCM tag，再检查容器成员、数据库与全部媒体摘要及 SQLite 完整性，全部通过后才发布；不会只恢复数据库却静默丢掉图片。
- JSON 资料导出与这里的运维备份不同：JSON 含简介和来源元信息，不含图片二进制、私有 storage key 或 token，导入后需重新添加图片。

## 容量与兼容性

- 新格式默认快照上限 1GiB，通过 `BACKUP_MAX_BYTES` 或 `--max-bytes` 显式调整；实现拒绝超过 GCM 每消息 `2^36 - 32` 字节标准上限的配置。
- 新格式除 52-byte 固定开销外与明文等长；1MiB 分块使 Python 数据缓冲与库大小无关，SQLite/解释器/OpenSSL 内存仍由系统预算管理。
- 无压缩，避免解压炸弹与额外算法/依赖。创建临时空间约为两倍快照大小，恢复临时空间约一倍快照大小，另计保留的生产库、历史密文和 WAL。
- 检测旧 Fernet token 后调用原库 `Fernet.decrypt`；旧格式只读兼容，仍限制为最多 32MiB 明文，超过在读取整体密文前拒绝。旧格式不会被转写为新格式或自动改变密钥。
- 两种命名文件共同参加 7 个日桶与 4 个周桶保留；无关文件、符号链接和不匹配名称不删除。新 `.wwb` 与旧 `.fernet` 均被发布包工具排除。

## 已执行测试与未验证事项

`python -W error::ResourceWarning -m unittest discover -s scripts/tests -v` 覆盖：实际超过 32MiB SQLite 的完整内容往返、受控 Python 堆峰值、WAL 提交、一致快照、错误密钥、魔数/版本/salt/nonce/密文/tag 篡改、各位置截断、已有目标、写盘失败、旧格式兼容及旧格式容量拒绝、保留与路径边界。测试在 Windows 开发机运行；真实 Debian 的 RSS、磁盘容量、systemd 权限、证书及人工恢复演练仍需部署时验证。
