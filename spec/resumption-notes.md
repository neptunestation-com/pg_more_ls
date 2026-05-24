# Resumption Notes

**Date**: 2026-05-24
**Purpose**: Re-entry document capturing the state of pg-policy-engine
after the May 2026 review and refinement work. This document
supplements the existing spec/ artifacts; it does not replace them.

---

## What This Document Is

The original project artifacts (PRD, ADR, algebra spec, DSL survey,
design doc, code) capture the technical foundation of the policy
engine. They were produced in February 2026 and validated in May 2026.
This document captures the **additional context** developed during the
May 2026 review that does not yet live in those artifacts — analytical
results, scope refinements, customer-signal observations, and a
prioritized list of forward workstreams.

If you are picking up this project after some time away, read this
document first. It will tell you where things stand and where to look
next. Then read the existing artifacts in this order:

1. `spec/product-requirements.md` — personas and requirements
2. `spec/architecture-decision.md` — implementation language decision
3. `spec/policy-algebra.md` — formal foundation
4. `spec/dsl-survey.md` — source language validation
5. `spec/design.md` — internal architecture
6. `spec/implementation-plan.md` — milestones and exit criteria

---

## State of the Project (as of May 2026)

### What was completed in the original (February 2026) work

- Formal specification of the policy algebra, including denotational
  semantics for atoms, clauses, policies, selectors, and traversals
- Undecidability theorem (algebra spec § 1.1) establishing the
  fundamental motivation for a constrained DSL
- Complete BNF grammar for the DSL (algebra spec § 13)
- ADR settling implementation language at Kotlin on the JVM
- Six-rule normalization system with termination and correctness proofs
- SMT encoding strategy using Z3 via z3-turnkey
- Compilation function from algebra to PostgreSQL artifacts
- Drift detection algorithm with seven classified drift types
- Governance loop with six phases (Define / Analyze / Compile / Apply /
  Monitor / Reconcile) and convergence properties
- Working implementation including ANTLR parser, sealed-class AST,
  SMT encoder, SQL compiler, drift detector, and nine registered proofs
- Test infrastructure including unit tests, property-based tests,
  integration tests via Testcontainers, and golden-file spec
  compliance tests
- Leave-no-trace constraint formalized: the engine installs nothing on
  the target database beyond policies, grants, and RLS enablement

### What was added in the May 2026 review

**DSL survey**. A structured ADR-style evaluation of authorization
DSLs as potential source languages (Cedar, OPA/Rego, SpiceDB schema,
Oso Polar, custom DSL, plus honorable mentions). Conclusion: retain
the custom DSL, with three specific borrowings from Cedar — Lean
mechanization of the algebra's theorems, terminology alignment with
Cedar's analysis vocabulary, and differential testing modeled on
`cedar-drt`. Lives at `spec/dsl-survey.md`. The survey's central
insight is the **per-instance vs. set-valued framing** (§ 3.2): most
modern authorization DSLs decide per request, while RLS filters row
sets. This structural difference is what closes off most of the
candidate space.

**Performance analysis**. An empirical investigation of RLS policy
performance, conducted via benchmark against PostgreSQL 17.7. Key
findings:

- EXISTS-based RLS policies suffer a structural 10–20× performance
  penalty compared to hand-written equivalents because the security
  barrier prevents PostgreSQL's planner from pulling EXISTS subqueries
  up into semi-joins.
- The penalty is not a defect; it is a deliberate consequence of the
  security model preventing non-LEAKPROOF functions from being applied
  to unauthorized rows. The opacity is the security guarantee.
- The penalty applies specifically to **transitive authorization
  expressed as EXISTS over related tables**. Direct column-equality
  policies (e.g., `tenant_id = current_setting(...)`) do not pay the
  penalty and are actually faster than equivalent hand-written queries.

This work was not in the original artifacts. It is **directly relevant
to the compiler** because the algebra's traversal atoms (§ 7) compile
to nested EXISTS subqueries (algebra spec § 10.2, Appendix A.5),
which is exactly the structurally penalized case.

**Function attribute hierarchy**. An analysis of how function
attributes interact with RLS policy performance. Key findings:

- For session-state retrieval in policies, the optimal form is
  `(SELECT fn())` rather than bare `fn()` — the subquery wrapping
  forces evaluation as an InitPlan exactly once per query, producing
  a cached scalar the planner can use against indexed columns.
- `STABLE` is the right volatility marking for session functions.
  `VOLATILE` defeats caching and indexability. `IMMUTABLE` is wrong
  semantically since the value can change across statements.
- `LEAKPROOF` matters for cross-barrier reordering but is rarely
  practical because it requires superuser and certification work.
- SQL functions that inline (single-statement, `LANGUAGE sql`) give
  the planner visibility into the function's structure; PL/pgSQL
  functions are black boxes regardless of attributes. Prefer
  inlinable SQL helpers where possible.
- The realistic target for functions in RLS policies is
  **STABLE, single-statement, LANGUAGE sql, called via (SELECT fn())**.

