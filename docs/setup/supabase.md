# Supabase Project Setup

This guide walks you through provisioning the Supabase Cloud project
that backs the pg-policy-engine web app. The web app uses Supabase
for backend Postgres, PostgREST (auto REST), Realtime, Auth, pgmq
(job queue), and Vault (secret storage) — see
[`spec/web-app-architecture-decision.md`](../../spec/web-app-architecture-decision.md)
for the rationale.

This is a Phase 0.2 task. Do it once before any other Phase 0 work
that needs the project to exist (Phase 0.3+).

---

## Prerequisites

- A Supabase account ([supabase.com](https://supabase.com)) with
  permission to create new projects in an organization you choose.
- A Google Cloud account with permission to create OAuth 2.0 clients
  (only required if you'll use Google OAuth — see Step 3).
- The `supabase` CLI installed locally (`brew install supabase/tap/supabase`
  on macOS; you already have this if `which supabase` returns a path).

---

## Step 1 — Create the Supabase project

1. Sign in to [supabase.com/dashboard](https://supabase.com/dashboard).
2. Click **New Project**.
3. Pick:
   - **Name**: `pgpe-poc` (or something equivalent; this is internal).
   - **Database Password**: generate a strong one and save it in your
     password manager. You won't need it day-to-day but you will if
     you ever connect with `psql` directly.
   - **Region**: pick a region close to wherever you'll deploy the
     Fly.io engine services (Phase 0.6). For most US-based POC work,
     `us-east-1` or `us-west-1` is fine.
   - **Plan**: Free is sufficient for the POC.
4. Click **Create new project**. Provisioning takes a couple of minutes.

Once provisioned, note the project reference — it's the
random-looking string in the URL bar (e.g.,
`https://supabase.com/dashboard/project/abcdefghijklmnop`). The
**project ref** is `abcdefghijklmnop`. You'll use it several times.

---

## Step 2 — Enable required extensions

The web app uses two Postgres extensions beyond the Supabase defaults:

- **pgmq** — persistent message queue (Phase 0.3 onward, used to
  schedule background engine jobs)
- **pgsodium** — symmetric encryption primitives (Supabase Vault is
  built on it; we use it to store target-database credentials)

In the Supabase dashboard:

1. Navigate to **Database → Extensions**.
2. Search for `pgmq` and click **Enable**. Accept defaults.
3. Search for `pgsodium` and click **Enable**. (Vault becomes
   available automatically once pgsodium is enabled.)

To verify, run this in the SQL Editor:

```sql
select extname, extversion from pg_extension
where extname in ('pgmq', 'pgsodium')
order by extname;
```

You should see both rows.

---

## Step 3 — Configure Google OAuth

The web app uses Supabase Auth with Google as the primary OAuth
provider (per ADR D5). This requires creating a Google OAuth 2.0
client and pasting its credentials into Supabase.

### 3a. Create the OAuth client in Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
   and pick (or create) a project. Naming doesn't matter for the
   POC; reuse anything you already have or create one called
   `pgpe-poc`.
2. Navigate to **APIs & Services → Credentials**.
3. Click **Create Credentials → OAuth client ID**.
4. If prompted, configure the OAuth consent screen first:
   - **User type**: External (unless you're inside a Google Workspace
     and want to scope to internal users only).
   - **App name**: `pg-policy-engine POC` (or similar — users will
     see this on the consent page).
   - **User support email**: your email.
   - **Developer contact**: your email.
   - Scopes: leave default (we only need `email` and `profile`,
     which Supabase requests automatically).
   - Test users: add your own email (and any colleagues who will
     test the POC) while in "Testing" mode.
5. Back at **Create OAuth client ID**:
   - **Application type**: Web application.
   - **Name**: `pgpe-poc-web` (internal label).
   - **Authorized JavaScript origins**:
     - `https://<project-ref>.supabase.co` (replace `<project-ref>`
       with yours from Step 1)
     - `http://localhost:5173` (Vite dev server — for local dev in
       Phase 0.4)
   - **Authorized redirect URIs**:
     - `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase
       handles the callback; do not register frontend URLs here)
6. Click **Create**. A dialog shows the **Client ID** and **Client
   secret**. Copy both somewhere safe (your password manager or a
   temporary scratch file — you'll paste them into Supabase next).

### 3b. Enable Google in Supabase Auth

1. In the Supabase dashboard, navigate to **Authentication →
   Providers**.
2. Find **Google** in the list, expand it.
3. Toggle **Enable Sign in with Google** on.
4. Paste the **Client ID** and **Client Secret** from Step 3a.
5. Click **Save**.

### 3c. Configure Site URL and Redirect URLs

This controls where Supabase Auth sends users after a successful
login.

1. Navigate to **Authentication → URL Configuration**.
2. **Site URL**: `http://localhost:5173` (for local dev; we'll add
   the Cloudflare Pages URL in Phase 0.7).
3. **Redirect URLs** (additional allowed destinations): leave empty
   for now; we'll add the deployed frontend URL in Phase 0.7.

---

## Step 4 — Collect credentials

You need four values from your new project. Don't paste them in
chat — store them locally and we'll wire them into `.env.local`,
Fly secrets, Cloudflare Pages env vars, and GitHub Actions secrets
as the relevant phases land.

In the Supabase dashboard:

1. **Settings → API**:
   - **Project URL**: `https://<project-ref>.supabase.co`
   - **Project API keys**:
     - **anon (public)** — safe to ship to the frontend
     - **service_role (secret)** — never ships to the frontend;
       Ktor/worker use it server-side to bypass RLS
2. **Settings → API → JWT Settings**:
   - **JWT Secret** — Ktor uses this to verify the JWT signature on
     every authenticated request

Save these as a temporary local file (e.g., `~/scratch/pgpe-secrets.env`)
keyed like this:

```bash
PGPE_SUPABASE_URL=https://<project-ref>.supabase.co
PGPE_SUPABASE_ANON_KEY=eyJhbGciOiJI...
PGPE_SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJI...
PGPE_SUPABASE_JWT_SECRET=<secret>
```

We'll move these to the right destinations in later phases.

---

## Step 5 — Verify the project is ready

Sanity checks before moving to Phase 0.3:

- [ ] Project ref is recorded (you'll need it in `supabase/config.toml`
      and several env var sets)
- [ ] `pgmq` and `pgsodium` show up in `pg_extension` (per Step 2)
- [ ] Google OAuth is enabled and you can complete a sign-in flow
      from the Supabase dashboard's **Authentication → Users** page
      (click **Add user → with Google** to test)
- [ ] All four credentials are saved locally and not in any tracked
      file

---

## Where these credentials end up

For reference; you don't need to do anything with them yet.

| Credential                | Destination                                       | Phase |
|---------------------------|---------------------------------------------------|-------|
| Project URL               | `web/.env.local` (`VITE_SUPABASE_URL`)            | 0.4   |
| Project URL               | Cloudflare Pages env vars (`VITE_SUPABASE_URL`)   | 0.7   |
| Project URL               | Fly.io secret (`SUPABASE_URL`)                    | 0.6   |
| anon key                  | `web/.env.local` (`VITE_SUPABASE_ANON_KEY`)       | 0.4   |
| anon key                  | Cloudflare Pages env vars                         | 0.7   |
| service-role key          | Fly.io secret (`SUPABASE_SERVICE_ROLE_KEY`)       | 0.6   |
| JWT secret                | Fly.io secret (`SUPABASE_JWT_SECRET`)             | 0.6   |
| Project ref               | `supabase/config.toml`                            | 0.2   |

Project ref is the only one I (Claude Code) need from you to finish
Phase 0.2 — it goes in the `supabase/config.toml` file I'll create
next. The secrets stay with you until their respective phases.

---

## Next

Tell me the project ref. I'll:

1. `supabase init` in `supabase/` and link it to your project ref
2. Write the first migration (orgs + org_members + RLS keyed off
   `auth.uid()`)
3. Document the local dev workflow (`.env.local.example`, README
   updates)
4. Have you `supabase db push` to apply the migration

After that Phase 0.2 is done.
