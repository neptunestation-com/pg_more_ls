# GitHub Actions CI/CD Setup

Phase 0.8. Three workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `engine-ci.yml` | PR to `main`, push to `main` | Runs `gradle :engine:test` |
| `fly-deploy.yml` | Push to `main` touching `engine/`, `api/`, `worker/`, `docker/`, or `fly.toml` | `flyctl deploy --remote-only` |
| `pages-deploy.yml` | Push to `main` touching `web/` | Builds with prod env vars, `wrangler pages deploy` |

Each deploy workflow also has `workflow_dispatch` so you can fire it
manually from the **Actions** tab.

---

## Required repo secrets

Open <https://github.com/dventimisupabase/pg-policy-engine/settings/secrets/actions>
and add the following **Repository secrets**:

### `FLY_API_TOKEN`

For `fly-deploy.yml`. Generate locally:

```bash
flyctl tokens create deploy -x 999999h
```

Copy the output (starts with `FlyV1`) and paste into the secret value.
This is a deploy-scoped token, not your personal API token.

### `CLOUDFLARE_API_TOKEN`

For `pages-deploy.yml`. Create at
<https://dash.cloudflare.com/profile/api-tokens> with the
**Cloudflare Pages → Edit** permission. Token name: `pgpe-pages-ci`
or similar.

Test the token works:

```bash
CLOUDFLARE_API_TOKEN=<token> npx wrangler whoami
```

### `CLOUDFLARE_ACCOUNT_ID`

For `pages-deploy.yml`. Find it in the Cloudflare dashboard sidebar
(any zone or workers page) — it's the 32-character hex string.

Or via CLI:

```bash
npx wrangler whoami
# Account ID appears in the output
```

### `VITE_SUPABASE_URL`

For `pages-deploy.yml`. Value:
`https://lqapmmlwmpffbqaqtvtc.supabase.co`

### `VITE_SUPABASE_ANON_KEY`

For `pages-deploy.yml`. Copy from `~/.pgpe-supabase-keys.env`:

```bash
grep '^SUPABASE_ANON_KEY=' ~/.pgpe-supabase-keys.env | cut -d= -f2
```

### `VITE_API_URL`

For `pages-deploy.yml`. Value: `https://pgpe-engine-poc.fly.dev`

---

## After adding the secrets

Trigger each workflow once to verify it works:

```bash
# From the local checkout, or via the Actions tab
gh workflow run engine-ci.yml
gh workflow run fly-deploy.yml
gh workflow run pages-deploy.yml
```

Or just push a trivial commit to `main` — `engine-ci` will run; if
the commit touches any deploy-relevant path, the matching deploy
workflow runs too.

Watch them:

```bash
gh run list --limit 5
gh run watch                  # picks the most recent run
```

---

## Optional: branch protection

The phasing plan §3.1 specifies one feature branch per phase merged
to `main` via PR. To enforce that and require `engine-ci` to pass
before merging:

Settings → Branches → **Add classic branch protection rule**:

- Branch name pattern: `main`
- ✓ Require a pull request before merging
- ✓ Require status checks to pass before merging
  - Select `engine-ci / test` from the list
- ✓ Require branches to be up to date before merging
- ✓ Do not allow bypassing the above settings *(optional;
  uncheck if you want admin bypass)*

For the POC we've been pushing directly to `main`. Branch protection
is optional polish — turn it on when you want to stop force-pushing
quick fixes.

---

## What's not in CI

- **pgTAP tests** (`supabase test db`). They need Supabase
  credentials in CI and would either hit the prod project (risky;
  side-effects from in-flight test data) or stand up a temporary
  test project (more infra). Deferred to Phase 1+.
- **Frontend tests**. None exist yet (Vitest setup is Phase 1+
  when the schema overlay component lands).
- **Cloudflare Pages preview deploys per PR**. The CLI-driven Pages
  flow ships only `main` deploys. PR previews are available via the
  dashboard's Git integration if we later wire it up.

---

## Tearing down a workflow

Disable from the Actions tab (per-workflow toggle) or delete the
file in `.github/workflows/`.