This analysis is not in the algebra spec or the ADR. The compiler's
emission rules (algebra spec § 10.2) currently produce bare
`current_setting('k')`, not `(SELECT current_setting('k'))`. This is
a tactical refinement to be made; it does not require changes to the
algebra itself.

**Three-strategy framework for transitive authorization**. The
empirical performance work surfaced a three-way trade-off for
authorization that spans multiple tables:

- **Strategy 1 (accept the penalty)**: write EXISTS-based policies,
  accept the 10–20× runtime cost. Appropriate for small tables,
  low-traffic paths, latency budgets with room.
- **Strategy 2 (defense in depth)**: keep EXISTS policies as a
  backstop, have the application write explicit JOINs that already
  filter to the authorized set. Performance is good because the
  policy doesn't do the heavy lifting.
- **Strategy 3 (denormalization)**: push the authorization column
  (`tenant_id`, etc.) onto every protected table, write policies as
  flat column equality. Performance is best, but the data model is
  coupled to the authorization model.

The progressive-disclosure default is to start with Strategy 1,
escalate to Strategy 2 query-by-query where performance demands,
reserve Strategy 3 for hot paths Strategy 2 cannot fix. The
compiler should be aware of which strategy a given policy falls
into and warn or suggest alternatives where appropriate.

**Selector-denormalization synergy**. The selector mechanism in the
algebra (§ 6) — `has_column('tenant_id')` matching every table that
has the column — is the natural mate to Strategy 3. If customers
denormalize `tenant_id` onto child tables, the existing selector
mechanism automatically covers them with no additional policies.
The selector's late-binding property (Property 6.1) means new tables
matching the selector are automatically protected. This is not new
analysis but it is worth naming as a deliberate design synergy.

### What didn't change

The May 2026 review **validated** the existing artifacts; it did not
override them.

- The algebra spec stands; no changes to primitives, semantics, or
  proofs.
- The ADR on implementation language stands; Kotlin/JVM remains the
  recommendation.
- The PRD's personas, scope boundaries, and explicit exclusions stand.
- The grammar in `src/main/antlr/PolicyDsl.g4` is the algebra's § 13
  BNF transcribed; no changes warranted.
- All code in `src/main/kotlin/com/pgpe/` continues to be the right
  implementation, modulo the performance refinements listed below.
- The nine proofs in `src/main/kotlin/com/pgpe/analysis/proofs/`
  remain the right analyses.
- The leave-no-trace constraint stands.
- The decision to exclude reverse-engineering existing RLS policies
  (PRD § 5) stands as scope, but see the open question below.

---

## Open Questions Surfaced in May 2026

### Q1: Should the spec be updated to reflect performance refinements?

The compilation rules in algebra spec § 10.2 produce SQL that is
correct but not performance-optimal:

- Bare `current_setting('k')` rather than `(SELECT current_setting('k'))`
- No explicit type casts (the ADR § 9.2 already noted this; it remains
  unfixed in the spec)
- No engagement with the EXISTS pullup penalty for traversals

Two options:

- **Update § 10.2 in place**: incorporate the InitPlan wrapping and
  type casting into the canonical compilation rules. Pro: the spec
  matches what the compiler should emit. Con: the spec becomes more
  PostgreSQL-implementation-coupled.
- **Add a performance addendum**: leave § 10.2 as the semantic
  compilation rules; add a new section (or a separate document) that
  defines the performance-aware refinements as an additional pass.
  Pro: separation of correctness from performance. Con: two places to
  look for "what does the compiler emit?"

