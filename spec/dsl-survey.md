# Architecture Decision Record: Source Language for the Policy Engine

**Version**: 1.0
**Date**: 2026-05-24
**Status**: Accepted — Custom DSL retained; selective borrowing from Cedar

---

## 1. Requirements

The policy engine's *source language* is the surface that security engineers
author against. The compilation target is PostgreSQL RLS; the compilation
pipeline is parsing → normalization → SMT analysis → SQL emission
(`policy-algebra.md` §§ 1.2, 9–10). The previous ADR
(`architecture-decision.md`) settled the *implementation* language at Kotlin
on the JVM. This ADR settles a different question, deferred until now: is
the *source* language the custom DSL defined in `policy-algebra.md` § 13,
or one of the existing authorization DSLs in the broader market?

The question matters because the custom DSL was specified from the inside
out — designed against a set of academic foundations (Bonatti's algebra,
lattice theory, SMT, Formal Concept Analysis, Galois connections) but
without systematic comparison to widely-deployed authorization languages.
A candidate language that mapped cleanly onto these foundations and brought
its own ecosystem could displace the custom DSL. The custom DSL has no
presumptive advantage; it must earn its place against the alternatives.

This section distills the requirements a candidate source language must
satisfy, each traced to its source.

### 1.1 Primitive Expressiveness

The source language must express, at fidelity high enough that the
compiler does not lose information, every primitive in the policy algebra:

- **Value sources** (`policy-algebra.md` § 2.1): column reference, session
  variable, literal (string, integer, boolean, null, list), and
  whitelisted function call.

- **Atoms** (§ 2.2): binary comparisons with operators
  `{=, !=, <, >, <=, >=, IN, NOT IN, LIKE, NOT LIKE}` and unary
  predicates `{IS NULL, IS NOT NULL}` over value sources.

- **Traversal atoms** (§ 7.2): existential subqueries following declared
  foreign-key relationships, with bounded depth (default `D = 2`,
  `policy-algebra.md` § 7.3). Recursive traversal is explicitly disallowed
  (Property 7.2) because it would push the algebra beyond the decidable
  fragment.

- **Clauses** (§ 3): finite conjunctions of atoms.

- **Policies** (§ 4.1): named, typed 5-tuples
  `(name, type, commands, selector, clauses)` where `type ∈
  {permissive, restrictive}` and `commands ⊆ {SELECT, INSERT, UPDATE,
  DELETE}`. Composition follows PostgreSQL's native semantics: permissive
  policies disjunct, restrictive policies conjunct, the combined
  predicate is `(∨ permissive) ∧ (∧ restrictive)` (§ 5.2).

- **Selectors** (§ 6.1): structural predicates over table metadata —
  `has_column(name, type?)`, `in_schema(s)`, `named(pat)`, `tagged(t)`,
  `ALL`, combinable under `AND`, `OR`, `NOT`. The selector mechanism
  defines a Galois connection between `𝒫(Tables)` and
  `𝒫(Attributes)` (§ 6.4); new tables matching a selector are
  automatically covered (Property 6.1).

### 1.2 Formal Semantics

The source language's meaning must be specified with sufficient rigor to
support the analyses in `policy-algebra.md` § 8:

- **Satisfiability** (§ 8.1): "can this clause ever match any row?"
- **Subsumption** (§ 8.2): "is one policy entirely contained in another?"
- **Redundancy** (§ 8.3): "can this policy be removed without changing the
  effective predicate?"
- **Contradiction** (§ 8.4): "does the effective predicate reduce to ⊥?"
- **Tenant isolation** (§ 8.5, Theorem 8.1): "can any session ever access
  a row belonging to a different tenant?"

These analyses presuppose a denotational semantics `⟦·⟧` mapping each
expression to a predicate over rows and sessions. A language without a
formal semantics — or with a semantics specified only by reference
implementation behavior — cannot support these proofs without first
inventing the missing semantics.

### 1.3 Decidability of the Adopted Fragment

The whole project rests on Theorem 1.1: arbitrary RLS is undecidable
because SQL is Turing-complete. The custom DSL is decidable by
construction — every atom translates to a formula in QF-LIA ∪ QF-EUF
(Property 2.5), and every clause is a finite conjunction of such atoms.
The traversal-depth bound (§ 7.3) keeps the encoding quantifier-free
after Skolemization.

A candidate source language must either (a) be decidable as designed, or
(b) admit a decidable fragment that covers the primitives in § 1.1.
Following the clarification recorded in § 6.4 below, candidates are
graded on the fragment we would actually use, with expressiveness lost
to that restriction noted explicitly.

### 1.4 Compilability to PostgreSQL RLS

The compilation function (§ 10.2) is a structural recursion: atoms compile
to SQL expressions, clauses to AND-joined expressions, policies to OR-joined
`USING` clauses, table policy sets to `CREATE POLICY` statements.
Compilation is deterministic (Property 10.2) and provably correct
(Theorem 10.1).

A candidate source language must support compile-time emission of SQL
artifacts as a *first-class* operation, not merely as an export feature.
This rules out candidates whose evaluation model is runtime-only — that
is, candidates that assume policies are evaluated by their own engine in
response to authorization queries, with no mode where the policies are
themselves consumed as data and transformed.

### 1.5 Schema Integration

Selectors evaluate against a metadata context `M` extracted from
`pg_catalog` (§ 6.2): for each governed table, the schema, columns
(name, type), and tags. The compilation of atoms requires the same
context — session-variable casts (`architecture-decision.md` § 9.2)
depend on knowing each column's type.

A candidate must provide either (a) a native mechanism to introduce
schema metadata as input to policy evaluation, or (b) an extension point
where the engine can supply it. A candidate that assumes a closed-world
fixed entity schema and does not contemplate runtime structural metadata
is a poor fit.

### 1.6 Verification Tooling

The custom DSL targets Z3 directly via z3-turnkey
(`architecture-decision.md` § 7). The encoding lives in
`src/main/kotlin/com/pgpe/analysis/SmtEncoder.kt` and is wired to nine
proofs in `src/main/kotlin/com/pgpe/analysis/proofs/`. The encoding
maps each atom to a Z3 formula over an uninterpreted sort `Val`, with
ordering operators conservatively modeled as unconstrained — sound but
incomplete on ordering.

A candidate must either (a) bring its own verification tooling that
covers the analyses in § 1.2, (b) have a structure amenable to writing
the analyses against, or (c) tolerate a separate SMT bridge. Cedar's
Symbolic Compiler is the only candidate that arrives with verification
tooling targeting these exact analyses; the others would require the
project to build the bridge.

### 1.7 Ecosystem Maturity

The PRD (`product-requirements.md` § 3.1) identifies the primary persona
as the Platform Security Engineer. Onboarding cost matters: a candidate
with broad IDE support, documentation, public training material, and a
governance model that won't pull the language out from under adopters is
preferable to a vendor-locked or unmaintained alternative.

License matters too. The implementation is currently unlicensed (see
README "No license has been selected yet"), but any source language the
engine ingests must itself be redistributable: a candidate's grammar,
runtime references, or specification text appearing in engine
documentation must be permissive. Apache 2.0 and MIT are both fine; a
GPL-incompatible or commercial-only specification is not.

### 1.8 Onramp and Migration

Per the PRD's persona definitions and § 5 explicit-exclusions ("No
reverse-engineering existing hand-written RLS policies into DSL"), the
expectation is that authors write *new* policy definitions rather than
import old ones. The relevant onramp question is the learning curve for a
security engineer who knows SQL and RLS to begin reading and writing
policies in the candidate language. Syntactic familiarity with SQL
predicates is an asset; conceptual distance from the row-level decision
model is a liability.

The custom DSL deliberately echoes SQL where it can — column references
written as `col('tenant_id')`, comparison operators `=`, `IN`,
`IS NULL` straight from SQL, EXISTS-like semantics on traversals. This is
a baseline against which candidates are graded.

### 1.9 Leave-No-Trace and Runtime Constraints

The leave-no-trace constraint (`architecture-decision.md` § 1.6.1)
prohibits engine artifacts on the target PostgreSQL database. It does
*not* prohibit a runtime engine running alongside the compiler — but in
the deployment model adopted (CLI tool, ADR § 4.1) there is no such
engine. The compiler is the whole tool.

Consequently, a candidate that *requires* its own evaluation engine to be
present at runtime — i.e., the engine that decides authorization requests
in production — does not fit the deployment model. The candidate's
authorization engine is irrelevant to this project. What matters is
whether the candidate's language and tooling can be used in a
compile-only mode where the engine consumes policies as data, performs
analysis and compilation, and emits SQL. Most of the candidates can
operate this way; whether they were designed to is a separate question.

