# Surfaces Wishlist

**Date**: 2026-05-24
**Purpose**: Capture the full inventory of user-facing surfaces,
integrations, and features brainstormed for `pg-policy-engine` beyond
the v1 web app. This document is the durable record of ideas that
should not be lost while the v1 web app is being built.

---

## What This Document Is

The v1 web app is scoped narrowly in `spec/web-app-vision.md` — seven
features, one surface. The brainstorming that produced that scope
generated many more ideas than fit in v1. Some are deferred web app
features; many are entirely different surfaces (IDE plugins, chat
bots, CI/CD integrations, AI agent interfaces).

This document is the *wishlist*. It is not a roadmap. Items here are
not committed; they are remembered. As v1 lands and customer signal
sharpens, items from this list will be promoted to formal scope and
implemented.

The organizing principle is **surface**. Each surface is a distinct
medium through which users (or agents) interact with the engine. The
items under each surface are the experiences that would live there.

A separate section captures **cross-cutting ideas** that don't belong
to one surface — architectural patterns, product philosophies,
speculative directions.

---

## Surface: Web App (beyond v1)

V1 is scoped at seven features (see `spec/web-app-vision.md`). The
following are deferred-but-anticipated additions for v1.1, v1.2, and
beyond.

### Deployment Environment Graph

A visual representation of dev/staging/prod (or whatever environment
topology the customer uses) as columns. Policies appear in the
columns where they are deployed. Promotion from one column to the
next is a button-click action with safety checks:

- Schema compatibility check on the target
- Proof re-execution on the target's schema
- Predicted query plan check (no surprising performance regressions)
- Drift check (target is in expected state before promotion)

Rollback is reversible by symmetric promotion in the other direction.
The graph shows promotion history as a timeline below each column.

**Why it's not v1**: requires the engine to support multi-environment
state, the API layer to manage multiple target databases as
environments rather than independent workspaces, and the web app to
present a multi-environment mental model. All achievable, none v1.

### Policy Library / Pattern Catalog

A curated catalog of authorization patterns:

- Multi-tenant isolation (column-based, traversal-based, denormalized)
- Soft-delete filtering
- Role-based access (table-level, column-level, row-level)
- Time-bounded access (policies with validity windows)
- Row ownership (user_id, owner_id, created_by)
- Hierarchical access via closure tables (organizational trees,
  document hierarchies)
- Geographical access restrictions
- Data classification access (sensitivity tags drive policy
  selection)

Each pattern includes:

- Documentation explaining when to use it
- Parameterizable DSL template
- Compiled SQL examples
- Performance characteristics (drawing on the framework in
  `spec/resumption-notes.md`)
- One-click "instantiate against my schema" using the recommendation
  engine

**Why it's not v1**: the v1 recommendation wizard handles the most
common patterns (tenant isolation, soft delete, ownership). A full
catalog is additive, not foundational.

### Continuous Shadow Mode

For every query that hits the target database, the engine evaluates
both the *current deployed* policy set and a *proposed* (not yet
deployed) policy set. Differences are logged: rows that would be
visible under one but not the other. The shadow log is reviewed by
the policy author before promotion.

This is canary deployment for security policies.

**Why it's not v1**: requires inline interception of queries against
the target, which is a substantial engineering effort beyond what v1
contemplates. Likely requires a database proxy or extension, both of
which conflict with the leave-no-trace constraint and would require
re-evaluation.

### Test Suite Generation from Natural Language

A user describes intent in plain language: "Customers should only see
their own orders." The engine produces:

- A DSL policy implementing the intent
- A test suite encoding the assertions: "Alice should see orders
  where customer_id = alice; Alice should not see orders where
  customer_id = bob"
- The natural-language description, persisted alongside the policy as
  authoritative documentation

The tests run continuously and fail loudly if a policy edit causes a
regression.

**Why it's not v1**: requires an LLM integration, prompt engineering
for reliable policy synthesis, and a test framework that doesn't yet
exist. High potential, high engineering cost.

### Federated Recommendation Improvement

The recommendation engine improves over time by learning patterns
across many anonymized deployments. The engine sees: "85% of users
with a schema like yours added a soft-delete policy on the `posts`
table." Recommendations get smarter as the corpus grows.

**Why it's not v1**: requires telemetry collection, privacy-
preserving aggregation infrastructure, and a critical mass of
deployments to be useful. Pure v2+ territory.

### Continuous Auditor Read-Only Access

