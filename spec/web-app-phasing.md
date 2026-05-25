# Web App Phasing Plan

**Status**: Draft
**Date**: 2026-05-24
**Audience**: Implementers, project managers, future maintainers
**Supersedes**: nothing
**Supplements**: `spec/web-app-vision.md`, `spec/web-app-architecture-decision.md`

---

## 1. Purpose

This document sequences the v1 web app implementation work into
discrete phases. It does **not** redefine scope (see
`spec/web-app-vision.md`) and does **not** revisit architectural
decisions (see `spec/web-app-architecture-decision.md`). It answers
one question: *what gets built, in what order, and when is each
phase done?*

The phasing was settled in conversation on 2026-05-24, building on
the ADR's decisions:

- **Slicing**: hybrid — minimal infrastructure first, then vertical
  feature slices.
- **Phase 0**: engine source refactor plus full infrastructure
  scaffolding (Supabase project, Fly.io app, Cloudflare Pages, CI).
- **Feature ordering**: schema overlay first, then simulator, editor,
  proof inspector, drift timeline, compliance binder, recommendation
  wizard. Rationale: schema overlay is the lowest-risk end-to-end
  slice that exercises every architectural layer; each subsequent
  feature builds on what's already proven.
- **Exit criteria per phase**: the feature meets its vision-doc exit
  criterion + the work is demoable cold end-to-end + prior phases
  still work.

Performance targets are *not* phase exit criteria (per ADR D13's
measure-first posture). They become work items only when measurement
shows them needed.

This document deliberately omits time estimates. Phase complexity is
indicated qualitatively (small / medium / large) so the team can
budget effort without committing to dates that will be wrong.

---

## 2. Scope & Framing

The v1 web app has seven features (`spec/web-app-vision.md` §V1 Web
App Scope). Mapping to phases:

| Phase | Deliverable                       | Vision doc reference          | Complexity |
|-------|-----------------------------------|-------------------------------|------------|
| 0     | Engine refactor + scaffolding     | (new; not in vision doc)      | Large      |
| 1     | Schema Overlay                    | Feature 1                     | Large      |
| 2     | Simulator                         | Feature 2                     | Large      |
| 3     | Policy Editor                     | Feature 3                     | Large      |
| 4     | Proof Inspector                   | Feature 4                     | Medium     |
| 5     | Drift Timeline                    | Feature 5                     | Medium     |
| 6     | Compliance Binder                 | Feature 6                     | Medium     |
| 7     | Recommendation Wizard             | Feature 7                     | Large      |

Phases are intended to run sequentially. Some later phases have
internal independence (e.g., drift timeline and proof inspector touch
different code paths and could overlap) but the default is one phase
at a time so the team is never split across more than one user-facing
surface at once.

---

## 3. Cross-Phase Conventions

These apply across every phase from Phase 1 onward.

### 3.1 Branching and merging

- One feature branch per phase off `main`. Sub-branches per discrete
  task within the phase, merged to the phase branch as they land,
  then phase branch merged to `main` when phase exits.
- Phase commits use conventional commits: `feat(web): ...`,
  `feat(api): ...`, `feat(worker): ...`, `feat(supabase): ...`,
  `chore(infra): ...`.
- Each phase's exit produces a tagged release: `v0.x.0-poc` where
  `x` is the phase number.

### 3.2 Testing posture

- **Engine code**: unit + property-based tests retained from existing
  work; CI must stay green.
- **Ktor service (api/)**: integration tests against an ephemeral
  Supabase test project (or local Postgres for cheap CI) hitting real
  engine primitives. JWT verification mocked at the boundary.
- **Worker**: integration tests against an ephemeral Postgres with
  pgmq installed; simulate job lifecycle end-to-end.
- **Frontend (web/)**: unit tests for non-trivial logic; integration
  tests via Playwright against a deployed preview. Storybook-style
  component isolation considered but not committed.
- **End-to-end smoke**: a single Playwright test per phase that
  exercises that phase's golden path against a deployed preview.

### 3.3 Deploy posture

- **Frontend**: Cloudflare Pages on push to `main` (production) and
  per PR (preview).
- **Engine services (HTTP + worker)**: GitHub Actions builds the
  Docker image on push to `main` and deploys via `flyctl deploy` to
  the Fly.io app.
- **Supabase**: migrations applied via Supabase CLI on push to `main`
  to the Supabase Cloud project. Phase migrations land via the same
  conventional-commit + PR review flow as code.
- **Rollback**: Fly.io supports `flyctl releases rollback`;
  Cloudflare Pages keeps prior deploys; Supabase migrations are
  designed to be reversible where possible.

### 3.4 Observability minimum

Each phase ships with at least:

- Structured logging from Ktor (`Logger.logback`) and the worker, with
  user-id and target-database-id in the MDC where applicable.
- Frontend errors caught and posted to a `frontend_errors` table for
  later analysis (cheap Sentry replacement until a real choice is
  made).
- No metric/tracing instrumentation until Phase 5 or later, by which
  point we'll have real workloads worth measuring.

### 3.5 Documentation discipline

- Each phase updates a top-level `CHANGELOG.md` (created in Phase 0)
  with the phase's user-visible additions.
- New decisions that emerge mid-phase land as amendments to the ADR
  (`spec/web-app-architecture-decision.md`) or as new ADRs in
  `spec/adrs/` if substantial.
- Each phase's exit produces a one-paragraph "what got built and what
  to demo" note suitable for sharing with stakeholders.

---

## 4. Phase 0 — Engine Refactor + Infrastructure Scaffolding

**Goal**: end Phase 0 with the engine sources in their new location
and the full deployment pipeline working end-to-end against a
"hello world" placeholder, so Phase 1 starts with no infrastructure
work blocking it.

**Complexity**: Large.

### 4.1 Scope

**In**:
- Engine source refactor (`src/main/kotlin/com/pgpe/` →
  `engine/src/main/kotlin/com/pgpe/`)
