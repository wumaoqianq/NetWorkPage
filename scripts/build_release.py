"""在开发机打包预编译前端；生产服务器无需 Node 或 npm。"""

import argparse
import hashlib
import io
import re
import tarfile
from datetime import datetime, timezone
from pathlib import Path

if __package__:
    from .build_extension import build_extension
else:
    from build_extension import build_extension

EXCLUDED_PARTS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache",
                  "tests", "qa", "reference", ".mypy_cache", ".ruff_cache"}
EXCLUDED_SUFFIXES = {".sqlite", ".sqlite3", ".db", ".pyc", ".pyo", ".pem", ".key",
                     ".fernet", ".wwb", ".log", ".bak", ".map"}
SECRET_ASSIGNMENT = re.compile(
    r'''(?im)^\s*(?:SECRET_KEY|SETUP_TOKEN|BACKUP_KEY|[A-Z_]*API_KEY|DATABASE_PASSWORD)\s*=\s*["']([^"'\r\n]{16,})["']\s*$'''
)
TOKEN_PATTERN = re.compile(rb"(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)")


def allowed_file(path, root):
    relative = path.relative_to(root)
    if path.is_symlink() or not path.is_file():
        return False
    if any(part in EXCLUDED_PARTS or part.startswith(".env") for part in relative.parts):
        return False
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    if path.name.endswith(("-wal", "-shm")) or "credential" in path.name.lower():
        return False
    return path.resolve().is_relative_to(root.resolve())


def inspect_content(path, content, known_secrets):
    """检查已知本机秘密和常见硬编码；拒绝时只显示路径，绝不回显匹配内容。"""
    if TOKEN_PATTERN.search(content):
        raise ValueError(f"Possible credential in release input: {path}")
    if any(secret in content for secret in known_secrets):
        raise ValueError(f"Local secret found in release input: {path}")
    if path.suffix in {".py", ".js", ".mjs", ".jsx", ".ts", ".tsx", ".yaml", ".yml", ".toml"}:
        for match in SECRET_ASSIGNMENT.finditer(content.decode("utf-8", errors="replace")):
            if not any(word in match[1].lower() for word in ("example", "placeholder", "change-me", "replace")):
                raise ValueError(f"Literal secret assignment in release input: {path}")


def local_secret_values(root):
    values = []
    for path in root.glob(".env*"):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            name, separator, value = line.partition("=")
            if separator and any(marker in name.upper() for marker in ("KEY", "TOKEN", "PASSWORD", "SECRET")):
                value = value.strip().strip("\"'")
                if len(value) >= 16:
                    values.append(value.encode("utf-8"))
    return values


def release_files(root):
    files = set()
    for directory in ("server", "extension", "deploy", "scripts", "docs", "prototype/dist/client"):
        path = root / directory
        if path.exists():
            files.update(candidate for candidate in path.rglob("*") if allowed_file(candidate, root))
    files.update(path for path in root.glob("requirements*.txt") if allowed_file(path, root))
    for name in ("requirements.lock", "README.md", "LICENSE", "LICENSE.md"):
        path = root / name
        if allowed_file(path, root):
            files.add(path)
    return sorted(files)


def build_release(root, output):
    root, output = Path(root).resolve(), Path(output).resolve()
    if (root / 'extension' / 'manifest.json').is_file():
        build_extension(root, run_checks=True)
    for required in ("server/manage.py", "prototype/dist/client/index.html", "requirements.txt"):
        if not (root / required).is_file():
            raise FileNotFoundError(f"Missing release input: {required}; build frontend on development machine first")
    secrets = local_secret_values(root)
    files = release_files(root)
    # 先审查全部输入，再创建归档；归档内容使用同一份已审查字节，避免检查后文件被改写。
    reviewed = []
    for path in files:
        content = path.read_bytes()
        inspect_content(path.relative_to(root), content, secrets)
        reviewed.append((path.relative_to(root).as_posix(), content))
    output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    archive = output / f"website-workspace-{stamp}.tar.gz"
    with tarfile.open(archive, mode="x:gz") as bundle:
        for relative, content in reviewed:
            info = tarfile.TarInfo(f"website-workspace/{relative}")
            info.size, info.mode = len(content), 0o644
            bundle.addfile(info, io.BytesIO(content))
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    Path(str(archive) + ".sha256").write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    return archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    archive = build_release(arguments.root, arguments.output or arguments.root / "release")
    print(f"Release created and secret scan passed: {archive.name}")
    print(f"SHA256: {archive.name}.sha256")


if __name__ == "__main__":
    main()
