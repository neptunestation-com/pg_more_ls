# Cloudflare Pages Deployment

Deploys the React frontend (`web/`) to Cloudflare Pages. Per ADR D14:
Cloudflare Pages serves the static build; the frontend talks to
Supabase Cloud directly and to the Fly.io engine api over HTTPS.

Phase 0.7 task; needs Phase 0.4 (frontend scaffold), 0.6 (Fly deploy
of the api), and the project's Supabase setup (0.2) done first.

This doc uses the wrangler CLI to drive Pages — no dashboard
clicking needed if you have wrangler installed and OAuth-authenticated.

---

## Prerequisites

- A Cloudflare account ([cloudflare.com](https://dash.cloudflare.com/sign-up)).
  Pages is on the free tier; nothing to pay at POC scale.
- `wrangler` v4+ installed:
  ```bash
  npx wrangler --version
  ```
- OAuth-authenticated (Pages deploy specifically rejects API-token-only
  auth; `wrangler whoami` lists scopes but Pages needs the OAuth
  session):
  ```bash
  npx wrangler login
  ```
- The Fly.io app deployed from chunk 0.6 — you'll need its public
  hostname (e.g. `https://pgpe-engine-poc.fly.dev`) as the
  `VITE_API_URL` baked into the build.
- The Supabase anon key + project URL (already in `web/.env.local`).

---

## Step 1 — Create the Pages project

From the repo root:

```bash
npx wrangler pages project create pgpe-poc --production-branch main
```

Output confirms the project URL will be `https://pgpe-poc.pages.dev`.
The project exists on Cloudflare's side but has no deployments yet.

If `pgpe-poc` is taken globally, swap to a unique name and use it in
the deploy command below.

---

## Step 2 — Build with production env vars

Vite bakes `import.meta.env.VITE_*` values into the bundle at build
time, so we need the production `VITE_API_URL` set on the build
command. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` come from
`web/.env.local` (same Supabase project for dev and prod).

```bash
cd web
VITE_API_URL=https://pgpe-engine-poc.fly.dev npm run build
cd ..
```

Output lands in `web/dist/`. Verify by inspecting the bundle — the
Fly URL should appear in the JS chunk.

---

## Step 3 — Deploy

```bash
npx wrangler pages deploy web/dist \
  --project-name pgpe-poc \
  --branch main \
  --commit-dirty=true
```

`--commit-dirty=true` silences the warning that the git working tree
has uncommitted files (some flyctl-regenerated `fly.toml` reformat,
`web/package-lock.json` shuffle from the compose's npm install, etc.).

Output looks like:

```
✨ Success! Uploaded 4 files (2.78 sec)
🌎 Deploying...
✨ Deployment complete! Take a peek over at https://<hash>.pgpe-poc.pages.dev
```

Two URLs live now:
- Per-deploy alias: `https://<hash>.pgpe-poc.pages.dev`
- Production alias: `https://pgpe-poc.pages.dev` (always points at
  the latest production deploy)

---

## Step 4 — Tell Fly to accept the Pages origin

The Ktor api's CORS plugin only allows origins listed in
`ALLOWED_ORIGINS`. Add the Pages URL:

```bash
flyctl secrets set \
  ALLOWED_ORIGINS="http://localhost:5173,https://pgpe-poc.pages.dev"
```

Setting a Fly secret triggers a rolling restart of both api and
worker machines (~20 seconds). The api comes back with the new
origin allowed; the worker restart is incidental.

If you want per-deploy preview URLs (e.g.
`https://<hash>.pgpe-poc.pages.dev`) also allowed, add a wildcard
entry — Ktor's CORS plugin supports `*` for host matching:

```bash
flyctl secrets set \
  ALLOWED_ORIGINS="http://localhost:5173,https://pgpe-poc.pages.dev,https://*.pgpe-poc.pages.dev"
```

---

## Step 5 — Tell Supabase Auth to redirect to the Pages URL

The remote Supabase project's auth URL allowlist is managed via
`supabase/config.toml` `[auth]` and `supabase config push`. The repo's
`supabase/config.toml` already includes both localhost dev and the
Pages production URLs (plus per-deploy wildcards):

```toml
site_url = "http://localhost:5173"
additional_redirect_urls = [
  "http://localhost:5173",
  "http://localhost:5173/**",
  "https://pgpe-poc.pages.dev",
  "https://pgpe-poc.pages.dev/**",
  "https://*.pgpe-poc.pages.dev",
  "https://*.pgpe-poc.pages.dev/**",
]
```

Push to the linked Supabase project:

```bash
supabase config push --yes
```

The diff before push will show only auth URL changes (assuming nothing
else has drifted). Confirm and it propagates to the live Supabase Auth
config within seconds.

> **Caveat about `supabase config push`**: it syncs the entire
> `[auth]` block (including `[auth.email]` knobs like
> `enable_confirmations`, `max_frequency`, `otp_length`) from local to
> remote. If you change those via the dashboard, you'll want to mirror
> the change into `config.toml` to keep the next push from regressing
> them. The current values in `config.toml` are sane defaults for the
> POC.

---

## Step 6 — Verify end-to-end

Open `https://pgpe-poc.pages.dev` in your browser:

1. Enter your email → **Send magic link**. The email arrives.
2. Click the link → page redirects back to the Pages URL, signed in.
3. Click **Call /healthz** → should return
   `{"status":"ok","service":"pgpe-api"}` in green. This proves
   Frontend (Cloudflare) → Fly api (with CORS) is working end-to-end.

If sign-in redirects fail, double-check Step 5 (`supabase config push`
ran).
If `/healthz` errors with a CORS error in the browser console,
double-check Step 4 (Fly's `ALLOWED_ORIGINS` includes the Pages URL).

That completes Phase 0.7.

---

## Redeploys

```bash
# After any change to web/, rebuild and redeploy:
cd web && VITE_API_URL=https://pgpe-engine-poc.fly.dev npm run build && cd ..
npx wrangler pages deploy web/dist --project-name pgpe-poc --branch main --commit-dirty=true
```

Phase 0.8 (GitHub Actions CI/CD) will automate this on push-to-main
so you don't have to run the build + deploy by hand.

## Optional: connect to Git for auto-deploys

Wrangler CLI doesn't configure the GitHub integration; that's
dashboard-only:

1. Cloudflare dashboard → Pages → `pgpe-poc` → **Settings** →
   **Builds & deployments** → **Connect to Git**.
2. Pick the repo, branch `main`.
3. Build command: `cd web && VITE_API_URL=$VITE_API_URL npm install && npm run build`
4. Build output: `web/dist`
5. Set env var `VITE_API_URL=https://pgpe-engine-poc.fly.dev` (plus
   `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` if you removed
   `web/.env.local` from Cloudflare's build context — by default it
   isn't copied since it's gitignored).

For Phase 0.7's CLI-driven workflow we don't need this; Phase 0.8's
GitHub Actions covers the equivalent automation.

## Tearing down

```bash
npx wrangler pages project delete pgpe-poc
```

Free; takes effect immediately.
