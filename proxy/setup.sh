#!/usr/bin/env bash
# Idempotent setup for the chunky-radar OpenSky proxy.
# Run as root (via sudo). Pass the public hostname as $1, e.g.:
#   sudo bash setup.sh chunky-radar.example.com
set -euo pipefail

DOMAIN="${1:-${CHUNKY_RADAR_DOMAIN:-}}"
if [ -z "$DOMAIN" ]; then
  echo "usage: sudo bash setup.sh <public-hostname>" >&2
  echo "  or set CHUNKY_RADAR_DOMAIN env var" >&2
  exit 1
fi

UNIT=/etc/systemd/system/chunky-radar-proxy.service
CADDYFILE=/etc/caddy/Caddyfile
SITE_MARKER='# >>> chunky-radar proxy (managed) >>>'
SITE_END='# <<< chunky-radar proxy (managed) <<<'

echo "==> writing systemd unit"
cat > "$UNIT" <<'UNIT_EOF'
[Unit]
Description=chunky-radar OpenSky proxy
After=network.target

[Service]
Type=simple
User=tyler
WorkingDirectory=/home/tyler/chunky-radar-proxy
EnvironmentFile=/home/tyler/chunky-radar-proxy/.env
ExecStart=/usr/bin/node /home/tyler/chunky-radar-proxy/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/tyler/chunky-radar-proxy
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT_EOF

systemctl daemon-reload
systemctl enable --now chunky-radar-proxy
sleep 1
systemctl --no-pager status chunky-radar-proxy | head -6 || true

echo
echo "==> ensuring Caddy site block"
if grep -q "$SITE_MARKER" "$CADDYFILE" 2>/dev/null; then
  echo "    block already present, skipping append"
else
  cat >> "$CADDYFILE" <<CADDY_EOF

$SITE_MARKER
$DOMAIN {
    reverse_proxy localhost:8787
    encode gzip
}
$SITE_END
CADDY_EOF
  echo "    appended"
fi

caddy validate --config "$CADDYFILE" --adapter caddyfile
systemctl reload caddy
sleep 1
systemctl --no-pager status caddy | head -6 || true

echo
echo "==> local healthz"
curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8787/healthz

echo
echo "==> done. once DNS resolves you should be able to hit:"
echo "    https://$DOMAIN/healthz"
