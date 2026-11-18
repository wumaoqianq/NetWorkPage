#!/bin/sh
set -eu
if [ -z "${SECRET_KEY:-}" ]; then
    echo "SECRET_KEY is required" >&2
    exit 1
fi
python manage.py migrate --noinput
exec "$@"