### 1.10 Summary

A source language fits this project if, restricted to a decidable
fragment, it can faithfully express atoms, clauses, policies, selectors,
and bounded traversals; admit a denotational semantics adequate for SMT
analysis of satisfiability, subsumption, redundancy, contradiction, and
tenant isolation; compile-emit PostgreSQL artifacts deterministically;
ingest column-level schema metadata; ship or admit verification tooling
covering those five analyses; carry a permissive license and a credible
maintenance story; and bear a learning curve compatible with a security
engineer who is fluent in SQL and RLS.

The custom DSL meets all of these by construction — it was designed
against precisely these requirements. The question Section 2 answers is
whether any existing candidate meets them at least as well, while
bringing ecosystem benefits the custom DSL does not.

---

## 2. Language Evaluation

Five primary candidates are evaluated against the structured rubric below:

- **Cedar** (AWS, Apache 2.0)
- **OPA/Rego** (CNCF graduated, Apache 2.0)
- **SpiceDB schema language** (Authzed, Apache 2.0)
- **Oso Polar** (Oso Inc., Apache 2.0 — *library deprecated*)
- **Custom DSL** (the language defined in `policy-algebra.md` § 13)

Three honorable mentions are addressed briefly in § 2.5:

- **Zanzibar** as a model (covered together with SpiceDB and OpenFGA)
- **Casbin** (Apache 2.0)
- **XACML 4.0** (OASIS)

A separate scan for *database-specific* candidates (Postgres-native,
Supabase, CockroachDB RLS, SQL Server RLS, Kusto RLS) returned no
candidate with a non-SQL DSL. RLS engines uniformly use SQL as the source
language, which is the project's whole rejected starting point. There is
no Postgres-specific authorization DSL in the wild to evaluate.

### 2.1 Evaluation Matrix

The rubric uses the grading scale from `architecture-decision.md` § 2.1:

- **A** = excellent native fit, mature ecosystem, minimal friction
- **B** = good support, some rough edges
- **C** = possible but requires significant effort or workarounds
- **D** = poor support, experimental or incomplete
- **F** = not feasible without fundamental compromise

Each candidate is graded on the eight dimensions from the brief.

| Dimension                    | Cedar | OPA/Rego | SpiceDB | Oso Polar | Custom DSL |
|------------------------------|:-----:|:--------:|:-------:|:---------:|:----------:|
| **Primitive expressiveness** |   C   |    B-    |    D    |    C+     |     A+     |
| **Formal semantics**         |  A+   |    D     |    D    |     C     |     A      |
| **Decidability of fragment** |   A   |    C     |    B    |     C     |     A      |
| **Compilability to PG RLS**  |   C   |    D     |    D    |     D     |     A      |
| **Schema integration**       |   D   |    C     |    F    |     C     |     A      |
| **Verification tooling**     |   A   |    C     |    D    |     D     |     A-     |
| **Ecosystem maturity**       |   B   |    A     |    B    |     F     |     C      |
| **Onramp and migration**     |   B   |    C+    |    D    |     C     |     A-     |

Two grades stand out as load-bearing and are spelled out in § 2.2:
Cedar's `C` on expressiveness comes from the entity-instance vs. row-set
mismatch; Cedar's `D` on schema integration comes from the fixed-schema
assumption baked into Cedar's validator. The custom DSL's `C` on
ecosystem maturity reflects exactly what this ADR is interrogating — it
has no community outside the project.

### 2.2 Per-Dimension Analysis

#### Primitive expressiveness

The custom DSL meets this dimension by definition; the question is how
each candidate's expressive model compares to atoms, clauses, policies,
selectors, and traversals.

**Cedar — C**. Cedar policies have the form
`permit(principal, action, resource) when { … } unless { … }` (Cedar
syntax reference). The body is an expression language over entity
attributes (`principal.department`, `resource.owner`), context fields,
literals, and operators (`==`, `!=`, `<`, `<=`, `in`, `like`,
`has`) that map closely to the algebra's atoms. Where Cedar falls short
is the *scope* of policies: Cedar policies decide a per-instance triple
`(principal, action, resource)`, where each side is an entity with a
unique identifier (`User::"alice"`, `Photo::"pic.jpg"`). The algebra's
atoms quantify implicitly over the rows of a table, with no per-row
identifier. To express "all rows of `users` with matching tenant_id are
accessible," Cedar requires either treating each row as an entity (an
explosion of the entity graph) or treating the whole table as a resource
and proving a property about all of its rows (which Cedar's per-request
decision model does not natively express). Cedar's hierarchy operator
`resource in Group::"team"` is structurally similar to the algebra's
traversal, but only for hierarchical containment, not for arbitrary
foreign-key relations. Selectors have no Cedar equivalent: Cedar has no
mechanism for "all resources of type X with attribute Y" as a policy
target. The grade reflects atom-level fidelity coexisting with
policy-level mismatch.

**OPA/Rego — B-**. Rego is a Datalog-derived rule language with
extensions for negation, universal quantification (`every`), and
comprehensions (OPA policy language docs). The expression sub-language
covers the algebra's atoms straightforwardly: equality, inequality,
ordering, `in` for list membership, plus arbitrary boolean composition.
Rego's input documents can carry session variables and the row under
evaluation, so the "session tenant equals row tenant" pattern is
expressible (`input.session["app.tenant_id"] == input.row.tenant_id`).
Selectors are expressible because Rego operates on arbitrary structured
data — the engine could supply table metadata as input and selectors
become rules that filter it. Traversal is awkward but expressible by
treating related tables as additional input documents. The grade is
held below `B` because Rego's expression model is *deeper* than the
algebra needs: it admits comprehensions, ad-hoc functions, recursion
between rules. Restricted to the algebra's primitive vocabulary, Rego is
adequate; left unrestricted, Rego is more language than the project
wants.

**SpiceDB schema language — D**. SpiceDB schema (`.zed` files) defines
*object types* with *relations* and *permissions* computed via union,
intersection, exclusion, and arrow operators (SpiceDB schema reference).
A relation models "users with the `reader` relation on this document";
a permission models "viewers who are also editors." This is the
Zanzibar tuple model: authorization is a graph reachability problem
over user-object-relation triples. The algebra's primitives do not map.
The algebra has no concept of named relations between principals and
resources — its predicates are scalar comparisons between row columns
and session variables. The closest SpiceDB analogue to a traversal atom
is the arrow operator (`parent_folder->reader`), but it traverses a
named relation declared in the schema, not an FK referenced by an `exists()`
atom. Selectors have no analogue at all: SpiceDB schemas describe types
and relations, not structural predicates over a relational schema.
Adapting SpiceDB to this project would require redefining what its
operators *mean* — at which point the language is no longer SpiceDB.

