# Web App Vision and Architecture

**Date**: 2026-05-24
**Purpose**: Capture the architectural shift from "CLI tool" to "engine
with surfaces," and define the v1 scope for the web application surface
that ships first.

---

## What This Document Is

The original `pg-policy-engine` was scoped as a CLI tool with subcommands
(`analyze`, `compile`, `apply`, `monitor`). That scoping was correct for
the foundational work — it forced a clean separation between the engine
proper (parsing, normalization, SMT analysis, SQL emission, drift
detection) and any user-facing surface. The engine is now substantially
complete (see `spec/resumption-notes.md` for state).

The next chapter is about *surfaces*. This document records the
architectural model going forward and the specific scope of the first
surface to ship — a web application.

This document supersedes nothing. The PRD, ADRs, algebra spec, DSL
survey, and resumption notes all stand. This document adds a new
chapter: the engine has surfaces, the web app is the first one, and
many more surfaces are anticipated.

---

## The Architectural Shift

### From "CLI tool" to "engine with surfaces"

The CLI tool framing positioned `pgpe` as a complete product. The shift
is to position the engine — the parser, normalizer, SMT analyzer, SQL
compiler, drift detector — as a *capability layer* that is consumed by
many user-facing surfaces.

The engine exposes primitive operations:

- **Compile** — DSL source → PostgreSQL artifacts
- **Analyze** — DSL source → proof verdicts (satisfiability,
  subsumption, redundancy, contradiction, tenant isolation)
- **Simulate** — DSL source + sample data + session → row visibility
  verdict
- **Drift-detect** — expected state + observed state → classified
  drift events
- **Recommend** — schema metadata → proposed policy set
- **Explain** — query + policy set → trace of which policy filtered
  what

Each surface composes these primitives into experiences appropriate to
its medium. The CLI tool is one composition. The web app is another.
Future surfaces (LSP server, MCP server, Slack bot, CI/CD integrations)
are additional compositions.

This is structurally different from how `pg-policy-engine` was
originally scoped, and different from how comparable commercial tools
(e.g., TrustLogix) are typically structured. The benefit is that
investment in the engine's primitives flows to every surface; the cost
is a stricter discipline about keeping engine logic out of surface
code.

### Implications for the existing artifacts

The existing engine implementation is the foundation, unchanged. No
refactoring is required to support the surface model — the engine
already exposes its capabilities as a CLI invocation that returns
structured output. Surfaces that need richer access (programmatic
calls, streaming results, long-lived sessions) will require an API
layer, which is a v1 engineering task described below.

### The first surface

The first surface to ship is a **web application**. The rationale:

- **Legibility**: a CTO, compliance officer, or non-technical
  stakeholder can understand what they are looking at in 30 seconds.
- **Marketing surface**: the product needs sizzle. A CLI doesn't get
  developers excited; a web app with a visible schema overlay and a
  simulator does.
- **Demo-ability**: every visual interaction is a demo. Engineering
  prospects, partnership conversations, conference talks — all
  benefit from a visual surface.
- **Coverage of all three personas**: the PRD's three personas
  (Platform Security Engineer, Application Developer, Compliance
  Auditor) all benefit from a visual surface, even though their
  primary work surfaces differ.

Other surfaces (LSP, MCP, Slack, CI/CD, observability, IdP integrations,
migration emitters) are anticipated and tracked in
`spec/surfaces-wishlist.md`. They are not in scope for v1.

---

## V1 Web App Scope

The v1 web app includes seven features. Each is anchored to one or
more engine primitives, each is visually compelling, and each is
legible to a stakeholder unfamiliar with the project.

The features are listed in priority order. Items 1–4 are the
irreducible minimum; items 5–7 are high-value additions intended for
v1 but acceptable to slip to v1.1 if scope pressure requires.

### Feature 1: The Schema Overlay

**Engine primitives consumed**: introspection (existing, from the
engine's `analyze` phase), proof status (from `analyze`'s tenant
isolation results).