Recommendation: option (a) for InitPlan wrapping and type casting
(these are corrections to current rules); option (b) for the
EXISTS-pullup awareness (this is new analysis the spec doesn't cover).

### Q2: Should the EXISTS-pullup penalty be addressed by compiler optimization or by user-facing warnings?

When a policy compiles to a structurally penalized EXISTS chain, the
compiler could:

- Emit the policy as-is and stay silent
- Emit the policy as-is and warn the user
- Refuse to emit and suggest denormalization
- Detect denormalization opportunities and emit a column-equality form
  if the necessary column happens to exist on the target table

The right answer depends on how strongly the project takes a position
on performance. Conservative: warn but emit. Aggressive: refuse to
emit for tables above a configurable row-count threshold without
explicit user override.

### Q3: Should reverse-engineering existing RLS policies move back into scope?

The PRD explicitly excluded this. The exclusion was sound for a
greenfield project. If the renewed customer signal turns out to be
heavily weighted toward "we have existing policies and we don't know
what they do," reverse engineering becomes potentially the most
valuable feature — even though it can only be partial (the
undecidability argument still applies to general SQL).

A partial reverse-engineering tool that translates the recognizable
patterns (column-equality with `current_setting`, EXISTS-based FK
traversal, simple boolean composition) and flags the rest for manual
review could be more valuable than additional forward-direction
features.

This should be decided based on actual customer conversations, not
speculation. But it is worth flagging that the original "never in
scope" call may need revisiting if customer signal warrants.

### Q4: Should the DSL grow first-class support for common session-function patterns?

The algebra's `session()` value source compiles to
`current_setting('key')`. In practice, many PostgreSQL setups use
specific session-function conventions (e.g., functions that wrap
`current_setting` with type casting, error handling, fallbacks).
First-class support for declaring "the canonical way to get the
tenant identifier in this deployment" would let users write
`session(tenant)` rather than `session('app.tenant_id')` and have the
compiler emit deployment-appropriate SQL.

This is a generalization, not a Supabase-specific feature. Any
deployment with non-trivial session-state conventions benefits. The
mechanism could be a configuration file mapping logical session keys
to compiled expressions, or a small DSL extension.

---

## Forward Workstreams

In rough priority order:

### Immediate: Performance refinements to compilation

- Wrap `current_setting()` and other session functions in
  `(SELECT ...)` to force InitPlan evaluation
- Emit explicit type casts based on column type (ADR § 9.2 already
  specified this; propagate to spec § 10.2 and compiler implementation)
- Add compiler awareness of structurally penalized EXISTS patterns,
  with warnings to the user
- Update tests and golden files to reflect the refined SQL output

Scope: a few hundred lines of changes across the algebra spec, the
compiler, and the test fixtures. Self-contained.

### Phase 1: User-facing terminology alignment

- Align CLI output and JSON field names with Cedar's analysis
  vocabulary where the concepts coincide (see DSL survey § 7.2)
- Internal terminology in the algebra and code stays as-is

Scope: documentation and CLI ergonomics changes. No internal logic
changes.

### Phase 1: Customer-signal-driven priority gathering

- Talk to PostgreSQL users who are struggling with RLS
- Identify which of the existing capabilities (analysis, compilation,
  drift detection, reconciliation) are most needed
- Identify which of the open questions above (especially Q3 on reverse
  engineering) should be answered yes vs. no
- Refine the implementation plan to ship the most-valuable capability
  first, rather than the originally-prioritized PoC exit criteria

Scope: conversations, not code. But it constrains everything else.

### Phase 2+: Lean port of the algebra

- Mechanize the algebra's properties (the 19 theorems and properties
  in algebra spec § 14) in Lean
- Establish differential testing between the Lean reference and the
  Kotlin production implementation, modeled on `cedar-drt`
- Lifts the formal-semantics grade from `A` to `A+` (DSL survey
  matrix)

Scope: multi-month workstream by an engineer with both Kotlin and
Lean familiarity. The single biggest investment that would still be
available and not yet done.

### Phase 2+: Tighter SMT encoding of ordering operators

- The current SMT encoder models `<`, `>`, `<=`, `>=` as uninterpreted
  booleans (see `SmtEncoder.kt` lines 70–75 and DSL survey § 5)
- Tightening this to use Z3's integer or real theories where the
  operand types permit would lift the verification grade from `A-`
  to `A`
- Practical impact is limited (the dominant analyses reduce to
  equality), but the gap is real

Scope: targeted encoder refinement, plus property tests confirming no
regression on existing proofs.

### Phase 2+: Differential testing infrastructure

- Build the harness that compares Lean and Kotlin implementations on
  parser output, normalization, compilation, and analysis verdicts
- Random policy generation, agreement assertion
- Depends on the Lean port being underway

Scope: dependent on Lean work, but architecture can be designed in
parallel.

---

## Constraints That Stay

These are deliberate scope decisions to keep, not problems to solve.

- **Generic PostgreSQL only**. The project targets standard PostgreSQL
  RLS. It is not Supabase-specific, not AWS-RDS-specific, not
  CockroachDB-specific. Customer signal from Supabase users is
  valid input; Supabase-specific feature design is not.
- **Leave-no-trace**. No engine artifacts installed on the target
  database beyond policies, grants, and RLS enablement. No helper
  functions on the target. No metadata tables. No comments.
- **CLI deployment model**. The engine is a CLI tool that runs
  against a target PostgreSQL instance. No long-running service, no
  proxy layer, no sidecar (until and unless Phase 2+ multi-database
  orchestration is added).
- **Tenant isolation as the primary proof target**. Other authorization
  properties (least privilege, separation of duties, role-based access
  patterns) are not formally addressed by the algebra. This is a
  tractable scope choice, not a defect.
- **No recursive traversal**. Hierarchical authorization (org trees,
  ancestor relationships) requires pre-computed closure tables, not
  algebraic expression. This is necessary for decidability.
- **Row-level only**. Column-level authorization is handled by GRANT,
  not by policies in the algebra. Extending the algebra to column-
  level would require significant additional formal work.

---

## How to Resume

The cheapest re-entry path is:

1. Read this document
2. Skim the existing spec/ artifacts (linked at top)
3. Pick the highest-priority workstream from the list above that
   matches your current capacity
4. Pursue it via the established workflow: ideation and synthesis in
   conversational Claude (claude.ai), durable analytical and
   implementation work in Claude Code, integration of results back
   into the spec artifacts

The collaboration pattern from the May 2026 review worked well:
conversational venue for ideas, repository venue for durable
artifacts, handoffs in both directions. Continue using it.

If priorities shift you onto something else for a quarter or longer,
update this document before stepping away, so the next resumption
benefits from a current re-entry point rather than reconstructing it.

---

*End of resumption notes.*