Instead of generating compliance binders quarterly, give the
auditor a read-only login to the live system. The auditor sees
proofs continuously, drift events as they happen, policy changes in
real-time. Compliance becomes a stream, not a series of snapshots.

**Why it's not v1**: the binder model is simpler to ship and matches
how auditors currently work. Streaming compliance is a behavior
change for the auditor's side of the relationship, not just a
technical capability. Adoption challenge as much as engineering.

### Cross-Database Federation View

A single web app instance governing policies across multiple
PostgreSQL deployments — multiple production databases, dev/staging
clusters across regions, replica sets. The user sees a unified
governance view with per-database drill-downs.

**Why it's not v1**: v1 scopes to one workspace per database. Cross-
database is v2 once the workspace model is solid.

### Policy Authoring via Drag-and-Drop on Schema

In the schema overlay, the user drags a "policy" object onto a table
or a group of tables. A wizard opens with the schema context already
populated. The user fills in conditions in the visual builder and
deploys. The schema overlay is the entry point to authoring, not
just visualization.

**Why it's not v1**: v1 has the schema overlay and the three-pane
editor as separate experiences. Integrating them is polish for
v1.1+.

---

## Surface: IDE (Language Server Protocol)

Build an LSP server for the DSL. Every IDE that supports LSP — VS
Code, IntelliJ, Neovim, Emacs, Helix — gets policy authoring for
free.

### LSP Features

- **Syntax highlighting** — via TextMate grammar (VS Code) or LSP
  semantic tokens
- **Real-time semantic validation** — type checking, selector
  evaluation against introspected schema, atom validity
- **Completion** — column names from the connected schema, function
  names from the whitelist, selector predicates, role names
- **Hover documentation** — for any DSL construct, show what it does
  and what it compiles to
- **Go-to-definition** — for policy references, function references,
  table references
- **Inline diagnostics** — proof status next to each policy as
  CodeLens or inline decoration
- **Inline simulator results** — for the policy under the cursor,
  show the most recent simulator run alongside

### Why This Surface Matters

The web app is for non-developers. The IDE is for developers. A
security engineer who writes policies daily wants them in their
editor, not in a browser tab. LSP is the universal protocol; one
implementation serves every editor.

### Engine Work Required

Beyond what v1 web app already requires:

- A long-running LSP process (different lifecycle than HTTP API
  requests)
- Incremental parsing and analysis (LSP expects sub-100ms responses
  for completion)
- File-watching for policy files on disk

The LSP server can share infrastructure with the web app's API layer
— both are clients of the engine's primitives.

### VS Code Extension as Companion

Build a VS Code extension that wraps the LSP server with VS Code
specific affordances:

- Schema explorer in the side bar
- Simulator panel that runs against the policy under the cursor
- Drift status indicator in the status bar
- One-click "deploy this policy" command

The extension is optional polish on top of the LSP server. The LSP
server alone gets every other editor.

---

## Surface: MCP (Model Context Protocol)

Expose the engine's primitives as an MCP server. Any AI agent — coding
agents, support agents, compliance agents, custom agents — can consume
them as tools.

### MCP Tools

- `compile_policy(dsl) → sql`
- `analyze_policy(dsl, analysis_name) → verdict_with_witness`
- `simulate(dsl, session, table) → row_visibility`
- `recommend_policies(schema_metadata) → proposed_policies`
- `detect_drift(expected_state, observed_state) → drift_events`
- `explain_query(query, policy_set) → policy_trace`
- `get_schema(database_id) → schema_with_governance_status`
- `get_proof_status(policy_id) → current_verdicts`

Each tool is the same primitive the engine exposes via CLI and HTTP;
MCP is just another binding.

### Why This Surface Matters

This is the long-game architectural bet. As AI agents become more
capable, they will need authorization-aware infrastructure. An engine
that exposes its capabilities to agents *as primitives* — not as
documentation an agent has to interpret — is positioned to be the
authorization layer in agent-driven workflows.

Example agent workflows enabled:

- A coding agent writing a database migration consults the policy
  engine to verify the migration doesn't break existing isolation
- A customer support agent answering "why can't I see X?" investigates
  via the explain tool
- A compliance agent generating quarterly reports pulls live proof
  status into its narrative

### Engine Work Required

The MCP server is a thin shim over the existing engine. The same API
layer that powers the web app and LSP can also serve MCP. The work is
defining the tool schemas and the protocol bindings, not new engine
capability.

---

## Surface: Chat (Slack, Teams, Discord)

A bot that lives in the team's chat platform and exposes engine
capabilities through natural conversation.

