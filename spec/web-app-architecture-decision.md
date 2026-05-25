# Web App Architecture Decision Record

**Status**: Draft
**Date**: 2026-05-24
**Audience**: Architects, senior engineers, future maintainers
**Supersedes**: nothing
**Supplements**: `spec/web-app-vision.md`, `spec/architecture-decision.md`

---

## 1. Purpose

This ADR records the architectural decisions for the v1 web application
surface defined in `spec/web-app-vision.md`. The vision document
established the seven-feature scope and identified four open technical
choices plus seven open risks (R1–R7); this ADR resolves them.

The decisions below were settled in conversation on 2026-05-24,
documented here as the durable record. Where the vision doc offered a
recommendation, we either adopt it or note the override and the
reasoning.

This ADR does not modify the engine ADR (`spec/architecture-decision.md`).
The engine remains Kotlin/JVM, generic-PostgreSQL, leave-no-trace. This
ADR concerns only the new surface code and its supporting infrastructure.

---

## 2. Context

The web app is the first **surface** in the "engine + surfaces"
architecture introduced by the vision doc. The engine is feature-complete
as a CLI tool; the web app reaches for a different audience (security
engineers in a browser, compliance officers in a binder, executives in
a demo) without expanding the engine's scope.

The web app is also a **proof-of-concept the user (a Supabase employee)
will pitch internally and to Supabase customers**. This is a real
constraint, not a footnote: the web app is allowed to lean into
Supabase as its backend stack, even though the engine itself is
deliberately Supabase-agnostic. Pitch-readiness — visual polish,
fast-to-impressive demos, first-class Supabase integration — is a
legitimate v1 priority alongside the seven feature exit criteria.

The engine's existing posture stays: vanilla PostgreSQL only, no
Supabase-specific dependencies in the engine itself. The web app's
posture is: Supabase-native, targeting Supabase Cloud for the POC;
production deployment shape is deferred.

---

## 3. Architectural Summary

```
┌────────────────────────────────────────────────────────────────────┐
│ Frontend (React + TypeScript, Vite)                                 │
│ - supabase-js: Auth, PostgREST, Realtime                            │
│ - Monaco/CodeMirror code editor                                     │
│ - React Flow / Cytoscape for graph viz                              │
│ - TanStack Table for tabular surfaces                               │
└────────┬────────────────────────────────┬──────────────────────────┘
         │ JWT-auth'd                      │ JWT-auth'd
         ▼                                 ▼
┌────────────────────────────┐  ┌──────────────────────────────────┐
│ Supabase Stack              │  │ Engine HTTP service (Kotlin Ktor) │
│ - PostgreSQL                │  │ - Verifies Supabase JWT (JWKS)    │
│ - PostgREST (auto REST)     │  │ - REST endpoints per primitive:   │
│ - Auth                      │  │   parse, compile, analyze,        │
│ - Realtime (CDC + Presence  │  │   simulate, introspect, recommend │
│   + Broadcast)              │  │ - Writes results to Supabase PG   │
│ - pgmq extension (queues)   │  │   via service-role PostgREST      │
│ - Vault (target DB creds)   │  └──────────────┬───────────────────┘
└────────┬───────────────────┘                  │
         │ pgmq.read()                          │
         ▼                                       │
┌────────────────────────────┐                  │
│ Engine Worker (Kotlin)      │                  │
│ - Polls pgmq queue          │                  │
│ - Runs background jobs:     │                  │
│   continuous verification,  │                  │
│   scheduled drift checks,   │                  │
│   long analyses             │                  │
│ - Writes results to PG      │                  │
└────────┬───────────────────┘                  │
         │                                       │
         └──────────────┬───────────────────────┘
                        │ JDBC: read-only role for simulator; write role for deploy/reconcile
                        ▼
            ┌────────────────────────────┐
            │ Target PostgreSQL DB(s)     │
            │ (customer-governed)         │
            └────────────────────────────┘
```

**One sentence**: React + TypeScript frontend on top of Supabase
(Postgres + PostgREST + Realtime + Auth + pgmq), with two Kotlin
processes — an interactive HTTP service and a background worker — that
wrap the existing engine primitives and write results into the
Supabase backend where the frontend sees them via Realtime.

---

## 4. Decisions

### D1. Frontend framework: React + TypeScript (Vite)

The frontend is a single-page application built with React 18+ and
TypeScript, bundled with Vite.

