# ALCO — VPS Deploy Runbook (M6 Phase B)

Target: Ubuntu 24.04 VPS · Docker · nginx + Let's Encrypt
Domain: **https://alco.funapp.live** (apex alternative: alco.kmnapps.xyz)
App port (host loopback): `127.0.0.1:3101` → container `:3000`

> Phase A (this repo state) ships deploy *artifacts* only. Nothing below has
> been executed — Phase B runs each step for real.

## 1. Postgres — create role + database

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE shweos WITH LOGIN PASSWORD '<strong-random-password>';
CREATE DATABASE shweosdb OWNER shweos;
SQL
```

## 2. Build the image (on the VPS, or build locally and ship the tarball)

```bash
cd ~/workspace/alco-os/app   # or wherever the source lives on the VPS
docker build -t alco-os:v1.0.0 .
```

## 3. Environment file (on the VPS, mode 600 — never in git)

```bash
install -m 600 /dev/null /opt/apps/alco-os/.env
```

Required values (`cp` the repo `.env.example` as a template):

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://shweos:<pw>@127.0.0.1:5432/shweosdb` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` output |
| `BETTER_AUTH_URL` | `https://alco.funapp.live` |
| `AI_PROVIDER` | OpenAI-compatible gateway id (NOT `mock`) |
| `AI_BASE_URL` | e.g. `https://api.relaymodels.com/v1` |
| `AI_API_KEY` | gateway secret — server env only, FALLBACK (optional when all users use BYO keys) |
| `APP_ENCRYPTION_KEY` | `openssl rand -hex 32` output — REQUIRED for BYO key encryption |
| `AI_DEFAULT_MODEL` | bare model id, e.g. `gemini-3.8-flash` |
| `AI_MODELS` | comma-separated ids for the chat selector (optional) |
| `SANDBOX_DRIVER` | `docker` |
| `STORAGE_DIR` | `/app/storage` (matches the image VOLUME) |
| `ADMIN_EMAILS` | owner email(s), comma-separated |
| `AI_TOKENS_DAILY_CAP` | `200000` (tune later) |
| `SANDBOX_MINUTES_DAILY_CAP` | `10` |
| `RATE_LIMIT_PER_MINUTE` / `AUTH_RATE_LIMIT_PER_MINUTE` | `60` / `20` |

AI features degrade **honestly** when the key is missing (the API returns a
`config` error, never a fake reply) — but production must set it.

## 4. Migrate the database (one-off, before first start)

```bash
docker run --rm --env-file /opt/apps/alco-os/.env alco-os:v1.0.0 \
  npx prisma migrate deploy
```

## 5. Run the container

```bash
docker volume create alco-storage
docker run -d --name alco-os --restart unless-stopped \
  --env-file /opt/apps/alco-os/.env \
  -p 127.0.0.1:3101:3000 \
  -v alco-storage:/app/storage \
  alco-os:v1.0.0
```

Notes:
- The image runs as non-root (`nextjs` uid 1001); `/app/storage` is a named
  volume so git-backed project repos survive image upgrades.
- The Docker **driver** needs the host Docker socket for sandbox runs:
  add `-v /var/run/docker.sock:/var/run/docker.sock` ONLY if sandbox
  execution is enabled for users; the sandbox containers themselves stay
  fully restricted (see ARCHITECTURE.md). Without the socket the driver
  fails closed with a clear error.
- Quotas and the rate limiter are in-memory (single instance). Moving to
  PM2-cluster or multi-host later requires Redis — see checklist.

## 6. nginx reverse proxy + Let's Encrypt

```nginx
# /etc/nginx/sites-available/alco.funapp.live
server {
    listen 80;
    server_name alco.funapp.live;
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name alco.funapp.live;

    ssl_certificate     /etc/letsencrypt/live/alco.funapp.live/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/alco.funapp.live/privkey.pem;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # SSE streaming (chat / builder / sandbox logs)
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/alco.funapp.live /etc/nginx/sites-enabled/
sudo certbot --nginx -d alco.funapp.live   # or: certbot certonly --nginx
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Health checks

```bash
curl -s http://127.0.0.1:3101/api/health
# {"ok":true,"db":true}
curl -sk https://alco.funapp.live/api/health
docker inspect --format='{{.State.Health.Status}}' alco-os
```

## 8. Rollback

Every deploy is an immutable image tag. To roll back:

```bash
docker stop alco-os && docker rm alco-os
docker run -d --name alco-os --restart unless-stopped \
  --env-file /opt/apps/alco-os/.env \
  -p 127.0.0.1:3101:3000 \
  -v alco-storage:/app/storage \
  alco-os:<previous-tag>
```

Database rollbacks: `prisma migrate resolve` — forward-only; never
`db push` against production. Test restores from `pg_dump` first.

## 9. Backups

```bash
# Nightly pg_dump (cron) — keep 7 days
pg_dump -h 127.0.0.1 -U shweos shweosdb | gzip > /root/backups/alcoos-$(date +%F).sql.gz
# Project git repos live in the alco-storage volume — back it up too:
docker run --rm -v alco-storage:/data -v /root/backups:/b alpine \
  tar czf /b/alco-storage-$(date +%F).tar.gz -C /data .
```

## Production readiness checklist

- [ ] `BETTER_AUTH_SECRET` is a fresh random 32+ char value (not the example)
- [ ] `ADMIN_EMAILS` set to the owner's email(s)
- [ ] `APP_ENCRYPTION_KEY` set (32-byte hex, `openssl rand -hex 32`) — REQUIRED for BYO keys; app fails closed without it
- [ ] `AI_API_KEY` in server env = fallback only (optional when all users use BYO keys in Settings)
- [ ] `SANDBOX_DRIVER=docker`; `SANDBOX_ALLOW_LOCAL` is NOT set
- [ ] `.env` file is mode 600, owned by root, not in git
- [ ] `prisma migrate deploy` applied; app boots and `/api/health` → `{"ok":true,"db":true}`
- [ ] nginx serves `https://alco.funapp.live` with valid cert; SSE endpoints stream (test `/chat`)
- [ ] Quotas sane for launch (`AI_TOKENS_DAILY_CAP`, `SANDBOX_MINUTES_DAILY_CAP`)
- [ ] Nightly `pg_dump` + storage-volume backup cron installed and tested (restore drill)
- [ ] Log retention decided (container logs: `docker logs --log-opt max-size=50m --log-opt max-file=5`)
- [ ] Redis planned before any second instance (rate limiter + quotas + preview registry are in-memory)
- [ ] Password-reset emails: Resend key wired (currently reset links are server-logged — see `src/lib/auth.ts` TODO)
- [ ] Rollback image tag of the previous release kept (`docker images`)