### Bot Capabilities

- **Drafting policies from descriptions**: "@pgpe-bot we need a
  policy so contractors can only see their own time entries" → bot
  drafts a DSL policy, posts it back with compiled SQL and a sim
  result, asks who should review.
- **Investigatory chat**: "@pgpe-bot why is alice unable to see her
  own invoices?" → bot uses the explain primitive, replies with the
  policy chain that filtered her query.
- **Drift notifications**: drift events posted to the security
  channel with narrative summaries and one-click acknowledge.
- **Daily/weekly reports**: engine state summaries posted on a
  schedule.
- **Approve-from-chat**: policy promotions trigger a chat thread with
  approve/reject buttons; once approved, the engine deploys.

### Why This Surface Matters

Most teams already live in chat. Building a separate web app for
notifications and lightweight authoring creates friction. The bot
brings the engine into the existing workflow rather than asking the
team to leave it.

### Engine Work Required

Standard chat platform integrations (Slack Bolt, Microsoft Bot
Framework, Discord bot SDK). The hard part is conversational design,
not engineering. Each interaction must be tight, useful, and not
spammy.

---

## Surface: CI/CD (GitHub Actions, GitLab Pipelines, Generic)

Integrate the engine into the team's existing CI/CD pipeline. Every
PR that touches policies or schema triggers engine checks.

### CI/CD Capabilities

- **Compile on PR**: emit compiled SQL as a build artifact; fail
  build on compile errors
- **Run all proofs on PR**: post results as a PR comment
- **Simulator diff**: "this PR changes which rows are visible for
  these test sessions" — surfaced as PR comment
- **Drift check**: compare PR's expected state to current production
  state; fail if drift exists that should be reconciled first
- **Migration file generation**: emit Flyway/Liquibase/Sqitch
  migration files as build artifacts
- **Block merge on proof failure**: configurable; some teams will
  want hard blocks, others advisory warnings

### GitHub Action Specifics

A published GitHub Action (`dventimisupabase/pgpe-action@v1`) that
wraps the CLI. The action takes a config file specifying which
analyses to run, what to do on failure, and how to format the PR
comment.

### Why This Surface Matters

Policies are DDL. They should flow through the same review and
deployment process as other DDL. The CI/CD surface is the glue that
makes policy work feel like normal development work.

### Engine Work Required

The CLI already produces structured output suitable for CI/CD
consumption. The work is building the GitHub Action wrapper, the
GitLab pipeline config, the generic Jenkins/CircleCI examples, and
the PR comment formatter.

---

## Surface: Migration Tooling Emitters

Generate migration files in the formats used by popular migration
tools.

### Target Formats

- **Flyway**: `V<n>__<description>.sql` files with the engine's
  emitted SQL
- **Liquibase**: changelog XML/YAML/SQL with metadata
- **Sqitch**: deploy/revert/verify scripts
- **Alembic**: Python migration files (for Python shops)
- **node-pg-migrate**: JavaScript migrations
- **Rails migrations**: Ruby migrations
- **Django migrations**: Python migrations with Django ORM
  conventions

### Why This Surface Matters

The engine is a *producer* of migrations, not a migration tool
itself. Customers have already chosen their migration tool. The
engine should fit into the choice they've made, not require them to
change.

### Engine Work Required

Per-format emitters. Each is small (the engine already produces the
underlying SQL; the emitters add format-specific wrappers and
metadata). The hard work is keeping up with the migration tools'
own conventions and version differences.

---

## Surface: Identity Provider Integrations

Connect the engine to the customer's identity provider for richer
context.

### IdP Connectors

- **Okta** — role and attribute import via API
- **Auth0** — same
- **Azure AD / Entra ID** — same
- **Google Workspace** — same
- **SCIM** — generic standard for principal sync
- **OIDC discovery** — for arbitrary OIDC providers

### What the Engine Does with IdP Data

- **Simulator richness**: "as user alice" becomes "as user alice with
  her actual attributes from Okta," not synthetic test sessions
- **Recommendation context**: the engine knows what roles exist in
  the organization and proposes policies that align with them
- **Session-state convention discovery**: if the application sets
  `app.tenant_id` from a JWT claim from the IdP, the engine can
  recognize this and reference it correctly in policies

### Why This Surface Matters

Authorization without identity is incomplete. The IdP knows who the
principals are; the engine knows what they can do. Connecting the
two makes both more useful.

### Engine Work Required