**Why**: largest ecosystem for the components we need — code editor
(Monaco / CodeMirror), graph visualization (React Flow, Cytoscape.js),
data tables (TanStack Table), forms (React Hook Form), and the
Supabase JS client. React's incumbency in the Supabase ecosystem
(supabase-js examples, Supabase Studio itself) reduces friction when
the web app is shown to Supabase audiences.

**Alternatives considered**:
- *Svelte + SvelteKit* — smaller bundles, simpler reactivity, but
  smaller ecosystem for the niche components (code editors, graph viz)
  we depend on.
- *SolidJS* — excellent performance, React-like JSX, but immature
  ecosystem requires more integration glue.

**Tradeoffs accepted**: React's bundle size is larger; we mitigate with
code splitting and Vite's tree-shaking. We accept React's somewhat
heavier rendering cost in exchange for the ecosystem.

### D2. API layer: PostgREST (Supabase) for CRUD; Ktor for engine primitives

There is no custom REST API service for backend state. PostgREST,
running as part of the Supabase stack, autogenerates REST endpoints
from the backend PostgreSQL schema. CRUD over backend tables
(`target_databases`, `policy_drafts`, `proof_results`,
`drift_events`, etc.) is PostgREST traffic; the frontend uses
supabase-js to issue it.

For engine-primitive operations that cannot be served from materialized
state (live compile-as-you-type, on-demand analyze, simulator
evaluation), a small Kotlin Ktor service exposes engine primitives over
HTTP. The Ktor service is the *only* custom backend code on the API
boundary.

**Why**: PostgREST removes the largest chunk of custom code (CRUD,
filtering, pagination, partial response, write validation). The Ktor
service is reduced to a thin shim over engine functions, which is
what it should be — engine primitives are the durable artifact.

**Alternatives considered**:
- *Custom Kotlin REST service for everything* (vision doc default) —
  rejected because it duplicates work PostgREST does well, and would
  require us to design every endpoint shape and pagination scheme by
  hand.
- *gRPC instead of REST for engine endpoints* — rejected because the
  benefit (typed contracts, streaming) doesn't outweigh the cost
  (browser tooling, gateway translation). REST + JSON is universally
  legible and matches PostgREST's shape.

**Tradeoffs accepted**: Two API surfaces (PostgREST + Ktor) instead of
one. We commit to a clear contract: PostgREST owns state; Ktor owns
primitives. The frontend knows which to call based on the operation.

### D3. Backend persistence: Supabase PostgreSQL

The web app's own state — users, organizations, target database
connections, saved simulator scenarios, drift acknowledgments,
compliance binder history, materialized proof status, materialized
drift events, materialized schema status — lives in a Supabase
PostgreSQL database. This is entirely separate from any *target*
PostgreSQL database the engine governs.

RLS protects every backend table; policies key off `auth.uid()` and
organization membership. The web app's *own* RLS is hand-written and
not engine-managed (avoiding the bootstrapping problem the vision doc
flagged in Component 4).

**Why**: aligns with the engine's domain (it's a PostgreSQL governance
tool — its backend should be PostgreSQL), matches the user's daily
stack and the Supabase pitch context, and absorbs auth/realtime/auto-API
in one stack.

**Alternatives considered**:
- *SQLite* — simpler self-host, but no PostgREST/Realtime/Auth and
  weak concurrent-write story.
- *Plain self-managed Postgres without Supabase* — possible, but loses
  PostgREST, Realtime, Auth, Vault, pgmq integration that ship together.

### D4. Realtime: Supabase Realtime (Postgres Changes + Presence + Broadcast)

The frontend receives live updates via Supabase Realtime, with all
three feature modes used as appropriate:

- **Postgres Changes (CDC)**: subscriptions on tables like
  `proof_results`, `drift_events`, `schema_status`,
  `recommendation_proposals`, `policy_drafts`. Frontend redraws when
  rows change. RLS applies to the change feed automatically.
- **Presence**: ephemeral state about who is viewing what — "alice is
  looking at the orders table," "bob is editing tenant_isolation_policy."
  Used for collaboration hints in the policy editor and schema overlay.
- **Broadcast**: pub/sub for events that don't deserve persistence —
  toast notifications, deployment progress steps, transient errors.

**Why**: Postgres Changes is the right mechanism for the vision doc's
"live preview updates on every edit" requirement — when the worker
writes a fresh proof result, every subscribed client sees it without
polling. Presence makes the schema overlay collaborative cheaply.
Broadcast handles ephemeral events that polluting tables would be
wrong for.

