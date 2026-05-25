# Cloudflare Pages Deployment

This guide deploys the React frontend (`web/`) to Cloudflare Pages
for the POC. Per ADR D14: Cloudflare Pages serves the static build,
talks to Supabase Cloud directly, and to the Fly.io engine api over
HTTPS. Cloudflare handles its own builds via its Git integration —
no GitHub Actions workflow needed for the frontend.

Phase 0.7 task; needs Phase 0.4 (frontend scaffold) and 0.6 (Fly
deploy of the api) to be done first.

---

## Prerequisites

- A Cloudflare account ([cloudflare.com](https://dash.cloudflare.com/sign-up)).
  Pages is on the free tier; nothing to pay at POC scale.
- The Fly.io app deployed from chunk 0.6 — you'll need its public
  hostname (e.g. `https://pgpe-engine-poc.fly.dev`) as
  `VITE_API_URL`.
- The Supabase anon key + project URL (already used locally in
  `web/.env.local`).

---

## Step 1 — Connect the repo to Pages

In the Cloudflare dashboard:

1. Sidebar → **Workers & Pages** → **Create application** →
   **Pages** tab → **Connect to Git**.
2. Authorize Cloudflare to access the `dventimisupabase/pg-policy-engine`
   repository on GitHub. Pick the repo from the list.
3. **Project name**: `pgpe-poc` (or similar). This becomes the
   subdomain: `https://pgpe-poc.pages.dev`.
4. **Production branch**: `main`.

---

## Step 2 — Configure build settings

In the same flow, fill in **Build settings**:

| Field | Value |
|-------|-------|
| **Framework preset** | None (Vite isn't in the preset list as a top-level option; manual config is more reliable than the Vite preset anyway) |
| **Build command** | `cd web && npm install && npm run build` |
| **Build output directory** | `web/dist` |
| **Root directory** | *(leave blank — defaults to repo root)* |
| **Environment variables** | see Step 3 below |

The build runs Node 22 (Cloudflare's current default; matches what we
use in compose). Vite's build outputs static assets under `web/dist`
which Cloudflare serves as-is.

---

## Step 3 — Set environment variables

In the build configuration, expand **Environment variables** and add
three for the **Production** environment:

| Name                       | Value                                                           |
|----------------------------|-----------------------------------------------------------------|
| `VITE_SUPABASE_URL`        | `https://lqapmmlwmpffbqaqtvtc.supabase.co`                       |
| `VITE_SUPABASE_ANON_KEY`   | *(your anon key — copy from `~/.pgpe-supabase-keys.env`)*       |
| `VITE_API_URL`             | `https://pgpe-engine-poc.fly.dev` (your Fly app's URL from 0.6) |

These are baked into the build at compile time (Vite replaces
`import.meta.env.VITE_*` with the values at build).

You can also set the same vars for the **Preview** environment if
you want PR preview deploys to hit the same Supabase / Fly app
(useful) — or leave Preview unset and PR previews won't have working
auth.

---

## Step 4 — First deploy

Click **Save and Deploy**. Cloudflare:
1. Pulls the repo at `main`'s current commit
2. Runs the build command
3. Uploads `web/dist` to the global CDN
4. Returns a deploy URL

First deploy takes ~3-5 minutes (npm install + Vite build). Watch
the build log live in the dashboard.

Note the production URL — it'll be `https://pgpe-poc.pages.dev`
(plus a per-deploy URL like `https://<hash>.pgpe-poc.pages.dev` for
each commit).

---

## Step 5 — Update Fly's `ALLOWED_ORIGINS`

The Ktor api's CORS plugin only allows origins listed in
`ALLOWED_ORIGINS`. Until now we had `http://localhost:5173`; add the
Pages URL so the deployed frontend can call the deployed api:

```bash
flyctl secrets set \
  ALLOWED_ORIGINS="http://localhost:5173,https://pgpe-poc.pages.dev"
```

(Both stay on the list — comma-separated — so local dev keeps working
against the deployed api too.)

Setting a secret triggers a Fly machine restart; takes ~20 seconds.

If you also want per-deploy preview URLs allowed (e.g.
`https://<hash>.pgpe-poc.pages.dev`), you can add a wildcard origin:

```bash
flyctl secrets set \
  ALLOWED_ORIGINS="http://localhost:5173,https://pgpe-poc.pages.dev,https://*.pgpe-poc.pages.dev"
```

Wildcards are supported by Ktor's CORS plugin via host matching.

---

## Step 6 — Update Supabase Auth's allowed redirect URLs

Supabase Auth's "Site URL" and "Redirect URLs" determine where the
magic link can send you back to. Add the Pages URL:

1. Supabase dashboard → **Authentication → URL Configuration**.
2. **Site URL**: leave as `http://localhost:5173` (this is the
   default redirect when no `redirectTo` override is supplied — keep
   it pointing at local dev).
3. **Additional Redirect URLs**: add `https://pgpe-poc.pages.dev/**`
   so magic-link clicks coming from the deployed frontend can complete.

---

## Step 7 — Verify end-to-end

Open `https://pgpe-poc.pages.dev` in your browser. Run the same flow
as Phase 0.4:

1. Enter your email, click **Send magic link**.
2. Check email, click the link → should redirect to the Pages URL,
   signed in.
3. Click **Call /healthz** → should return
   `{"status":"ok","service":"pgpe-api"}` (this proves
   Frontend → Fly api with CORS working).

If the healthz call fails with a CORS error, double-check Step 5
(the Fly `ALLOWED_ORIGINS` secret includes the Pages URL).
If sign-in fails to redirect, double-check Step 6 (Supabase's
allowed redirect URLs).

That completes Phase 0.7.

---

## How redeploys work

Every push to `main` automatically triggers a new Pages production
deploy. Every PR also gets its own preview deploy at a per-PR URL.
The Cloudflare dashboard's **Deployments** tab shows the history.

No GitHub Actions configuration needed for the frontend — Cloudflare
handles it. (Phase 0.8 covers the Fly side: push-to-main triggers a
Fly redeploy via Actions.)

## Custom domain (optional, deferred)

If/when you want `pgpe.something.com` instead of the `.pages.dev`
URL: Cloudflare → Pages project → **Custom domains** → **Set up a
custom domain**. Requires the domain to be on Cloudflare DNS. Not a
v1 requirement; defer.

## Tearing down

If you ever need to remove the project: Cloudflare → Pages → project
→ **Settings** → **Delete project**. Free; takes effect immediately.