Per-IdP connectors plus a normalized internal model of principals
and attributes. The simulator and the recommendation engine consume
the normalized model; the connectors translate from each IdP's API.

---

## Surface: Observability (OpenTelemetry)

Emit engine activity as OpenTelemetry traces, metrics, and logs.

### Emission Targets

- **Traces**: proof executions, compile invocations, drift checks
- **Metrics**: proof verdicts per period, drift events per period,
  policy deployment events
- **Logs**: structured engine events with appropriate severity

### Why This Surface Matters

Operations teams use Datadog, Grafana, Honeycomb, New Relic. They
want engine activity visible in those tools, not in a separate engine
dashboard. OpenTelemetry is the universal protocol.

### Engine Work Required

Standard OTel instrumentation. The engine's existing logging is the
starting point; restructuring into OTel-compatible spans is
mechanical.

---

## Surface: Compliance Platform Integrations

Push proof status, drift events, and policy change history into the
customer's existing compliance platform.

### Target Platforms

- **Vanta** — automated SOC 2, ISO 27001 compliance tracking
- **Drata** — same
- **AuditBoard** — enterprise audit and compliance
- **Hyperproof** — same
- **OneTrust** — broader GRC platform
- **ServiceNow GRC** — enterprise IT/GRC

### What the Engine Pushes