**Alternatives considered**:
- *Polling only* — simpler RLS story, less snappy editor preview;
  rejected because the live-preview feel is central to Feature 3
  (Policy Authoring Surface) and Feature 1 (Schema Overlay).
- *WebSocket from the Ktor service* — would duplicate Realtime's
  infrastructure for no gain.

### D5. Authentication: Supabase Auth

Users authenticate to the web app via Supabase Auth (email + OAuth
providers; Google, GitHub, and Microsoft expected at launch). The
Supabase JWT is the credential. The frontend uses `supabase-js` for
sign-in/sign-out and session management. PostgREST reads
`auth.uid()` from the JWT for RLS evaluation. The Kotlin Ktor service
verifies the JWT against Supabase's JWKS and reads the user id from
claims.

The vision doc's R4 recommended reverse-proxy as the primary auth mode
with local accounts as fallback. We override that recommendation:
Supabase Auth is simpler, more pitch-friendly, and naturally integrates
with the rest of the stack. Reverse-proxy / SAML / OIDC integration is
deferred to a later phase if enterprise customers require it.

**Why**: pitch-friendly (sign in with Google in one click), integrated
with the rest of the Supabase stack, gives us `auth.uid()` in RLS
without custom plumbing, supports OAuth providers out of the box.

**Alternatives considered**:
- *Reverse-proxy primary* (vision doc default) — rejected as the
  primary mode because it adds setup friction to a POC that is being
  pitched. Could be added as a deployment option later.
- *Roll our own auth* — rejected; Supabase Auth is a solved problem.

### D6. Engine bridge: Hybrid HTTP + worker

Two integration paths between the web app and the engine:

- **Ktor HTTP service** for interactive operations: editor-typing live
  preview (parse + compile + light analysis on every settled edit),
  on-demand "Verify" runs, simulator evaluations, recommendation
  proposals. Synchronous; the frontend awaits the response. Sub-second
  target where the engine can deliver.
- **Kotlin worker** for background operations: continuous verification
  (full proof rerun on schedule or on schema change), scheduled drift
  checks, large simulator scans, compliance binder generation.
  Asynchronous; the worker reads jobs from a queue, runs them, writes
  results to backend tables, Realtime broadcasts to subscribed
  frontends.

Both services share the same engine source code — the engine's
internal modules (`com.pgpe.parser`, `com.pgpe.analysis`, etc., per
`spec/design.md` §4) are invoked directly in-process. The two services
differ only in their entry point and lifecycle.

**Why**: the snappy editor-preview path and the long-running
verification path have genuinely different requirements (latency vs.
throughput, sync vs. async, retry semantics). One mechanism for both
would compromise one of them.

**Alternatives considered**:
- *HTTP-only* (vision doc default) — rejected because long-running
  proof reruns over a large policy set would block HTTP connections
  and time out.
- *Queue-only* — rejected because every keystroke in the editor
  shouldn't enqueue a job; the latency tax is too high for the
  preview UX.

### D7. Job queue: pgmq extension

Background jobs are enqueued and dequeued via the `pgmq` PostgreSQL
extension running inside the Supabase Postgres. The Ktor service (and
Edge Functions, if we use them later) enqueue via `pgmq.send()`. The
worker dequeues via `pgmq.read()` with a visibility timeout, processes
the job, and finalizes via `pgmq.archive()` or `pgmq.delete()`.

Each queue maps to a job category: `q_verify` (proof reruns),
`q_drift_check` (introspection + diff), `q_binder` (compliance report
generation), `q_simulate_scan` (large simulator runs).

**Why**: pgmq is a Supabase-supported native extension purpose-built
for this. It gives us persistent queues with visibility timeout,
retries, dead-letter queues, and ordering — none of which
LISTEN/NOTIFY provides. It runs inside the same Postgres as our
backend state, so jobs are atomic with their enqueueing transaction.