- Multi-project Gradle build with `engine/`, `api/`, `worker/` as
  Kotlin subprojects
- Empty Ktor service in `api/` returning `200 OK` on `/healthz`
- Empty worker in `worker/` that logs `alive` every 30 seconds
- Dockerfile producing one image with `ENTRYPOINT` switchable via
  `PROCESS_NAME` env var (`http` or `worker`)
- Vite + React + TypeScript scaffold in `web/` with a placeholder
  landing page
- Supabase Cloud project provisioned with:
  - `pgmq` extension enabled
  - `pgsodium` / Vault enabled
  - Google OAuth provider configured (other providers deferred)
  - Empty `supabase/` directory with `supabase init` artifacts
  - One migration: `orgs`, `org_members`, RLS skeleton
- Fly.io app `pgpe-engine-poc` created with two processes in
  `fly.toml`
- Cloudflare Pages project connected to the GitHub repo, building
  `web/`
- GitHub Actions workflows:
  - `engine-ci.yml`: gradle build + test on PR
  - `fly-deploy.yml`: docker build + flyctl deploy on push to main
  - Cloudflare Pages handles its own builds via the GitHub integration
- `docker/docker-compose.yml` with the `cloud-dev` profile
- `CHANGELOG.md` initialized

**Out**:
- Any business logic in `api/` or `worker/` beyond the placeholders
- Any backend tables beyond orgs/members
- Any frontend pages beyond the landing placeholder
- Other OAuth providers, multi-user auth flows
- Production deployment configuration

### 4.2 Key tasks

1. **Engine refactor**
   - Move `src/main/kotlin/com/pgpe/` → `engine/src/main/kotlin/com/pgpe/`
   - Move `src/test/kotlin/com/pgpe/` → `engine/src/test/kotlin/com/pgpe/`
   - Move ANTLR sources to `engine/src/main/antlr/`
   - Update root `build.gradle.kts` to declare the multi-project
     structure
   - Create `engine/build.gradle.kts` taking over the engine-specific
     build config
   - Update CI scripts and any IDE configuration
   - Verify all existing engine tests pass (no regressions)
2. **API service skeleton** (`api/`)
   - New Kotlin Ktor project, depends on `:engine`
   - One route: `GET /healthz` → `200 OK`
   - JWT verification middleware stubbed but inert (logs decoded
     claims, does not enforce — enforcement added when first real
     route lands in Phase 1)
3. **Worker skeleton** (`worker/`)
   - New Kotlin project, depends on `:engine`
   - `main` function that polls pgmq every 30s and logs (no queues
     declared yet)
4. **Dockerfile** (`docker/Dockerfile`)
   - Multi-stage build: Gradle build → JRE runtime
   - `ENTRYPOINT` script reads `PROCESS_NAME` env var, dispatches to
     `api` or `worker` main class
5. **Frontend scaffold** (`web/`)
   - `npm create vite@latest -- --template react-ts`
   - Add `@supabase/supabase-js`
   - Placeholder `App.tsx`: "pg-policy-engine — POC" + a Supabase
     auth sign-in button
6. **Supabase project provisioning**
   - Create project in Supabase Cloud
   - Enable extensions: pgmq, pgsodium (Vault)
   - Configure Google OAuth
   - `supabase init` in `supabase/`
   - First migration: `20260524000000_init.sql`:
     - `orgs` table (id, name, created_at)
     - `org_members` table (org_id, user_id, role, created_at)
     - RLS on both, keyed off `auth.uid()`
   - `supabase db push` to apply
7. **Fly.io app**
   - `fly launch --no-deploy` to create `fly.toml`
   - Edit `fly.toml`: add `[processes]` with `http` and `worker`
   - Configure secrets via `flyctl secrets set`:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `SUPABASE_JWT_SECRET`
   - `flyctl deploy` produces both processes running