**Description**: After the user connects a target PostgreSQL database,
the app introspects the schema and renders it as a node-and-edge
diagram. Tables are nodes; foreign-key relationships are edges. Each
node is color-coded by its governance status:

- **Green**: RLS enabled, all applicable proofs return UNSAT (safe)
- **Yellow**: RLS enabled, policies present, but at least one proof
  is UNKNOWN or not yet run
- **Red**: RLS enabled but no policies, *or* RLS not enabled
- **Gray**: not selected by any selector (not governed)

Interactions:

- Hover a table: a panel shows the policies that apply to it
  (resolved through selector evaluation)
- Hover a policy: tables matched by its selectors highlight across
  the diagram
- Click a table: drill into its detail view (policies, proofs, drift,
  simulator)
- Click a policy: drill into its detail view (DSL source, compiled
  SQL, proof inspector, deployment status)

**Why this is the landing experience**: it is the single most
demo-able artifact in the product. A first-time viewer understands
the engine's scope in seconds.

**Engine work required**: introspection must produce a graph-shaped
output (tables, columns, relationships, proof status per table). The
engine currently produces this information in scattered forms
(metadata for selectors, proof verdicts per analysis, drift reports);
a unified "schema status" endpoint must be added.

### Feature 2: The "What Would This User See" Simulator

**Engine primitives consumed**: compile (to obtain the predicates),
plus a new execute-against-data capability.

**Description**: The user selects a table and a session. The session
is specified by role (drawn from PostgreSQL roles or IdP-imported
roles if connected) and by session variables (`tenant_id`, `user_id`,
or whatever the policies reference). The app queries the underlying
table and renders the rows, with rows the session would see in full
color and rows filtered by RLS grayed out and annotated with the
policy responsible.

Interactions:

- Drag a session variable's value to a different value: watch rows
  flicker between visible and filtered
- Switch role: watch policies activate and deactivate
- Click a filtered row: see the specific policy and clause that
  caused it to be filtered
- "Save this session as a test case" → adds an assertion to the
  policy's regression test set

**Why this is the killer feature**: nothing else in the market does
this. The simulator is what builds confidence that the policies are
actually doing what they claim. It is also pedagogical — engineers
who interact with it learn RLS faster than from any documentation.

**Engine work required**: the engine must support running policies
against live data with arbitrary session state. The current execution
model assumes policies are deployed; the simulator needs to evaluate
predicates *without* deploying them. This is feasible because the
engine already compiles policies to deterministic SQL; the SQL can be
executed in a read-only sandbox session with the simulated state.

**Data privacy concern to address in design**: the simulator shows
real row contents. For production-connected deployments, this is a
sensitive operation. Design choices include: connect-to-staging-only,
masked-data mode, anonymized row IDs, opt-in row display. To be
resolved during web app design.

### Feature 3: The Policy Authoring Surface

**Engine primitives consumed**: parser/validator (for DSL editing),
compile (for SQL preview), simulate (for live preview), analyze (for
inline proof status).

**Description**: A three-pane editor:

- **Left pane — DSL source**: syntax-highlighted text editor with
  inline error markers, completion, hover documentation. Backed by
  the engine's parser and validator.
- **Center pane — Visual builder**: a structured form-style view of
  the same policy. Selector block at the top; clauses as connected
  panels; atoms as form rows. Edits in either pane update the other.
- **Right pane — Live preview**: the compiled SQL, the proof status,
  and a small simulator running against test data.

The DSL is the canonical representation. The visual builder is a
view; the live preview is a view. All three panes update on every
edit.

Interactions:

- Type in the DSL pane: visual builder and preview update on every
  valid parse