**Oso Polar — C+**. Polar is logic-programming-derived (the
documentation acknowledges Prolog-style predicates and unification) and
expresses rules as `allow(actor, action, resource) if …`. The body
admits comparisons, conjunctions, disjunctions, and calls to other
rules. The algebra's atoms map readily: `resource.tenant_id =
actor.tenant_id` is direct Polar. Traversal would be expressed by
chaining rules: `allow(actor, action, task) if project(task,
project) and allow(actor, action, project)`. Selectors are not
expressible natively; Polar binds policies to declared resource types
via the host application's class registration, not via structural
schema predicates. The grade is held at `C+` rather than `B-`
because Polar's typical evaluation model is application-callback-heavy:
Polar policies routinely call into the host application's classes
(`resource.is_public()`), and this hybrid model is awkward to compile
to RLS where the database, not the application, evaluates the
predicate.

**Custom DSL — A+**. The custom DSL primitives are precisely the
algebra's primitives; the grammar (`policy-algebra.md` § 13) was
written against the algebra's definitions. The implementation
(`src/main/kotlin/com/pgpe/ast/Types.kt`) preserves the layered structure
as Kotlin sealed classes: `Atom = BinaryAtom | UnaryAtom |
TraversalAtom`, `Selector = HasColumn | Named | InSchema | Tagged | All
| And | Or | Not`. The fidelity is by construction.

#### Formal semantics

The question is whether the candidate's meaning is specified rigorously
enough to support the five analyses in § 1.2, and at what level (informal
prose, operational, denotational, mechanized proof).

**Cedar — A+**. Cedar's semantics is formalized in Lean and mechanically
verified (Cutler et al., *Cedar: A New Language for Expressive, Fast,
Safe, and Analyzable Authorization*, OOPSLA 2024, arXiv:2403.04651; AWS
Open Source Blog, *Introducing Cedar Analysis*, June 2025). The `cedar-spec`
repository contains the Lean formalization (`cedar-lean`) alongside
differential testing infrastructure. Proved properties include the
"forbid trumps permit" override semantics and the default-deny
semantics. The Cedar Symbolic Compiler — implemented in Lean — produces
SMT formulas with proofs of soundness and completeness for the
translation. This is the strongest formal-semantics story of any
candidate evaluated, including the custom DSL (whose semantics is
specified in mathematical prose but not mechanically verified).

**OPA/Rego — D**. Rego's documentation describes the language
operationally — it explains how rules evaluate, what `with`, `every`,
and comprehensions do, what built-ins exist, what the type checker
catches when JSON Schema annotations are supplied (OPA Policy Language
docs). There is no formal denotational semantics in the upstream
documentation, no Lean/Coq formalization, and no published theorem
about Rego's expressive class. There is academic work analyzing
fragments of Rego (e.g., the Constraint Framework's subset used by
Gatekeeper), but the language as deployed has no canonical formal
specification. Adopting Rego as the source language would oblige this
project to invent the formal semantics it would need for SMT encoding
— a substantial undertaking with no upstream support.

**SpiceDB schema language — D**. SpiceDB's documentation describes
schemas operationally (relations as named edges, permissions as
computed sets over relations, arrow operators as graph traversals) but
provides no formal denotational semantics, decidability analysis, or
complexity proofs. The system is engineered for low-latency consistent
lookups over a tuple store, not for static analysis of policies. The
Zanzibar paper itself is an engineering paper, not a formal-methods
paper. As with Rego, adopting SpiceDB would require inventing the
semantics from scratch.

**Oso Polar — C**. Polar inherits Prolog's resolution semantics —
SLD-resolution with unification — which is a well-studied formal model.
However, Polar's deviations from pure Prolog (typed parameters, class
integration, specialization) are documented operationally rather than
in a published formal account. The grade is held at `C` rather than
`D` because the Prolog substrate is at least well-known, even if
Polar's specific semantics is not separately formalized.

**Custom DSL — A**. The algebra's semantics is specified mathematically
in `policy-algebra.md`: atoms denote boolean functions over rows and
sessions (§ 2); clauses denote conjunctions (§ 3); policies denote
disjunctions (§ 4.2); effective predicates compose by Bonatti's algebra
(§ 5.2). The 19 properties and theorems in § 14 — including
Theorem 10.1 (compilation correctness) and Property 9.2 (normalization
preserves denotation) — are stated in mathematical prose with proof
sketches. The grade is held at `A` rather than `A+` because the proofs
are not mechanized in a proof assistant; Cedar's `A+` reflects its
Lean-verified status.

#### Decidability of the adopted fragment

The clarification recorded in § 6.4 grades candidates on the fragment
that maps to the algebra's primitives, with lost expressiveness noted.

**Cedar — A**. The full Cedar language is decidable in a strong sense:
the Cedar Symbolic Compiler proves equivalence, redundancy,
shadowed-permits, impossible-conditions, and other policy-level
properties by reduction to SMT, with proofs that the translation is
sound, complete, and decidable (AWS Open Source Blog, "the compiler's
encoding is proved to be decidable, sound, and complete"). The decidable
fragment is the *whole* language, modulo Cedar's validator's
restrictions; this is the strongest decidability claim of any candidate.

**OPA/Rego — C**. Full Rego is not decidable: the language admits
recursion between rules, comprehensions over inputs of unbounded shape,
and `every`/`some` quantification that pushes evaluation beyond
decidable fragments. Decidable fragments exist: Gatekeeper's Constraint
Framework restricts Rego to a subset adequate for admission control,
and there are academic Datalog fragments (Datalog with negation as
failure, stratified Datalog) that admit decision procedures. Restricted
to the algebra's primitives — equality, ordering, list membership, no
recursion, no comprehensions — Rego is decidable, but the restriction
is severe enough that adopting Rego means adopting a subset that bears
little resemblance to idiomatic Rego.

**SpiceDB schema language — B**. SpiceDB's reachability semantics over
relation tuples is decidable in principle — graph reachability over a
finite tuple store is computable. SpiceDB's engineering choices
restrict the schema to ensure tractable lookups (caveats, the more
expressive extension, do add a CEL expression sub-language whose
decidability is less clear). The grade is held at `B` rather than `A`
because decidability is asserted operationally — "the system answers
queries fast" — without a published formal account of the language's
expressive class.

**Oso Polar — C**. Polar inherits Prolog's undecidability in the
general case (Prolog is Turing-complete via unrestricted recursion).
Decidable fragments exist (Datalog-like subsets), and Polar can be
restricted to those, but the restriction excludes much of what
distinguishes Polar from Datalog. Oso Cloud's "rules editor" enforces
some restrictions, but these are not documented as a formally specified
decidable fragment.

**Custom DSL — A**. The custom DSL is decidable by construction.
Property 2.5 in the algebra spec proves that any finite conjunction of
atoms is decidable by reduction to QF-LIA ∪ QF-EUF, and the depth-bound
on traversal atoms (§ 7.4) keeps the encoding quantifier-free after
Skolemization. There is no Turing-complete substrate to restrict.

#### Compilability to PostgreSQL RLS

The question is how naturally the candidate's expressions map to
`CREATE POLICY` artifacts, and how much work it takes to treat the
candidate as a *source* language for an RLS compiler rather than as a
runtime engine.

**Cedar — C**. Cedar policies decide per-request `(principal, action,
resource)`. RLS policies filter rows against `USING` and `WITH CHECK`
predicates evaluated by PostgreSQL. The mapping is not bijective:
Cedar's "permit when resource.tenant_id == principal.tenant_id"
naturally compiles to `tenant_id = current_setting('app.tenant_id')`
only if Cedar treats each row as an entity, which Cedar does not
natively encourage. The Cedar Symbolic Compiler operates on Cedar
policies, not their compiled RLS, so adopting Cedar would mean writing
a *second* compiler from Cedar to SQL that does not exist upstream and
would have to be authored by this project. Cedar's strength —
analyzability via SMT — is unavailable to the SQL output: the analysis
is on the Cedar policy, not on the compiled SQL.

**OPA/Rego — D**. Rego is fundamentally a runtime evaluation language:
the OPA engine evaluates policies against input documents in response
to queries. Compiling Rego policies to RLS SQL means writing a Rego
interpreter that produces SQL rather than decisions — a non-trivial
project for which no upstream tooling exists. The "Rego compile to
WebAssembly" or "Rego compile to Plan" paths exist in OPA's tooling
but target Rego's own execution machinery, not external SQL. The
algebra's whole *point* is to compile, not evaluate; Rego's whole point
is to evaluate, not compile.

**SpiceDB schema language — D**. SpiceDB's evaluation model is a
namespace-relation graph traversal over a tuple store. There is no
natural compilation to RLS USING expressions because the SpiceDB model
does not address row-level predicates over a relational schema —
SpiceDB authorizes operations on named resources, not row sets. Some
hybrid Postgres-on-SpiceDB designs exist (the
`zanzibar_postgres_authorization_summary.md` and
`zanzibar_datalog_rls_summary.md` notes in this repository sketch
adapter approaches), but these are integrations, not compilation
targets. SpiceDB-as-source-language for RLS would mean teaching the
engine that "users with `reader` relation on document D" means
"USING (id IN (SELECT object FROM authzed_tuples WHERE
relation='reader' AND subject = current_user))", at which point
SpiceDB has become a sidecar lookup service, not a source language.

**Oso Polar — D**. Polar evaluation is interleaved with the host
application via class registration and method callbacks
(`resource.is_public()`). Compiling Polar to RLS means freezing out
these callbacks (RLS cannot call application code) and falling back to
a pure-data fragment that resembles Datalog. Compiling that fragment
to SQL is feasible but is essentially "Datalog to SQL," for which
many academic and a few practical implementations exist; the result is
not idiomatic Polar.

**Custom DSL — A**. Compilation is the central operation of the custom
DSL. The compilation function is defined as structural recursion over
the algebra's types (`policy-algebra.md` § 10.2), implemented as
`src/main/kotlin/com/pgpe/compiler/SqlCompiler.kt`, and proved correct
(Theorem 10.1). The output (Appendix A.5) is character-identical
across invocations (Property 10.2). This is the dimension on which the
custom DSL most decisively beats the alternatives.

#### Schema integration

Selectors require structural metadata about tables; the compiler
requires column types to emit casts (`architecture-decision.md` § 9.2);
the introspection phase requires reading `pg_catalog`. Each candidate
is evaluated on how cleanly it admits this metadata.

**Cedar — D**. Cedar's schema is a fixed declaration of entity types
and their attributes (Cedar Schema docs). It tells the validator that
`User` has attribute `department: String`. The schema does not — and
is not designed to — accept structural metadata at runtime ("this
schema has six tables and here are their columns"). Cedar's policies
are statically typed against the schema; the schema is part of the
policy author's input. The algebra's selector model — declaring a
policy and *then* discovering at compile time which tables it applies
to based on column presence — has no Cedar equivalent. Adopting Cedar
means choosing between (a) flattening every table-and-column into a
Cedar entity type at deployment time (which loses the late-binding
property selectors give) or (b) bypassing Cedar's schema entirely and
treating Cedar as a free-form expression language (which loses Cedar's
type checker).

**OPA/Rego — C**. Rego is schema-agnostic; it treats input as JSON.
Schema metadata can be fed in as additional input documents, and
selectors written as rules that match on column presence. This is
expressive but verbose, and it sits outside the canonical Rego idiom
where input is the request being authorized, not the catalog. The
type-checker integration with JSON Schema annotations exists but is
oriented toward checking that input shape matches the policy author's
expectations, not the other way around.

**SpiceDB schema language — F**. SpiceDB schemas are themselves the
"schema" the system is aware of. They describe object types and
relations specific to the authorization model. There is no mechanism
for SpiceDB to consume PostgreSQL `pg_catalog` metadata and adapt
authorization decisions to it. This is a categorical mismatch:
SpiceDB's schema *is* the authorization model, not metadata about a
target system.

**Oso Polar — C**. Polar binds to host classes — the application
registers `Resource` and `Actor` types with their fields. PostgreSQL
catalog metadata could in principle be exposed as such a class, but
it is awkward: the natural Polar idiom is "ask the application for
the actor's permissions," not "consult a schema dictionary."

**Custom DSL — A**. The algebra explicitly models the table metadata
context `M` (§ 6.2) and threads it through selector evaluation and atom
compilation. The implementation surfaces this as `TableMetadata` and
`SchemaMetadata` data classes
(`src/main/kotlin/com/pgpe/ast/Types.kt`), populated either from
introspection (`Introspector.kt`) or from a configured schema. The
dimension is met by design.

#### Verification tooling

Five analyses are required (§ 1.2). The candidates are evaluated on
what they ship and how readily the remaining gaps can be closed.

**Cedar — A**. Cedar Analysis (released as `cedar-policy-symcc`)
covers equivalence-of-policy-sets, shadowed-permits,
impossible-conditions, and several other analyses (AWS Open Source
Blog). The toolkit uses CVC5 as its SMT solver and is implemented in
Lean with proofs of soundness and completeness. The exact analyses
match the algebra's analyses closely: Cedar's "policy A is at least as
permissive as policy B" is the algebra's subsumption (§ 8.2); Cedar's
"shadowed permits" is the algebra's redundancy (§ 8.3); Cedar's
"impossible conditions" is the algebra's contradiction (§ 8.4); and
the algebra's tenant isolation (§ 8.5) is a satisfiability check that
Cedar's underlying machinery handles. Cedar does not natively address
tenant isolation as a named analysis, but the building blocks are
there. This is the strongest verification story of any candidate.

**OPA/Rego — C**. OPA ships testing tooling, coverage reporting,
explain mode, and the `opa eval` interpreter for ad-hoc evaluation.
There are research projects (e.g., Regorus, Rego-to-SMT prototypes)
but no production-grade SMT analysis toolchain. Adopting Rego means
building the verification bridge from scratch.

**SpiceDB schema language — D**. SpiceDB ships `zed validate`, schema
unit tests, and the Authzed Playground for interactive exploration of
schemas. There is no SMT integration, no equivalence checker for
schemas, and no published analysis tooling at the level the algebra
requires.

**Oso Polar — D**. Oso has a debugger and policy tests, but no formal
analysis tooling. The deprecation of the OSS library (see § 2.4
below) makes the prospect of investing in such tooling unattractive.

**Custom DSL — A-**. The custom DSL ships with nine proofs registered
in `ProofRegistry`, all backed by Z3 via z3-turnkey
(`src/main/kotlin/com/pgpe/analysis/proofs/`). The implementation is
sound on equality and IN-list reasoning; it is conservatively
incomplete on ordering operators (the encoder uses an uninterpreted
boolean for `<`, `>`, etc. — see `SmtEncoder.kt` lines 70–75). The
grade is held at `A-` rather than `A+` because (a) the encoding is
purpose-built rather than mechanically verified the way Cedar's is,
and (b) the ordering-operator gap is real, even if its practical
impact is limited (tenant isolation and contradiction analyses
typically reduce to equality).

#### Ecosystem maturity

**Cedar — B**. Cedar was open-sourced by AWS in May 2023 and is
governed under the Cedar Policy organization on GitHub
(`github.com/cedar-policy`). Apache 2.0 licensed. The implementation
is Rust; bindings exist for Java, Python, JavaScript, Go, and
WebAssembly. Tooling includes a VS Code extension, a CLI, and
playground. Adoption is real but narrower than Rego's — Cedar is used
inside AWS (Verified Permissions, Verified Access) but its external
adopter base is younger and smaller. The grade reflects "real but not
ubiquitous."

**OPA/Rego — A**. OPA is a CNCF graduated project (CNCF graduation
2021), governed under cloud-native community processes, Apache 2.0
licensed, with a deep ecosystem: Gatekeeper for Kubernetes admission,
Conftest for testing, Styra DAS as commercial tooling, and adoption
across the cloud-native landscape. This is the broadest ecosystem of
any candidate.

**SpiceDB — B**. Apache 2.0, Authzed-led (single-vendor governance,
similar to HashiCorp's relationship to early Terraform). The
ecosystem is real — Authzed runs a hosted offering, an open-source
SpiceDB server, and a schema language with tooling. Single-vendor
control is a long-term governance concern.

**Oso Polar — F**. The Oso open-source library is officially
deprecated (Oso documentation, "Deprecating the Oso Open Source
Library"; GitHub `osohq/oso` is marked "Deprecated: See README"). Oso
has committed to critical bug fixes for at least 12 months from the
deprecation announcement, but the strategic direction is Oso Cloud,
which is a commercial hosted product, not an open-source library.
Adopting Polar as a source language means coupling this project to a
deprecated library on a 12-month-and-counting clock, with no
open-source successor announced as of this writing. The grade is `F`
on ecosystem maturity not because the language is bad but because the
sustainability is unacceptable.

**Custom DSL — C**. The custom DSL is internal to this project. Its
"ecosystem" is the repository: the grammar, the parser, the compiler,
the tests, and the documentation. There is no community, no
third-party tooling, no published academic adoption. The grade is `C`
rather than `D` because the implementation does ship with a working
parser, compiler, normalizer, nine proofs, golden-file tests, and
property-based tests — which is more than a research artifact. But it
is dimensionally a different beast from CNCF-graduated OPA.

#### Onramp and migration

**Cedar — B**. Cedar's syntax is close enough to a procedural-style
permission language that a security engineer can read it after thirty
minutes of documentation. The `permit/forbid/when/unless` structure
is intuitive. Migration from RLS to Cedar is not addressed by upstream
tooling. The mismatch on row-level scope (§ 2.2, expressiveness) is
the largest onramp friction: an engineer must internalize that Cedar
decides per request, not per row, and that mapping RLS predicates to
Cedar requires modeling rows as entities — an unfamiliar move.

**OPA/Rego — C+**. Rego's syntax is unusual: rule-based, Datalog-derived,
with deduplication-as-conjunction, `default` declarations, and "first
matching rule wins" semantics that diverges from imperative
expectations. Engineers report a meaningful learning curve. Migration
from RLS to Rego requires re-expressing predicates as Rego rules with
explicit input shape. The grade is held at `C+` rather than `C`
because Rego's documentation and learning resources are unmatched.

**SpiceDB — D**. The Zanzibar model — relations, permissions,
arrow-operators — is a different conceptual frame than RLS. Engineers
fluent in RLS must rewire their thinking to "what relations does this
user have to this object" rather than "what rows can this session
read." Migration from RLS to SpiceDB is not a syntactic mapping but a
modeling shift. Authzed publishes migration guides but they presuppose
the target is a SpiceDB-style permission model.

**Oso Polar — C**. Polar's Prolog roots present a learning curve for
engineers unfamiliar with logic programming. The host-application
integration (resource methods, class registration) is unfamiliar to
RLS authors. With the OSS library deprecated, investing in this
onramp seems imprudent regardless of merit.

**Custom DSL — A-**. The custom DSL was deliberately designed to echo
SQL where it could: column references, comparison operators, EXISTS
semantics on traversal atoms. The Appendix A example policies are
readable after one pass for any engineer who writes RLS. The grade is
`A-` rather than `A+` because there is, of course, no upstream
documentation, no third-party books, no Stack Overflow corpus —
onramp for a new author depends on the project's own documentation
holding up.

### 2.3 Disqualifications

A disqualified candidate has a fundamental gap that cannot be overcome
without compromising the project's core commitments. The bar is
"fundamental incompatibility," not "imperfect fit."

**Oso Polar is disqualified.** Not on technical grounds — Polar's
logic-programming model could plausibly be adapted to express
algebra-like predicates — but on the ecosystem-maturity dimension.
The Oso open-source library is officially deprecated (Oso
Documentation, "Deprecating the Oso Open Source Library"). The GitHub
repository carries the "Deprecated: See README" banner. Oso has
committed to critical bug fixes for at least twelve months from the
deprecation announcement, but the strategic direction is the
proprietary Oso Cloud product. Adopting Polar as the source language
of a project that expects to outlive the underlying parser by a
factor of years is a maintenance commitment the project would not
recover from. The disqualification is on sustainability, not
capability.

**SpiceDB schema language is disqualified.** SpiceDB's schemas
describe an authorization model — object types, relations, computed
permissions — not predicates over row-level data. The algebra's
atoms, clauses, and selectors do not map onto SpiceDB's relation
graph. The schema language is not a small-step mismatch but a
categorical one: SpiceDB is for graph-based permissions over named
resources, the algebra is for predicate-based row filtering over a
relational schema. Adopting SpiceDB's schema language would not be
"using SpiceDB"; it would be repurposing SpiceDB's syntax to mean
something its authors did not intend, with no formal or operational
support for that reinterpretation.

**OPA/Rego is not disqualified, but it is heavily downgraded.** Rego's
ecosystem is mature, its tooling is excellent, and its expression
sub-language is adequate. What disqualifies it from being recommended
is the combination of: (a) no formal denotational semantics
suitable for SMT encoding; (b) a runtime-evaluation orientation that
makes compile-to-SQL a project, not a feature; (c) a learning curve
that adds friction for the primary persona without offsetting benefit
in expressiveness. These accumulate; none alone is disqualifying.
Rego remains a candidate, but it does not advance to the head-to-head
in § 2.4.

**XACML is disqualified** (honorable mention; see § 2.5). The XML
syntax, the 50+ algorithm combinator surface, the lack of formal
semantics, and the long arc of low industry adoption together make
XACML a poor source language for any new project, the published
XACML 4.0 standard notwithstanding.

**Casbin is disqualified** (honorable mention; see § 2.5). Casbin's
PERM metamodel is a runtime evaluation framework, not a source
language with formal semantics or compile-time analysis tooling.

### 2.4 Viable Candidates

Two candidates emerge from § 2.2 and § 2.3 as viable: **Cedar** and
the **Custom DSL**. The decision is between them.

Cedar's strengths are large and rare: a Lean-formalized semantics with
mechanically verified properties, a Symbolic Compiler that proves
soundness and completeness for an SMT encoding covering most of the
algebra's analyses, Apache 2.0 licensing, AWS backing, and a broad
multi-language ecosystem. No other authorization DSL in this
evaluation matches Cedar on formal-methods rigor.

Cedar's weaknesses are also rare in the candidate set, but they are
load-bearing for *this project*: the entity-instance model does not
naturally express row-level predicates, the schema model assumes a
fixed entity declaration rather than runtime structural metadata, and
the natural compilation target is Cedar's own evaluation engine, not
PostgreSQL RLS. The strengths and weaknesses are not on the same
dimensions; the question is whether Cedar's strengths are worth the
work of adapting it.

The custom DSL's strengths are correspondingly narrow but exactly
aimed: the primitives match the algebra one-to-one, compilation to RLS
is the central operation rather than an afterthought, schema
integration is structural by design, and verification covers all five
analyses end-to-end against the algebra's own theorems. The
ecosystem cost is real and acknowledged on the matrix as `C`.

The head-to-head matters most along Axis 1 in § 3 below: borrowed
ecosystem maturity (Cedar) vs. structural fidelity to the algebra
(custom). The recommendation in § 4 resolves this.

### 2.5 Honorable Mentions

**Zanzibar (the model)**. As clarified in § 6.5, Zanzibar is a *model*
(relation tuples `user@object#relation`) rather than a syntactic
language. The model is foundational for SpiceDB and OpenFGA. SpiceDB's
disqualification (§ 2.3) covers the Zanzibar lineage on the relevant
dimensions. The Zanzibar paper itself is engineering-focused and does
not specify a syntactic DSL that this project could adopt; downstream
implementations (SpiceDB, OpenFGA) supply DSLs that diverge from one
another (Authzed's `.zed` vs. OpenFGA's DSL/JSON dual representation).
None of these would close the row-level-predicate gap that
disqualifies the lineage.

