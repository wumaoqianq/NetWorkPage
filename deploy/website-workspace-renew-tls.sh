#!/bin/sh
# 仅发布本站证书；先验证完整 PEM，再原子替换，避免续期时读到不配对的证书/私钥。
set -eu
if [ "${RENEWED_LINEAGE:-}" != /etc/letsencrypt/live/website-workspace-ip ]; then
    exit 0
fi
install -d -o root -g root -m 0700 /etc/website-workspace/tls
tls_temp=$(mktemp /etc/website-workspace/tls/.server.pem.XXXXXX)
trap 'rm -f -- "$tls_temp"' EXIT HUP INT TERM
cat "$RENEWED_LINEAGE/fullchain.pem" "$RENEWED_LINEAGE/privkey.pem" > "$tls_temp"
chown root:root "$tls_temp"
chmod 0600 "$tls_temp"
python3 - "$tls_temp" <<'PY'
import ssl
import sys
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(sys.argv[1])
PY
mv -f -- "$tls_temp" /etc/website-workspace/tls/server.pem
trap - EXIT HUP INT TERM
/usr/sbin/nginx -t -c /etc/nginx/website-workspace.conf
systemctl reload website-workspace-web.service
