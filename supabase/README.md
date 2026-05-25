# Supabase Backend

Backend Postgres for the web app surface (see
[`spec/web-app-architecture-decision.md`](../spec/web-app-architecture-decision.md) §D3).

## Current POC project

- **Environment**: supabase.com (production environment)
- **Org**: `supabase-demo` (org id `scivptaoxfrnvkuuippg`)
- **Project ref**: `lqapmmlwmpffbqaqtvtc`
- **Project name**: `pgpe-poc`
- **Dashboard**: <https://supabase.com/dashboard/project/lqapmmlwmpffbqaqtvtc>
- **API base URL**: `https://lqapmmlwmpffbqaqtvtc.supabase.co`
- **Direct DB host**: `db.lqapmmlwmpffbqaqtvtc.supabase.co:5432` (IPv4 add-on enabled, so the direct host resolves from any network)
- **Pooler (Supavisor)**: `aws-0-us-east-1.pooler.supabase.com:5432` (session mode); username format `postgres.lqapmmlwmpffbqaqtvtc`
- **Region**: us-east-1 (East US, North Virginia)
- **Size**: `micro`

> **Migration history**: the POC originally lived at `vkvzbcikigubfxwujklv.supabase.green` (Supabase-internal staging). It was moved to supabase.com on 2026-05-25 because the staging environment's SMTP credentials were invalid, blocking magic-link sign-in. All migrations and tests replayed cleanly on the new project; the staging project is being deleted as part of the move.

## What's provisioned

| Item               | Status     | Notes                                              |
|--------------------|------------|----------------------------------------------------|
| Project            | ✅          | Created via `supabase projects create`              |
| `pgmq` extension   | ✅          | Enabled by `20260525154702_init.sql`                |
| `pgsodium` (Vault) | ✅          | Enabled by `20260525154702_init.sql`                |
| `orgs` table       | ✅          | Skeleton with RLS                                   |
| `org_members` table| ✅          | Skeleton with RLS                                   |
| Email auth         | ✅ (default) | Default Supabase Auth — magic link works out of box |
| Google OAuth       | ⏳ deferred | Add when needed; see `docs/setup/supabase.md` §3    |
| `pgtap` extension  | ✅          | For in-database tests; see "Running pgTAP tests"    |
| `q_placeholder` queue | ✅       | pgmq queue the Phase 0.3 worker polls               |
| pgTAP tests        | ✅          | Coverage for orgs/org_members schema, trigger, RLS  |
| Vault secrets      | ⏳ Phase 0.3 onward | Target DB credentials land here              |
| Feature tables     | ⏳ Phase 1+ | `target_databases`, `schema_tables`, etc.           |

## Local credentials (not in repo)

These files live on the machine that provisioned the project. Mode
600. They are **not** in `.env.local` or any tracked file. Other
contributors who need them can ask the project owner or rotate via
the Supabase dashboard.

| File                              | Contents                                              |
|-----------------------------------|-------------------------------------------------------|
| `~/.pgpe-supabase-db-password`    | Postgres `postgres` user password (for direct psql)   |
| `~/.pgpe-supabase-keys.env`       | `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DEFAULT_KEY` (new-format publishable) |

These get wired into Fly secrets (Phase 0.6), Cloudflare Pages env
vars (Phase 0.7), and GitHub Actions secrets (Phase 0.8) as those
phases land.

## Working in this directory

### Apply a new migration

```bash
supabase migration new <descriptive-name>   # creates supabase/migrations/<ts>_<name>.sql
# edit the file
supabase db push -p "$(cat ~/.pgpe-supabase-db-password)" --yes
```

### Inspect migration state

```bash
supabase migration list
```

Local and Remote columns should match for every row.

### Run pgTAP tests

Tests live in `supabase/tests/` and use the [pgTAP](https://pgtap.org/)
in-database test framework. Each file declares a `plan(N)` and a set
of assertions, wrapped in `begin; ... rollback;` so test side effects
don't escape the transaction.

With the IPv4 add-on enabled on the POC project, the canonical
invocation works directly:

```bash
supabase test db --linked supabase/tests
```

Expected output: `All tests successful.` (22 tests across three files).

A couple of permission quirks worth knowing about (encoded in the test
files themselves, so they "just work" — documented here for future
test authors):

- pgTAP is installed in the `extensions` schema. Each test file does
  `set search_path = public, extensions;` at the top so unqualified
  `plan()` / `has_table()` / etc. resolve.
- `20260525171539_grant_extensions_usage.sql` grants USAGE on the
  `extensions` schema to PUBLIC so the CLI's per-session test login
  role (`cli_login_postgres`) can see the pgTAP functions.
- Tests that need to insert into `auth.users` directly do
  `set role postgres;` after setting search_path — `cli_login_postgres`
  lacks USAGE on the `auth` schema, but it has membership in `postgres`
  via Supabase's role hierarchy, so `set role` succeeds.

**Note on enabling pgTAP**: the canonical Supabase pattern is to
toggle the pgtap extension from the dashboard (Database → Extensions),
not via a migration. This project enabled it through
`20260525162123_enable_pgtap.sql` for reproducibility — that migration
is already applied. For *new* environments modeled on this one, the
dashboard toggle is a fine alternative; either path lands in the same
place.

### Run Supabase locally (optional)

`supabase/config.toml` configures a local Supabase stack you can run
with `supabase start`. We don't use this for the POC — we develop
against Supabase Cloud (supabase.green) directly per ADR D8 — but
the config is generated by `supabase init` and committed for
reproducibility. Anyone who wants offline dev or test-database
isolation can `supabase start` without further setup.

## Layout

```
supabase/
├── .gitignore       # excludes .temp, .branches, .env files
├── config.toml      # local-dev Supabase config (port assignments, etc.)
├── migrations/
│   ├── 20260525154702_init.sql                    # pgmq + pgsodium + orgs/org_members + RLS
│   ├── 20260525161206_pgmq_placeholder_queue.sql  # q_placeholder pgmq queue
│   ├── 20260525162123_enable_pgtap.sql            # pgtap extension (see README note)
│   └── 20260525171539_grant_extensions_usage.sql  # USAGE on extensions schema for test login role
├── tests/
│   ├── 01_schema.sql    # tables / RLS / helper / trigger sanity
│   ├── 02_trigger.sql   # orgs_add_creator_as_owner behavior
│   └── 03_rls.sql       # member vs non-member visibility
└── README.md        # this file
```

## What is *not* here

- Tracked secrets — see "Local credentials" above
- Cloud project state — that's at supabase.green; the dashboard is
  the source of truth for runtime configuration (auth providers, URL
  configuration, etc.). Migrations cover schema only.