**OpenFGA** deserves a separate note. It is the other major Zanzibar
implementation (Apache 2.0, originated at Auth0, governance now in the
Cloud Native Computing Foundation as an incubating project; OpenFGA
language repository on GitHub uses ANTLR for its DSL with a
DSL-to-JSON compilation step). OpenFGA's expressive scope is the same
as SpiceDB's — relations and permissions over named objects — so the
same row-level mismatch applies. The ecosystem maturity is slightly
better than SpiceDB's (CNCF governance) but the categorical mismatch
on primitives makes ecosystem improvements moot for this project.

**Casbin** (Apache Software Foundation, Apache 2.0). Casbin's
PERM (Policy, Effect, Request, Matcher) metamodel uses INI-format
configuration files and an expression language in the matcher
(Casbin documentation, casbin.apache.org). Casbin supports ACL, RBAC,
ABAC, and several derived models. Casbin is an evaluation framework
with adapters for various stores — it is not a compile-to-something
toolchain. There is no formal semantics, no SMT integration, no
schema-integration story. The PERM model is closer to a runtime
matcher than to an analyzable algebra. Casbin is widely deployed
because it is convenient to embed, not because it is rigorous.

**XACML 4.0** (OASIS, January 2026; the previous major was XACML 3.0
in 2013). XACML is an XML-based standard for attribute-based access
control with PolicySet/Policy/Rule structure, Target and Condition
elements, and combining algorithms. The 4.0 revision adds a JSON
equivalent (JACAL) and modernizes some constructs. XACML's formal
semantics is documented but operational; the standard does not
specify a denotational semantics in a form usable for SMT encoding.
Adoption peaked in the mid-2000s and has declined steadily; major
implementations (AuthzForce, WSO2 Balana, Axiomatics) continue but
new green-field adoption is rare. The XML-first syntax is not
aligned with the project's audience (security engineers who write
RLS in SQL). XACML is rejected as a source language for the same
reasons it has lost mindshare elsewhere: verbose, ceremonial, and
operationally bound to its own decision-engine framework.

