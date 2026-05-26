# Changelog

All notable changes to the **web app surface** of `pg-policy-engine`.
The engine's pre-surface history (parser, normalizer, SMT analyzer,
compiler, drift detector, MVP CLI) is captured in the spec artifacts
under `spec/`.

Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow the [phasing plan](spec/web-app-phasing.md) — each
phase exits with a `v0.x.0-poc` tag.

---

## [v0.1.0-poc] — Phase 1 exit (Schema Overlay) — 2026-05-25

First user-facing feature shipped. A signed-in user can register a
target PostgreSQL database, trigger introspection, and see its
`public`-schema topology rendered as an interactive graph color-coded
by RLS governance status. Closes vision-doc Feature 1.

### Added

**Backend schema** (Phase 1.1)
- `target_databases`, `schema_tables`, `schema_columns`,
  `schema_relationships` with RLS keyed off org membership.
- `governance_status` generated column on `schema_tables` —
  `'red'` (no RLS) or `'yellow'` (RLS on, no proofs run). Phase 4
  will widen this to `'green'` once `proof_runs` lands.
- Two SECURITY DEFINER helpers: `target_belongs_to_my_org` and
  `target_belongs_to_my_owned_org`.
- 36 new pgTAP tests; suite-wide total 58.

**Vault wrappers** (Phase 1.2)
- `set_target_db_password` / `get_target_db_password` — SECURITY
  DEFINER, JWT-claim-gated inside, EXECUTE explicitly granted only
  to `service_role` and revoked from `public` / `authenticated` /
  `anon` to defeat Supabase's project-level default privileges.
- Lesson encoded in commit history: inside SECURITY DEFINER,
  `current_user` is the function owner — for the *caller* identity
  read the JWT claim that PostgREST sets per-request.

**JWT verification** (Phase 1.3)
- Ktor api verifies Supabase JWTs via JWKS (the project signs ES256
  asymmetrically — no shared secret). Lazy fetch + 24h cache.
- All routes opt into auth by living inside `authenticate("supabase")
  {...}`. `/healthz` stays public.
- Placeholder endpoint `GET /api/v1/me` returns `{userId, role, email}`
  from the JWT claims.

**Target management endpoints + RPC wrappers** (Phase 1.4)
- `POST /api/v1/targets`, `POST /api/v1/targets/{id}/introspect`,
  `DELETE /api/v1/targets/{id}` — api is a thin proxy that forwards
  the caller's Bearer JWT to PostgREST.
- Three SECURITY DEFINER RPCs (`create_target`, `enqueue_introspect`,
  `delete_target`) atomically do the cross-schema work (Vault, pgmq)
  and check `auth.uid()` against org membership / ownership.
- New `q_introspect` pgmq queue.
- 21 new pgTAP tests; suite-wide total 93.

**Introspect worker** (Phase 1.5)
- Worker switched from `q_placeholder` polling to `q_introspect`.
- Per job: load target row, decrypt password via Vault wrapper,
  open per-target JDBC connection with timeouts, query
  `information_schema` + `pg_class` for public-schema topology,
  apply via DELETE-then-INSERT inside a backend transaction, stamp
  `last_introspected_at`.