- Drag a new clause in the visual builder: DSL updates
- Click "Verify": run all five analyses against the current policy
- Click "Save": persist the policy (to repository, if connected; or
  to the engine's policy store)
- Click "Deploy": apply the policy to the target database

**Why this matters**: it solves the dual-audience problem. Security
engineers who think in SQL get DSL editing. Compliance officers and
less-technical stakeholders get a structured form. The simulator
preview keeps both groups grounded in actual behavior.

**Engine work required**: the parser/validator must operate as a
service, not just a CLI invocation, so it can return errors and
completions in real-time. This is the same work needed for the LSP
surface (deferred to wishlist), and the API layer that supports it
will be reused there.

### Feature 4: The Proof Inspector

**Engine primitives consumed**: analyze (each of the five analyses).

**Description**: A dedicated panel for each analysis. For a selected
policy or table, run the analysis and display:

- **The question being asked**, in plain language. ("Can any session
  ever access a row belonging to a different tenant?" rather than the
  SMT-LIB encoding.)
- **The verdict**: SAT / UNSAT / UNKNOWN with a colored badge.
- **The witness if SAT**: a concrete row and session that demonstrate
  the violation. "A row with `tenant_id = 42` would be visible to a
  session with `tenant_id = 99` under policy X." This is the SMT
  model rendered as a human-readable scenario.
- **The certificate if UNSAT**: a statement that the proof succeeded,
  with the proof time and solver used. ("Proved by Z3 in 14ms: no
  (row, session) pair satisfies both the policy and the violation
  condition.")
- **The encoding, expandable**: for engineers who want to see the
  SMT-LIB. Hidden by default.

Interactions:

- Re-run analysis: trigger fresh execution
- Compare to previous run: show what changed since last verification
- Add as continuous check: run this analysis on every policy change

**Why this is in v1**: the formal-methods story is the project's
strongest intellectual position. Without a surface that shows the
proofs, the story is invisible. With this panel, "this database has
been mathematically proven tenant-isolated" becomes a thing you can
demonstrate, not just claim.

**Engine work required**: the analyses already exist (nine registered
proofs). The surface work is translating SMT models into human-
readable scenarios and SMT-LIB into expandable encodings. This is
presentation work, not engine work.

### Feature 5: The Drift Timeline

**Engine primitives consumed**: drift-detect (existing, from the
engine's `monitor` phase).

**Description**: A chronological view of drift events. Each event is
displayed with:

- **What changed**: structured description ("RLS disabled on
  `projects`"; "foreign policy `manual_override` added to `users`";
  "policy `tenant_isolation_invoices` modified outside the engine").
- **When**: precise timestamp.
- **Who** (if available): user attribution from database audit logs
  or extension data.
- **Impact**: which rows became visible or invisible. Computed by
  re-running the simulator against expected vs. observed predicates.
- **Reconciliation action**: what `pgpe apply --reconcile` would do
  to restore expected state.
- **Resolve / Acknowledge** buttons: mark the event handled.

Interactions:

- Filter by drift type, time range, severity
- Click an event to see full detail (before/after policy, impact
  simulation, reconciliation plan)
- One-click reconcile (with confirmation)

**Why this is in v1**: drift is otherwise invisible until something
breaks. A timeline makes it continuous awareness. The narrative
framing ("what changed, who did it, what the impact was") makes
events legible to non-engineers — compliance officers can read the
timeline directly without needing translation.

**Engine work required**: drift detection already produces classified
events. The surface work is enriching events with attribution (from
audit logs) and impact analysis (by re-simulating against expected
vs. observed).

### Feature 6: The Compliance Binder

**Engine primitives consumed**: analyze (all analyses, all tables),
drift-detect (history for the period), introspection (current state).

**Description**: A button — "Generate compliance evidence" — that
produces a report covering a specified period. The report contains:

- **Executive summary**: number of governed tables, count of proofs
  passing/failing/unknown, count of drift events, count of policy
  changes.
- **Per-table evidence**: each governed table with its policies,
  proof verdicts, and last-verified timestamp.
- **Policy inventory**: every policy with its DSL source, compiled
  SQL, deployment status, and authorship history.
- **Drift event log**: chronological list with classifications,
  impacts, and resolutions.
- **Change history**: if connected to a version control system,
  the policy changes during the period with PR references and
  reviewer attestations.
- **Engine signature**: cryptographic signature from the engine
  asserting "as of [timestamp], the following properties hold..."

Output formats: web view (drill-into structure), PDF (audit-ready),
JSON (machine-consumable for compliance platforms).

**Why this is in v1**: this is the function that makes the product
*sell*. Compliance officers can take the binder to their auditors.
CTOs can take it to their board. It is the artifact that justifies
the budget for the tool.

**Engine work required**: a report generator that composes proof
status, drift events, and policy state into a structured document.
The PDF generation and the signing mechanism are new engineering;
the underlying data is already available from the engine.

### Feature 7: The Schema-Driven Recommendation Wizard

**Engine primitives consumed**: recommend (new primitive), simulate
(for verification of proposals).

**Description**: Triggered when connecting a database without
policies, or via an explicit "scan for missing policies" action. The
engine introspects the schema and walks the user through proposed
policies one by one:

For each proposal:

- **The proposed policy** in DSL form
- **The compiled SQL** that would result
- **The simulator preview** against a sample of real data
- **Why this is proposed** — explanation referencing the schema
  pattern that triggered the recommendation
- **Performance note** (from the framework in resumption-notes
  §"What was added in the May 2026 review"): "this policy compiles to
  an EXISTS subquery and will pay the security-barrier penalty;
  consider denormalizing `tenant_id` onto this table"
- **Accept / Modify / Skip** actions

Recognized patterns (initial v1 set):

- Direct tenant isolation: tables with a `tenant_id` (or similar)
  column → column-equality policy
- Transitive tenant isolation: tables with FK to a tenant-bearing
  table → traversal policy (with performance warning)
- Soft delete: tables with a `deleted_at` or `is_deleted` column →
  visibility policy
- Ownership: tables with a `user_id` or `owner_id` column →
  ownership policy

**Why this is in v1**: it lowers the activation energy from "you
need to learn the DSL" to "click yes a few times." For new adopters,
this is the difference between trying the product and bouncing.

**Engine work required**: the recommendation engine is new. It must
take introspected schema metadata, identify candidate patterns, and
synthesize DSL policies that match. This is substantial engineering
but bounded; the patterns are well-defined and the synthesis is
deterministic.

---

## Architectural Components for the V1 Web App

The web app implies several engineering components beyond the
existing engine.

### Component 1: API Layer

The current engine is invoked as a CLI process. The web app needs a
long-running service that exposes the engine's primitives as HTTP
endpoints (REST or gRPC; choice to be made in design).

Endpoints minimally needed:

- `POST /api/parse` — DSL source → AST (for the editor)
- `POST /api/compile` — DSL source → compiled SQL
- `POST /api/analyze` — DSL source + analysis name → verdict + witness
- `POST /api/simulate` — DSL source + session + table → row visibility
- `POST /api/recommend` — schema metadata → proposed policies
- `GET /api/schema` — introspected target database schema with
  governance status overlay
- `GET /api/drift` — drift events for a period
- `POST /api/binder` — compliance report for a period

The API layer is a thin Kotlin service (consistent with the engine's
implementation language per ADR §7). It manages connections to target
PostgreSQL databases and invokes the engine's existing libraries.

### Component 2: Web Frontend

A single-page application. Framework choice deferred to design; React
or Svelte are the obvious candidates. The frontend is purely
presentational — every behavior is backed by an API call.

Key technical choices to be made in design:

- Authentication: how do users authenticate to the web app?
- Multi-database: does one web app instance manage multiple target
  databases?
- Deployment: hosted SaaS, self-hosted single-tenant, or both?
- Real-time: WebSocket for live preview, or polling?

### Component 3: Target Database Connection Management

The web app connects to one or more target PostgreSQL databases. It
needs:

- A secure way to store target database credentials
- A connection pool per target
- A read-only mode for simulator queries (do not allow the web app to
  write to target except via the explicit deploy action)
- Audit logging of all engine actions against targets

This is standard infrastructure work but not trivial. The leave-no-
trace constraint from the original ADR (§1.6.1) continues to apply:
the web app must not install artifacts on the target database.

### Component 4: Identity and Authorization for the Web App Itself

The web app itself needs an authorization model. Users authenticate;
some users can view policies but not change them; some users can
deploy; some users can connect new target databases.

This is a meta-irony — the policy engine has its own authorization
needs. The v1 implementation should probably *not* use the engine to
manage its own authorization (this is a bootstrapping problem and
also a complexity that does not benefit v1). A simple role-based
auth scheme suffices for v1.

### Component 5: Persistence Beyond the Target Database

The engine itself is stateless across CLI invocations; state lives
either in the policy repository (Git, or wherever DSL files are
stored) or in the target database (deployed policies).

The web app introduces session state, user preferences, saved
simulator scenarios, drift event acknowledgments, and compliance
binder history. This implies a persistence layer for the web app's
own data — a PostgreSQL database for the web app, separate from any
target database it governs.

### Component 6: Continuous Verification Service

For the proof inspector and the drift timeline to be useful, the
engine must re-run analyses and re-check drift on an ongoing basis,
not just on demand. A background service that runs the engine's
analyses on a schedule (and on policy or schema changes) is needed.

The service must respect rate limits — running tenant isolation
proofs against a large policy set is non-trivial computational work,
and the service should not hammer the target database with
introspection queries.

---

## What Is *Not* in V1

To prevent scope drift, the following are explicitly out of scope for
v1, even though they appeared in the brainstorming and may be valuable
later:

- Deployment environment graph (dev/staging/prod visualization)
- Policy library / pattern catalog beyond what the recommendation
  wizard uses
- Continuous shadow mode (proposed policy run alongside current)
- Test suite generation from natural language
- Federated learning across deployments
- LSP server
- MCP server
- Slack/Teams/Discord integration
- CI/CD integration (GitHub Action, GitLab pipeline, etc.)
- Migration file emitters (Flyway, Liquibase, Sqitch)
- IdP connectors (Okta, Auth0, etc.) — except for basic role
  awareness in the simulator
- Observability emission (OpenTelemetry)
- Compliance platform integrations (Vanta, Drata, AuditBoard)
- Database client integrations (psql plugins, etc.)
- Voice / ambient interfaces
- Signed policies
- Physical signaling

All of these are tracked in `spec/surfaces-wishlist.md`.

---

## V1 Exit Criteria

The v1 web app is considered shippable when:

1. A user can connect to a PostgreSQL database and see its schema
   overlay rendered with governance status.
2. A user can select a table and use the simulator to see row
   visibility under a chosen session.
3. A user can author a new policy in the three-pane editor and see
   live preview, compiled SQL, and proof status update as they type.
4. A user can run any of the five algebra analyses against a policy
   and see the verdict with a human-readable witness.
5. A user can view a drift timeline for a connected database with
   classified events and reconciliation options.
6. A user can generate a compliance binder for a chosen period and
   download it as PDF.
7. A user connecting a new database without policies can run the
   recommendation wizard and accept proposed policies that compile
   and verify.

Performance, scale, and polish are explicitly *not* v1 exit criteria.
A v1 that works correctly on a small database with hand-crafted
policies is shippable. Optimization for production scale comes in
v1.1+.

---

## Risks and Open Questions

### R1: The simulator's data privacy story

The simulator displays real row contents. For databases with
sensitive data, this is a sensitive operation. Need to design:

- Default behavior (show data, hide data, show masked data?)
- Per-column masking driven by tags or pg_catalog comments
- Read-only enforcement at the connection level
- Audit logging of all simulator queries

### R2: Multi-database vs. single-database web app

Is the v1 web app scoped to manage one target PostgreSQL database, or
multiple? Multi-tenancy adds complexity in connection management,
isolation between databases, and the UI's mental model. Single-
database is simpler but limits the product to "install per database."

Recommendation: v1 supports multiple connected databases but treats
them as separate workspaces (no cross-database queries or reports).
Defer cross-database concerns to v2.

### R3: Hosted SaaS vs. self-hosted

The web app could be hosted by the project (SaaS) or installed by the
customer (self-hosted, on-premises or in their cloud). These imply
very different operational models, security postures, and pricing
structures.

Recommendation: v1 targets self-hosted only (Docker container that
the customer runs in their network, adjacent to their PostgreSQL
deployments). This avoids the SaaS operational burden and matches
the security posture customers will likely require. SaaS can come
later if there is demand.

### R4: Web app authentication

How do users authenticate to the web app? Options:

- Local username/password (simple but enterprise-unfriendly)
- SAML/OIDC integration (enterprise-ready but complex)
- Reverse-proxy auth (the customer's existing auth gateway handles
  it)

Recommendation: v1 supports reverse-proxy auth as the primary mode,
with local accounts as a fallback for development and small
deployments. SAML/OIDC integration deferred to v1.1+.

### R5: Engine performance under web app load

The engine was designed for CLI use: one invocation, one analysis,
done. The web app implies many small invocations in quick succession
(every keystroke in the editor triggers re-parsing and re-analysis;
the simulator runs continuously as session variables change).

The engine's existing performance characteristics may be inadequate.
This is an empirical question to resolve early in v1 development.
Caching, incremental re-analysis, and result memoization may be
needed.

### R6: The proof inspector's witness rendering

SMT models are machine-readable but not human-readable. Translating
them into "a row with tenant_id=42 would be visible to a session with
tenant_id=99" requires connecting the model's variables to the
algebra's named entities. This is straightforward in principle but
requires careful surface design. Worth prototyping early.

### R7: How to handle policies that don't fit the recommendation patterns

The recommendation wizard handles common patterns. Customers will
have schemas that don't match those patterns. The wizard should
gracefully fall back to "I have nothing to propose for this table;
author manually" rather than producing nonsense recommendations.

---

## Relationship to Existing Artifacts

This document does not modify:

- `spec/product-requirements.md` — personas and scope stand;
  surfaces are an implementation choice, not a scope expansion
- `spec/architecture-decision.md` — Kotlin/JVM stands; the API layer
  is in Kotlin too
- `spec/policy-algebra.md` — the algebra is unchanged
- `spec/dsl-survey.md` — the source language is unchanged
- `spec/resumption-notes.md` — the engine state is unchanged

This document *adds*:

- A new architectural framing: engine + surfaces
- A new component set: API layer, web frontend, target connection
  management, web app auth, web app persistence, continuous
  verification service
- A new scope artifact: the v1 web app feature set with exit
  criteria

This document anticipates:

- Future surface specifications (LSP, MCP, CI/CD, etc.) tracked in
  `spec/surfaces-wishlist.md`
- Future ADRs for the web app's framework choice, deployment model,
  and authentication approach

---

## Recommended Next Steps

1. **Review and refine this document** — confirm the v1 feature set
   and exit criteria match intent. Cut or adjust where appropriate.
2. **Write a web app ADR** — settle the framework (React vs. Svelte
   vs. ...), the deployment model (Docker self-host as default), the
   auth model (reverse-proxy primary), and the persistence choice
   (PostgreSQL for web app state).
3. **Design the API layer** — settle endpoints, request/response
   shapes, authentication, rate limiting.
4. **Prototype the simulator** — this is the highest-novelty
   component. Build a minimal working version against the existing
   engine to validate the data privacy and performance approaches.
5. **Prototype the schema overlay** — this is the landing experience.
   Build a minimal working version to validate the introspection
   pipeline and the visual design.
6. **Build outward from the prototypes** — once the simulator and
   schema overlay work, the rest of the v1 scope is mostly
   composition of those primitives plus the editor and the report
   generator.

This is multi-month work. The exact phasing should be settled in a
follow-up document once the ADR for the web app is written.

---

*End of web app vision document.*
