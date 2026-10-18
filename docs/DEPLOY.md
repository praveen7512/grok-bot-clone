# Deploying BotClone

BotClone needs a Docker daemon to give each bot a real container. Choose how to deploy based on whether your host gives you one:

| Target | Sandboxes | Screen share | Effort |
|---|---|---|---|
| **VPS / VM with Docker** (Hetzner, DigitalOcean, Lightsail, EC2, GCP…) | Docker, fully isolated | Yes | ~15 min |
| **Fly.io Machine with Docker inside** (advanced) | Docker | Yes | ~45 min |
| **Railway / Render / Fly app (no Docker)** | Demo subprocess mode | No | ~10 min |

---

## 1. VPS with Docker (recommended for production)

Use any Ubuntu 22.04/24.04 VM with 2 vCPU and 4 GB RAM. That is enough for roughly 4–6 active bots at the default limit of 512 MB each.

```bash
# on the server
curl -fsSL https://get.docker.com | sh
git clone https://github.com/<you>/grok-bot-clone.git botclone && cd botclone
cp .env.example .env
nano .env     # ANTHROPIC_API_KEY, OWNER_PASSWORD (strong!), SESSION_SECRET=$(openssl rand -hex 32), COOKIE_SECURE=true
docker compose up -d --build
```

The app listens on `127.0.0.1:8787` only. Put a TLS reverse proxy in front of it. With **Caddy** (automatic HTTPS):

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'CADDY'
bots.example.com {
    reverse_proxy 127.0.0.1:8787
}
CADDY
sudo systemctl reload caddy
```

Caddy proxies WebSockets (used for screen sharing) and keeps SSE (used for chat streaming) unbuffered by default. If you use **nginx**, add `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_buffering off;`.

Operations:

```bash
docker compose logs -f app          # structured JSON logs
docker compose pull && docker compose up -d --build   # update
docker ps --filter label=botclone.managed=true         # bot containers
# backup: the SQLite DB lives in the botclone-data volume
docker run --rm -v botclone_botclone-data:/data -v $PWD:/backup debian tar czf /backup/botclone-data.tgz /data
```

Hardening checklist:
- Dedicate this VM to BotClone, because the app container controls the Docker daemon.
- Set `SANDBOX_NETWORK=isolated` if bots don't need the internet.
- Firewall: allow only 80 and 443. The compose file already binds the app to localhost.

## 2. Railway / Render / Fly.io (demo mode, no Docker)

These platforms run your container but don't give it a Docker daemon. BotClone detects this and falls back to **demo mode**: each bot gets a restricted working directory with a scrubbed environment, ulimits and timeouts. Chat, memory, voice and isolation of history and memory all work. There is **no desktop or screen sharing**, and the shell sandbox is **not a security boundary**, so use this mode for demos only.

Common settings:
- Build from the repo's `Dockerfile`.
- Env vars: `ANTHROPIC_API_KEY`, `OWNER_PASSWORD`, `SESSION_SECRET`, `SANDBOX_MODE=subprocess`, `COOKIE_SECURE=true`.
- Attach a persistent volume at `/data` so bots and memories survive redeploys.
- Health check path: `/api/health`.

**Railway**: New Project → Deploy from GitHub repo → it detects the `Dockerfile` → add the variables → Settings → add a Volume mounted at `/data` → Networking → Generate Domain.

**Render**: New → Web Service → repo → Runtime: Docker → add the env vars → add a Disk mounted at `/data` (paid plans) → health check `/api/health`.

**Fly.io**:
```bash
fly launch --no-deploy            # pick a name/region; it uses the Dockerfile
fly volumes create botclone_data --size 1
# in fly.toml:
#   [mounts]  source = "botclone_data"  destination = "/data"
#   [http_service] internal_port = 8787
fly secrets set ANTHROPIC_API_KEY=sk-ant-... OWNER_PASSWORD=... SESSION_SECRET=$(openssl rand -hex 32) SANDBOX_MODE=subprocess COOKIE_SECURE=true
fly deploy
```

## 3. Full sandboxes on a PaaS (advanced)

To get real per-bot containers without managing a VPS, run the app on a host that provides a Docker daemon. Options include a Fly.io Machine running `dockerd` (Docker-in-Docker, needs a larger machine) or a managed VM service. Point `DOCKER_SOCKET` (or `DOCKER_HOST`) at that daemon and set `SANDBOX_MODE=docker`. The orchestrator only talks to the Docker Engine API, so any reachable daemon works. Nested Docker setups were **not** tested as part of this release.

## Smoke test after deploy

```bash
curl -s https://bots.example.com/api/health
# {"ok":true,"llm":"claude:claude-sonnet-5-5","demoLlm":false,"sandbox":{"mode":"docker","defaultKind":"docker","dockerReachable":true,...}}
```

Then sign in, create a bot, ask it to "run uname -a", and say "show me your computer".