- Errors are logged and the message archived (no retry/DLQ for
  Phase 1 — that's a Phase 5 concern).

**Frontend workspace shell** (Phase 1.6)
- Header (project name + email + sign-out) + sidebar (orgs grouped
  with their targets, live via Supabase Realtime) + main pane.
- Add-target modal with full form (org/name/host/port/db/user/pw/
  ssl_mode/is_production); POSTs to the api endpoint from 1.4.
- New users (no org memberships) land on a "create your first
  organization" form; trigger auto-assigns them as owner.
- Removed the Phase 0.4 `/healthz` debug card.

**Schema overlay** (Phase 1.7)
- React Flow graph (`@xyflow/react`) of the target's public schema,
  auto-laid-out with dagre (left-to-right).
- Custom `TableNode` shows table name, RLS pill, first 5 columns
  with types ("…N more" if truncated). Border color tracks
  `governance_status`.
- FK edges labeled `source_col → target_col`.
- "Refresh schema" button calls `enqueueIntrospect`; the worker
  processes the job and Realtime repaints the graph when
  `schema_*` rows update.
- Legend explains the color codes (with green dimmed until Phase 4).

### Known gaps

- Drift detection / timeline (Phase 5 wishlist)
- Proof status surfacing — `governance_status` stays at red/yellow
  until Phase 4 wires the `proof_runs` table
- Per-target "Delete" / "Edit" gestures aren't in the UI yet; the
  `DELETE /api/v1/targets/{id}` endpoint works via curl, but no
  button calls it
- pgTAP suite still not in CI (needs an ephemeral test database
  story)
- Frontend has no tests yet (Vitest setup deferred again)
- Branch-protection "1 approving review" requirement was removed
  mid-Phase-0 because we're a single-contributor POC; reinstate
  when collaborators join

### Migrations / breaking changes

- Additive only — no schema renames or destructive changes.
- `q_placeholder` pgmq queue still exists in the project (created
  in Phase 0.3) but the worker no longer polls it. Harmless;
  cleanup deferred.

[v0.1.0-poc]: https://github.com/dventimisupabase/pg-policy-engine/releases/tag/v0.1.0-poc

---

## [v0.0.0-poc] — Phase 0 exit — 2026-05-25

Infrastructure scaffolding for the web app surface. No user-facing
features yet; the next phase (Phase 1, Schema Overlay) builds on top
of everything below.

### Added

**Engine subproject** (Phase 0.1)
- Converted the single-module Gradle build into a multi-project
  layout: `engine/`, `api/`, `worker/`. All 100 existing engine tests
  still pass. `application` plugin + CLI moved to the engine
  subproject — invoke via `gradle :engine:run`.
- Added the foojay-resolver plugin so anyone with internet + a JVM
  can build without first installing a JDK 21 by hand.

**Supabase backend** (Phase 0.2)
- Provisioned the `pgpe-poc` project on supabase.com (org
  `supabase-demo`, ref `lqapmmlwmpffbqaqtvtc`, region us-east-1).
  Originally on supabase.green; moved to supabase.com mid-phase
  after staging SMTP credentials proved unusable for magic-link
  auth.
- Initial migration: `orgs`, `org_members`, RLS keyed off
  `auth.uid()`, a `SECURITY DEFINER` membership helper, and a
  trigger that auto-adds an org's creator as its owner. Plus a
  pgmq queue placeholder and the pgtap extension.
- 22 pgTAP tests covering schema sanity, the trigger, and
  member-vs-non-member RLS visibility — runs via
  `supabase test db --linked`.

**Kotlin services** (Phase 0.3)
- `api/`: Ktor 3.1.3 + Netty + kotlinx-serialization. `GET /healthz`
  returns `{"status":"ok","service":"pgpe-api"}`. CORS plugin
  installed (Phase 0.7 wires the deployed frontend's origin).
- `worker/`: Kotlin coroutine loop polling pgmq via direct JDBC.
  Logs `alive — no messages on '<queue>'` on every empty cycle.
- `docker/Dockerfile`: single multi-stage image (`pgpe-engine`) that
  packs both apps; `docker/entrypoint.sh` dispatches based on
  CLI arg (Fly's `[processes]`) or `PROCESS_NAME` env (Compose).

**Frontend scaffold** (Phase 0.4)
- `web/`: Vite + React 19 + TypeScript 6 + `@supabase/supabase-js`.
  Magic-link sign-in flow, "Call /healthz" probe button, light/dark
  CSS, no design dependencies beyond what Vite ships with.

**Local Compose stack** (Phase 0.5)
- `docker/docker-compose.yml` brings up api + worker + web wired to
  Supabase Cloud via root `.env.local`. `docker compose up` from a
  fresh checkout is the one-command onboarding path.

**Fly.io deployment** (Phase 0.6)
- `fly.toml` configures two-process deploy of the engine image:
  `http` (Ktor api, `:8080`) and `worker` (pgmq poller, no exposed
  port). Deployed at <https://pgpe-engine-poc.fly.dev>.

**Cloudflare Pages deployment** (Phase 0.7)
- Frontend live at <https://pgpe-poc.pages.dev>, deployed via
  `wrangler pages deploy`.
- `supabase/config.toml` carries the canonical auth URL allowlist
  (localhost + Pages prod + per-deploy wildcards), synced with
  `supabase config push`.
- Documented the gotcha: `supabase config push` is a full-sync of
  `[auth]`; treat `config.toml` as source-of-truth for everything
  you want preserved on the remote, not just the bits you intend
  to change.

**CI/CD** (Phase 0.8)
- Three GitHub Actions workflows:
  - `engine-ci.yml` — `gradle :engine:test` on PRs + pushes
  - `fly-deploy.yml` — `flyctl deploy --remote-only` on push-to-main
  - `pages-deploy.yml` — Vite build (with prod `VITE_*` env vars)
    + `wrangler pages deploy` on push-to-main
- Path-filtered triggers keep doc-only commits from kicking deploys.
- Setup doc lists every required repo secret with exact commands
  to obtain each value locally.

### Documentation

- **Architecture**: `spec/web-app-vision.md` (set during pre-Phase-0
  planning), `spec/web-app-architecture-decision.md` (14 decisions
  including the supabase.com / Fly / Cloudflare / monorepo choices),
  `spec/web-app-phasing.md` (the 8-chunk plan).
- **Setup**: `docs/setup/supabase.md`, `docs/setup/fly.md`,
  `docs/setup/cloudflare-pages.md`, `docs/setup/github-actions.md`.
- **Wishlist**: `spec/surfaces-wishlist.md` + 11 GitHub issues
  (#5–#15) for the surfaces and post-v1 features deliberately out
  of scope.

### Known gaps

- JWT verification in the Ktor api is deferred to Phase 1 (the first
  authenticated route lands then). `/healthz` is public; signed-in
  identity is not yet enforced server-side.
- pgTAP tests aren't in CI yet (needs a non-prod test database
  story). Deferred.
- Frontend has no tests yet (Vitest setup is Phase 1).
- Branch protection on `main` is off; PRs aren't required. Optional
  polish — enable when the team grows or the surface stabilizes.
- The `web/package-lock.json` shuffles between host npm and the
  Compose container's Linux npm install. Cosmetic; ignored.

### Migrations / breaking changes

- The engine's source directory moved from `src/` to `engine/src/`.
  No git history was lost (all 49 files were detected as 100%
  renames).
- The CLI entrypoint moved with the engine; invoke via
  `gradle :engine:run` instead of `gradle run`.

[v0.0.0-poc]: https://github.com/dventimisupabase/pg-policy-engine/releases/tag/v0.0.0-poc