---

## 3. Trade-Off Axes

Three axes dominate the decision space. They organize the comparison
between Cedar and the custom DSL in the recommendation.

### 3.1 Axis 1: Borrowed ecosystem maturity vs. structural fidelity

Cedar arrives with a mechanically verified semantics, a published peer-
reviewed paper, an SMT-backed analysis toolkit, IDE extensions, and a
multi-language SDK matrix. The custom DSL arrives with none of these;
its only external presence is the algebra spec.

The trade is whether the project pays the cost of adapting Cedar's
per-instance model to row-level predicates — building a Cedar→RLS
compiler, modeling tables and rows in Cedar's entity-and-attribute
vocabulary, deferring or duplicating selector logic that has no Cedar
analogue — in exchange for inheriting Cedar's formal-methods position.

The custom DSL accepts the cost of building (and maintaining) its own
ecosystem in exchange for primitives that are exactly the algebra's
primitives.

This is the deepest axis. Most of the other dimensions resolve to
"which side of this trade are we on?"

### 3.2 Axis 2: Per-instance decisions vs. set-valued predicates

Cedar, SpiceDB, OpenFGA, and Casbin all decide per request: given a
specific principal, action, and resource, permit or forbid. This is the
operational shape of every modern authorization-as-a-service product.

RLS is a different beast. RLS does not decide per request; it filters
*row sets* against a predicate evaluated as part of the query. The
algebra's atoms — `col('tenant_id') = session('app.tenant_id')` — are
*set-valued* predicates expressed over rows, not per-row decisions.

