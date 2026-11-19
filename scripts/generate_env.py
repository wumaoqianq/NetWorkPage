"""创建仅本机保存的新环境文件；密钥永不写入终端。"""

import argparse
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet


def generate_env(destination, public_url):
    url = urlsplit(public_url)
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        raise ValueError("Production PUBLIC_URL must use HTTPS without credentials")
    if url.path not in ("", "/") or url.query or url.fragment:
        raise ValueError("PUBLIC_URL must contain only an HTTPS origin")
    origin = f"https://{url.netloc}"
    contents = [
        "# Private generated configuration; never commit or include in releases.",
        "DEBUG=False", "COOKIE_SECURE=True", "TRUST_PROXY=True", "SECURE_SSL_REDIRECT=True",
        f"PUBLIC_URL={origin}", f"ALLOWED_HOSTS={url.hostname}",
        f"CSRF_TRUSTED_ORIGINS={origin}", "DATA_DIR=/var/lib/website-workspace",
        "BACKUP_MAX_BYTES=1073741824",
        f"SECRET_KEY={secrets.token_urlsafe(64)}", f"SETUP_TOKEN={secrets.token_urlsafe(48)}",
        f"BACKUP_KEY={Fernet.generate_key().decode('ascii')}",
    ]
    # O_EXCL 保证重复运行不覆盖现有生产秘密；POSIX 下创建即为 0600。
    destination = Path(destination)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
        stream.write("\n".join(contents) + "\n")
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(".env.local"))
    parser.add_argument("--public-url", required=True)
    arguments = parser.parse_args()
    generate_env(arguments.output, arguments.public_url)
    print("Private configuration created; key values were not printed. Store an offline backup of BACKUP_KEY.")


if __name__ == "__main__":
    main()