8. **Cloudflare Pages**
   - Create project, connect to GitHub repo
   - Build settings: build command `cd web && npm run build`, output
     dir `web/dist`
   - Environment variables:
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_ANON_KEY`
     - `VITE_ENGINE_API_URL` (points to Fly.io app)
9. **GitHub Actions**
   - `.github/workflows/engine-ci.yml`: PR check — `./gradlew check`
   - `.github/workflows/fly-deploy.yml`: push to main — build &
     deploy to Fly via `flyctl`
   - Branch protection on `main`: require CI green, require PR review
10. **Local Compose**
    - `docker/docker-compose.yml` with `cloud-dev` profile:
      - `engine-api`: builds from Dockerfile, `PROCESS_NAME=http`
      - `engine-worker`: builds from Dockerfile, `PROCESS_NAME=worker`
      - `web`: Vite dev server (`npm run dev`)
    - All services point at Supabase Cloud via env vars (not a local
      Postgres)
11. **End-to-end verification**
    - Sign in via Cloudflare Pages frontend → Google OAuth →
      authenticated Supabase session
    - Frontend reads JWT, makes a call to Fly.io `GET /healthz` with
      the JWT in `Authorization` header → 200 OK + logged claim
    - Worker pgmq poll log lines visible in `flyctl logs --process
      worker`
    - `docker compose up` brings the same shape locally; manual click-
      through reproduces the same flow

### 4.3 Dependencies

- Engine code is already MVP-complete; no engine logic changes
  required.
- Supabase Cloud account exists (the user is a Supabase employee).
- Fly.io account and CLI installed (the user has both as of
  2026-05-24).
- GitHub repo `dventimisupabase/pg-policy-engine` exists with admin
  access.
- Cloudflare account; can be created if not present.

### 4.4 Exit criteria

- [ ] All existing engine tests pass after the source move.
- [ ] CI green on `main`.
- [ ] Fly.io app shows both processes (`http`, `worker`) running.
- [ ] Cloudflare Pages serves the placeholder frontend at a public
      URL.
- [ ] A logged-in user can hit the Fly.io `/healthz` endpoint with
      their Supabase JWT and see the claim logged.
- [ ] `docker compose up` reproduces the same setup locally against
      Supabase Cloud.
- [ ] `CHANGELOG.md` records Phase 0.
- [ ] Tag `v0.0.0-poc` pushed.

### 4.5 Risks and open questions

- **Engine refactor breaks something subtle**: mitigate by running
  full test suite (unit + property-based + integration) before
  declaring the refactor done.
- **z3-turnkey native libraries don't load on Fly.io's Linux image**:
  test early. If Z3 fails to load, may need a custom base image with
  the right libc / glibc compatibility.
- **Supabase Cloud project pricing**: free tier should cover the POC.
  Monitor.
- **JWT verification implementation details**: the JWT secret vs.
  asymmetric (JWKS) decision. Supabase Cloud uses HS256 with a
  shared secret by default. Use that for simplicity; revisit if we
  later want true asymmetric verification.

---

## 5. Phase 1 — Schema Overlay

**Goal**: a logged-in user can connect a target PostgreSQL database
and see its schema rendered as an interactive node-and-edge graph
with governance status overlays.

**Vision doc**: Feature 1 (The Schema Overlay).

**Complexity**: Large.

### 5.1 Scope

**In**:
- "Connect a database" UI: target DB host/port/db/user/password,
  display name, `is_production` toggle (per ADR D10)
- Supabase Vault storage of target DB credentials
- Two roles per target: read-only and write-capable (per ADR D10)
- Backend schema additions:
  - `target_databases` (id, org_id, name, host, port, db, role,
    is_production, vault_secret_id, created_at, last_introspected_at)
  - `schema_tables` (id, target_id, schema, name, has_rls,
    rls_forced, governance_status, last_seen_at)
  - `schema_columns` (id, table_id, name, type, nullable, position)
  - `schema_relationships` (id, target_id, source_table_id,
    source_col, target_table_id, target_col, fk_name)
  - `governance_status` view computed from policies + proofs
- RLS on all new tables, keyed off `auth.uid()` + org membership
- Ktor endpoints:
  - `POST /api/v1/targets` (create target; stores creds in Vault)
  - `POST /api/v1/targets/:id/introspect` (kick off introspect job)
  - `DELETE /api/v1/targets/:id`
- pgmq queue: `q_introspect`
- Worker: handles `q_introspect` jobs by calling engine's
  `introspect` primitive and writing results to `schema_tables`,
  `schema_columns`, `schema_relationships`
- Frontend pages:
  - Workspaces sidebar with target switcher
  - "Add target" modal
  - Schema overlay page using React Flow
  - Color-coded nodes (green / yellow / red / gray per vision doc)
  - Hover panel showing applicable policies
  - Click drills into table detail (basic: column list, RLS status)
- Realtime subscription to `schema_tables` updates → frontend redraws

**Out**:
- Simulator (Phase 2)
- Code editor for policies (Phase 3)
- Detailed proof status per table (Phase 4)
- Drift history (Phase 5)
- Drag-and-drop policy authoring on overlay (wishlist
  [#5](https://github.com/dventimisupabase/pg-policy-engine/issues/5))

### 5.2 Key tasks

1. **Backend schema migration**
   - New tables (above) with foreign keys and indexes
   - RLS policies on each, hand-written
   - `governance_status` view
2. **Vault layout for target DB credentials**
   - Wrapper functions to encrypt/decrypt connection strings
   - Service-role-only access to decrypted form
3. **Engine `introspect` primitive shaping**
   - Verify the existing engine introspection returns a
     graph-shaped structure suitable for `schema_tables` /
     `schema_relationships` materialization; add adaptation if needed
4. **Ktor target management endpoints**
   - `POST /api/v1/targets` validates inputs, stores creds in Vault,
     creates `target_databases` row
   - `POST /api/v1/targets/:id/introspect` enqueues to `q_introspect`
   - `DELETE /api/v1/targets/:id` removes row, scrubs Vault secret
5. **Worker handler for `q_introspect`**
   - Reads target by id, decrypts Vault secret
   - Calls `engine.introspect()` against the target
   - Diffs against current `schema_tables` snapshot
   - Upserts new state; soft-deletes removed tables
   - Updates `target_databases.last_introspected_at`
6. **Frontend: workspaces sidebar**
   - Lists `target_databases` for the user's org
   - "Add target" button → modal
   - Active target persisted in URL (`/workspace/:targetId`)
7. **Frontend: schema overlay**
   - React Flow setup with custom node component
   - Layout via dagre or elkjs (TBD; dagre simpler)
   - Color coding per `governance_status`
   - Edge labels for FK names
8. **Frontend: interactions**
   - Hover table → policies panel
   - Click table → detail drawer
9. **Realtime wiring**
   - `supabase-js` subscription on `schema_tables` filtered by
     `target_id`
   - Frontend redraws on updates

### 5.3 Dependencies

- Phase 0 complete (infrastructure pipeline working).
- Engine's `introspect` primitive returns information sufficient to
  populate `schema_tables`, `schema_columns`, `schema_relationships`.

### 5.4 Exit criteria

Vision doc § V1 Exit Criteria #1:
> A user can connect to a PostgreSQL database and see its schema
> overlay rendered with governance status.

Operationally:

- [ ] A logged-in user can add a target database via the UI
- [ ] The target database's schema is rendered as a node-and-edge
      graph within ~30 seconds of connection
- [ ] Tables are color-coded by governance status (green / yellow /
      red / gray)
- [ ] Hover shows applicable policies
- [ ] Click opens a detail drawer
- [ ] Re-running introspection updates the graph via Realtime (no
      page reload needed)
- [ ] Demo: a colleague unfamiliar with the project can add a sample
      database and see the overlay in under 3 minutes of guidance
- [ ] Phase 0 round-trip (auth + healthz) still works
- [ ] Tag `v0.1.0-poc` pushed

### 5.5 Risks and open questions

- **React Flow at scale**: a schema with 200+ tables may overwhelm
  the default layout. Measure with a real schema early; if
  problematic, switch to elkjs or a custom layout.
- **Long-running introspection**: if the target schema is huge,
  introspection takes minutes. Make sure the worker handler reports
  progress (intermediate writes to `schema_tables`) so the frontend
  shows incremental updates rather than a stuck "loading" state.
- **Connection failures**: invalid credentials, host unreachable,
  SSL handshake failures. Surface errors clearly in the UI; do not
  silently fail.
- **Governance status computation**: depends on which proofs the
  engine has run against the target. For Phase 1, "yellow" = RLS
  enabled but no proofs run yet. Proof status will come in Phase 4.

---

## 6. Phase 2 — Simulator

**Goal**: a user can select a table and use the simulator to see row
visibility under a chosen session, with proper data privacy
safeguards.

**Vision doc**: Feature 2 (The "What Would This User See" Simulator).

**Complexity**: Large.

### 6.1 Scope

**In**:
- Engine `simulate` primitive: takes DSL policy text (or an
  already-deployed policy reference) + session variables + target
  table; returns row visibility verdict per row sampled
- Read-only role automation: when a target is created, the API
  service ensures a `pgpe_readonly_<targetid>` role exists with
  `SELECT`-only grants on the simulator-permitted tables (creates
  the role using the user-provided write-capable creds, then stores
  the read-only role's password in Vault)
- Backend additions:
  - `simulator_sessions` (id, target_id, user_id, table_name,
    role_name, session_vars JSONB, created_at)
  - `simulator_results` (id, session_id, row_data JSONB, visible
    BOOL, filtered_by_policy TEXT, created_at)
  - `simulator_audit_log` (id, user_id, target_id, sql, session_vars,
    row_count, ts) (per ADR D10)
- Ktor endpoints:
  - `POST /api/v1/simulate` (synchronous; for small tables)
  - `POST /api/v1/simulate/scan` (enqueues `q_simulate_scan`; for
    large tables)
- pgmq queue: `q_simulate_scan`
- Worker handler for `q_simulate_scan`
- Frontend simulator page:
  - Table selector (from current workspace)
  - Session variable inputs
  - Role selector
  - Results pane: rows shown with visibility marker (full color =
    visible, grayed = filtered, hover = policy responsible)
  - Drag a session value → live updates via re-fetch (debounced)
  - "Save as test case" button → `simulator_sessions` insert

**Out**:
- Test case continuous evaluation (deferred; tracked as future work)
- Column-level masking (deferred to v1.1 per ADR D10)
- Comparing two sessions side-by-side (deferred)

### 6.2 Key tasks

1. **Engine `simulate` primitive**
   - Compile policy to predicate
   - Execute `SELECT *, <predicate> AS pgpe_visible FROM <table>
     LIMIT N` against target as read-only role with session vars
     set
   - For filtered rows, identify which policy was responsible (rerun
     predicate per policy)
2. **Read-only role provisioning automation**
   - On target creation: connect as write-capable role, create
     `pgpe_readonly_<id>` role with random password, `GRANT SELECT`
     on schema, store password in Vault
   - On target deletion: drop the role
3. **Backend schema migration**
   - New tables (above) with RLS
   - `simulator_audit_log` is append-only; RLS allows users to read
     their own entries but not modify
4. **Ktor synchronous endpoint**
   - `POST /api/v1/simulate` for tables under N rows (configurable,
     default 1000)
   - Returns results directly; suitable for editor-preview-style
     usage
5. **Worker `q_simulate_scan` handler**
   - For larger tables; processes async and writes to
     `simulator_results` in batches
   - Frontend subscribes via Realtime
6. **Frontend simulator page**
   - Table list (read from `schema_tables`)
   - Session variable form (free-form keys; pre-filled from policies
     referencing them where possible)
   - Role dropdown (Postgres roles introspected from target)
   - Results table with TanStack Table + custom row renderer
7. **Audit log policy enforcement**
   - Every simulator query writes to `simulator_audit_log` before
     returning
   - Backend page (admin-only) showing audit log for the org

### 6.3 Dependencies

- Phase 1 complete (target databases exist; schema is introspected;
  RLS on backend tables works).
- Engine has a `simulate` primitive or can be extended to provide one.
  (Check before phase start; if not, this phase includes the engine
  extension.)

### 6.4 Exit criteria

Vision doc § V1 Exit Criteria #2:
> A user can select a table and use the simulator to see row
> visibility under a chosen session.

Operationally:

- [ ] User selects a table from the current workspace
- [ ] User specifies a role and session variables
- [ ] Results render: each row marked visible or filtered with the
      responsible policy
- [ ] Production-tagged targets require explicit opt-in before the
      simulator runs (per ADR D10)
- [ ] Every simulator query is recorded in `simulator_audit_log`
- [ ] "Save as test case" persists the session for later re-run
- [ ] Demo: a colleague can simulate a tenant isolation scenario and
      explain what they're seeing in under 5 minutes of guidance
- [ ] Phase 0 and 1 functionality intact
- [ ] Tag `v0.2.0-poc` pushed

### 6.5 Risks and open questions

- **Read-only role creation requires DDL privileges**: the
  user-provided target credentials need permission to `CREATE ROLE`
  and `GRANT`. Document this requirement; surface a clear error if
  privileges insufficient.
- **Session variable validation**: free-form session keys make it
  easy to introduce typos. Consider auto-completing from policies
  referencing `session(...)`. Defer if simple typing works fine.
- **Large table sampling**: showing 1M rows of a table is useless.
  The simulator samples (LIMIT N) but the sampling strategy
  (random? deterministic? user-controlled?) needs a UX decision.
  Start with `LIMIT 100` random sample; expand later.
- **Policy-to-filtered-row attribution**: re-running each policy's
  predicate per row is O(rows × policies). Probably fine for sampled
  data; revisit if slow.

---

## 7. Phase 3 — Policy Editor

**Goal**: a user can author a new policy in a three-pane editor and
see live preview, compiled SQL, and proof status update as they type.

**Vision doc**: Feature 3 (The Policy Authoring Surface).

**Complexity**: Large.

### 7.1 Scope

**In**:
- Engine `parse` and `validate` primitives exposed as fast
  (sub-100ms target) Ktor endpoints
- Backend additions:
  - `policy_drafts` (id, org_id, target_id, name, dsl_source,
    compiled_sql, proof_status JSONB, created_by, updated_at)
  - `policy_deployments` (id, draft_id, target_id, deployed_at,
    deployed_by) — recording when a draft was applied
- Ktor endpoints:
  - `POST /api/v1/parse` (DSL → AST or errors)
  - `POST /api/v1/compile` (DSL → compiled SQL or errors)
  - `POST /api/v1/analyze` (DSL + analysis name → verdict + witness)
  - `POST /api/v1/deploy` (draft_id → apply to target via engine's
    `apply` flow)
- Frontend editor page:
  - Three panes: DSL source (Monaco/CodeMirror), visual builder
    (structured form), live preview (compiled SQL + proof status +
    small simulator)
  - Debounced edits → re-parse, re-compile, re-analyze
  - Inline parse errors with file/line markers
  - "Verify" button to run all proofs
  - "Save" persists to `policy_drafts`
  - "Deploy" applies to target (with confirmation dialog)
- Visual builder ↔ DSL sync (DSL is canonical; visual builder is
  derived; edits in builder regenerate DSL)

**Out**:
- Multi-user concurrent editing with operational transform / CRDT
  (deferred; Presence is enough for "alice is editing X" awareness)
- Version history beyond the latest draft (deferred; Supabase has
  point-in-time recovery if needed)
- Git integration ("save to repo") (deferred to CI/CD wishlist
  [#9](https://github.com/dventimisupabase/pg-policy-engine/issues/9))

### 7.2 Key tasks

1. **Engine primitives shaping**
   - Verify `parse` returns AST + structured error positions; if not,
     extend
   - Same for `compile` and `analyze`
   - All three must return in under 100ms for typical-size policies
     to support live preview
2. **Backend schema migration**
   - `policy_drafts` and `policy_deployments` with RLS
3. **Ktor primitive endpoints**
   - All four endpoints take JWT, verify, invoke engine, return JSON
   - Error responses include structured field offsets for inline
     rendering
4. **Code editor integration**
   - Pick Monaco or CodeMirror (recommend CodeMirror 6 for smaller
     bundle and easier theming; Monaco if we want VS Code-like UX)
   - Custom syntax highlighting from a TextMate grammar derived
     from the DSL
   - Inline error markers from `/api/v1/parse` responses
5. **Visual builder pane**
   - Form-style representation: selector block, clause cards, atom
     rows
   - State derived from parsed AST; user edits trigger regenerated
     DSL
6. **Live preview pane**
   - Compiled SQL rendered with `pg-format` for readability
   - Proof status badges (per analysis)
   - Mini simulator embedded (re-uses Phase 2 component)
7. **Deploy flow**
   - "Deploy" → confirmation dialog → POST `/api/v1/deploy` →
     engine's `apply` flow runs against target → results recorded
     in `policy_deployments`
   - Target `schema_tables.governance_status` updates via Realtime

### 7.3 Dependencies

- Phases 0, 1, 2 complete
- Engine's `parse`, `compile`, `analyze`, `apply` primitives mature

### 7.4 Exit criteria

Vision doc § V1 Exit Criteria #3:
> A user can author a new policy in the three-pane editor and see
> live preview, compiled SQL, and proof status update as they type.

Operationally:

- [ ] All three panes update on every settled edit (debounce 200ms)
- [ ] DSL parse errors appear inline within 200ms
- [ ] Compiled SQL renders correctly for representative policies
- [ ] Proof status updates as policy changes
- [ ] Visual builder regenerates DSL when edited
- [ ] DSL pane edits update the visual builder
- [ ] "Verify" runs all enabled proofs and renders results
- [ ] "Save" persists to `policy_drafts`
- [ ] "Deploy" applies to target and updates `governance_status`
      via Realtime
- [ ] Demo: a colleague can write a `tenant_isolation` policy and
      deploy it inside 5 minutes
- [ ] Phases 0-2 still work
- [ ] Tag `v0.3.0-poc` pushed

### 7.5 Risks and open questions

- **Visual builder ↔ DSL sync is harder than it sounds**: edge cases
  where the AST has shapes the visual builder doesn't represent.
  Start with a constrained subset; extend as needed. Always treat
  DSL as canonical.
- **Sub-100ms parse/analyze**: the engine was designed for one-shot
  CLI use; per-keystroke calls may be slow. Measure early; cache the
  parse result in-process if needed.
- **Monaco vs. CodeMirror**: bundle size delta is significant
  (Monaco ~2MB, CodeMirror 6 ~200KB gzipped). Recommend CodeMirror
  for v1; can swap later if Monaco's affordances become essential.

---

## 8. Phase 4 — Proof Inspector

**Goal**: a user can run any of the five algebra analyses against a
policy and see the verdict with a human-readable witness.

**Vision doc**: Feature 4 (The Proof Inspector).

**Complexity**: Medium.

### 8.1 Scope

**In**:
- Backend additions:
  - `proof_runs` (id, draft_id or deployed_id, analysis_name,
    verdict, witness JSONB, smt_lib TEXT, solver TEXT,
    duration_ms, ran_at)
- Ktor endpoint:
  - `POST /api/v1/analyze` already exists from Phase 3; extend to
    record runs to `proof_runs`
- Frontend proof inspector page:
  - Per-analysis panel
  - Plain-language question (e.g., "Can any session ever access a
    row belonging to a different tenant?")
  - Verdict badge (SAT / UNSAT / UNKNOWN, color-coded)
  - Witness rendering for SAT (per vision doc R6, now resolved
    here)
  - Certificate for UNSAT (solver, duration, "no (row, session) pair
    satisfies both the policy and the violation condition")
  - Expandable SMT-LIB encoding for engineers
- Witness rendering logic — translates Z3 model variables back to
  algebra entities ("session.tenant_id = 99, row.tenant_id = 42")
- "Compare to previous run" — surface diffs between consecutive
  runs for the same policy

**Out**:
- Continuous-check "always run on every policy change" toggle
  (deferred; the worker can be extended later)
- Cross-policy interaction analyses (the algebra's existing
  subsumption and contradiction proofs are covered; new analyses
  not on the existing nine deferred)

### 8.2 Key tasks

1. **Backend schema migration**
   - `proof_runs` table with RLS
2. **Ktor `/api/v1/analyze` extension**
   - Records every run to `proof_runs`
   - Returns the latest run when called without `rerun=true`
3. **Witness rendering** (resolves vision doc R6)
   - Parse the Z3 model from the analyzer's output
   - Map SMT variable names back to algebra entities (column refs,
     session vars)
   - Render as "a row with `tenant_id = X` is visible to a session
     with `tenant_id = Y` under policy `name`"
4. **Plain-language question library**
   - One question per registered proof, written in user terms
   - Stored in source (i18n later)
5. **Frontend proof panel**
   - Card layout per analysis
   - Status badge + question + verdict
   - SAT: witness rendered + "see SMT" expandable
   - UNSAT: certificate
6. **Run history**
   - Sidebar showing past `proof_runs` for the active draft
   - Diff renderer for "compare to previous"

### 8.3 Dependencies

- Phase 3 complete (editor saves drafts; analyze endpoint exists)
- Engine's analyses already exist; this phase mostly adds
  presentation

### 8.4 Exit criteria

Vision doc § V1 Exit Criteria #4:
> A user can run any of the five algebra analyses against a policy
> and see the verdict with a human-readable witness.

Operationally:

- [ ] All five primary analyses are runnable from the UI
- [ ] SAT verdicts come with human-readable witnesses
- [ ] UNSAT verdicts come with certificates
- [ ] SMT-LIB encoding is available expandably
- [ ] Past runs are visible per policy draft
- [ ] Demo: a colleague can read a SAT witness and identify the
      isolation hole inside 2 minutes
- [ ] Phases 0-3 still work
- [ ] Tag `v0.4.0-poc` pushed

### 8.5 Risks and open questions

- **Witness rendering completeness**: some Z3 models will have
  variables that don't map cleanly to algebra entities (e.g.,
  uninterpreted function outputs). Render the unmappable parts
  verbatim with a note; don't hide them.
- **"Five analyses"**: vision doc says five, engine has nine. The
  vision doc's five are the tenant-isolation-relevant ones. Surface
  all enabled-by-default analyses; group by category.

---

## 9. Phase 5 — Drift Timeline

**Goal**: a user can view a drift timeline for a connected database
with classified events and reconciliation options.

**Vision doc**: Feature 5 (The Drift Timeline).

**Complexity**: Medium.

### 9.1 Scope

**In**:
- Worker scheduled job: periodic drift check per target
- Backend additions:
  - `drift_events` (id, target_id, drift_type, severity, table_name,
    policy_name, detected_at, resolved_at, resolution_action,
    impact JSONB)
- Ktor endpoint:
  - `POST /api/v1/targets/:id/drift-check` (manual trigger)
  - `POST /api/v1/drift/:id/reconcile` (apply reconciliation SQL)
- Frontend drift timeline page:
  - Per-target chronological list
  - Filter by drift type / severity / time range
  - Click event → detail drawer with before/after, impact, plan
  - "Resolve" / "Acknowledge" buttons
  - "Reconcile" button (with confirmation)
- pgmq queue: `q_drift_check` (scheduled by a Supabase cron job)

**Out**:
- Audit log attribution ("who changed it") — requires target DB
  audit logs which are out of scope for the leave-no-trace engine
  (deferred; flag in the impact section as "user attribution not
  available unless your DB has logging configured")
- Continuous notification (Slack, email) — deferred to chat
  surface wishlist [#8](https://github.com/dventimisupabase/pg-policy-engine/issues/8)

### 9.2 Key tasks

1. **Backend schema migration**
   - `drift_events` table with RLS
2. **Worker scheduled drift check**
   - Cron in Supabase invokes pgmq enqueue every N minutes per
     active target
   - Worker handler calls engine's drift detection
   - Writes new events; updates existing events
3. **Engine drift integration**
   - Existing engine drift detection feeds into `drift_events`
4. **Impact analysis**
   - For each drift event, re-run the simulator pattern to compute
     row visibility diff (expected vs. observed)
   - Store as `impact` JSONB
5. **Reconcile flow**
   - "Reconcile" button → confirmation → POST `/api/v1/drift/:id/
     reconcile` → engine's reconcile emits remediation SQL → applied
     to target → drift event marked resolved
6. **Frontend timeline page**
   - Vertical timeline with event cards
   - Click → detail drawer
   - Filters (TanStack Table compatible)

### 9.3 Dependencies

- Phases 0, 1, 3 complete (targets exist; policies are deployable)
- Engine's drift detection is already MVP-complete
- Supabase cron scheduling

### 9.4 Exit criteria

Vision doc § V1 Exit Criteria #5:
> A user can view a drift timeline for a connected database with
> classified events and reconciliation options.

Operationally:

- [ ] Drift events for connected targets appear on the timeline
- [ ] Events are classified by drift type and severity
- [ ] Clicking shows full detail with impact analysis
- [ ] Reconcile applies remediation SQL and marks the event resolved
- [ ] Realtime updates the timeline when new events arrive
- [ ] Demo: a colleague can identify a drift event, understand its
      impact, and reconcile it inside 3 minutes
- [ ] Phases 0-4 still work
- [ ] Tag `v0.5.0-poc` pushed

### 9.5 Risks and open questions

- **Drift check frequency**: too frequent costs Supabase / Fly
  resources; too rare misses events. Start at every 5 minutes per
  active target; tune.
- **Impact analysis cost**: re-running simulator-like comparison per
  drift event can be expensive on large tables. Sample if needed.
- **False positives**: cosmetic differences (e.g., whitespace in
  expression text) shouldn't be drift. Normalize before comparison.

---

## 10. Phase 6 — Compliance Binder

**Goal**: a user can generate a compliance binder for a chosen period
and download it as PDF.

**Vision doc**: Feature 6 (The Compliance Binder).

**Complexity**: Medium.

### 10.1 Scope

**In**:
- Backend additions:
  - `binders` (id, org_id, target_id, period_start, period_end,
    generated_at, status, pdf_storage_path, signature)
- Ktor endpoint:
  - `POST /api/v1/binders` (enqueue generation)
  - `GET /api/v1/binders/:id` (status + download URL)
- Worker handler for `q_binder`
- PDF generation (server-side; recommend Playwright headless
  rendering of a React component → PDF, for fidelity with the web
  view)
- Signing: HMAC-SHA256 over the binder content using a
  Supabase-Vault-stored key
- Supabase Storage bucket for PDF persistence
- Frontend binder page:
  - "Generate for period" form
  - List of past binders
  - Web view (interactive drill-into)
  - "Download PDF" button
  - JSON export

**Out**:
- Asymmetric signatures with full certificate chain (deferred to
  signed policies wishlist [#15](https://github.com/dventimisupabase/pg-policy-engine/issues/15))
- Branding / per-customer theming (deferred)

### 10.2 Key tasks

1. **Backend schema migration**
   - `binders` table with RLS
2. **Binder content schema**
   - Define JSON shape: executive summary, per-table evidence,
     policy inventory, drift log, change history, signature
3. **Worker handler for `q_binder`**
   - Aggregates data from `proof_runs`, `drift_events`,
     `policy_drafts`, `policy_deployments`, `schema_tables`
   - Computes executive summary stats
   - Signs the content
   - Renders to PDF
   - Uploads to Supabase Storage
   - Updates `binders.pdf_storage_path` and `.signature`
4. **PDF rendering**
   - Recommendation: a separate Playwright instance (in the worker
     container or a small companion service) renders an HTML/React
     view to PDF for visual fidelity with the web view
   - Alternative: server-side library like `puppeteer` from a Node
     subprocess; rejected to keep the worker pure Kotlin where
     possible — revisit if Playwright in Kotlin is too clunky
5. **Frontend binder pages**
   - Generate form
   - List view
   - Web view (renders the same React component used for PDF)
   - Download button

### 10.3 Dependencies

- Phases 0, 1, 3, 4, 5 complete (need policies, proofs, drift)
- Supabase Storage available
- A way to run a headless browser from the worker (Playwright in a
  Docker layer)

### 10.4 Exit criteria

Vision doc § V1 Exit Criteria #6:
> A user can generate a compliance binder for a chosen period and
> download it as PDF.

Operationally:

- [ ] User selects a period and target
- [ ] Generation enqueues a worker job; status updates via Realtime
- [ ] Generated binder appears in list with download link
- [ ] PDF renders correctly and matches the web view's content
- [ ] Signature is verifiable (provide a `verify-binder` CLI command
      or doc explaining HMAC verification)
- [ ] JSON export works
- [ ] Demo: a colleague can generate a binder for a sample target
      and download the PDF inside 2 minutes
- [ ] Phases 0-5 still work
- [ ] Tag `v0.6.0-poc` pushed

### 10.5 Risks and open questions

- **Playwright in Docker**: requires a Linux image with browser
  dependencies (Chromium). Image size grows significantly. If too
  heavy, fall back to `react-pdf` browser-side or a server-side
  library like Apache PDFBox in Kotlin.
- **Long generation times for large binders**: stream progress to
  the frontend via Realtime updates on `binders.status`.
- **Signature semantics**: HMAC proves "this content was signed by
  someone with the key" — not "this binder was created by alice."
  Document the limit clearly. Asymmetric signing per-user is
  wishlist territory.

---

## 11. Phase 7 — Recommendation Wizard

**Goal**: a user connecting a new database without policies can run
the recommendation wizard and accept proposed policies that compile
and verify.

**Vision doc**: Feature 7 (The Schema-Driven Recommendation Wizard).

**Complexity**: Large.

### 11.1 Scope

**In**:
- New engine primitive: `recommend` — takes introspected schema
  metadata, returns a list of proposed policies with DSL source,
  rationale, and performance note
- Pattern recognizers for v1:
  - Direct tenant isolation (column matches `tenant_id`, `org_id`,
    `account_id`)
  - Transitive tenant isolation (FK to tenant-bearing table)
  - Soft delete (column matches `deleted_at`, `is_deleted`)
  - Ownership (column matches `user_id`, `owner_id`, `created_by`)
- Ktor endpoint:
  - `POST /api/v1/targets/:id/recommend` (enqueue scan)
- pgmq queue: `q_recommend`
- Worker handler that runs `recommend` and writes proposals
- Backend additions:
  - `recommendation_proposals` (id, target_id, table_name,
    proposed_dsl, compiled_sql, rationale, performance_note,
    status (proposed/accepted/modified/skipped), created_at)
- Frontend wizard page:
  - "Scan for missing policies" action on target page
  - Step-by-step walk-through of proposals
  - Per-proposal: DSL preview, compiled SQL, simulator preview,
    rationale, performance note (from resumption-notes' three-
    strategy framework — see ADR §3.6 cross-references)
  - Accept → creates a draft via `policy_drafts` flow
  - Modify → opens the editor with the proposed DSL pre-filled
  - Skip → marks proposal skipped

**Out**:
- Federated recommendation improvement across deployments
  (wishlist [#5](https://github.com/dventimisupabase/pg-policy-engine/issues/5))
- Extensible pattern catalog beyond the four above (wishlist
  [#5](https://github.com/dventimisupabase/pg-policy-engine/issues/5))

### 11.2 Key tasks

1. **Engine `recommend` primitive**
   - New module in `engine/` for schema pattern recognition
   - Per-pattern: detector function + DSL synthesizer + performance
     note generator
   - Returns ordered list of proposals
2. **Backend schema migration**
   - `recommendation_proposals` table with RLS
3. **Worker handler**
   - Reads target, decrypts creds, calls engine's `recommend`
   - Compiles each proposal's DSL (validate it works)
   - Optionally runs analyze on each (proof results stored)
   - Writes to `recommendation_proposals`
4. **Wizard UI**
   - Multi-step component
   - Accept / Modify / Skip per proposal
   - Aggregate "X accepted, Y skipped" summary
5. **Accept flow integration**
   - Accept → creates `policy_drafts` row → editor open to it OR
     direct deploy if the user prefers (configurable)
6. **Graceful fallback** (resolves vision doc R7)
   - If no patterns match for a table, surface "no recommendations
     for this table; author manually" — link to the editor

### 11.3 Dependencies

- Phases 0, 1, 3 complete (target exists; schema introspected;
  editor exists to accept proposals into)
- Engine extended with `recommend` primitive (this phase includes
  that extension)

### 11.4 Exit criteria

Vision doc § V1 Exit Criteria #7:
> A user connecting a new database without policies can run the
> recommendation wizard and accept proposed policies that compile
> and verify.

Operationally:

- [ ] Wizard triggers from the target page
- [ ] Engine scans schema and proposes policies for recognized
      patterns
- [ ] Each proposal includes DSL, compiled SQL, simulator preview,
      rationale, performance note
- [ ] Accept creates a draft (and optionally deploys)
- [ ] Modify opens the editor pre-filled
- [ ] Skip marks the proposal skipped
- [ ] Tables with no matching pattern show graceful fallback
- [ ] Accepted policies compile and (when verifiable) prove UNSAT
      for tenant isolation
- [ ] Demo: a colleague can connect a fresh database, run the
      wizard, and accept tenant isolation + soft delete policies
      inside 3 minutes
- [ ] Phases 0-6 still work
- [ ] Tag `v0.7.0-poc` pushed

### 11.5 Risks and open questions

- **Pattern overreach**: proposing a policy for every column named
  `user_id` will be wrong sometimes (e.g., the column is a foreign
  key to a non-user table). The synthesizer must verify by checking
  column type, FK relationships, and apply heuristics; accept that
  some proposals will be "no, that's wrong" and the wizard should
  make rejection easy.
- **Engine extension scope**: the `recommend` primitive is new
  engine code, not just UI work. Allow for engine work in this phase
  proportional to feature complexity.
- **Performance note quality**: should reference resumption-notes'
  three-strategy framework. Performance notes are user-facing, so
  text must be clear without engine internals jargon.

---

## 12. After Phase 7 — v1 Exit

When Phase 7 exits, the v1 web app is complete per the vision doc's
seven exit criteria. The recommended follow-up actions:

1. **Tag `v1.0.0-poc`** and announce internally at Supabase.
2. **Gather customer signal** by demoing the POC to Supabase
   customers facing RLS governance problems. Capture what they
   value, what's confusing, what they want next.
3. **Promote items from `spec/surfaces-wishlist.md`** to formal scope
   based on customer signal. The wishlist issues
   ([#5–#15](https://github.com/dventimisupabase/pg-policy-engine/issues?q=is%3Aissue+is%3Aopen+label%3Awishlist))
   are the menu.
4. **Resolve the production deployment decision** (ADR §6) based on
   what customers actually need.
5. **Performance pass** if measurements gathered during demos
   indicate problems.

---

## 13. What This Plan Does Not Cover

- **Production deployment**: deferred per ADR §6.
- **Wishlist surface work** (LSP, MCP, chat, CI/CD, etc.): explicitly
  out of v1 scope.
- **Time / date estimates**: deliberately omitted because they will
  be wrong.
- **Specific library / tool choices** beyond what the ADR settles:
  TanStack Table, React Flow, CodeMirror — recommendations only,
  may swap during implementation.
- **Team allocation**: this plan assumes a single development thread
  per phase. Parallel work across phases is possible but increases
  coordination cost.

---

## 14. Cross-References

| This plan                       | Other artifact                                                            |
|---------------------------------|---------------------------------------------------------------------------|
| §2 Scope & Framing              | `spec/web-app-vision.md` § V1 Web App Scope                               |
| §3 Cross-Phase Conventions      | `spec/web-app-architecture-decision.md` D11, D12, D13, D14                |
| §4 Phase 0                      | `spec/web-app-architecture-decision.md` (entire); D11 timing in particular |
| §5 Phase 1 (Schema Overlay)     | `spec/web-app-vision.md` Feature 1; ADR D10 (target DB roles)             |
| §6 Phase 2 (Simulator)          | `spec/web-app-vision.md` Feature 2; ADR D10 (data privacy)                |
| §7 Phase 3 (Editor)             | `spec/web-app-vision.md` Feature 3; ADR D2, D6                            |
| §8 Phase 4 (Proof Inspector)    | `spec/web-app-vision.md` Feature 4, R6                                    |
| §9 Phase 5 (Drift Timeline)     | `spec/web-app-vision.md` Feature 5                                        |
| §10 Phase 6 (Compliance Binder) | `spec/web-app-vision.md` Feature 6                                        |
| §11 Phase 7 (Recommendation)    | `spec/web-app-vision.md` Feature 7, R7; resumption-notes three-strategy framework |
| §12 After Phase 7               | `spec/surfaces-wishlist.md`; ADR §6 Deferred Decisions                    |

---

*End of web app phasing plan.*