The candidate set splits along this axis. Cedar can be coerced toward
set-valued predicates by modeling rows as entities or by treating a
table as a resource and quantifying over its rows externally, but the
coercion is friction. Rego is more flexible because its input model is
free-form, but the flexibility is paid for in expressive depth that
the algebra does not want. The custom DSL is set-valued natively.

The axis matters because the analyses in `policy-algebra.md` § 8 are
*set-valued questions*. "Does tenant isolation hold?" is a question
about all rows, all sessions, all tables. A per-instance decision
language has to be lifted into a set-valued analysis framework before
those questions can even be asked.

### 3.3 Axis 3: Verification rigor vs. compilation simplicity

Cedar's verification story is more rigorous than the custom DSL's:
Lean-mechanized, soundness/completeness proofs of the symbolic
compiler, a CVC5-backed analysis toolkit. The custom DSL's
verification story is rigorous but unmechanized — the algebra's
properties are stated in mathematical prose with proof sketches and
implemented against Z3 via a purpose-built encoder.

Cedar's compilation story, however, is non-existent for RLS. The
algebra's compilation story is the central operation — defined,
implemented, tested against golden files, and proved correct in prose.

The trade is between borrowing Cedar's verification (and writing the
compiler ourselves) vs. keeping the custom DSL (and accepting that
the verification is bespoke rather than mechanized).

These two engineering risks are not symmetric. The compilation
function for the custom DSL is implemented and shipping; replacing it
with a Cedar-to-RLS compiler is greenfield work of comparable scope to
the original implementation. The verification function for the custom
DSL is implemented and shipping with nine proofs; gaining mechanically
verified proofs would require either porting the algebra's theorems
into Lean or adopting Cedar's framework wholesale.

The custom DSL has shipped verification; Cedar has more rigorous
verification but no shipped compiler. The axis comes down to which
risk is more tolerable.

---

## 4. Recommendation

**The custom DSL defined in `policy-algebra.md` § 13 is retained as
the source language**, with selective adoption of *techniques* (not
syntax or semantics) from Cedar's verification approach. This is
answer (c) from the exit question — but it is justified, per the
brief, against what the alternatives offered, not against an
assumption of inertia.

The four options framed by the brief resolve as follows:

- **(a) Adopt an existing DSL as-is.** Rejected. No candidate
  expresses the algebra's row-level predicates, selectors, and
  bounded traversals without significant adaptation. Cedar is the
  closest, but Cedar's entity-instance decision model is not the
  algebra's set-valued predicate model (§ 3.2). The remaining
  candidates fail more basic requirements (formal semantics,
  compilability, ecosystem sustainability) before language fit even
  becomes the issue.

- **(b) Adopt an existing DSL with extensions or restrictions.**
  Rejected. The extensions Cedar would need to express row-level
  scope and selectors, and the bridges Rego or SpiceDB would need to
  reach a compile-to-RLS target, are individually larger than the
  custom DSL itself. The project would not be "using Cedar"; it
  would be "using Cedar's syntax to mean something Cedar's authors
  did not intend, with a custom compiler and a custom analyzer
  bolted on." That is not adoption; it is repurposing, and it
  loses Cedar's primary advantages (the upstream verification
  tooling and the matching analyses) in the process.

- **(c) Retain the custom DSL, justified in light of the
  alternatives.** Accepted. The custom DSL is the only candidate
  scoring `A` simultaneously on the four dimensions where the
  project's core commitments live (expressiveness, decidability,
  compilability, schema integration). Its weaknesses (`C` ecosystem
  maturity, `A-` rather than mechanized verification) are accepted
  costs that the alternatives do not improve on without introducing
  larger costs.

