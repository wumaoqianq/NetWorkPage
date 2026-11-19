"""使用 cryptography 标准 AES-GCM/HKDF，按 1MiB 分块处理备份。"""

import base64
import binascii
import os
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

MAGIC = b"WWBK\x01GCM"
SALT_BYTES = 16
NONCE_BYTES = 12
HEADER_BYTES = len(MAGIC) + SALT_BYTES + NONCE_BYTES
TAG_BYTES = 16
CHUNK_BYTES = 1024 * 1024
LEGACY_MAX_BYTES = 32 * 1024 * 1024
GCM_MAX_BYTES = (1 << 36) - 32
HKDF_INFO = b"website-workspace/sqlite-backup/aes256gcm/v1"


def decode_key(key):
    """沿用 Fernet 的 URL-safe base64 编码，但将 32 字节随机主密钥分域派生。"""
    if isinstance(key, str):
        key = key.encode("ascii")
    try:
        master = base64.b64decode(key, altchars=b"-_", validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("BACKUP_KEY must be a base64 encoded 32-byte random key") from error
    if len(master) != 32:
        raise ValueError("BACKUP_KEY must be a base64 encoded 32-byte random key")
    return master


def validate_budget(max_bytes):
    if not isinstance(max_bytes, int) or not 0 < max_bytes <= GCM_MAX_BYTES:
        raise ValueError("Backup disk budget must be positive and within the AES-GCM per-message limit")


def derive_key(master, salt):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=HKDF_INFO).derive(master)


def private_writer(path):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    return os.fdopen(descriptor, "wb")


def flush_file(stream):
    stream.flush()
    os.fsync(stream.fileno())


def encrypt_file(source, target, key, max_bytes):
    """随机 salt 和 nonce；魔数、版本、salt、nonce 全部纳入 AAD 认证。"""
    validate_budget(max_bytes)
    master = decode_key(key)
    salt, nonce = os.urandom(SALT_BYTES), os.urandom(NONCE_BYTES)
    header = MAGIC + salt + nonce
    encryptor = Cipher(algorithms.AES(derive_key(master, salt)), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(header)
    processed = 0
    with Path(source).open("rb") as incoming, private_writer(target) as outgoing:
        outgoing.write(header)
        while chunk := incoming.read(CHUNK_BYTES):
            processed += len(chunk)
            if processed > max_bytes:
                raise ValueError("Snapshot exceeds configured backup disk budget")
            outgoing.write(encryptor.update(chunk))
        outgoing.write(encryptor.finalize())
        outgoing.write(encryptor.tag)
        flush_file(outgoing)


def decrypt_gcm(incoming, outgoing, key, size, max_bytes):
    if size < HEADER_BYTES + TAG_BYTES:
        raise InvalidToken("Truncated authenticated backup")
    remaining = size - HEADER_BYTES - TAG_BYTES
    if remaining > max_bytes:
        raise ValueError("Backup exceeds configured restore disk budget")
    header = incoming.read(HEADER_BYTES)
    if len(header) != HEADER_BYTES or header[:len(MAGIC)] != MAGIC:
        raise InvalidToken("Unknown backup format")
    salt, nonce = header[len(MAGIC):len(MAGIC) + SALT_BYTES], header[-NONCE_BYTES:]
    decryptor = Cipher(algorithms.AES(derive_key(decode_key(key), salt)), modes.GCM(nonce)).decryptor()
    decryptor.authenticate_additional_data(header)
    while remaining:
        chunk = incoming.read(min(CHUNK_BYTES, remaining))
        if not chunk:
            raise InvalidToken("Truncated backup ciphertext")
        remaining -= len(chunk)
        outgoing.write(decryptor.update(chunk))
    tag = incoming.read(TAG_BYTES)
    if len(tag) != TAG_BYTES or incoming.read(1):
        raise InvalidToken("Truncated or extended backup tag")
    try:
        outgoing.write(decryptor.finalize_with_tag(tag))
    except InvalidTag as error:
        raise InvalidToken("Backup authentication failed") from error


def decrypt_legacy(incoming, outgoing, key, size, max_bytes):
    """旧 Fernet 消息仍是整体认证：严格限制到 32MiB，不用于创建新备份。"""
    limit = min(max_bytes, LEGACY_MAX_BYTES)
    if size > (limit * 4 // 3) + 4096:
        raise ValueError("Legacy Fernet backup exceeds its 32MiB compatibility limit")
    plaintext = Fernet(key).decrypt(incoming.read(size + 1))
    if len(plaintext) > limit:
        raise ValueError("Legacy Fernet plaintext exceeds compatibility limit")
    outgoing.write(plaintext)


def decrypt_file(source, target, key, max_bytes):
    """未认证明文仅写入调用者提供的私有临时文件；认证失败由上层清理。"""
    validate_budget(max_bytes)
    decode_key(key)
    with Path(source).open("rb") as incoming, private_writer(target) as outgoing:
        size = os.fstat(incoming.fileno()).st_size
        prefix = incoming.read(len(MAGIC))
        incoming.seek(0)
        if prefix == MAGIC:
            decrypt_gcm(incoming, outgoing, key, size, max_bytes)
        elif prefix.startswith(b"g"):
            decrypt_legacy(incoming, outgoing, key, size, max_bytes)
        else:
            raise InvalidToken("Unknown backup format")
        flush_file(outgoing)
