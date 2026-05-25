# Fly.io Deployment

This guide walks you through deploying the engine services (api +
worker) to Fly.io for the POC. Per ADR D14, both processes share a
single Fly app and a single Docker image, dispatched at runtime via
`docker/entrypoint.sh`.

Phase 0.6 task; needs Phase 0.2 (Supabase project) and 0.3 (Docker
image) to be done first.

---

## Prerequisites

- A Fly.io account ([fly.io](https://fly.io/app/sign-up)) with billing
  enabled. The POC runs on `shared-cpu-1x` + 1 GB memory machines
  (~$5/mo per machine; two machines = ~$10/mo at this sizing).
- The `flyctl` CLI installed and authenticated:
  ```bash
  flyctl auth whoami
  ```
- The repo's `fly.toml` at the root (committed; do not edit by hand
  unless you're changing the deployment shape).
- The Supabase credentials stored locally (see `supabase/README.md`
  "Local credentials"):
  - `~/.pgpe-supabase-db-password`
  - `~/.pgpe-supabase-keys.env`

---

## Step 1 — Create the Fly app

From the repo root:

```bash
flyctl launch --copy-config --no-deploy
```

`--copy-config` tells flyctl to use the existing `fly.toml` instead
of generating a new one. `--no-deploy` skips the initial deploy so we
can set secrets first.

flyctl will:
- Prompt for an app name — the default `pgpe-engine-poc` is suggested;
  if that name is already taken on Fly, pick a different one (e.g.
  `pgpe-engine-poc-<your-handle>`). If you change the name, update
  the `app = "..."` line at the top of `fly.toml`.
- Confirm the primary region (`iad` / Ashburn, VA — keep this; it's
  geographically close to the Supabase POC project in us-east-1).
- Create the app on Fly. No machines are launched yet.

---

## Step 2 — Set secrets

The non-sensitive defaults (`PORT`, `PGMQ_PLACEHOLDER_QUEUE`,
`WORKER_POLL_SECONDS`) are baked into `fly.toml`. Sensitive values
go to Fly secrets:

```bash
PROJECT_REF=lqapmmlwmpffbqaqtvtc
PW=$(cat ~/.pgpe-supabase-db-password)
ANON=$(grep '^SUPABASE_ANON_KEY=' ~/.pgpe-supabase-keys.env | cut -d= -f2)
SRK=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' ~/.pgpe-supabase-keys.env | cut -d= -f2)

flyctl secrets set \
  SUPABASE_URL="https://${PROJECT_REF}.supabase.co" \
  SUPABASE_ANON_KEY="${ANON}" \
  SUPABASE_SERVICE_ROLE_KEY="${SRK}" \
  SUPABASE_DB_URL="jdbc:postgresql://db.${PROJECT_REF}.supabase.co:5432/postgres?user=postgres&password=${PW}&sslmode=require" \
  ALLOWED_ORIGINS="http://localhost:5173"
```

> `ALLOWED_ORIGINS` is set to localhost for now so you can hit the
> deployed api from local frontend dev during chunk 0.6 verification.
> Phase 0.7 (Cloudflare Pages) will extend it to the production
> frontend URL.

Verify secrets are set (only names, no values shown):

```bash
flyctl secrets list
```

---

## Step 3 — Deploy

```bash
flyctl deploy
```

flyctl will:
- Push the build context up to Fly
- Build the Docker image remotely (faster than local build for most
  Mac dev setups — Fly builds on native amd64 hardware)
- Roll out one machine per process group: one for `http`, one for
  `worker`
- Run the `/healthz` check on the http machine before promoting

First deploy can take 5-10 minutes (image build + push). Subsequent
deploys use cached layers and finish in 1-2 minutes.

---

## Step 4 — Verify

Get the public URL:

```bash
flyctl status
```

It'll show the hostname (something like `pgpe-engine-poc.fly.dev`).

```bash
APP_URL=$(flyctl status --json | jq -r '.Hostname')
curl https://${APP_URL}/healthz
# -> {"status":"ok","service":"pgpe-api"}
```

Check both machines are running:

```bash
flyctl machines list
```

You should see two machines: one with process group `http`, one with
`worker`. Both should show state `started`.

Tail logs to confirm the worker is polling:

```bash
flyctl logs --process-group worker
# -> ... alive — no messages on 'q_placeholder'
```

And the api is serving:

```bash
flyctl logs --process-group http
# -> ... Starting pgpe-api on 0.0.0.0:8080
# -> ... Application started ...
```

---

## What gets exposed publicly

- `https://<app-name>.fly.dev/healthz` — public, no auth (Phase 1
  will add JWT verification to non-healthz routes).
- Worker has no public ports; only the http process group is in
  `[http_service].processes`.

## Updating secrets later

```bash
flyctl secrets set ALLOWED_ORIGINS="http://localhost:5173,https://your-pages.pages.dev"
```

A secret update triggers a rolling restart of all machines so they
pick up the new env.

## Updating the deployment

After any commit to `main`, redeploy with:

```bash
flyctl deploy
```

Phase 0.8 (GitHub Actions CI/CD) will automate this on push to
`main` — no manual deploys needed once that's wired.

## Tearing down

If you ever need to delete the app:

```bash
flyctl apps destroy pgpe-engine-poc
```

This stops billing immediately.