- **(d) Hybrid — adopt parts, custom parts.** Rejected at the
  *language* level (the source language is fully custom) but
  endorsed at the *technique* level (§ 4.4). The distinction
  matters: this ADR does not recommend mixing Cedar syntax with
  custom semantics, or custom syntax with Cedar evaluation. It
  recommends mechanizing the algebra's proofs in Lean (drawing on
  Cedar's example), aligning user-facing terminology with Cedar's
  analyses (drawing on Cedar's vocabulary), and building
  differential testing infrastructure (drawing on `cedar-drt`'s
  architecture). These borrowings do not change the language.

### 4.1 Why not Cedar (the closest competitor)

Cedar's strengths are real and unmatched in the candidate set: a
mechanically verified semantics, a soundness-and-completeness-proved
SMT compiler, a credible vendor (AWS), a permissive license, and a
healthy community. These would be decisive if the question were
"which authorization DSL has the best formal-methods position." They
are not decisive for *this project* because the project is not asking
that question. It is asking: which source language best supports
compilation to PostgreSQL RLS, analysis of row-level predicates, and
fan-out via structural selectors over a relational schema.

Cedar fails three requirements (§§ 1.4, 1.5, 1.1) that the custom DSL
meets by construction:

1. **Compilation target**. Cedar's expression model decides per
   `(principal, action, resource)`; RLS predicates filter row sets.
   A Cedar-to-RLS compiler does not exist upstream, and writing it
   would require either modeling each row as a Cedar entity (which
   does not scale and loses Cedar's per-instance analyzability) or
   bypassing Cedar's evaluation model entirely (which makes Cedar a
   syntax-and-grammar import, not a language adoption).

2. **Schema integration**. Cedar's schema is a fixed declaration of
   entity types, intended as input to the policy author. The
   algebra's selector model requires *consuming* runtime structural
   metadata to compute which tables a policy applies to. Cedar's
   schema validator is the wrong direction.

3. **Selector fan-out**. The Galois-connection structure of selectors
   (§ 6.4) — declaring `has_column('tenant_id')` once and matching
   `users`, `projects`, `comments`, plus any future table with that
   column — has no Cedar analogue. Cedar policies enumerate the
   resource types they apply to; new tables are not auto-covered.

These are not problems Cedar will fix; they are differences in the
modeling layer. Cedar is the right tool for "authorize this request,"
not "filter these rows."

The Cedar verification story is the strongest case for adoption, and
it is the case worth taking seriously. The disposition is to *borrow*
from Cedar's approach (see § 4.4) without adopting its language.

### 4.2 Why not OPA/Rego, SpiceDB, or Oso Polar

Each has been disqualified or downgraded in § 2.3. Briefly:

- **Rego** would require this project to invent the formal denotational
  semantics it needs for SMT encoding (the upstream language has only
  operational documentation), to build a Rego-to-RLS compiler from
  scratch, and to absorb a learning curve for the primary persona that
  buys no expressive benefit over the custom DSL.

- **SpiceDB** addresses a different category of authorization
  (graph-based permissions over named resources) and does not express
  row-level predicates. The mismatch is categorical, not stylistic.

- **Oso Polar** is built on a deprecated open-source library. The
  language merit is moot when the substrate is end-of-life.

### 4.3 Why the custom DSL — affirmatively

The custom DSL is retained because, evaluated on the rubric in § 2:

- It is the only candidate scoring `A` on compilability, schema
  integration, expressiveness, and decidability simultaneously.
- It ships with verification covering all five analyses (`A-` on the
  tooling dimension), and the gap to mechanized verification (Cedar's
  `A`) is real but not load-bearing for shipping behavior.
- It is implemented, tested, and working: the parser, normalizer,
  compiler, nine proofs, and drift detector are all in place.
- The onramp story is at parity with or better than every alternative
  except Rego's documentation depth, and Rego's expressive depth is
  more than the project wants.

The "no community" concern (`C` on ecosystem maturity) is the cost the
project pays. It is acknowledged in § 5.

### 4.4 What to borrow from Cedar

The custom DSL benefits from selectively adopting techniques from
Cedar's verification approach without adopting Cedar itself. Three
borrowings are recommended:

1. **Mechanize the algebra's theorems in a proof assistant.** Cedar's
   semantics is in Lean; the algebra's semantics is in prose. Porting
   `policy-algebra.md` § 14's theorems to Lean (or Coq, or Isabelle)
   is a non-trivial project but a tractable one, and it would lift the
   custom DSL's `A` on formal semantics to `A+`. This is a Phase 2+
   undertaking, not a PoC blocker.

2. **Adopt Cedar's analysis vocabulary.** Cedar names its analyses —
   "shadowed permits," "impossible conditions," "subsumption" — in
   ways that have entered the authorization literature. The algebra's
   contradiction and redundancy proofs cover the same ground. Aligning
   the project's user-facing terminology with Cedar's where the
   concepts coincide reduces friction for engineers who have read the
   Cedar paper or used Cedar Analysis.

3. **Adopt differential testing infrastructure modeled on
   `cedar-drt`.** Cedar's specification repository ships a property-
   based and differential testing harness against the Lean
   formalization. The custom DSL's property tests
   (`src/test/kotlin/com/pgpe/property/`) are good but narrower. Cedar
   demonstrates how a reference Lean implementation can serve as the
   oracle for differential testing of a Rust implementation; the same
   pattern could be applied between a hypothetical Lean port of the
   algebra and the Kotlin implementation.

These borrowings do not change the recommendation: the source language
remains the custom DSL.

---

## 5. Acknowledged Trade-Offs

The custom DSL is not the top-graded candidate in every dimension. The
trade-offs are explicit.

| Dimension                    | Custom DSL grade | Leader | Leader grade |
|------------------------------|:----------------:|:------:|:------------:|
| **Primitive expressiveness** |        A+        |   —    |      A+      |
| **Formal semantics**         |        A         | Cedar  |      A+      |
| **Decidability of fragment** |        A         |   —    |      A       |
| **Compilability to PG RLS**  |        A         |   —    |      A       |
| **Schema integration**       |        A         |   —    |      A       |
| **Verification tooling**     |        A-        | Cedar  |      A       |
| **Ecosystem maturity**       |        C         |  Rego  |      A       |
| **Onramp and migration**     |        A-        |   —    |      A-      |

The custom DSL is the leader or tied in six of eight dimensions. The
gaps are on two dimensions:

**Formal semantics (`A` vs Cedar's `A+`)**. The algebra's properties
are stated in mathematical prose and proved by hand or by SMT, but the
proofs are not mechanized. Cedar's properties are mechanized in Lean.
Mechanization adds confidence at the cost of effort; the project
accepts the gap as a known finite undertaking that does not block
shipping but is worth pursuing in Phase 2+ (§ 4.4). The risk of an
error in the algebra's prose proofs is non-zero but mitigated by
property-based testing against Z3 — every theorem has an executable
counterpart in the test suite.

**Verification tooling (`A-` vs Cedar's `A`)**. The custom DSL's SMT
encoder is sound but incomplete on ordering operators
(`SmtEncoder.kt`, lines 70–75 model `<`, `>`, `<=`, `>=` as
uninterpreted booleans). Cedar's encoding is mechanically verified
end-to-end. The project's gap is real but its practical impact is
limited: the dominant analyses (tenant isolation, contradiction,
satisfiability) reduce to equality reasoning, where the encoder is
complete. Tightening the ordering encoding to use Z3's integer or
real theories where the operand types permit is a known follow-up;
the conservative modeling currently produces `UNKNOWN` results in
edge cases rather than incorrect ones.

**Ecosystem maturity (`C` vs Rego's `A`)**. The custom DSL has no
community outside the project. Adopters cannot ask Stack Overflow,
cannot install a VS Code extension, cannot point at a published
specification on a standards body's site. This cost is paid in three
forms:

- *Documentation burden*. The project carries the entire load of
  explaining its own language. The algebra spec, ADR, PRD, and design
  doc together are 5,000+ lines; this is what "no upstream
  documentation" costs.
- *Hiring and onboarding*. Engineers who join the project learn a
  language nobody else uses. The learning curve is shallow (the DSL
  is small and SQL-adjacent), but the absence of recognition is real.
- *Tooling*. No IDE syntax highlighting beyond what ANTLR-based
  tooling provides; no linters, formatters, or auto-completers
  without project investment.

These costs are accepted because the alternative — adopting a
candidate with a worse fit on the load-bearing dimensions in exchange
for community — is a worse trade. But they should not be papered over.

The custom DSL also lacks two affordances that Cedar (and to a lesser
extent Rego) provides:

- *Multi-language SDK matrix*. Cedar has bindings in Rust, Java,
  Python, JavaScript, Go, and WebAssembly. The custom DSL has Kotlin.
  This matters if the engine is later embedded in non-JVM hosts.
- *Independent governance*. Cedar's stewardship is AWS-backed; Rego
  is CNCF-governed. The custom DSL's stewardship is whoever maintains
  this repository. A successor maintainer or an organizational change
  affects the DSL's continuity in a way that a CNCF project would
  resist.

These are not dimensions on which the rubric grades — they are
adjacent risks that the recommendation acknowledges.

---

## 6. Supporting Evidence from Resolved Open Questions

Five open questions surfaced during research. They are resolved inline
below, following the pattern in `architecture-decision.md` § 9.

### 6.1 Cedar's symbolic compiler — what does it actually cover?

**Status**: Resolved — Cedar Analysis covers four of the algebra's
five analyses by name; the fifth (tenant isolation) is expressible in
the same framework.

The AWS Open Source Blog announcement of Cedar Analysis (June 2025)
names the analyses the toolkit performs: equivalence between
policy versions, "more or less permissive after changes," shadowed
permits, impossible conditions, forbid overrides, and complete denials
(AWS Open Source Blog, *Introducing Cedar Analysis*). Cross-mapping to
the algebra:

| Algebra analysis         | Cedar Analysis                       | Coverage |
|--------------------------|--------------------------------------|----------|
| Satisfiability (§ 8.1)   | "Impossible conditions"              | Direct   |
| Subsumption (§ 8.2)      | "More/less permissive after changes" | Direct   |
| Redundancy (§ 8.3)       | "Shadowed permits"                   | Direct   |
| Contradiction (§ 8.4)    | "Complete denials"                   | Direct   |
| Tenant isolation (§ 8.5) | (Not named)                          | Indirect |

Tenant isolation is not a named Cedar analysis but it is expressible
as: "given two policy evaluations with sessions differing in
`app.tenant_id`, is there any row entity that satisfies both?" This is
the same satisfiability question the algebra's Theorem 8.1 reduces
to, and Cedar's symbolic compiler handles it. The absence of a named
analysis is a documentation gap, not a capability gap.

This finding reinforces the recommendation's "borrow from Cedar's
approach" disposition (§ 4.4): Cedar Analysis is the closest analog
in the industry to what the custom DSL does internally, and the
specific analyses align almost one-to-one.

### 6.2 Is selector fan-out emulable in Cedar?

**Status**: Resolved — partially emulable via templates, but at a cost
that defeats the purpose.

Cedar supports "policy templates" — policies parameterized by
principal or resource entity identifiers, instantiated against a
specific entity at decision time (Cedar documentation, *Policy
Templates*). A template could in principle take a table name as a
parameter and be instantiated for each governed table. This emulates
fan-out by *instantiating N policies rather than declaring one
selector-driven policy*.

The cost is that the instantiation is the user's job — Cedar does not
auto-discover which tables match a selector. The user must list the
tables, or write a build step that enumerates them. This loses the
declarative quality that makes selectors work in the algebra:
"any table with a `tenant_id` column is governed by tenant isolation"
becomes "for each table in the enumerated list `[users, projects,
comments]`, instantiate the template." The "auto-cover new tables"
property (Property 6.1, selector monotonicity) is lost; adding a new
`tenant_id`-bearing table requires touching the policy instantiation.

The conclusion is that Cedar can be made to produce the same SQL as
the custom DSL for a *fixed* schema, but cannot reproduce the
late-binding behavior that makes selectors operationally useful.

### 6.3 OPA's compilation modes — does any of them target SQL?

**Status**: Resolved — OPA can produce "partial evaluation" outputs
that can be specialized to SQL by external tooling, but no upstream
SQL emitter exists.

OPA's Compile API provides access to Rego's partial-evaluation
machinery: it accepts a query, a set of "unknown" inputs, and returns
a residual policy AST specialized against the known inputs (OPA
documentation, *REST API Reference* and *Evaluating a Data Filter
Policy*). The residual can be translated externally into SQL `WHERE`
clauses, Elasticsearch DSL, or other query targets — and OPA
documents this data-filtering pattern explicitly. Third-party
adapters (e.g., `opa-data-filter-spring-boot-starter`) implement
specific target translations.

What does not exist upstream is a stable, decidable subset of Rego
whose every authored policy compiles deterministically to RLS-style
USING expressions for arbitrary tables. The Compile API returns
residuals shaped by the author's input model; mapping those residuals
to `CREATE POLICY` for a target schema is the user's responsibility.
The existence of OPA's partial-evaluation framework makes it *less
hard* than building a Rego-to-SQL transpiler from scratch, but
not *easy*.

This finding does not change the recommendation but it qualifies the
"D" grade on OPA's compilability dimension: it is not impossible, it
is unfinished upstream work.

### 6.4 Decidable-fragment grading: should the matrix reflect full or restricted?

**Status**: Resolved per user clarification — grade the restricted
fragment used, note expressiveness lost.

This was clarified explicitly during requirements review for this
survey. The matrix in § 2.1 reflects restricted-fragment grading for
Rego (decidable subset only, sacrificing comprehensions, `every`,
inter-rule recursion) and for Cedar (the whole language is in the
Symbolic Compiler's decidable scope, so no restriction is needed —
Cedar earns its `A` on the unrestricted language). The grading
captures what the project would actually use, not what the candidate
admits in principle.

### 6.5 Zanzibar's role — model vs. language

**Status**: Resolved per user clarification — Zanzibar demoted to
honorable mention.

Zanzibar is a system architecture and data model, not a syntactic
language. The Zanzibar paper (Pang et al., USENIX ATC 2019) describes
the tuple model `user@object#relation`, the consistency model based on
Spanner, and the namespace-based partitioning scheme, but does not
define a DSL syntax. Downstream implementations (SpiceDB, OpenFGA)
each define their own DSLs over the same underlying tuple model.

Treating Zanzibar as a primary candidate would have meant grading
either the model abstractly (where the answers come from theoretical
properties of relation tuples) or the implementations (where the
answers are SpiceDB- and OpenFGA-specific). The clarification
demoted Zanzibar to an honorable mention, with SpiceDB carrying the
Zanzibar lineage in the main matrix. OpenFGA is acknowledged in
§ 2.5 with the same disposition.

---

## 7. Migration Implications

The recommendation in § 4 retains the custom DSL. No migration of
existing artifacts is implied: the algebra spec stands, the ADR on
implementation language stands, the parser, normalizer, compiler,
SMT encoder, and proofs continue to be the right modules.

The selective borrowings from Cedar (§ 4.4) imply three forward-
looking workstreams, none of which is in the PoC critical path.

### 7.1 Lean port of the algebra (Phase 2+)

Mechanizing `policy-algebra.md` § 14's properties in Lean would lift
the formal-semantics grade from `A` to `A+`. The scope:

- Port the algebra's types (`ValueSource`, `Atom`, `Clause`, `Policy`,
  `Selector`) into Lean inductive types.
- Port the denotation function `⟦·⟧` as a Lean definition over the
  inductive types.
- Port the normalization function and prove `⟦normalize(p)⟧ = ⟦p⟧`
  (Property 9.2).
- Port the compilation function and prove the structural-induction
  version of Theorem 10.1.
- Establish differential testing between the Lean reference
  implementation and the Kotlin production implementation, modeled on
  `cedar-drt`.

This is a multi-month workstream by an engineer with both Kotlin and
Lean familiarity. It is the highest-leverage borrowing from Cedar.

### 7.2 User-facing terminology alignment (Phase 1)

Aligning the analyses' user-facing names with Cedar's terminology
where the concepts coincide reduces friction. The mapping:

| Algebra (internal) | User-facing (Cedar-aligned)    |
|--------------------|--------------------------------|
| "satisfiability"   | "impossibility detection"      |
| "subsumption"      | "permissiveness comparison"    |
| "redundancy"       | "shadowed-policy detection"    |
| "contradiction"    | "complete-denial detection"    |
| "tenant isolation" | (no Cedar analog — keep as-is) |

The internal vocabulary in the algebra spec, code, and tests should
not change; only the CLI output, JSON field names, and user-facing
documentation should align. This is `pgpe analyze --format json` ergonomics, not algebra refactoring.

### 7.3 Differential testing infrastructure (Phase 2+)

Once the Lean port (§ 7.1) exists, differential testing can compare
the Kotlin and Lean implementations on:

- Parser output (does the Kotlin AST match the Lean inductive value?)
- Normalization output (does the Kotlin normalizer produce the same
  canonical form as the Lean function?)
- Compilation output (is the emitted SQL identical?)
- Analysis verdicts (do both produce the same SAT/UNSAT/UNKNOWN?)

The differential harness should generate random policies, run both
implementations, and assert agreement. Cedar's `cedar-drt` is a
reference architecture; the implementation is feasible in Kotlin
calling out to a `lean --run` subprocess, or — once the Lean code is
extracted to OCaml or compiled to C — via FFI.

### 7.4 What does *not* change

The following are not touched by the recommendation:

- `spec/policy-algebra.md` — the algebra spec is the source of truth.
- `spec/architecture-decision.md` — the Kotlin/JVM decision stands.
- `spec/product-requirements.md` — personas, user stories, scope
  boundaries are unaffected.
- `src/main/antlr/PolicyDsl.g4` — the grammar is the algebra's
  Section 13 BNF transcribed into ANTLR; no changes warranted.
- `src/main/kotlin/com/pgpe/ast/Types.kt` — the sealed-class AST is
  unchanged.
- `src/main/kotlin/com/pgpe/analysis/SmtEncoder.kt` — the SMT
  encoding is unchanged; tightening the ordering-operator encoding
  (the `A-` rather than `A` on verification tooling) is a known
  follow-up tracked separately from this ADR.
- `src/main/kotlin/com/pgpe/compiler/SqlCompiler.kt` — the
  compilation function is unchanged.
- The nine proofs in `src/main/kotlin/com/pgpe/analysis/proofs/` —
  unchanged; renaming for terminology alignment (§ 7.2) is a CLI
  concern, not an internal one.
- `policies/tenant-isolation.policy` and the golden files under
  `src/test/resources/golden/` — unchanged.

The recommendation is "keep the custom DSL." The migration
implications are correspondingly small. The borrowings from Cedar are
forward-looking optimizations, not corrections.

---

## Appendix: Traceability Matrix

| Requirement              | Source                                       |
|--------------------------|----------------------------------------------|
| Primitive expressiveness | `policy-algebra.md` §§ 2, 3, 4, 6, 7         |
| Formal semantics         | `policy-algebra.md` § 14 (theorems 1.1–12.2) |
| Decidability             | `policy-algebra.md` § 1.1, § 2.5             |
| Compilability to RLS     | `policy-algebra.md` § 10                     |
| Schema integration       | `policy-algebra.md` § 6.2                    |
| Verification tooling     | `policy-algebra.md` § 8                      |
| Ecosystem maturity       | PRD § 3, § 5                                 |
| Onramp                   | PRD § 3.1                                    |
| Leave-no-trace           | `architecture-decision.md` § 1.6.1           |

Every grade in § 2.1 is justified in § 2.2; every disqualification in
§ 2.3 is reasoned against the requirements in § 1; every borrowing in
§ 4.4 traces to a Cedar feature documented in primary sources cited
in § 2.2 and § 6.

## Appendix: Primary Sources Cited

- Cutler, Disselkoen, Eline, He, Headley, Hicks, Hietala, Ioannidis,
  Kastner, Mamat, McAdams, McCutchen, Rungta, Torlak, Wells (2024).
  *Cedar: A New Language for Expressive, Fast, Safe, and Analyzable
  Authorization* (Extended Version). arXiv:2403.04651. Conference
  version at OOPSLA 2024.
- AWS Open Source Blog (June 2025). *Introducing Cedar Analysis: Open
  Source Tools for Verifying Authorization Policies*.
- Cedar documentation. `docs.cedarpolicy.com`, including
  *Cedar Policy Syntax* and *Cedar Entity Model*.
- Cedar Spec repository. `github.com/cedar-policy/cedar-spec`,
  containing `cedar-lean` (Lean formalization), `cedar-drt`
  (differential testing), and `cedar-policy-generators`.
- `cedar-policy-symcc`. crates.io. Cedar Symbolic Compiler crate using
  CVC5.
- OPA Policy Language documentation. `openpolicyagent.org/docs/policy-language`.
- CNCF Open Policy Agent project page. CNCF graduation 2021.
- Authzed (SpiceDB) Schema Language Reference. `authzed.com/docs/spicedb/concepts/schema`.
- SpiceDB GitHub repository. `github.com/authzed/spicedb`, Apache 2.0.
- OpenFGA documentation. `openfga.dev/docs/configuration-language`.
- OpenFGA language repository. `github.com/openfga/language`,
  ANTLR-based DSL with DSL↔JSON compilation.
- Oso documentation. `osohq.com/docs`, including the *Polar Language*
  reference and the *Deprecating the Oso Open Source Library*
  announcement.
- `github.com/osohq/oso`. "Deprecated: See README" status as of
  retrieval.
- Apache Casbin documentation. `casbin.apache.org/docs/how-it-works`,
  PERM metamodel.
- OASIS XACML Standard. XACML 3.0 (2013) and XACML 4.0 (January 2026).
- Pang et al. (2019). *Zanzibar: Google's Consistent, Global
  Authorization System*. USENIX ATC 2019.

---

*End of Architecture Decision Record on source language selection.*