Reference: [Supabase pgmq docs](https://supabase.com/docs/guides/database/extensions/pgmq).

**Alternatives considered**:
- *LISTEN/NOTIFY* — rejected; ephemeral signaling without persistence,
  no retry, no visibility timeout.
- *External queue (Redis Streams, RabbitMQ, etc.)* — rejected;
  introduces a separate service to operate, breaks the
  Supabase-as-backend simplification.

### D8. Supabase host: Supabase Cloud for the POC MVP

The POC MVP runs against **Supabase Cloud**. The user is a Supabase
employee with Cloud access; this is the fastest path to a working
product to pitch. All Supabase features used in this ADR (PostgREST,
Realtime, Auth, pgmq, Vault) are available on Cloud.

**Production deployment is deferred.** The vision doc's R3 recommended
self-hosted Supabase for prod; this ADR overrides that recommendation.
Self-hosted Supabase is not Supabase's recommended posture for
production, and committing now to any specific prod deployment shape
is premature for a POC. The production deployment decision is left
for when customer signal justifies one — see §6 Deferred Decisions.

To preserve optionality, the web app's code stays deployment-agnostic
about which Supabase project it connects to — environment variables
differ; the code does not. We avoid Cloud-only features that would
close off plausible future prod paths without a clear reason.

**Why**: deferring is cheaper than committing wrong. The POC's
success criterion is pitch-readiness, not coverage of every prod
deployment shape. We'll learn the right prod story from the customers
who actually want it.

**Alternatives considered**:
- *Self-hosted Supabase for prod* (vision doc R3) — rejected; not
  Supabase's recommended prod posture, and premature for a POC stage.
- *Commit to Supabase Cloud for prod too* — rejected; some customers
  will have data-residency or compliance constraints that may not
  match. Leave the decision open.

### D9. Multi-database scope: workspaces

The web app manages multiple target PostgreSQL databases. Each is a
*workspace*; the user switches between workspaces from a sidebar or
header dropdown. Workspaces are isolated — no cross-database queries
or unified reports in v1.

This adopts the vision doc's R2 recommendation. Cross-database
federation (unified governance views) is tracked as a v1.1+ wishlist
item ([issue #5](https://github.com/dventimisupabase/pg-policy-engine/issues/5)).

### D10. Simulator data privacy (R1): show real rows, read-only, audit-logged

The default for the Feature 2 simulator is to display real row contents
under three safeguards:

1. **Read-only target connection**: simulator queries run as a
   dedicated PostgreSQL role with `SELECT`-only grants on the
   simulated tables. Writes are impossible at the DB level.
2. **Audit log**: every simulator query is recorded to the Supabase
   backend (`simulator_audit_log` table) with user id, target, query
   SQL, session variables, timestamp, and row count returned.
3. **Per-target opt-in**: when adding a target database, the user
   toggles "allow simulator over real data." If off, the simulator
   refuses to query that target. The `target_databases` row carries
   an `is_production` boolean; when true, the simulator opt-in
   defaults to off and must be explicitly enabled per session.
   Free-form tags (for environment grouping or other classification)
   are deferred to v1.1 if other features need them.

The simulator's read-only role is distinct from the role used by the
`apply` and `reconcile` flows, which need write access to issue
`CREATE POLICY` / `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` DDL
against the target database. Two roles per target, two connection
strings, scoped grants on each.

Masking modes (column-level masking, anonymized row IDs, hide-by-default)
are deferred to v1.1. The pitch demands real data demonstrability;
adding masking now would slow shipping without serving the POC's
audience.

**Why**: the simulator's value comes from showing actual filtering
behavior on actual data. Read-only and audit log address the
high-order concerns. Masking is real but not v1 critical.

### D11. Repository layout: monorepo with subdirectories

The existing `pg-policy-engine` repository becomes a monorepo. The
engine's existing sources move into `engine/` (Kotlin), and new
top-level directories are added:

```
pg-policy-engine/
├── engine/          # existing Kotlin engine sources
├── api/             # Kotlin Ktor HTTP service wrapping engine primitives
├── worker/          # Kotlin background worker reading pgmq queues
├── web/             # React + TypeScript frontend (Vite)
├── supabase/        # Supabase CLI config, migrations, seed
├── docker/          # Docker Compose files and Dockerfiles
└── spec/            # existing spec artifacts (no change)
```

`api/` and `worker/` share dependencies on `engine/` via Gradle
composite build or a published local Maven artifact (TBD in the build
config). `web/` is independently built; it depends only on the public
API contract (PostgREST schema + Ktor OpenAPI spec).

**Why**: refactors that touch engine + surfaces land in one PR. One
CI pipeline. One issue tracker. The engine + surfaces tight loop is
the primary development pattern for the next several months.

**Alternatives considered**:
- *Split repos* — rejected for v1; the cross-cutting change rate is
  high and split repos would slow that. Worth reconsidering when the
  engine matures and other surfaces (LSP, MCP) become independent
  consumers.
- *Monorepo with strict package boundaries* (publish engine to a
  local registry, surfaces depend on the artifact) — rejected as
  overhead; we can adopt this later when boundaries become real.

**Timing**: the engine source refactor (moving
`src/main/kotlin/com/pgpe/` into `engine/src/main/kotlin/com/pgpe/`)
is Phase 0 work in the phasing plan — done before any new surface
code is written, so all subsequent web app PRs see the new layout
from day one. Existing engine tests must continue to pass after the
move; CI must be green before any surface work begins.

### D12. Engine deployment: Docker Compose for the POC

Both engine services (Ktor HTTP + worker) ship as Docker images. A
single `docker-compose.yml` brings up the engine services plus the
frontend dev server, all wired to Supabase Cloud via environment
variables.

The POC needs one Compose profile:

- `profile: cloud-dev` — engine HTTP service + engine worker +
  frontend dev server, connecting to a Supabase Cloud project.

Additional profiles (local-only Supabase for offline development;
production deployment shapes) can be added when a need emerges. The
Compose structure does not preclude them; we just don't define them
yet.

**Why**: one workflow for the POC. Containerizing from day one avoids
the "works on my machine" problem and keeps options open. Tying
everything to Compose now would over-fit; the POC's deployment story
is simple by design.

**Alternatives considered**:
- *Gradle for dev (no containers)* — rejected; we want the engine
  services portable and reproducible from day one.
- *GraalVM native binary* — interesting future optimization; rejected
  for v1 because of Z3 JNI complications and build-time cost.

### D13. Performance posture (R5): measure first, cache where natural

The vision doc's R5 flagged that the engine was designed for one-shot
CLI use and may be inadequate for the web app's continuous-query load.
The decision: ship v1 with a measure-first posture. Specifically:

- **No premature caching infrastructure**. Don't build a request-level
  cache, a result memoization layer, or an incremental re-analysis
  system until empirical measurement shows they're needed.
- **Cache where it's free**: materialize proof results, drift events,
  and schema status in Supabase tables. The continuous verification
  worker already produces these; the editor consumes them via
  Realtime. Cache hits cost a `select` on a table.
- **Measure with realistic workloads early**. As soon as the editor
  preview works against a real database, capture latency
  distributions and the Z3 timeout rate. If preview latency exceeds
  300ms p95, then invest in caching.

**Why**: the engine's existing performance characteristics may be
adequate. Designing caches before measuring is the classic premature
optimization mistake. The materialization pattern (worker → table →
Realtime) is a natural cache that costs us nothing extra.

### D14. POC hosting: Fly.io for engine services, Cloudflare Pages for the frontend

The engine HTTP service and the engine worker run on **Fly.io** from
early in the POC. They share one Fly.io application with two
processes (per Fly's `[processes]` config) — one process serves HTTP,
the other polls pgmq. The same Docker image is used for both; the
entry point differs by process name. Locally with Docker Compose
(D12), the same shape is achieved by defining two `services:` entries
that share the image with different commands — one for the HTTP
process, one for the worker. Developers run those services locally
during daily iteration; the Fly.io deployment exists in parallel for
shared demos and pitches.

The React frontend builds to a static bundle and is served from
**Cloudflare Pages**. Cloudflare's global CDN handles asset delivery;
the frontend's API calls go to (a) Supabase Cloud for PostgREST,
Auth, and Realtime, and (b) the Fly.io Ktor service for engine
primitives.

**Why Fly.io for the Kotlin services**:
- Strong Kotlin/JVM support — Ktor and Spring run cleanly
- Persistent long-running containers fit the worker's pgmq polling
  loop; serverless runtimes (Lambda, Cloud Run, Edge Functions) do
  not.
- Dockerfile-native deploys match D12's packaging choice
- Region placement near Supabase reduces latency
- Cheap at POC traffic; widely used in the Supabase customer orbit

**Why Cloudflare Pages for the frontend**:
- Free at our scale, fast global CDN
- Framework-agnostic — works cleanly with a Vite SPA
- GitHub integration for preview deploys per PR
- No Next.js bias to fight; we are not building a Next.js app
- Isolated from the engine services — frontend changes don't risk
  the API surface

**Alternatives considered**:
- *Local Compose only, no hosted instance until later* — rejected;
  pitch-readiness requires a shareable URL early.
- *Railway or Render* — fine choices, similar shape to Fly.io;
  rejected in favor of Fly.io for Kotlin-friendliness and
  Supabase-orbit familiarity.
- *Frontend on Vercel* — fine; rejected in favor of Cloudflare Pages
  to avoid Next.js framework opinions and edge-runtime coupling.
- *Frontend served from the Fly.io app (nginx sidecar)* — rejected;
  mixes concerns and gives up CDN edge caching.
- *Frontend on Supabase Storage* — interesting "all-Supabase" pitch
  story; rejected for now because Cloudflare Pages gives us better
  CDN performance, preview deploys per PR, and isolation from the
  rest of the stack.

These are POC hosting choices, not v1.1+ commitments. Production
hosting is governed by the deferred prod deployment decision (§6).

---

## 5. Components

The decisions above produce the following deployable components:

| Component            | Tech              | Repo location | Notes                                                                                                  |
|----------------------|-------------------|---------------|--------------------------------------------------------------------------------------------------------|
| Frontend             | React + TS + Vite | `web/`        | Static build; hosted on Cloudflare Pages                                                               |
| Engine HTTP service  | Kotlin + Ktor     | `api/`        | JWT verification, in-process engine calls; hosted on Fly.io                                            |
| Engine worker        | Kotlin            | `worker/`     | Polls pgmq, runs background engine jobs; hosted on Fly.io (same app as HTTP service, separate process) |
| Backend Postgres     | Supabase          | (managed)     | Supabase Cloud for the POC; prod deployment deferred                                                   |
| Auto REST API        | PostgREST         | (managed)     | Bundled with Supabase                                                                                  |
| Realtime             | Supabase Realtime | (managed)     | Bundled with Supabase                                                                                  |
| Auth                 | Supabase Auth     | (managed)     | Bundled with Supabase                                                                                  |
| Job queue            | pgmq (extension)  | (in PG)       | Inside the backend Postgres                                                                            |
| Secret storage       | Supabase Vault    | (in PG)       | Target DB credentials, service-role tokens                                                             |
| Docker orchestration | Docker Compose    | `docker/`     | Profile: `cloud-dev` (others deferred)                                                                 |
| Supabase config      | Supabase CLI      | `supabase/`   | Migrations, seed data, RLS policies, generated types                                                   |

Total custom-code surface: three deployables (frontend, API service,
worker). The rest is configured Supabase stack.

---

## 6. Deferred Decisions

Decisions deliberately not made in this ADR; revisit as needed.

### Witness rendering for the proof inspector (R6)

The proof inspector needs to translate SMT models into human-readable
scenarios ("a row with `tenant_id = 42` would be visible to a session
with `tenant_id = 99`"). This is a presentation design problem, not an
architecture decision. Resolve during Feature 4 implementation.

### Unmatched recommendation patterns (R7)

When the recommendation wizard encounters a schema that doesn't match
its known patterns, the planned behavior is "graceful fallback to
'nothing to propose; author manually.'" The mechanism (per-table or
per-schema; how the user is informed) is a UX detail resolved during
Feature 7 implementation.

### Production deployment model

The POC runs against Supabase Cloud (D8). The production deployment
shape — multi-tenant SaaS on a Supabase project we operate;
customer-deployed-to-their-own-Supabase-Cloud-project; hybrid; or
something else — is deferred until customer signal justifies a
decision. Self-hosted Supabase is explicitly off the table per D8.
The web app code remains deployment-agnostic about which Supabase
project it connects to, preserving optionality.

### Reverse-proxy / SAML / OIDC auth

Deferred per D5. Revisit when enterprise customer signal arrives.

### Cross-database federation views

Deferred per D9. Tracked as wishlist
[issue #5](https://github.com/dventimisupabase/pg-policy-engine/issues/5).

### Masking modes for the simulator

Deferred per D10. Tracked as a v1.1 follow-up — flagged in the
simulator audit log code so we know what to add.

### Storage and rendering of compliance binder PDFs

Feature 6 needs PDF output and signing. The PDF mechanism (server-side
generation vs. browser-side via something like react-pdf) and the
signing mechanism (Supabase Vault for keys, but which signature
algorithm) are deferred to Feature 6 implementation.

### Edge Functions vs. direct frontend-to-Ktor calls

Currently the frontend calls the Ktor service directly with the
Supabase JWT. We may want a Supabase Edge Function in front of the
Ktor service eventually for rate limiting, request shaping, or
centralized auth/logging. Skip for v1; revisit when a need emerges.

---

## 7. Constraints That Stay

These constraints (from `spec/resumption-notes.md` and the vision doc)
remain in force and were not changed by any decision above:

- **Engine remains vanilla PostgreSQL**: the engine itself uses no
  Supabase-specific extensions or features. The Supabase adoption in
  this ADR is for the web app surface only.
- **Engine leave-no-trace on target databases**: the web app's
  introspection and simulator queries against target databases follow
  the same posture. No metadata tables, no helper functions, no
  comments on the customer's database.
- **Three personas from the PRD**: Platform Security Engineer,
  Application Developer, Compliance Auditor. The web app serves all
  three; no persona expansion.
- **Tenant isolation as primary proof target**: the proof inspector
  surfaces tenant-isolation results first; other proofs are
  secondary in the UI.

---

## 8. Open Items Going Into Implementation

These are not decisions; they are work to do in the implementation
phase, recorded here so they're not lost:

1. **Define the backend Postgres schema** — `target_databases`,
   `policy_drafts`, `proof_results`, `drift_events`, `schema_status`,
   `recommendation_proposals`, `simulator_sessions`,
   `simulator_audit_log`, `binder_history`, plus orgs/users/membership.
   Supabase CLI migration.
2. **Define RLS for the backend schema** — each table's row visibility
   keyed off `auth.uid()` and organization membership. Hand-written;
   not engine-managed (the bootstrapping problem).
3. **Define the Ktor service's OpenAPI spec** — endpoints for each
   primitive. The frontend generates a typed client from it.
4. **Define the pgmq queue payloads** — JSON shapes for `q_verify`,
   `q_drift_check`, `q_binder`, `q_simulate_scan`.
5. **Define the Supabase Vault layout for target DB credentials** —
   how connection strings are stored, who can decrypt, how the engine
   services authenticate to Vault.
6. **JWT verification setup in Ktor** — fetch Supabase JWKS, cache
   keys, verify signatures, extract user claims.

These become the early-phase implementation work once the phasing
plan is settled.

---

## 9. Cross-References

| This ADR                 | Other artifact                                                                        |
|--------------------------|---------------------------------------------------------------------------------------|
| §2 Context               | `spec/web-app-vision.md` (entire), `spec/resumption-notes.md` § Constraints That Stay |
| §3 Architectural Summary | `spec/web-app-vision.md` § Architectural Components for the V1 Web App                |
| D1 Frontend framework    | `spec/web-app-vision.md` Component 2 (Web Frontend)                                   |
| D2 API layer             | `spec/web-app-vision.md` Component 1 (API Layer)                                      |
| D3 Backend persistence   | `spec/web-app-vision.md` Component 5 (Persistence Beyond the Target Database)         |
| D4 Realtime              | `spec/web-app-vision.md` Component 2, Component 6                                     |
| D5 Auth                  | `spec/web-app-vision.md` Component 4, R4                                              |
| D6 Engine bridge         | `spec/web-app-vision.md` Component 1, Component 6                                     |
| D7 pgmq                  | `spec/web-app-vision.md` Component 6 (Continuous Verification Service)                |
| D8 Supabase host         | `spec/web-app-vision.md` R3                                                           |
| D9 Multi-database        | `spec/web-app-vision.md` R2                                                           |
| D10 Simulator privacy    | `spec/web-app-vision.md` R1, Feature 2                                                |
| D11 Repo layout          | `spec/architecture-decision.md` § 4.2 (Package Layout)                                |
| D12 Engine deployment    | `spec/web-app-vision.md` R3                                                           |
| D13 Performance posture  | `spec/web-app-vision.md` R5                                                           |
| D14 POC hosting          | (new; not covered by vision doc)                                                      |
| §6 Deferred R6, R7       | `spec/web-app-vision.md` R6, R7                                                       |

---

## 10. Next Steps

This ADR resolves the architectural decisions. The next planning
artifact is a **phasing plan** — what to build first, in what order,
with what exit criteria per phase. The vision doc recommended starting
with simulator + schema overlay prototypes; the phasing plan will
either adopt that or argue for a different sequence.

Recommended document name: `spec/web-app-phasing.md`.

After the phasing plan, the implementation work itself begins. Each
phase will reference back to this ADR for architectural commitments
and to `spec/web-app-vision.md` for feature scope.

---

*End of web app architecture decision record.*