- Proof status as continuous evidence ("tenant isolation proven on
  schema as of [timestamp]")
- Drift event log as security control change history
- Policy change history with author/reviewer attribution
- Compliance binder PDFs as point-in-time artifacts

### Why This Surface Matters

Compliance officers don't want to look at the engine. They want the
engine's evidence to appear inside the platform they already use.
The integration meets them where they are.

### Engine Work Required

Per-platform API integrations. Most platforms have similar evidence-
push APIs but with different schemas and authentication mechanisms.

---

## Surface: Database Client Integrations

Inline explanations in the database clients developers already use.

### Target Clients

- **psql** — extension or wrapper that adds engine context
- **pgAdmin** — plugin
- **DataGrip / IntelliJ Database** — plugin
- **DBeaver** — plugin
- **TablePlus** — plugin (if APIs allow)
- **Jupyter notebooks** — Python package
- **Hex / Mode / Metabase** — workspace integrations

### What the Engine Adds

When a query returns fewer rows than expected (or zero rows) because
of RLS, the client shows an inline annotation:

- "0 rows returned. Filtered by policy `tenant_isolation_invoices`
  because session.tenant_id (42) does not match any invoice tenants
  for this session."

This is the explain primitive surfaced at the moment of confusion,
inside the tool where the confusion happens.

### Why This Surface Matters

Developers debug queries dozens of times a day. The friction of
"query returns wrong data, why?" → "go open the policy engine UI
and investigate" is high. The integration collapses it.

### Engine Work Required

Per-client plugins. The underlying engine call is the explain
primitive. The work is plugin scaffolding and client-specific UI
integration.

---

## Surface: Forward-Looking and Speculative

Surfaces that depend on technology trends still maturing, or that are
genuinely speculative.

### Voice / Ambient Agents

A voice-first interface for executives and incident responders. "Hey,
boardroom assistant, can the support team see customer payment info?"
The agent has the engine's full state available and answers in
seconds.

This requires the MCP surface to exist and to be consumed by
general-purpose voice assistants. The engine work is the MCP server;
the voice integration is downstream of broader voice agent maturity.

### Continuous Narration

Instead of dashboards the user checks, an ongoing prose narrative
the user subscribes to. Daily or weekly summaries delivered as email,
push notification, Slack message, or RSS:

- "This week: 47 queries against governed tables, all properly
  filtered. Tenant isolation proof rerun 12 times on schema changes,
  all UNSAT. One drift event auto-reconciled. Compliance evidence
  attached."

The narration is generated by an LLM with the engine's structured
output as input. Subscription preferences control cadence and depth.

### Physical Signaling

Status lights, ambient indicators, environmental feedback in the
security team's physical workspace. Red light = something needs
attention. Green light = everything provable. Worth considering as
the security-engineering equivalent of operations dashboards.

### Signed Policies

Every policy carries cryptographic signatures from authors and
reviewers. Signatures persist through compilation, deployment, and
drift detection. The compliance binder includes signature chains
proving who reviewed each policy and when.

This is hard to retrofit but valuable for high-security environments
(government, healthcare, financial services).

### Policy Review Beyond GitHub PRs

If PR comments turn out to have the wrong shape for policy review —
because reviewers need interactive exploration (simulator, what-if
analysis) that doesn't fit in a comment thread — build a richer
review surface that *complements* PRs without replacing them. The
review surface is a webview launched from a PR comment that gives
the reviewer the simulator, the proof inspector, and a comment
thread synced back to the PR.

This is the "build deliberately when existing tools don't fit" case
flagged in the brainstorm. It is not v1 work but may emerge as a
need.

---

## Cross-Cutting Ideas

Ideas that are not tied to one surface — architectural patterns,
product philosophies, ways of thinking about the product.

### Engine Capabilities as Universal Primitives

The architectural commitment: every user-facing experience composes
the same set of engine primitives. The web app, LSP, MCP, CI/CD,
chat — all consume the same `compile`, `analyze`, `simulate`,
`drift-detect`, `recommend`, `explain` primitives. New surfaces are
new compositions, not new engine work.

This implies that engine work is the highest-leverage investment.
Every primitive improvement compounds across every surface.

### Bidirectional Representations

For any policy, multiple representations exist:

- DSL source (canonical)
- Visual structure (the visual builder's form)
- Natural-language description (documentation)
- Compiled SQL (deployment artifact)
- Simulator behavior (observed effect)
- Proof verdicts (analytical truth)

All representations are views on the same canonical policy. Edits in
one representation propagate to the others. This is more ambitious
than typical DSL tooling and worth designing for from the start.

### Narratives Over Alerts

Wherever the engine produces output for human consumption — drift
events, compliance reports, recommendation explanations — produce
*narratives*, not raw data. "RLS disabled on `projects` at 3:42pm by
dba@company.com; this exposed 14,302 rows to non-tenant queries
that ran before reconciliation at 3:51pm" is more useful than "drift
event, type=rls_disabled, table=projects, ts=15:42:17."

The same data plus a narrative wrapper. The work is generation, but
the output is far more usable.

### The Engine as a Colleague

A reframe: the engine isn't a tool you operate, it's a colleague who
works alongside you. It checks your work (proofs), watches your back
(drift detection), proposes improvements (recommendations), explains
what it sees (explain queries), files reports (compliance binder).
Surfaces should reflect this — the colleague is in your IDE, in your
chat, in your inbox, available on voice, generating reports while
you sleep.

Worth holding loosely as a design metaphor. Not every interaction
fits the "colleague" framing, but enough do that the metaphor pulls
toward better design choices than "operate the tool" does.

### Federation as a Long-Term Direction

The engine could eventually federate across deployments — multiple
PostgreSQL instances, perhaps eventually other databases (Snowflake,
Databricks, ClickHouse, BigQuery). The algebra is general; the
compilation target is currently PostgreSQL but doesn't have to be.

This is far beyond v1 but worth holding in mind: the engine could
evolve from "PostgreSQL RLS tool" to "universal authorization
algebra with multiple compilation targets." That positioning is more
defensible long-term than single-database tooling.

### AI-Native From the Start

The MCP surface should ship early — possibly even before the web
app in some form. The reason is positioning: as AI agents become
standard in developer workflows, an authorization engine with a
first-class agent surface is more durable than one with only human
surfaces. Build for the agent future even while shipping for the
human present.

---

## How This Document Should Be Used

Not as a roadmap. As a memory.

When v1 ships and the team considers what to build next, this
document is the menu. Pick items based on:

- Customer signal — which surface or feature do customers actually
  ask for?
- Technical readiness — which engine primitives are mature enough to
  support new surfaces?
- Strategic positioning — which investment compounds best with
  what's already shipped?

When a customer asks "do you have X?" or "can the engine do Y?",
this document is the answer to "yes, that's anticipated and we've
thought about how to do it well." Even unimplemented, the existence
of considered designs is itself a signal of seriousness.

Update this document as new ideas surface. Add to it freely. Mark
items as "in progress" or "shipped" when they move. Move items to
formal scope artifacts (a new vision document, a new ADR) when they
graduate from wishlist to commitment.

---

## Recommendation for Maintenance

This document should be reviewed at major milestones:

- After v1 ships, to plan v1.1
- After significant customer feedback, to reorder priorities
- When a new surface or technology emerges (e.g., a new agent
  protocol), to consider where it fits
- Quarterly, regardless of other triggers, to keep the document
  from going stale

Items can be removed if they no longer make sense (technology moved
on, customer signal proved they aren't wanted, the engine evolved
in a direction that makes the item obsolete). The document is
living, not archival.

---

*End of surfaces wishlist.*
