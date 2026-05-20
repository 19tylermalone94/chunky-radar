# chunky-radar OpenSky proxy

A standalone Node service that proxies OpenSky `/states/all` and serves it with permissive CORS, so the frontend can call it directly from the browser. Exists because OpenSky filters major cloud provider IP ranges (Vercel, AWS, etc.) at the TCP level, so our Vercel function can't reach them.

This service is meant to run on a small dedicated/VPS host **outside** the big-three cloud IP space. Hetzner CX11 (€4.50/mo) works.

## What it does

- `GET /states?lamin=…&lamax=…&lomin=…&lomax=…` — proxies OpenSky, 8-second in-memory cache keyed by rounded bbox, OAuth2 client_credentials with token refresh, anonymous tier fallback on auth failure.
- `GET /healthz` — `{ "ok": true }`.
- `Access-Control-Allow-Origin: *` on every response.

## Running locally

```bash
export OPENSKY_CLIENT_ID=…
export OPENSKY_CLIENT_SECRET=…
node server.mjs                   # listens on :8787
curl http://localhost:8787/healthz
```

Zero dependencies. Requires Node 18+ for the built-in `fetch`.

## Deploying to a Hetzner CX11

Total time: ~20 minutes. Cost: €4.50/month.

### 1. Create the server

1. Make a Hetzner Cloud account at https://console.hetzner.cloud.
2. New project → **Add server**.
3. Pick **Falkenstein** (DE) or **Helsinki** (FI) — both have IP ranges OpenSky's filter doesn't catch.
4. Image: Ubuntu 24.04. Type: **CX22** (was CX11, ~€4.50/mo, 2 vCPU + 4GB).
5. SSH keys: add yours (`cat ~/.ssh/id_ed25519.pub`).
6. Hostname: `chunky-radar-proxy`. Create.

Hetzner gives you an IPv4. Note it down, e.g. `203.0.113.42`.

### 2. Point a (sub)domain at the IP

You need HTTPS because the frontend (on Vercel = https) can't call an HTTP backend. Easiest path: a free subdomain on a domain you already own.

In your DNS provider:
- Type: `A`
- Name: `radar-api` (or anything)
- Value: `203.0.113.42`
- TTL: low (e.g. 300)

Wait for propagation: `dig radar-api.yourdomain.com +short` should return the IP.

> Don't own a domain? `duckdns.org` is free and works fine for this.

### 3. SSH in and install Node + Caddy

```bash
ssh root@203.0.113.42

# Node 22 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Caddy (handles HTTPS automatically via Let's Encrypt)
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# Create a user for the service (don't run as root)
useradd --system --create-home --shell /usr/sbin/nologin chunky
```

### 4. Copy the proxy code over

From your laptop:

```bash
scp proxy/server.mjs root@203.0.113.42:/home/chunky/server.mjs
ssh root@203.0.113.42 'chown chunky:chunky /home/chunky/server.mjs'
```

### 5. Drop in the env vars

On the server:

```bash
mkdir -p /etc/chunky-radar
cat > /etc/chunky-radar/proxy.env <<'EOF'
OPENSKY_CLIENT_ID=<your client id>
OPENSKY_CLIENT_SECRET=<your client secret>
PORT=8787
EOF
chmod 600 /etc/chunky-radar/proxy.env
chown chunky:chunky /etc/chunky-radar/proxy.env
```

### 6. systemd unit

```bash
cat > /etc/systemd/system/chunky-radar-proxy.service <<'EOF'
[Unit]
Description=chunky-radar OpenSky proxy
After=network.target

[Service]
Type=simple
User=chunky
WorkingDirectory=/home/chunky
EnvironmentFile=/etc/chunky-radar/proxy.env
ExecStart=/usr/bin/node /home/chunky/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now chunky-radar-proxy
systemctl status chunky-radar-proxy   # should be active (running)
curl http://localhost:8787/healthz    # should return {"ok":true}
```

### 7. Caddy reverse proxy with auto-HTTPS

Replace `radar-api.yourdomain.com` with whatever you pointed at the IP:

```bash
cat > /etc/caddy/Caddyfile <<'EOF'
radar-api.yourdomain.com {
    reverse_proxy localhost:8787
    encode gzip
}
EOF

systemctl reload caddy
```

Caddy will fetch a Let's Encrypt cert automatically. Within a few seconds:

```bash
curl https://radar-api.yourdomain.com/healthz
# {"ok":true}
```

### 8. Verify the real endpoint

```bash
curl -i 'https://radar-api.yourdomain.com/states?lamin=46&lamax=48&lomin=8&lomax=10'
# Should return HTTP/2 200 with `access-control-allow-origin: *`
# and a JSON body with a `states` array of length ~10.
```

If that works, you're done. The frontend env can now be pointed at this URL.

## Frontend wiring

In the chunky-radar Vercel project, add:

```
NEXT_PUBLIC_STATES_BASE_URL=https://radar-api.yourdomain.com
```

The client reads it (defaults to the local `/api/states` if unset, so dev still works without the env var). Redeploy.

## Updating the proxy

When the proxy code changes:

```bash
scp proxy/server.mjs root@<ip>:/home/chunky/server.mjs
ssh root@<ip> 'systemctl restart chunky-radar-proxy'
```

## Logs

```bash
ssh root@<ip> 'journalctl -u chunky-radar-proxy -f'
```

## Firewall

Hetzner's default config exposes ports 22, 80, 443. The proxy listens on 8787 but only on `localhost` (because Caddy is the public face). If you want to lock it down further:

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```
