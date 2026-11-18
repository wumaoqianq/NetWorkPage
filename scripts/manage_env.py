"""加载私有 env 文件后运行 Django 命令，不把秘密放入命令参数。"""

import argparse
import os
import runpy
import sys
from pathlib import Path

from backup import load_environment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("django_args", nargs=argparse.REMAINDER)
    arguments = parser.parse_args()
    if not arguments.django_args:
        parser.error("A Django management command is required")
    load_environment(arguments.env_file)
    server = Path(__file__).resolve().parents[1] / "server"
    os.chdir(server)
    sys.path.insert(0, str(server))
    sys.argv = [str(server / "manage.py"), *arguments.django_args]
    runpy.run_path(str(server / "manage.py"), run_name="__main__")


if __name__ == "__main__":
    main()
